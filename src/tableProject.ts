import { defaults, maxTabWidth, mmPerInch, presetValues, projectConfig, projectFields, readPart, tableProjectVersion, type Config, type CustomHole, type RemovedHole } from './model'

import { readToolSelections, toolSelectionsAtTable } from './tools/project'

export type NumericKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config]
export type BooleanKey = { [K in keyof Config]: Config[K] extends boolean ? K : never }[keyof Config]

export const numericBounds: Record<NumericKey, { min: number; max: number }> = {
  holeDiameter: { min: 1, max: 40 }, pitch: { min: 11, max: 1000 },
  margin: { min: 0, max: 200 * mmPerInch / 2 - 10 },
  length: { min: 500, max: 200 * mmPerInch }, width: { min: 400, max: 200 * mmPerInch },
  height: { min: 50, max: 20 * mmPerInch }, ribSpacing: { min: 200, max: 24 * mmPerInch },
  ribAccessHoleDiameter: { min: 1, max: 1000 }, thickness: { min: 1, max: 40 },
  tabWidth: { min: 5, max: Math.floor((20 * mmPerInch - 1) / 2) - 5 },
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
export type TableProjectLoad = { kind: 'current'; config: Config }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const invalid = (field: string, requirement: string): never => { throw new TableProjectError('invalid-field', `${field}: ${requirement}`, field) }
const finite = (value: unknown, field: string): number => typeof value === 'number' && Number.isFinite(value) ? value : invalid(field, 'должно быть конечным числом')
const identifier = (value: unknown, field: string): string | number => typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) ? value : invalid(field, 'должно быть строкой или конечным числом')

const customHoles = (value: unknown): CustomHole[] => {
  if (!Array.isArray(value)) return invalid('customHoles', 'должно быть массивом')
  const ids = new Set<string>()
  return value.map((item, index) => {
    const field = `customHoles[${index}]`
    if (!record(item)) return invalid(field, 'должно быть объектом')
    const part = readPart(item.part), id = identifier(item.id, `${field}.id`)
    if (!part || ids.has(String(id))) return invalid(field, 'требуются известная деталь и уникальный сохраняемый идентификатор')
    ids.add(String(id))
    const d = finite(item.d, `${field}.d`)
    if (d <= 0) return invalid(`${field}.d`, 'должно быть положительным')
    return { part, id, x: finite(item.x, `${field}.x`), y: finite(item.y, `${field}.y`), d }
  })
}
const removedHoles = (value: unknown): Array<RemovedHole | string> => {
  if (!Array.isArray(value)) return invalid('removedHoles', 'должно быть массивом')
  return value.map((item, index) => {
    if (typeof item === 'string') return item
    const field = `removedHoles[${index}]`
    if (!record(item)) return invalid(field, 'должно быть идентификатором отверстия или объектом координат')
    const part = readPart(item.part)
    if (!part) return invalid(`${field}.part`, 'неизвестная деталь')
    const r = finite(item.r, `${field}.r`)
    if (r <= 0) return invalid(`${field}.r`, 'должно быть положительным')
    return { part, id: identifier(item.id, `${field}.id`), x: finite(item.x, `${field}.x`), y: finite(item.y, `${field}.y`), r }
  })
}

