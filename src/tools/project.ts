import type { FabricationPart } from '../geometry'
import type { NestingResult } from '../nesting'
import { validNestingInventory } from '../nestingJob'
import { automaticNestingOptions } from '../nestingSettings'
import { extensionAssembly, extensionDefaults, extensionParts, type ExtensionConfig } from './extension'
import { compactExtensionAssembly, compactExtensionDefaults, compactExtensionParts, type CompactExtensionConfig } from './compactExtension'
import { squareDefaults, squareParts, type SquareConfig } from './square'
import { cornerBracketAssembly, cornerBracketDefaults, cornerBracketParts, type CornerBracketConfig } from './cornerBracket'

export const toolIds = ['extension', 'compactExtension', 'square', 'cornerBracket'] as const
export type ToolId = typeof toolIds[number]
export const isToolId = (value: unknown): value is ToolId => toolIds.some(id => id === value)
export type ToolSheet = { length: number; width: number; edgeGap: number; partGap: number }
type ProjectBase = { sheet: ToolSheet; copies: number }
export type ToolProject = ProjectBase & ({ version: 3; tool: 'extension'; size: ExtensionConfig } | { version: 1; tool: 'compactExtension'; size: CompactExtensionConfig } | { version: 2; tool: 'square'; size: SquareConfig } | { version: 2; tool: 'cornerBracket'; size: CornerBracketConfig })
type Vector3 = [number, number, number]
export type ToolSelection = { id: string; project: ToolProject }
export type ToolPlacement = { part: string; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }

export const toolLabels: Record<ToolId, string> = { extension: 'Wedge table extension', compactExtension: 'Compact table extension', square: 'Flat welding square', cornerBracket: 'Internal corner bracket' }
export const defaultToolProject: ToolProject & { tool: 'extension' } = {
  version: 3, tool: 'extension', size: { ...extensionDefaults },
  sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 }, copies: 1,
}
export const defaultSquareProject: ToolProject & { tool: 'square' } = {
  version: 2, tool: 'square', size: { ...squareDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}

export const defaultCornerBracketProject: ToolProject & { tool: 'cornerBracket' } = {
  version: 2, tool: 'cornerBracket', size: { ...cornerBracketDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}
export const defaultCompactExtensionProject: ToolProject & { tool: 'compactExtension' } = {
  version: 1, tool: 'compactExtension', size: { ...compactExtensionDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}
export const toolDefaults = { extension: defaultToolProject, compactExtension: defaultCompactExtensionProject, square: defaultSquareProject, cornerBracket: defaultCornerBracketProject } satisfies Record<ToolId, ToolProject>

const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value)
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
export class ToolProjectError extends Error {
  readonly name = 'ToolProjectError'
  constructor(readonly code: 'invalid-json' | 'invalid-field' | 'unsupported-version' | 'grid-migration' | 'invalid-layout', message: string) { super(message) }
}
const number = (value: unknown) => { if (typeof value !== 'number') throw new ToolProjectError('invalid-field', 'Project numeric fields must be numbers'); return value }

/** Only current fabrication data can reach exports; old shapes and grids have no runtime path. */
export const parseToolProject = (text: string): ToolProject => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new ToolProjectError('invalid-json', 'Project JSON is invalid') }
  const root = object(raw)
  if (!root || !exactKeys(root, ['version', 'tool', 'size', 'sheet', 'copies'])) throw new ToolProjectError('invalid-field', 'Project has unknown or missing fields')
  if (root.tool === 'extension' && root.version === 1) throw new ToolProjectError('unsupported-version', 'This project uses the retired box design. It cannot be silently converted into wedge cutting plans. Download the original JSON before starting the corrected design.')
  if (root.tool === 'extension' && root.version === 2) throw new ToolProjectError('grid-migration', 'The extension grid now has a fixed 25 mm origin and side row, independent of thickness. Review and explicitly apply the corrected grid; the original data is retained.')
  if (!isToolId(root.tool) || root.version !== toolDefaults[root.tool].version) throw new ToolProjectError('unsupported-version', 'Unsupported project version or tool')
  const size = object(root.size), sheet = object(root.sheet)
  const sizeKeys = Object.keys(toolDefaults[root.tool].size)
  if (!size || !exactKeys(size, sizeKeys) || !sheet || !exactKeys(sheet, ['length', 'width', 'edgeGap', 'partGap'])) throw new ToolProjectError('invalid-field', 'Project dimensions are malformed')
  const base: ProjectBase = {
    sheet: { length: number(sheet.length), width: number(sheet.width), edgeGap: number(sheet.edgeGap), partGap: number(sheet.partGap) }, copies: number(root.copies),
  }
  if (!finite(base.sheet.length, 100, 6000) || !finite(base.sheet.width, 100, 6000) || !finite(base.sheet.edgeGap, 0, 100) || !finite(base.sheet.partGap, 0, 100) || !Number.isInteger(base.copies) || base.copies < 1 || base.copies > 10) throw new ToolProjectError('invalid-field', 'Project sheet or copy count is outside supported limits')
  const common = { length: number(size.length), width: number(size.width), thickness: number(size.thickness) }
  let project: ToolProject
  switch (root.tool) {
    case 'extension': project = { ...base, version: 3, tool: 'extension', size: { ...common, height: number(size.height) } }; break
    case 'compactExtension': project = { ...base, version: 1, tool: 'compactExtension', size: { ...common, height: number(size.height), holeDiameter: number(size.holeDiameter), holePitch: number(size.holePitch), holeInset: number(size.holeInset), tipHeight: number(size.tipHeight), taperRun: number(size.taperRun), windowInset: number(size.windowInset), windowRadius: number(size.windowRadius), tabWidth: number(size.tabWidth), clearance: number(size.clearance) } }; break
    case 'square': project = { ...base, version: 2, tool: 'square', size: { ...common, armWidth: number(size.armWidth), holeDiameter: number(size.holeDiameter), endOffset: number(size.endOffset) } }; break
    case 'cornerBracket': project = { ...base, version: 2, tool: 'cornerBracket', size: { ...common, height: number(size.height), holeDiameter: number(size.holeDiameter), holePitch: number(size.holePitch), slotLength: number(size.slotLength), cornerCut: number(size.cornerCut), tipWidth: number(size.tipWidth), tabWidth: number(size.tabWidth), clearance: number(size.clearance) } }; break
  }
  projectModelParts(project)
  return project
}

