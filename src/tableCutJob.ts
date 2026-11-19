import { engravingLines, type FabricationPart, type Part } from './geometry'
import { readPart, type Config } from './model'
import { nestingKey, nestingOptions, nestingParts } from './nestingSettings'
import { validNestingInventory, type NestingJob, type NestingStock } from './nestingJob'
import type { NestingResult } from './nesting'
import { parseToolSelections, projectModelParts, toolSelectionsAtTable, toolLabels, type ToolId } from './tools/project'

export class TableCutJobError extends Error {
  readonly name = 'TableCutJobError'
  constructor(readonly code: 'part-limit' | 'invalid-layout', message: string, readonly selectionId?: string) { super(message) }
}
export type CutPartSource = { kind: 'table'; part: string; perCopy: number }
  | { kind: 'tool'; selectionId: string; tool: ToolId; part: string; perCopy: number }
export type TableLayoutSnapshot = { key: string; result: NestingResult }
export const tableLayoutKey = (config: Config) => nestingKey({ ...config, nestingTools: [] })

/** Namespaces distinguish equal tool families and tool 'top' from table 'top'. Geometry is never rewritten. */
export const tableCutInventory = (config: Config, preparedParts?: Part[]) => {
  const tableParts = nestingParts(config, preparedParts)
  const sources: Record<string, CutPartSource> = Object.fromEntries(tableParts.map(part => [part.name, { kind: 'table', part: part.name, perCopy: part.count / config.nestingCopies }]))
  const parts: FabricationPart[] = [...tableParts]
  const selections = toolSelectionsAtTable(parseToolSelections(config.nestingTools), config)
  selections.forEach(({ id, project }, index) => {
    for (const source of projectModelParts(project, config)) {
      const name = `tool:${id}:${source.name}`
      parts.push({ ...source, name, label: `${toolLabels[project.tool]} № ${index + 1} — ${source.label}`, count: source.count * project.copies })
      sources[name] = { kind: 'tool', selectionId: id, tool: project.tool, part: source.name, perCopy: source.count }
    }
  })
  if (parts.reduce((count, part) => count + part.count, 0) > 256) throw new TableCutJobError('part-limit', 'Стол и выбранная оснастка превышают предел 256 деталей. Уменьшите количество или удалите оснастку.')
  return { tableParts, parts, sources, selections, stock: { material: 'steel' as const, thickness: config.thickness } }
}

export const tableNestingJob = (config: Config, snapshot?: TableLayoutSnapshot): NestingJob => {
  const { parts, tableParts } = tableCutInventory(config)
  const options = nestingOptions(config)
  const baseline = snapshot?.key === tableLayoutKey(config) ? snapshot.result : undefined
  return { parts, options, stock: config.nestingTools.length
    ? { kind: 'table-offcuts', tableParts, baseline }
    : { kind: 'new-sheets' } }
}

export const tableCutEngravings = (part: FabricationPart, config: Config) => {
  const name = readPart(part.name)
  return name ? engravingLines({ ...part, name }, config) : []
}

export const validateTableCut = (config: Config, result: NestingResult, stock: NestingStock): boolean => {
  try {
    const inventory = tableCutInventory(config), options = nestingOptions(config)
    if (config.nestingTools.length) {
      if (stock.kind !== 'table-offcuts' || !validNestingInventory(inventory.tableParts, stock.baseline, options)) return false
      options.maxSheets = stock.baseline.sheets.length
    } else if (stock.kind !== 'new-sheets') return false
    return validNestingInventory(inventory.parts, result, options)
  } catch { return false }
}
