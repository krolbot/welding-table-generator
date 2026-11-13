import { defaults, maxTabWidth, mmPerInch, presetValues, projectConfig, projectFields, readPart, tableProjectVersion, type Config, type CustomHole, type RemovedHole } from './model'

export type NumericKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config]
export type BooleanKey = { [K in keyof Config]: Config[K] extends boolean ? K : never }[keyof Config]

export const numericBounds: Record<NumericKey, { min: number; max: number }> = {
  holeDiameter: { min: 1, max: 40 }, pitch: { min: 11, max: 1000 },
  margin: { min: 0, max: 200 * mmPerInch / 2 - 10 },
  length: { min: 500, max: 200 * mmPerInch }, width: { min: 400, max: 200 * mmPerInch },
  height: { min: 50, max: 20 * mmPerInch }, ribSpacing: { min: 200, max: 24 * mmPerInch },
  ribAccessHoleDiameter: { min: 1, max: 1000 }, thickness: { min: 1, max: 40 },
  tabWidth: { min: 0, max: Math.floor((20 * mmPerInch - 1) / 2) - 5 },
  clearance: { min: 0, max: 2.5 }, dogBoneDiameter: { min: 0.5, max: 5 },
  legBoltDiameter: { min: 1, max: 100 }, legPatternX: { min: 0, max: 1000 }, legPatternY: { min: 0, max: 1000 },
  legCols: { min: 1, max: 4 }, legRows: { min: 1, max: 4 },
  legEdgeOffset: { min: 0, max: 1000 }, legBottomOffset: { min: 0, max: 1000 },
  legProfileSize: { min: 20, max: 200 }, legPlateSize: { min: 80, max: 400 },
  legPlateHoleDiameter: { min: 1, max: 40 }, legPlateHoleSpacing: { min: 20, max: 350 }, legLength: { min: 100, max: 1500 },
  sheetLength: { min: 0, max: Infinity }, sheetWidth: { min: 0, max: Infinity },
  sheetEdgeGap: { min: 0, max: 1000 }, sheetPartGap: { min: 0, max: 1000 },
  nestingCopies: { min: 1, max: 10 }, exploded: { min: 0, max: 100 },
}
const numericKeys = Object.keys(numericBounds) as NumericKey[]
const booleanKeys: BooleanKey[] = ['skirtHoles', 'engraving', 'nameMarking', 'ribs', 'ribAccessHoles', 'dogBones', 'legMounts', 'liftingHoles', 'showDimensions', 'renderHoles', 'highlighting']
const integerKeys: NumericKey[] = ['legCols', 'legRows', 'nestingCopies']
export const clampNumeric = (key: NumericKey, value: number) => Math.max(numericBounds[key].min, Math.min(numericBounds[key].max, integerKeys.includes(key) ? Math.round(value) : value))

export class TableProjectError extends Error {
  readonly name = 'TableProjectError'
  constructor(readonly code: 'invalid-json' | 'unsupported-version' | 'invalid-field' | 'unknown-field' | 'missing-field', message: string, readonly field?: string) { super(message) }
}
export type TableProjectLoad = { kind: 'current' | 'migration'; config: Config }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const invalid = (field: string, requirement: string): never => { throw new TableProjectError('invalid-field', `${field}: ${requirement}`, field) }
const finite = (value: unknown, field: string): number => typeof value === 'number' && Number.isFinite(value) ? value : invalid(field, 'must be a finite number')
const identifier = (value: unknown, field: string): string | number => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? value : invalid(field, 'must be a string or finite number')

const customHoles = (value: unknown): CustomHole[] => {
  if (!Array.isArray(value)) return invalid('customHoles', 'must be an array')
  const ids = new Set<string>()
  return value.map((item, index) => {
    const field = `customHoles[${index}]`
    if (!record(item)) return invalid(field, 'must be an object')
    const part = readPart(item.part), id = identifier(item.id, `${field}.id`)
    if (!part || ids.has(String(id))) return invalid(field, 'requires a known part and a unique serialized ID')
    ids.add(String(id))
    const d = finite(item.d, `${field}.d`)
    if (d <= 0) return invalid(`${field}.d`, 'must be positive')
    return { part, id, x: finite(item.x, `${field}.x`), y: finite(item.y, `${field}.y`), d }
  })
}
const removedHoles = (value: unknown): Array<RemovedHole | string> => {
  if (!Array.isArray(value)) return invalid('removedHoles', 'must be an array')
  return value.map((item, index) => {
    if (typeof item === 'string') return item
    const field = `removedHoles[${index}]`
    if (!record(item)) return invalid(field, 'must be a hole ID or coordinate object')
    const part = readPart(item.part)
    if (!part) return invalid(`${field}.part`, 'unknown part')
    const r = finite(item.r, `${field}.r`)
    if (r <= 0) return invalid(`${field}.r`, 'must be positive')
    return { part, id: identifier(item.id, `${field}.id`), x: finite(item.x, `${field}.x`), y: finite(item.y, `${field}.y`), r }
  })
}