/** The compact extension is cut from its host table's stock, including outside a mixed job. */
export const projectAtTableThickness = (project: ToolProject, thickness: number): ToolProject => project.tool === 'compactExtension'
  ? { ...project, size: { ...project.size, thickness } }
  : project

export const toolSelectionsAtTableThickness = (selections: ToolSelection[], thickness: number): ToolSelection[] => selections.map(row => {
  const project = projectAtTableThickness(row.project, thickness)
  if (project.tool === 'compactExtension') projectModelParts(project)
  return { ...row, project }
})

/** Dimensions/quantities are snapshots; compact-extension thickness follows the host table. */
export const parseToolSelections = (value: unknown): ToolSelection[] => {
  if (!Array.isArray(value) || value.length > 32) throw new ToolProjectError('invalid-field', 'Select at most 32 configured tools for a table cut job')
  const ids = new Set<string>()
  return value.map(item => {
    const row = object(item)
    if (!row || !exactKeys(row, ['id', 'project']) || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id))
      throw new ToolProjectError('invalid-field', 'Each selected tool needs a unique safe ID and a project')
    ids.add(row.id)
    return { id: row.id, project: parseToolProject(JSON.stringify(row.project)) }
  })
}

export const readToolProject = (text: string): { project: ToolProject; kind: 'current' | 'migration'; message: string } => {
  try { return { project: parseToolProject(text), kind: 'current', message: '' } }
  catch (error) {
    if (!(error instanceof ToolProjectError) || error.code !== 'grid-migration') throw error
    const raw: unknown = JSON.parse(text)
    const root = object(raw)
    return { project: parseToolProject(JSON.stringify({ ...root, version: 3 })), kind: 'migration', message: error.message }
  }
}

export const projectJson = (project: ToolProject) => JSON.stringify(project)
export const projectKey = (project: ToolProject) => JSON.stringify([project.version, project.tool, Object.entries(project.size).sort(([a], [b]) => a.localeCompare(b)), project.sheet.length, project.sheet.width, project.sheet.edgeGap, project.sheet.partGap, project.copies])
export const projectModelParts = (project: ToolProject): FabricationPart[] => {
  switch (project.tool) {
    case 'extension': return extensionParts(project.size)
    case 'compactExtension': return compactExtensionParts(project.size)
    case 'square': return squareParts(project.size)
    case 'cornerBracket': return cornerBracketParts(project.size)
  }
}
export const projectParts = (project: ToolProject): FabricationPart[] => projectModelParts(project).map(part => ({ ...part, count: part.count * project.copies }))
export const projectEnvelope = (project: ToolProject) => ({ length: project.size.length, width: project.size.width, height: project.tool === 'square' ? project.size.thickness : project.size.height })
export const projectAssembly = (project: ToolProject): ToolPlacement[] => {
  switch (project.tool) {
    case 'extension': return extensionAssembly(project.size)
    case 'compactExtension': return compactExtensionAssembly(project.size)
    case 'square': return [{ part: 'square', instance: 0, origin: [0, 0, project.size.thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }]
    case 'cornerBracket': return cornerBracketAssembly(project.size)
  }
}
export const projectNestingOptions = (project: ToolProject) => ({ ...automaticNestingOptions(project.sheet), attempts: 60 })

/** Rejects a result whose parts, instances, sheets or geometry no longer match this project. */
export const validProjectLayout = (project: ToolProject, result: NestingResult | undefined, key: string | undefined) => {
  return Boolean(result && key === projectKey(project) && validNestingInventory(projectParts(project), result, projectNestingOptions(project)))
}
