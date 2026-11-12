import { nestParts, type NestingResult } from '../nesting.js'
import { nestingOptionsFor, type NestingSettings, type ProductionGroup } from './production.js'

export type ToolingNestingRequest = { key: string; groups: ProductionGroup[]; settings: NestingSettings }
export type ToolingNestingResponse = { key: string; results?: Record<string, NestingResult>; error?: string }

self.onmessage = (event: MessageEvent<ToolingNestingRequest>) => {
  try {
    const options = nestingOptionsFor(event.data.settings)
    const results = Object.fromEntries(event.data.groups.map(group => [group.key, nestParts(group.parts, options)]))
    self.postMessage({ key: event.data.key, results } satisfies ToolingNestingResponse)
  } catch (error) {
    self.postMessage({ key: event.data.key, error: error instanceof Error ? error.message : 'Nesting failed' } satisfies ToolingNestingResponse)
  }
}
