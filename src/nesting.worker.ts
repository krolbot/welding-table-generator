import { searchNesting, type NestingResult } from './nesting'
import { nestingOptions, nestingParts, type NestingRequest, type NestingResponse } from './nestingSettings'

let iterator: Generator<NestingResult> | undefined
let key = ''
let elapsedMs = 0
let last: NestingResult | undefined
self.onmessage = (event: MessageEvent<NestingRequest>) => {
  const request = event.data
  try {
    if (request.type === 'start') {
      key = request.key
      elapsedMs = 0
      last = undefined
      iterator = searchNesting(nestingParts(request.config), { ...nestingOptions(request.config), attempts: 4096 })
    }
    if (!iterator || request.key !== key) return
    const started = performance.now()
    const step = iterator.next()
    elapsedMs += performance.now() - started
    if (!step.done) last = step.value
    if (last) self.postMessage({ key, result: last, elapsedMs, done: Boolean(step.done) } satisfies NestingResponse)
  } catch (error) {
    self.postMessage({ key: request.key, error: error instanceof Error ? error.message : 'Nesting calculation failed' } satisfies NestingResponse)
  }
}
