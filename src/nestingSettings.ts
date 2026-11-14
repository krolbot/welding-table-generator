import { assertFabricationReady, makeParts } from './geometry'
import { projectConfig, type Config } from './model'
import type { NestingOptions } from './nesting'
import type { NestingJob, NestingRun } from './nestingJob'

export const nestingKey = (config: Config) => JSON.stringify(projectConfig(config))
export const nestingParts = (config: Config) => {
  assertFabricationReady(config)
  return makeParts(config).map(part => ({ ...part, count: part.count * config.nestingCopies }))
}
const automaticRotations = [0, 90, 180, 270, ...Array.from({ length: 24 }, (_, i) => i * 15).filter(angle => angle % 90 !== 0)]
export const automaticNestingOptions = (sheet: { length: number; width: number; edgeGap: number; partGap: number }): NestingOptions => ({
  sheet: { width: sheet.length, height: sheet.width },
  // Native DXF coordinates/radii/angles are serialized at three decimal places.
  edgeClearance: sheet.edgeGap + 0.002,
  partClearance: sheet.partGap + 0.002,
  maxSheets: 32,
  rotations: automaticRotations,
})
export const nestingOptions = (config: Config) => automaticNestingOptions({ length: config.sheetLength, width: config.sheetWidth, edgeGap: config.sheetEdgeGap, partGap: config.sheetPartGap })
export type NestingRequest = { type: 'start'; key: string; job: NestingJob } | { type: 'continue'; key: string }
export type NestingResponse = { key: string; run: NestingRun; elapsedMs: number; done: boolean } | { key: string; error: { code: string; message: string } }
