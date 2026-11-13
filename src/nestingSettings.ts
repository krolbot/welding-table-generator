import { assertFabricationReady, makeParts } from './geometry'
import { projectConfig, type Config } from './model'
import type { NestingOptions, NestingResult } from './nesting'

export const nestingKey = (config: Config) => JSON.stringify(projectConfig(config))
export const nestingParts = (config: Config) => {
  assertFabricationReady(config)
  return makeParts(config).map(part => ({ ...part, count: part.count * config.nestingCopies }))
}
const automaticRotations = [0, 90, 180, 270, ...Array.from({ length: 24 }, (_, i) => i * 15).filter(angle => angle % 90 !== 0)]
export const nestingOptions = (config: Config): NestingOptions => {
  return {
    sheet: { width: config.sheetLength, height: config.sheetWidth },
    // Native DXF coordinates/radii/angles are serialized at three decimal places.
    edgeClearance: config.sheetEdgeGap + 0.002,
    partClearance: config.sheetPartGap + 0.002,
    maxSheets: 32,
    rotations: automaticRotations,
  }
}
export type NestingRequest = { type: 'start'; key: string; config: Config } | { type: 'continue'; key: string }
export type NestingResponse = { key: string; result: NestingResult; elapsedMs: number; done: boolean } | { key: string; error: string }
