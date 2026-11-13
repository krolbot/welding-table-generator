import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import type { FabricationPart } from '../geometry'
import { validateNesting, type NestingResult } from '../nesting'
import { extensionAssembly, extensionDefaults, extensionParts, type ExtensionConfig } from './extension'

export type ToolProject = {
  version: 1
  tool: 'extension'
  size: ExtensionConfig
  sheet: { length: number; width: number; edgeGap: number; partGap: number }
  copies: number
}

export const defaultToolProject: ToolProject = {
  version: 1, tool: 'extension', size: { ...extensionDefaults },
  sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 }, copies: 1,
}

const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value)
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Strictly decodes saved/share data; callers retain the last valid project on failure. */
export const parseToolProject = (text: string): ToolProject => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Project JSON is invalid') }
  const root = object(raw)
  if (!root || !exactKeys(root, ['version', 'tool', 'size', 'sheet', 'copies'])) throw new Error('Project has unknown or missing fields')
  if (root.version !== 1 || root.tool !== 'extension') throw new Error('Unsupported project version or tool')
  const size = object(root.size), sheet = object(root.sheet)
  if (!size || !exactKeys(size, ['length', 'width', 'height', 'thickness']) || !sheet || !exactKeys(sheet, ['length', 'width', 'edgeGap', 'partGap'])) throw new Error('Project dimensions are malformed')
  const number = (value: unknown) => { if (typeof value !== 'number') throw new Error('Project numeric fields must be numbers'); return value }
  const project: ToolProject = {
    version: 1, tool: 'extension',
    size: { length: number(size.length), width: number(size.width), height: number(size.height), thickness: number(size.thickness) },
    sheet: { length: number(sheet.length), width: number(sheet.width), edgeGap: number(sheet.edgeGap), partGap: number(sheet.partGap) }, copies: number(root.copies),
  }
  if (!finite(project.sheet.length, 100, 6000) || !finite(project.sheet.width, 100, 6000) || !finite(project.sheet.edgeGap, 0, 100) || !finite(project.sheet.partGap, 0, 100) || !Number.isInteger(project.copies) || project.copies < 1 || project.copies > 10) throw new Error('Project sheet or copy count is outside supported limits')
  try { extensionParts(project.size) } catch (error) { throw new Error(error instanceof Error ? error.message : 'Project extension dimensions are invalid') }
  return project
}

export const projectJson = (project: ToolProject) => JSON.stringify(project)
export const projectKey = (project: ToolProject) => projectJson(project)
export const projectParts = (project: ToolProject): FabricationPart[] => extensionParts(project.size).map(part => ({ ...part, count: part.count * project.copies }))
export const projectNestingOptions = (project: ToolProject) => ({
  sheet: { width: project.sheet.length, height: project.sheet.width }, edgeClearance: project.sheet.edgeGap + 0.002,
  partClearance: project.sheet.partGap + 0.002, rotations: Array.from({ length: 24 }, (_, index) => index * 15), maxSheets: 32, attempts: 60,
})

/** Rejects a result whose parts, instances, sheets or geometry no longer match this project. */
export const validProjectLayout = (project: ToolProject, result: NestingResult | undefined, key: string | undefined) => {
  if (!result || key !== projectKey(project) || result.unplaced.length || !result.validation.valid) return false
  const parts = projectParts(project), expected = parts.reduce((sum, part) => sum + part.count, 0)
  if (result.placements.length !== expected || !result.placements.length) return false
  const seen = new Set<string>()
  for (const placement of result.placements) {
    const canonical = parts.find(part => part.name === placement.part.name)
    const id = `${placement.part.name}:${placement.instance}`
    if (!canonical || JSON.stringify(placement.part) !== JSON.stringify(canonical) || placement.instance < 0 || placement.instance >= canonical.count || !Number.isInteger(placement.instance) || seen.has(id)) return false
    seen.add(id)
  }
  const sheets = [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b)
  return sheets.every((sheet, index) => sheet === index) && validateNesting(result.placements, projectNestingOptions(project)).valid
}

export const extensionArchive = (project: ToolProject, result: NestingResult, key: string) => {
  if (!validProjectLayout(project, result, key)) throw new Error('Layout is incomplete, stale or invalid for the current project')
  const zip = new JSZip(), parts = projectParts(project)
  parts.forEach(part => zip.file(`parts/${part.name}_${part.count}pcs.dxf`, nativeDxfForPart(part)))
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`sheets/Sheet_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('layout.json', JSON.stringify({ version: 1, units: 'mm', projectKey: key, nesting: projectNestingOptions(project), placements: result.placements.map(({ part, instance, sheet, rotation, translation }) => ({ part: part.name, instance, sheet, rotation, translation })), stats: result.stats }, null, 2))
  zip.file('assembly.json', JSON.stringify({ version: 1, units: 'mm', placements: extensionAssembly(project.size) }, null, 2))
  zip.file('README.txt', 'Extension analogue: independently engineered, not a vendor drawing.\nNominal dimensions are millimetres. Mount to the actual table before cutting. Verify weld sequence/distortion, fit-up, clamp/load requirements and CAM kerf, lead-ins, tabs and cutting order.\n')
  return zip
}

export const downloadExtensionArchive = async (project: ToolProject, result: NestingResult, key: string) => {
  const blob = await extensionArchive(project, result, key).generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'WeldingTable_Extension_Analogue.zip'; anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}
