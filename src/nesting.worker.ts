import { searchNestingJob, type NestingRun } from './nestingJob'
import { type NestingRequest, type NestingResponse } from './nestingSettings'

let iterator: Generator<NestingRun> | undefined
let key = ''
let elapsedMs = 0
let last: NestingRun | undefined
self.onmessage = (event: MessageEvent<NestingRequest>) => {
  const request = event.data
  try {
    if (request.type === 'start') {
      key = request.key
      elapsedMs = 0
      last = undefined
      iterator = searchNestingJob({ ...request.job, options: { ...request.job.options, attempts: 4096 } })
    }
    if (!iterator || request.key !== key) return
    const started = performance.now()
    const step = iterator.next()
    elapsedMs += performance.now() - started
    if (!step.done) last = step.value
    if (last) self.postMessage({ key, run: last, elapsedMs, done: Boolean(step.done) } satisfies NestingResponse)
  } catch (error) {
    self.postMessage({ key: request.key, error: {
      code: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'calculation-failed',
      message: error instanceof Error ? error.message : 'Nesting calculation failed',
    } } satisfies NestingResponse)
  }
}
