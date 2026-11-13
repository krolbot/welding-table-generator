import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import type { FabricationPart } from '../geometry'
import { arrangeParts } from '../fabricationLayout'
import { validateNesting, type NestingResult } from '../nesting'
import { automaticNestingOptions } from '../nestingSettings'
import { downloadFile } from '../projectIO'
import { extensionAssembly, extensionDefaults, extensionDimensions, extensionParts, type ExtensionConfig } from './extension'
import { squareDefaults, squareParts, type SquareConfig } from './square'

export type ToolId = 'extension' | 'square'
export type ToolSheet = { length: number; width: number; edgeGap: number; partGap: number }
type ProjectBase = { version: 2; sheet: ToolSheet; copies: number }
export type ToolProject = ProjectBase & ({ tool: 'extension'; size: ExtensionConfig } | { tool: 'square'; size: SquareConfig })
type Vector3 = [number, number, number]
export type ToolPlacement = { part: string; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }

export const toolLabels: Record<ToolId, string> = { extension: 'Welding-table extension', square: 'Flat welding square' }
export const defaultToolProject: ToolProject & { tool: 'extension' } = {
  version: 2, tool: 'extension', size: { ...extensionDefaults },
  sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 }, copies: 1,
}
export const defaultSquareProject: ToolProject & { tool: 'square' } = {
  version: 2, tool: 'square', size: { ...squareDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}

const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value)
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const number = (value: unknown) => { if (typeof value !== 'number') throw new Error('Project numeric fields must be numbers'); return value }

/** Version 2 extension data is unchanged; old box projects are never silently converted. */
export const parseToolProject = (text: string): ToolProject => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('Project JSON is invalid') }
  const root = object(raw)
  if (!root || !exactKeys(root, ['version', 'tool', 'size', 'sheet', 'copies'])) throw new Error('Project has unknown or missing fields')
  if (root.tool === 'extension' && root.version === 1) throw new Error('This project uses the retired box design. It cannot be silently converted into wedge cutting plans. Download the original JSON before starting the corrected design.')
  if (root.version !== 2 || root.tool !== 'extension' && root.tool !== 'square') throw new Error('Unsupported project version or tool')
  const size = object(root.size), sheet = object(root.sheet)
  const sizeKeys = root.tool === 'extension' ? ['length', 'width', 'height', 'thickness'] : ['length', 'width', 'armWidth', 'thickness', 'holeDiameter', 'endOffset']
  if (!size || !exactKeys(size, sizeKeys) || !sheet || !exactKeys(sheet, ['length', 'width', 'edgeGap', 'partGap'])) throw new Error('Project dimensions are malformed')
  const base: ProjectBase = {
    version: 2, sheet: { length: number(sheet.length), width: number(sheet.width), edgeGap: number(sheet.edgeGap), partGap: number(sheet.partGap) }, copies: number(root.copies),
  }
  if (!finite(base.sheet.length, 100, 6000) || !finite(base.sheet.width, 100, 6000) || !finite(base.sheet.edgeGap, 0, 100) || !finite(base.sheet.partGap, 0, 100) || !Number.isInteger(base.copies) || base.copies < 1 || base.copies > 10) throw new Error('Project sheet or copy count is outside supported limits')
  const common = { length: number(size.length), width: number(size.width), thickness: number(size.thickness) }
  const project: ToolProject = root.tool === 'extension'
    ? { ...base, tool: 'extension', size: { ...common, height: number(size.height) } }
    : { ...base, tool: 'square', size: { ...common, armWidth: number(size.armWidth), holeDiameter: number(size.holeDiameter), endOffset: number(size.endOffset) } }
  projectModelParts(project)
  return project
}

