import { automaticNestingFinish, searchNestingJob, type NestingFinishReason, type NestingRun } from './nestingJob'
import { type NestingRequest, type NestingResponse } from './nestingSettings'

let iterator: Generator<NestingRun> | undefined
let key = ''
let elapsedMs = 0
let phaseElapsedMs = 0
let last: NestingRun | undefined
let lastPhase: NestingRun['phase'] | undefined
let lastImprovements = 0
let unchangedPasses = 0
self.onmessage = (event: MessageEvent<NestingRequest>) => {
  const request = event.data
  try {
    if (request.type === 'start') {
      key = request.key
      elapsedMs = 0
      phaseElapsedMs = 0
      last = undefined
      lastPhase = undefined
      lastImprovements = 0
      unchangedPasses = 0
      iterator = searchNestingJob({ ...request.job, options: { ...request.job.options, attempts: 4096 } })
    }
    if (!iterator || request.key !== key) return
    const started = performance.now()
    const step = iterator.next()
    const duration = performance.now() - started
    elapsedMs += duration
    let finishReason: NestingFinishReason | undefined
    if (!step.done) {
      last = step.value
      if (last.phase !== lastPhase) {
        lastPhase = last.phase; phaseElapsedMs = duration; lastImprovements = last.result.stats.improvements; unchangedPasses = 0
      } else {
        phaseElapsedMs += duration
        if (last.result.stats.improvements > lastImprovements) { lastImprovements = last.result.stats.improvements; unchangedPasses = 0 }
        else unchangedPasses++
      }
      finishReason = automaticNestingFinish(last, unchangedPasses, phaseElapsedMs)
      if (finishReason) iterator = undefined
    } else finishReason = 'exhausted'
    if (last) self.postMessage({ key, run: last, elapsedMs, done: Boolean(step.done || finishReason), finishReason } satisfies NestingResponse)
  } catch (error) {
    self.postMessage({ key: request.key, error: {
      code: error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : 'calculation-failed',
      message: error instanceof Error ? error.message : 'Не удалось рассчитать раскладку',
    } } satisfies NestingResponse)
  }
}
