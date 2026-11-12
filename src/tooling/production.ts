import JSZip from 'jszip'
import { assertFabricationReady, contourLength, makeParts } from '../geometry.js'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf.js'
import { projectConfig, type Config } from '../model.js'
import { validateNesting, type NestingOptions, type NestingResult } from '../nesting.js'
import { buildToolingAssembly } from './build.js'
import { createToolingConfig } from './catalog.js'
import { estimatePartMassKg } from './bom.js'
import { assertA10B08Compatibility, assertA13B14Compatibility } from './validation.js'
import { materialDensityKgPerMm3, type PurchasedComponent, type SheetMaterial, type SheetPart, type ToolingAssembly } from './model.js'
import { PROJECT_VERSION, type CombinedProject, type ToolingBasketItem } from './project.js'

export type NestingSettings = {
  sheetLength: number
  sheetWidth: number
  edgeGap: number
  partGap: number
  rotations: readonly number[]
}

export type ProductionPart = SheetPart & {
  source: { kind: 'table' | 'tooling'; lineId: string; toolingId?: string; partName: string }
}
export type ProductionGroup = { key: string; material: SheetMaterial; thickness: number; parts: ProductionPart[] }
export type BuiltLine = { line: ToolingBasketItem; assembly: ToolingAssembly }
export type ProductionModel = {
  project: CombinedProject
  lines: BuiltLine[]
  groups: ProductionGroup[]
  purchased: Array<PurchasedComponent & { lineId: string; toolingId: string; assemblyName: string }>
  massKg: number
  cutLengthM: number
}

const safeName = (value: string) => value.replaceAll(/[^A-Za-z0-9._-]+/g, '_')
const groupKey = (material: SheetMaterial, thickness: number) => `${material}:${thickness}`
const cloneToolingPart = (line: ToolingBasketItem, part: SheetPart): ProductionPart => ({
  ...part,
  name: `tool:${line.instanceId}:${part.name}`,
  label: `${line.config.id} ${part.label}`,
  count: part.count * line.quantity,
  material: line.material,
  densityKgPerMm3: materialDensityKgPerMm3[line.material],
  source: { kind: 'tooling', lineId: line.instanceId, toolingId: line.config.id, partName: part.name },
})

export const buildProductionModel = (table: Config, tooling: ToolingBasketItem[], includeTable: boolean): ProductionModel => {
  const ids = new Set<string>()
  const lines = tooling.map(line => {
    if (ids.has(line.instanceId)) throw new Error(`Duplicate basket line ${line.instanceId}`)
    ids.add(line.instanceId)
    const built = buildToolingAssembly(line.config)
    const assembly: ToolingAssembly = {
      ...built,
      parts: built.parts.map(part => ({ ...part, material: line.material, densityKgPerMm3: materialDensityKgPerMm3[line.material] })),
    }
    return { line, assembly }
  })
  const a10 = tooling.filter(line => line.config.id === 'A10').map(line => createToolingConfig('A10', line.config.values))
  const b08 = tooling.filter(line => line.config.id === 'B08').map(line => createToolingConfig('B08', line.config.values))
  const a13 = tooling.filter(line => line.config.id === 'A13').map(line => createToolingConfig('A13', line.config.values))
  const b14 = tooling.filter(line => line.config.id === 'B14').map(line => createToolingConfig('B14', line.config.values))
  const everyHasMatch = <A, B>(first: readonly A[], second: readonly B[], check: (a: A, b: B) => void) => !first.length || !second.length || (
    first.every(a => second.some(b => { try { check(a, b); return true } catch { return false } }))
    && second.every(b => first.some(a => { try { check(a, b); return true } catch { return false } }))
  )
  if (!everyHasMatch(a10, b08, assertA10B08Compatibility)) throw new Error('A10/B08 basket lines have no compatible insert/holder counterpart')
  if (!everyHasMatch(a13, b14, assertA13B14Compatibility)) throw new Error('A13/B14 basket lines have no compatible slat/module counterpart')
  const parts: ProductionPart[] = lines.flatMap(({ line, assembly }) => assembly.parts.map(part => cloneToolingPart(line, part)))
  if (includeTable) {
    assertFabricationReady(table)
    parts.push(...makeParts(table).map(part => ({
      ...part,
      name: `table:${part.name}`,
      material: 'S235JR' as const,
      densityKgPerMm3: materialDensityKgPerMm3.S235JR,
      role: part.label,
      process: 'laser-cut' as const,
      interfaces: [],
      source: { kind: 'table' as const, lineId: 'table', partName: part.name },
    })))
  }
  const grouped = new Map<string, ProductionGroup>()
  for (const part of parts) {
    const key = groupKey(part.material, part.thickness)
    const current = grouped.get(key) ?? { key, material: part.material, thickness: part.thickness, parts: [] }
    current.parts.push(part)
    grouped.set(key, current)
  }
  const groups = [...grouped.values()].sort((a, b) => a.material.localeCompare(b.material) || a.thickness - b.thickness)
  for (const group of groups) {
    const count = group.parts.reduce((sum, part) => sum + part.count, 0)
    if (count > 256) throw new Error(`${group.key} contains ${count} parts; the verified nesting limit is 256`)
  }
  const purchased = lines.flatMap(({ line, assembly }) => assembly.purchased.map(item => ({
    ...item,
    quantity: item.quantity * line.quantity,
    lineId: line.instanceId,
    toolingId: line.config.id,
    assemblyName: assembly.name,
  })))
  const massKg = parts.reduce((sum, part) => sum + estimatePartMassKg(part) * part.count, 0)
  const cutLengthM = parts.reduce((sum, part) => sum + part.count * (part.contours.reduce((length, contour) => length + contourLength(contour), 0) + part.holes.reduce((length, hole) => length + Math.PI * hole.d, 0)), 0) / 1000
  return {
    project: { version: PROJECT_VERSION, table: projectConfig(table), includeTable, tooling },
    lines, groups, purchased, massKg, cutLengthM,
  }
}

