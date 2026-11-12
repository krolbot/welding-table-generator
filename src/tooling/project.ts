import { createToolingConfig, TOOLING_IDS } from './catalog.js'
import { materialDensityKgPerMm3, type ParameterValue, type SheetMaterial, type ToolingConfig, type ToolingId } from './model.js'

export const PROJECT_VERSION = 2 as const
export const sheetMaterials = Object.keys(materialDensityKgPerMm3) as SheetMaterial[]

export type ToolingBasketItem = {
  instanceId: string
  config: ToolingConfig
  quantity: number
  material: SheetMaterial
}

export type CombinedProject = {
  version: typeof PROJECT_VERSION
  table: Record<string, unknown>
  includeTable: boolean
  tooling: ToolingBasketItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], path: string) => {
  const expected = new Set(keys)
  const unknown = Object.keys(value).filter(key => !expected.has(key))
  if (unknown.length) throw new Error(`${path}: unknown field${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}`)
}
const isToolingId = (value: unknown): value is ToolingId => typeof value === 'string' && (TOOLING_IDS as readonly string[]).includes(value)
const isMaterial = (value: unknown): value is SheetMaterial => typeof value === 'string' && (sheetMaterials as readonly string[]).includes(value)

export const makeBasketItem = (id: ToolingId, material: SheetMaterial = 'S235JR'): ToolingBasketItem => ({
  instanceId: crypto.randomUUID(),
  config: createToolingConfig(id),
  quantity: 1,
  material,
})

export const parseCombinedProject = (input: unknown): CombinedProject => {
  if (!isRecord(input)) throw new Error('Project must be an object')
  if (input.version !== PROJECT_VERSION) {
    if ('length' in input && 'width' in input) return { version: PROJECT_VERSION, table: input, includeTable: true, tooling: [] }
    throw new Error(`Unsupported project version: ${String(input.version ?? 'missing')}`)
  }
  exactKeys(input, ['version', 'table', 'includeTable', 'tooling'], 'project')
  if (!isRecord(input.table)) throw new Error('project.table must be an object')
  if (typeof input.includeTable !== 'boolean') throw new Error('project.includeTable must be boolean')
  if (!Array.isArray(input.tooling)) throw new Error('project.tooling must be an array')
  if (input.tooling.length > 100) throw new Error('project.tooling exceeds 100 basket lines')
  const ids = new Set<string>()
  const tooling = input.tooling.map((raw, index): ToolingBasketItem => {
    const path = `project.tooling[${index}]`
    if (!isRecord(raw)) throw new Error(`${path} must be an object`)
    exactKeys(raw, ['instanceId', 'config', 'quantity', 'material'], path)
    if (typeof raw.instanceId !== 'string' || !raw.instanceId || raw.instanceId.length > 100) throw new Error(`${path}.instanceId is invalid`)
    if (ids.has(raw.instanceId)) throw new Error(`${path}.instanceId is duplicated`)
    ids.add(raw.instanceId)
    if (!Number.isInteger(raw.quantity) || (raw.quantity as number) < 1 || (raw.quantity as number) > 20) throw new Error(`${path}.quantity must be an integer from 1 to 20`)
    if (!isMaterial(raw.material)) throw new Error(`${path}.material is invalid`)
    if (!isRecord(raw.config)) throw new Error(`${path}.config must be an object`)
    exactKeys(raw.config, ['id', 'values'], `${path}.config`)
    if (!isToolingId(raw.config.id)) throw new Error(`${path}.config.id is invalid`)
    if (!isRecord(raw.config.values)) throw new Error(`${path}.config.values must be an object`)
    const values = Object.fromEntries(Object.entries(raw.config.values).map(([key, value]) => {
      if (!['number', 'boolean', 'string'].includes(typeof value)) throw new Error(`${path}.config.values.${key} has an invalid type`)
      return [key, value as ParameterValue]
    }))
    return { instanceId: raw.instanceId, config: createToolingConfig(raw.config.id, values), quantity: raw.quantity as number, material: raw.material }
  })
  return { version: PROJECT_VERSION, table: input.table, includeTable: input.includeTable, tooling }
}

export const encodeCombinedProject = (project: CombinedProject) => {
  const bytes = new TextEncoder().encode(JSON.stringify(project))
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export const decodeCombinedProject = (value: string) => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return parseCombinedProject(JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)))))
}