/** Legacy dimensions can be reviewed, never rendered/exported through the retired grid algorithm. */
export const parseTableProject = (text: string): TableProjectLoad => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new TableProjectError('invalid-json', 'Project JSON is invalid.') }
  if (!record(raw)) throw new TableProjectError('invalid-json', 'A table project must be a JSON object.')
  const legacy = raw.schemaVersion === undefined
  if (!legacy && raw.schemaVersion !== tableProjectVersion) throw new TableProjectError('unsupported-version', 'Unsupported table project version.', 'schemaVersion')
  const allowed = new Set([...Object.keys(defaults), ...Object.values(projectFields), 'schemaVersion', ...(legacy ? ['skirtHoleLayout'] : [])])
  for (const field of Object.keys(raw)) if (!allowed.has(field)) throw new TableProjectError('unknown-field', `Unknown table project field: ${field}`, field)
  const required = legacy ? ['length', 'width'] : Object.keys(projectConfig(defaults))
  for (const field of required) if (!Object.hasOwn(raw, field)) throw new TableProjectError('missing-field', `Missing table project field: ${field}`, field)
  const value = { ...raw }
  for (const [key, field] of Object.entries(projectFields)) if (Object.hasOwn(raw, field)) {
    if (Object.hasOwn(raw, key) && raw[key] !== raw[field]) return invalid(field, 'conflicts with its internal field name')
    value[key] = raw[field]
  }
  const config: Config = { ...defaults, customHoles: [], removedHoles: [] }
  for (const key of numericKeys) if (Object.hasOwn(value, key)) {
    const number = finite(value[key], key), { min, max } = numericBounds[key]
    if (number < min || number > max || integerKeys.includes(key) && !Number.isInteger(number)) return invalid(key, `must be ${min}–${max}${integerKeys.includes(key) ? ' and an integer' : ''}`)
    config[key] = number
  }
  for (const key of booleanKeys) if (Object.hasOwn(value, key)) {
    const flag = value[key]
    if (typeof flag !== 'boolean') return invalid(key, 'must be a boolean')
    config[key] = flag
  }
  if (value.units !== undefined) {
    if (value.units !== 'mm' && value.units !== 'inch' && value.units !== 'in') return invalid('units', 'unknown display units')
    config.units = value.units === 'in' ? 'inch' : value.units
  }
  if (value.grid !== undefined) {
    if (value.grid === 'square' || value.grid === 'grid') config.grid = 'square'
    else if (value.grid === 'staggered' || value.grid === 'stagger') config.grid = 'staggered'
    else return invalid('holePattern', 'unknown grid pattern')
  }
  if (value.engravingMode !== undefined) {
    if (value.engravingMode !== 'through' && value.engravingMode !== 'between') return invalid('engravePattern', 'unknown engraving layout')
    config.engravingMode = value.engravingMode
  }
  if (value.legMountStyle !== undefined) {
    if (legacy && value.legMountStyle === 'squareSocket') config.legMountStyle = 'cornerPlate'
    else if (value.legMountStyle === 'boltPattern' || value.legMountStyle === 'cornerPlate') config.legMountStyle = value.legMountStyle
    else return invalid('legMountStyle', 'unknown mounting style')
  }
  if (legacy && value.skirtHoleLayout !== undefined && value.skirtHoleLayout !== 'canonical' && value.skirtHoleLayout !== 'compact') return invalid('skirtHoleLayout', 'unknown legacy layout')
  if (value.customHoles !== undefined) config.customHoles = customHoles(value.customHoles)
  if (value.removedHoles !== undefined) config.removedHoles = removedHoles(value.removedHoles)
  if (config.tabWidth > maxTabWidth(config)) return invalid('tabWidth', 'does not fit the selected height and stock')

  config.preset = 'Custom'
  for (const name of ['D16', 'D28'] as const) {
    const preset = presetValues[name]
    if (config.holeDiameter === preset.holeDiameter && config.pitch === preset.pitch && config.margin === preset.margin) config.preset = name
  }
  return { kind: legacy ? 'migration' : 'current', config }
}

export const tableProjectQuery = (config: Config) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(projectConfig(config))) params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  return params
}

/** URL values are decoded once at the text boundary, then use the same JSON validator. */
export const tableProjectFromQuery = (params: URLSearchParams): string | undefined => {
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length) return invalid('query', 'duplicate URL parameter')
  if (params.has('state')) {
    if (keys.some(key => key !== 'state' && key !== 'workspace')) return invalid('state', 'cannot be mixed with other project parameters')
    return params.get('state') ?? ''
  }
  if (params.has('project')) throw new TableProjectError('unsupported-version', 'The retired combined tooling catalog project is not supported. Original data has not been replaced.', 'project')
  if (params.has('toolProject')) return undefined
  const fields = [...params.entries()].filter(([key]) => key !== 'workspace')
  if (!fields.length) return undefined
  const value: Record<string, unknown> = {}
  const numbers = new Set<string>(numericKeys)
  const booleans = new Set<string>(booleanKeys)
  for (const [key, field] of Object.entries(projectFields)) {
    if (numbers.has(key)) numbers.add(field)
    if (booleans.has(key)) booleans.add(field)
  }
  for (const [key, text] of fields) {
    if (numbers.has(key) || key === 'schemaVersion') value[key] = text.trim() === '' ? null : Number(text)
    else if (booleans.has(key)) value[key] = text === 'true' ? true : text === 'false' ? false : text
    else if (key === 'customHoles' || key === 'removedHoles') {
      try { value[key] = JSON.parse(text) } catch { return invalid(key, 'invalid JSON in URL') }
    } else value[key] = text
  }
  return JSON.stringify(value)
}
