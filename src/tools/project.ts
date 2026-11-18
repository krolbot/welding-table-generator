import { fixtureGridPoints, type FabricationPart } from '../geometry'
import type { Config } from '../model'
import type { NestingResult } from '../nesting'
import { validNestingInventory } from '../nestingJob'
import { automaticNestingOptions } from '../nestingSettings'
import { extensionAssembly, extensionDefaults, extensionParts, type ExtensionConfig } from './extension'
import { compactExtensionAssembly, compactExtensionDefaults, compactExtensionParts, type CompactExtensionConfig } from './compactExtension'
import { viseModuleAssembly, viseModuleDefaults, viseModuleParts, type ViseModuleConfig } from './viseModule'
import { squareDefaults, squareParts, type SquareConfig } from './square'
import { cornerBracketAssembly, cornerBracketDefaults, cornerBracketParts, type CornerBracketConfig } from './cornerBracket'

export const toolIds = ['extension', 'compactExtension', 'square', 'cornerBracket', 'viseModule'] as const
export type ToolId = typeof toolIds[number]
export const isToolId = (value: unknown): value is ToolId => toolIds.some(id => id === value)
export type ToolSheet = { length: number; width: number; edgeGap: number; partGap: number }
type ProjectBase = { sheet: ToolSheet; copies: number }
export type ToolProject = ProjectBase & ({ version: 4; tool: 'extension'; size: ExtensionConfig } | { version: 1; tool: 'compactExtension'; size: CompactExtensionConfig } | { version: 3; tool: 'square'; size: SquareConfig } | { version: 5; tool: 'cornerBracket'; size: CornerBracketConfig } | { version: 2; tool: 'viseModule'; size: ViseModuleConfig })
type Vector3 = [number, number, number]
export type ToolSelection = { id: string; project: ToolProject }
export type ToolPlacement = { part: string; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }

