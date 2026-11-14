import type { FabricationPart } from './geometry'
import { searchNesting, validateNesting, type NestingOptions, type NestingResult } from './nesting'

export type NestingJob = {
  parts: FabricationPart[]
  options: NestingOptions
  stock: { kind: 'new-sheets' } | { kind: 'table-offcuts'; tableParts: FabricationPart[]; baseline?: NestingResult }
}
export type NestingStock = { kind: 'new-sheets' } | { kind: 'table-offcuts'; baseline: NestingResult }
export type NestingRun = { phase: 'capacity'; result: NestingResult } | { phase: 'nesting'; result: NestingResult; stock: NestingStock }
export class NestingJobError extends Error {
  readonly name = 'NestingJobError'
  constructor(readonly code: 'stale-baseline', message: string) { super(message) }
}
const tableCapacityPasses = 48

/** Inventory, native geometry, instance identity and both representations of the sheet plan must agree. */
export const validNestingInventory = (parts: readonly FabricationPart[], result: NestingResult, options: NestingOptions): boolean => {
  if (!result?.validation?.valid || !result.placements?.length || result.unplaced?.length !== 0
    || result.placements.length !== parts.reduce((sum, part) => sum + part.count, 0)) return false
  const canonical = new Map(parts.map(part => [part.name, part]))
  if (canonical.size !== parts.length) return false
  const seen = new Set<string>()
  for (const placement of result.placements) {
    const part = canonical.get(placement.part.name), key = JSON.stringify([placement.part.name, placement.instance])
    if (!part || JSON.stringify(part) !== JSON.stringify(placement.part) || !Number.isInteger(placement.instance)
      || placement.instance < 0 || placement.instance >= part.count || seen.has(key)) return false
    seen.add(key)
  }
  const sheets = [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b)
  if (sheets.some((sheet, i) => sheet !== i) || result.sheets.length !== sheets.length) return false
  for (const [index, sheet] of result.sheets.entries()) {
    if (sheet.index !== index || JSON.stringify(sheet.placements) !== JSON.stringify(result.placements.filter(placement => placement.sheet === index))) return false
  }
  return validateNesting(result.placements, options).valid
}

/** Reuse the same search, but never purchase another sheet to admit selected tools. */
export function* searchNestingJob(job: NestingJob): Generator<NestingRun> {
  if (job.stock.kind === 'new-sheets') {
    for (const result of searchNesting(job.parts, job.options)) yield { phase: 'nesting', result, stock: job.stock }
    return
  }
  let baseline = job.stock.baseline
  if (baseline && !validNestingInventory(job.stock.tableParts, baseline, job.options)) throw new NestingJobError('stale-baseline', 'The table-only layout is stale or invalid. Recalculate the table before adding tools.')
  if (!baseline) {
    for (const result of searchNesting(job.stock.tableParts, { ...job.options, attempts: tableCapacityPasses })) {
      baseline = result
      yield { phase: 'capacity', result }
    }
  }
  if (!baseline || !validNestingInventory(job.stock.tableParts, baseline, job.options)) return
  const stock: NestingStock = { kind: 'table-offcuts', baseline }
  for (const result of searchNesting(job.parts, { ...job.options, maxSheets: baseline.sheets.length })) {
    yield { phase: 'nesting', result, stock }
  }
}