export const nestingOptionsFor = (settings: NestingSettings): NestingOptions => ({
  sheet: { width: settings.sheetLength, height: settings.sheetWidth },
  edgeClearance: settings.edgeGap,
  partClearance: settings.partGap,
  rotations: settings.rotations,
  maxSheets: 32,
  attempts: 128,
})

export const productionNestingKey = (model: ProductionModel, settings: NestingSettings) => JSON.stringify({
  project: model.project,
  settings,
  parts: model.groups.map(group => [group.key, group.parts]),
})

export const validateProductionNesting = (model: ProductionModel, results: Readonly<Record<string, NestingResult>>, settings: NestingSettings) => {
  const options = nestingOptionsFor(settings)
  for (const group of model.groups) {
    const result = results[group.key]
    if (!result || result.unplaced.length || !result.validation.valid) return false
    if (result.placements.length !== group.parts.reduce((sum, part) => sum + part.count, 0)) return false
    const expected = new Map(group.parts.map(part => [part.name, part]))
    const instances = new Set<string>()
    for (const placement of result.placements) {
      const part = expected.get(placement.part.name)
      const key = `${placement.part.name}:${placement.instance}`
      if (!part || JSON.stringify(part) !== JSON.stringify(placement.part) || placement.instance < 0 || placement.instance >= part.count || instances.has(key)) return false
      instances.add(key)
    }
    if (!validateNesting(result.placements, options).valid) return false
  }
  return model.groups.length > 0
}

const csv = (rows: Array<Array<string | number>>) => rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n') + '\n'

export const productionArchive = (model: ProductionModel, results: Readonly<Record<string, NestingResult>>, settings: NestingSettings) => {
  if (!validateProductionNesting(model, results, settings)) throw new Error('The sheet layout is incomplete, stale or invalid')
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(model.project, null, 2))
  const sheetRows: Array<Array<string | number>> = [['material', 'thickness_mm', 'source', 'tooling_id', 'part', 'quantity', 'mass_kg']]
  for (const group of model.groups) for (const part of group.parts) {
    sheetRows.push([part.material, part.thickness, part.source.kind, part.source.toolingId ?? '', part.source.partName, part.count, (estimatePartMassKg(part) * part.count).toFixed(4)])
    const lineNumber = part.source.kind === 'table' ? 0 : model.project.tooling.findIndex(line => line.instanceId === part.source.lineId) + 1
    zip.file(`parts/${String(lineNumber).padStart(3, '0')}_${safeName(part.source.partName)}_${part.count}pcs.dxf`, nativeDxfForPart(part))
  }
  zip.file('bom-sheet.csv', csv(sheetRows))
  zip.file('bom-purchased.csv', csv([
    ['line_id', 'tooling_id', 'assembly', 'component_id', 'description', 'quantity', 'interface_parameters'],
    ...model.purchased.map(item => [item.lineId, item.toolingId, item.assemblyName, item.id, item.description, item.quantity, JSON.stringify(item.interfaceParameters)]),
  ]))
  const placementManifest: Record<string, unknown> = { schemaVersion: 1, engine: 'contour-nfp-v2', units: 'mm', holesNestable: false, nominalContours: true, globalOptimalityProven: false, settings, groups: {} }
  for (const group of model.groups) {
    const result = results[group.key]
    const folder = `sheets/${safeName(group.material)}_${group.thickness}mm`
    result.sheets.forEach(sheet => zip.file(`${folder}/Sheet_${sheet.index + 1}.dxf`, nativeDxfForNestedSheet(sheet.placements)))
    ;(placementManifest.groups as Record<string, unknown>)[group.key] = {
      material: group.material,
      thickness: group.thickness,
      parts: group.parts.map(part => ({ name: part.name, source: part.source, count: part.count })),
      placements: result.placements.map(value => ({ part: value.part.name, source: (value.part as ProductionPart).source, instance: value.instance, sheet: value.sheet, rotation: value.rotation, translation: value.translation })),
      validation: result.validation,
      stats: result.stats,
    }
  }
  zip.file('placement-manifest.json', JSON.stringify(placementManifest, null, 2))
  zip.file('assembly-transforms.json', JSON.stringify(model.lines.map(({ line, assembly }) => ({ lineId: line.instanceId, toolingId: line.config.id, quantity: line.quantity, instances: assembly.instances, joints: assembly.joints })), null, 2))
  zip.file('validation.json', JSON.stringify({ valid: true, groups: model.groups.map(group => ({ key: group.key, validation: results[group.key].validation, unplaced: results[group.key].unplaced.length })), generatedFromProjectVersion: model.project.version }, null, 2))
  zip.file('README.txt', [
    'Welding table and tooling production package',
    'All dimensions are nominal millimetres. DXF entities are native LINE, ARC and CIRCLE.',
    'Sheet groups are separated by material and thickness. Purchased components are excluded from sheets.',
    'Assembly transforms use XYZ rotations in degrees and translations in millimetres; see assembly-transforms.json.',
    'Match every part and basket line using placement-manifest.json before fabrication.',
    'Kerf, lead-ins, clamps, cutting order, weld procedure and machine-specific minimum webs require independent CAM/fabrication verification.',
    'No load rating, accuracy class or proof of global nesting optimality is claimed.',
  ].join('\n') + '\n')
  return zip
}

export const downloadProductionArchive = async (model: ProductionModel, results: Readonly<Record<string, NestingResult>>, settings: NestingSettings) => {
  const blob = await productionArchive(model, results, settings).generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'WeldingTable_Tooling_Production.zip'
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}