export const toolLabels: Record<ToolId, string> = { extension: 'Клиновое расширение стола', compactExtension: 'Компактное расширение стола', square: 'Плоский сварочный угольник', cornerBracket: 'Внутренний угловой кронштейн', viseModule: 'Модуль крепления тисков' }
export const defaultToolProject: ToolProject & { tool: 'extension' } = {
  version: 4, tool: 'extension', size: { ...extensionDefaults },
  sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 }, copies: 1,
}
export const defaultSquareProject: ToolProject & { tool: 'square' } = {
  version: 3, tool: 'square', size: { ...squareDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}

export const defaultCornerBracketProject: ToolProject & { tool: 'cornerBracket' } = {
  version: 5, tool: 'cornerBracket', size: { ...cornerBracketDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}
export const defaultCompactExtensionProject: ToolProject & { tool: 'compactExtension' } = {
  version: 1, tool: 'compactExtension', size: { ...compactExtensionDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}
export const defaultViseModuleProject: ToolProject & { tool: 'viseModule' } = {
  version: 2, tool: 'viseModule', size: { ...viseModuleDefaults },
  sheet: { ...defaultToolProject.sheet }, copies: 1,
}
export const toolDefaults = { extension: defaultToolProject, compactExtension: defaultCompactExtensionProject, square: defaultSquareProject, cornerBracket: defaultCornerBracketProject, viseModule: defaultViseModuleProject } satisfies Record<ToolId, ToolProject>

const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => key in value)
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
export class ToolProjectError extends Error {
  readonly name = 'ToolProjectError'
  constructor(readonly code: 'invalid-json' | 'invalid-field' | 'unsupported-version' | 'invalid-layout' | 'mounting-grid-mismatch' | 'stock-mismatch', message: string) { super(message) }
}
const number = (value: unknown) => { if (typeof value !== 'number') throw new ToolProjectError('invalid-field', 'Числовые поля проекта должны содержать числа'); return value }
const grid = (value: unknown): Config['grid'] => { if (value !== 'square' && value !== 'staggered') throw new ToolProjectError('invalid-field', 'Схема сетки стола не поддерживается'); return value }

/** Only the current schema can reach the editor or fabrication exports. */
export const parseToolProject = (text: string): ToolProject => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new ToolProjectError('invalid-json', 'Некорректный JSON проекта') }
  const root = object(raw)
  if (!root || !exactKeys(root, ['version', 'tool', 'size', 'sheet', 'copies'])) throw new ToolProjectError('invalid-field', 'В проекте есть неизвестные поля или отсутствуют обязательные')
  if (!isToolId(root.tool) || root.version !== toolDefaults[root.tool].version) throw new ToolProjectError('unsupported-version', 'Версия проекта или тип оснастки не поддерживается')
  const size = object(root.size), sheet = object(root.sheet)
  const sizeKeys = Object.keys(toolDefaults[root.tool].size)
  if (!size || !exactKeys(size, sizeKeys) || !sheet || !exactKeys(sheet, ['length', 'width', 'edgeGap', 'partGap'])) throw new ToolProjectError('invalid-field', 'Размеры проекта заданы некорректно')
  const base: ProjectBase = {
    sheet: { length: number(sheet.length), width: number(sheet.width), edgeGap: number(sheet.edgeGap), partGap: number(sheet.partGap) }, copies: number(root.copies),
  }
  if (!finite(base.sheet.length, 100, 6000) || !finite(base.sheet.width, 100, 6000) || !finite(base.sheet.edgeGap, 0, 100) || !finite(base.sheet.partGap, 0, 100) || !Number.isInteger(base.copies) || base.copies < 1 || base.copies > 10) throw new ToolProjectError('invalid-field', 'Размер листа или количество копий выходит за поддерживаемые пределы')
  const common = { length: number(size.length), width: number(size.width), thickness: number(size.thickness) }
  let project: ToolProject
  switch (root.tool) {
    case 'extension': project = { ...base, version: 4, tool: 'extension', size: { ...common, height: number(size.height) } }; break
    case 'compactExtension': project = { ...base, version: 1, tool: 'compactExtension', size: { ...common, height: number(size.height), holeDiameter: number(size.holeDiameter), holePitch: number(size.holePitch), holeInset: number(size.holeInset), tipHeight: number(size.tipHeight), taperRun: number(size.taperRun), windowInset: number(size.windowInset), windowRadius: number(size.windowRadius), tabWidth: number(size.tabWidth), clearance: number(size.clearance) } }; break
    case 'viseModule': project = { ...base, version: 2, tool: 'viseModule', size: { ...common, height: number(size.height), holeDiameter: number(size.holeDiameter), holePitch: number(size.holePitch), holeInset: number(size.holeInset), grid: grid(size.grid), slotWidth: number(size.slotWidth), slotInnerRadius: number(size.slotInnerRadius), tipHeight: number(size.tipHeight), tabWidth: number(size.tabWidth), clearance: number(size.clearance) } }; break
    case 'square': project = { ...base, version: 3, tool: 'square', size: { ...common, armWidth: number(size.armWidth), holeDiameter: number(size.holeDiameter), endOffset: number(size.endOffset) } }; break
    case 'cornerBracket': project = { ...base, version: 5, tool: 'cornerBracket', size: { ...common, height: number(size.height), holeDiameter: number(size.holeDiameter), holePitch: number(size.holePitch), slotLength: number(size.slotLength), cornerCut: number(size.cornerCut), tipWidth: number(size.tipWidth), tabWidth: number(size.tabWidth), clearance: number(size.clearance) } }; break
  }
  projectModelParts(project)
  return project
}

type ToolTableSettings = Pick<Config, 'length' | 'width' | 'height' | 'thickness' | 'holeDiameter' | 'pitch' | 'margin' | 'grid'>

/** Host-owned dimensions resolve identically for editing, imports and mixed cutting jobs. */
export const projectAtTable = (project: ToolProject, table: ToolTableSettings): ToolProject => {
  switch (project.tool) {
    case 'extension': return { ...project, size: { ...project.size, thickness: table.thickness } }
    case 'compactExtension': return { ...project, size: { ...project.size, thickness: table.thickness } }
    case 'viseModule': return { ...project, size: { ...project.size, thickness: table.thickness, holeDiameter: table.holeDiameter, holePitch: table.pitch, holeInset: table.margin, grid: table.grid } }
    case 'square': return { ...project, size: { ...project.size, thickness: table.thickness } }
    case 'cornerBracket': return { ...project, size: { ...project.size } }
  }
}