/** The editor accepts only the current complete project schema. */
export const parseTableProject = (text: string): TableProjectLoad => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new TableProjectError('invalid-json', 'Некорректный JSON проекта.') }
  if (!record(raw)) throw new TableProjectError('invalid-json', 'Проект стола должен быть объектом JSON.')
  if (raw.schemaVersion !== tableProjectVersion) throw new TableProjectError('unsupported-version', 'Версия проекта стола не поддерживается.', 'schemaVersion')
  const allowed = new Set(Object.keys(projectConfig(defaults)))
  for (const field of Object.keys(raw)) if (!allowed.has(field)) throw new TableProjectError('unknown-field', `Неизвестное поле проекта стола: ${field}`, field)
  const required = Object.keys(projectConfig(defaults))
  for (const field of required) if (!Object.hasOwn(raw, field)) throw new TableProjectError('missing-field', `Отсутствует поле проекта стола: ${field}`, field)
  const value = { ...raw }
  for (const [key, field] of Object.entries(projectFields)) if (Object.hasOwn(raw, field)) {
    if (Object.hasOwn(raw, key) && raw[key] !== raw[field]) return invalid(field, 'конфликтует с внутренним именем поля')
    value[key] = raw[field]
  }
  const config: Config = { ...defaults, customHoles: [], removedHoles: [], nestingTools: [] }
  for (const key of numericKeys) if (Object.hasOwn(value, key)) {
    const number = finite(value[key], key), { min, max } = numericBounds[key]
    if (number < min || number > max || integerKeys.includes(key) && !Number.isInteger(number)) return invalid(key, `должно быть от ${min} до ${max}${integerKeys.includes(key) ? ' и целым числом' : ''}`)
    config[key] = number
  }
  for (const key of booleanKeys) if (Object.hasOwn(value, key)) {
    const flag = value[key]
    if (typeof flag !== 'boolean') return invalid(key, 'должно быть логическим значением')
    config[key] = flag
  }
  if (value.grid !== undefined) {
    if (value.grid === 'grid') config.grid = 'square'
    else if (value.grid === 'stagger') config.grid = 'staggered'
    else return invalid('holePattern', 'неизвестная схема сетки')
  }
  if (value.engravingMode !== undefined) {
    if (value.engravingMode !== 'through' && value.engravingMode !== 'between') return invalid('engravePattern', 'неизвестная схема гравировки')
    config.engravingMode = value.engravingMode
  }
  if (value.legMountStyle !== undefined) {
    if (value.legMountStyle === 'boltPattern' || value.legMountStyle === 'cornerPlate') config.legMountStyle = value.legMountStyle
    else return invalid('legMountStyle', 'неизвестный способ крепления')
  }
  if (value.customHoles !== undefined) config.customHoles = customHoles(value.customHoles)
  if (value.removedHoles !== undefined) config.removedHoles = removedHoles(value.removedHoles)
  if (value.nestingTools !== undefined) {
    config.nestingTools = toolSelectionsAtTable(readToolSelections(value.nestingTools, config), config)
  }
  if (config.tabWidth > maxTabWidth(config)) return invalid('tabWidth', 'не помещается при выбранной высоте и толщине металла')

  config.preset = 'Custom'
  for (const name of ['D16', 'D28'] as const) {
    const preset = presetValues[name]
    if (config.holeDiameter === preset.holeDiameter && config.pitch === preset.pitch && config.margin === preset.margin) config.preset = name
  }
  return { kind: 'current', config }
}

export const tableProjectQuery = (config: Config) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(projectConfig(config))) params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  return params
}

/** URL values are decoded once at the text boundary, then use the same JSON validator. */
export const tableProjectFromQuery = (params: URLSearchParams): string | undefined => {
  const keys = [...params.keys()]
  const navigationParameters = new Set(['workspace', 'view', 'toolProject'])
  if (new Set(keys).size !== keys.length) return invalid('query', 'параметр URL повторяется')
  if (params.has('state')) {
    if (keys.some(key => key !== 'state' && !navigationParameters.has(key))) return invalid('state', 'нельзя сочетать с другими параметрами проекта')
    return params.get('state') ?? ''
  }
  if (params.has('project')) throw new TableProjectError('unsupported-version', 'Снятый с поддержки объединённый каталог оснастки не поддерживается. Исходные данные не заменены.', 'project')
  if (params.has('toolProject') && !params.has('schemaVersion') && !params.has('length')) return undefined
  const fields = [...params.entries()].filter(([key]) => !navigationParameters.has(key))
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
    else if (key === 'customHoles' || key === 'removedHoles' || key === 'nestingTools') {
      try { value[key] = JSON.parse(text) } catch { return invalid(key, 'некорректный JSON в URL') }
    } else value[key] = text
  }
  return JSON.stringify(value)
}