export const projectJson = (project: ToolProject) => JSON.stringify(project)
export const projectKey = (project: ToolProject) => JSON.stringify([project.version, project.tool, Object.entries(project.size).sort(([a], [b]) => a.localeCompare(b)), project.sheet.length, project.sheet.width, project.sheet.edgeGap, project.sheet.partGap, project.copies])
export const projectModelParts = (project: ToolProject): FabricationPart[] => project.tool === 'extension' ? extensionParts(project.size) : squareParts(project.size)
export const projectParts = (project: ToolProject): FabricationPart[] => projectModelParts(project).map(part => ({ ...part, count: part.count * project.copies }))
export const projectEnvelope = (project: ToolProject) => ({ length: project.size.length, width: project.size.width, height: project.tool === 'extension' ? project.size.height : project.size.thickness })
export const projectAssembly = (project: ToolProject): ToolPlacement[] => project.tool === 'extension' ? extensionAssembly(project.size) : [
  { part: 'square', instance: 0, origin: [0, 0, project.size.thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
]
export const projectNestingOptions = (project: ToolProject) => ({ ...automaticNestingOptions(project.sheet), attempts: 60 })

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

const fabricationNotes = (project: ToolProject) => project.tool === 'extension'
  ? 'Wedge extension: seven flat parts with locating tabs and matching notches/mortises. X points away from the host table, the high mounting end is X=0, and the horizontal working top is Z=height.\nReference envelope: 500x200x200 mm, T6, D16/50. Free-end height, joint stations/0.2 mm total clearance, slot origins, radii and window dimensions are proposed, not manufacturer measurements. Assemble the two sides, high mounting end, low free end and two cross ties; seat the working top over their tabs before tack welding. Confirm joint fit and welding access on a sample first.\n'
  : 'Flat welding square: one planar L-shaped plate, not a bent or welded angle. The reference shows a 250x250 mm envelope and three holes, but no manufacturing drawing. Arm width, thickness, hole diameter and end offsets are our editable design assumptions. The corner hole is at half the arm width on both axes; end holes are inset from each free end. No bend or weld is required by this model. Confirm hole alignment against your actual table; this model does not guarantee that custom dimensions lie on its grid. The nominal 90 degree contour does not establish the accuracy or flatness of a cut part; finish and measure working edges as needed.\n'

export const toolPartsArchive = (project: ToolProject) => {
  parseToolProject(projectJson(project))
  const zip = new JSZip()
  projectParts(project).forEach(part => zip.file(`parts/${part.name}_${part.count}pcs.dxf`, nativeDxfForPart(part)))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('assembly.json', JSON.stringify({ version: 2, tool: project.tool, units: 'mm', axes: project.tool === 'extension' ? 'X away from host table; Y across; Z up' : 'X/Y in the flat plate; Z through thickness', ...(project.tool === 'extension' ? { joinery: extensionDimensions(project.size) } : {}), placements: projectAssembly(project) }, null, 2))
  zip.file('README.txt', fabricationNotes(project) + 'All DXFs use nominal millimetres. Check the actual table and locking hardware, steel grade, loads, weld sequence/distortion where relevant and CAM kerf/lead-ins/cut order before fabrication. No structural rating or physical fit validation is supplied.\n')
  return zip
}

export const toolArchive = (project: ToolProject, result: NestingResult, key: string) => {
  if (!validProjectLayout(project, result, key)) throw new Error('Layout is incomplete, stale or invalid for the current project')
  const zip = toolPartsArchive(project)
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`sheets/Sheet_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  zip.file('layout.json', JSON.stringify({ version: 1, units: 'mm', projectKey: key, nesting: projectNestingOptions(project), placements: result.placements.map(({ part, instance, sheet, rotation, translation }) => ({ part: part.name, instance, sheet, rotation, translation })), stats: result.stats }, null, 2))
  return zip
}

export const downloadToolArchive = async (project: ToolProject, result: NestingResult, key: string) => {
  downloadFile(await toolArchive(project, result, key).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Sheets.zip`)
}
export const downloadToolParts = async (project: ToolProject) => {
  downloadFile(await toolPartsArchive(project).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Parts.zip`)
}
export const toolStripDxf = (project: ToolProject) => nativeDxfForNestedSheet(arrangeParts(projectModelParts(project)).instances.map(({ part, instance, position }) => ({ part, instance, translation: position, rotation: 0, sheet: 0 })))
export const downloadToolStrip = (project: ToolProject) => downloadFile(toolStripDxf(project), `WeldingTable_${project.tool}_Strip.dxf`, 'application/dxf')