/** Explicitly discards one Tool's saved geometry while retaining its sheet settings. */
export const resetToolProject = (project: ToolProject, table: ToolTableSettings): ToolProject => {
  const defaults = toolDefaults[project.tool]
  return projectAtTable({ ...defaults, size: { ...defaults.size }, sheet: { ...project.sheet } } as ToolProject, table)
}

export const toolSelectionsAtTable = (selections: ToolSelection[], table: ToolTableSettings): ToolSelection[] => selections.map(row => {
  const project = projectAtTable(row.project, table)
  projectModelParts(project)
  if (project.tool === 'viseModule') {
    const hostGrid = new Set(fixtureGridPoints(Math.max(table.length, table.width), table.height, table).map(p => `${p.x}:${p.y}`))
    const mountingGrid = fixtureGridPoints(project.size.width, project.size.height, table)
    if (mountingGrid.some(p => !hostGrid.has(`${p.x}:${p.y}`)))
      throw new ToolProjectError('mounting-grid-mismatch', 'Полная монтажная сетка тисков должна помещаться на боковой стороне стола; увеличьте длину или глубину стола либо уменьшите модуль')
  }
  return { ...row, project }
})

/** Dimensions other than stock (and the vise grid) and quantities are snapshots. */
export const readToolSelections = (value: unknown, table?: ToolTableSettings): ToolSelection[] => {
  if (!Array.isArray(value) || value.length > 32) throw new ToolProjectError('invalid-field', 'В одно задание на резку стола можно выбрать не более 32 настроенных изделий')
  const ids = new Set<string>()
  const selections: ToolSelection[] = value.map(item => {
    const row = object(item)
    if (!row || !exactKeys(row, ['id', 'project']) || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(row.id) || ids.has(row.id))
      throw new ToolProjectError('invalid-field', 'Для каждого выбранного изделия нужны уникальный безопасный идентификатор и проект')
    ids.add(row.id)
    const project = table ? readToolProjectAtTable(JSON.stringify(row.project), table) : parseToolProject(JSON.stringify(row.project))
    return { id: row.id, project }
  })
  return selections
}

export const parseToolSelections = readToolSelections

/** The active table owns stock except for the reference corner bracket; it always owns vise mounting-grid dimensions. */
export const readToolProjectAtTable = (text: string, table: ToolTableSettings): ToolProject => {
  const project = projectAtTable(parseToolProject(text), table)
  projectModelParts(project)
  return project
}

export const projectJson = (project: ToolProject) => JSON.stringify(project)
export const projectKey = (project: ToolProject) => JSON.stringify([project.version, project.tool, Object.entries(project.size).sort(([a], [b]) => a.localeCompare(b)), project.sheet.length, project.sheet.width, project.sheet.edgeGap, project.sheet.partGap, project.copies])
export const projectModelParts = (project: ToolProject): FabricationPart[] => {
  switch (project.tool) {
    case 'extension': return extensionParts(project.size)
    case 'compactExtension': return compactExtensionParts(project.size)
    case 'viseModule': return viseModuleParts(project.size)
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
    case 'viseModule': return viseModuleAssembly(project.size)
    case 'square': return [{ part: 'square', instance: 0, origin: [0, 0, project.size.thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }]
    case 'cornerBracket': return cornerBracketAssembly(project.size)
  }
}
export const projectNestingOptions = (project: ToolProject) => ({ ...automaticNestingOptions(project.sheet), attempts: 60 })

/** Rejects a result whose parts, instances, sheets or geometry no longer match this project. */
export const validProjectLayout = (project: ToolProject, result: NestingResult | undefined, key: string | undefined) => {
  return Boolean(result && key === projectKey(project) && validNestingInventory(projectParts(project), result, projectNestingOptions(project)))
}
