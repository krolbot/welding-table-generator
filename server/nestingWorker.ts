import { parentPort, workerData } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { automaticNestingFinish, searchNestingJob, type NestingFinishReason, type NestingRun } from '../src/nestingJob'
import { tableNestingJob } from '../src/tableCutJob'
import { parseTableInput, errorDto } from './services'

if (!parentPort) throw new Error('Nesting worker requires a parent port')
const port = parentPort
const config = parseTableInput(workerData.project)
const job = tableNestingJob(config)
const iterator = searchNestingJob({ ...job, options: { ...job.options, attempts: 4096 } })
let elapsedMs = 0
let phaseElapsedMs = 0
let last: NestingRun | undefined
let lastPhase: NestingRun['phase'] | undefined
let lastImprovements = 0
let unchangedPasses = 0
let finished = false

const advance = () => {
  if (finished) return
  try {
    const started = performance.now()
    const step = iterator.next()
    const duration = performance.now() - started
    elapsedMs += duration
    let finishReason: NestingFinishReason | undefined
    if (!step.done) {
      last = step.value
      if (last.phase !== lastPhase) {
        lastPhase = last.phase
        phaseElapsedMs = duration
        lastImprovements = last.result.stats.improvements
        unchangedPasses = 0
      } else {
        phaseElapsedMs += duration
        if (last.result.stats.improvements > lastImprovements) {
          lastImprovements = last.result.stats.improvements
          unchangedPasses = 0
        } else unchangedPasses++
      }
      finishReason = automaticNestingFinish(last, unchangedPasses, phaseElapsedMs)
    } else finishReason = 'exhausted'
    finished = Boolean(step.done || finishReason)
    if (last) port.postMessage({ type: 'result', run: last, elapsedMs, done: finished, finishReason })
    else if (finished) port.postMessage({ type: 'error', error: { code: 'empty-result', message: 'Расчёт раскроя не вернул ни одного варианта.' } })
  } catch (error) {
    finished = true
    port.postMessage({ type: 'error', error: errorDto(error, 'Не удалось рассчитать раскладку') })
  }
}

port.on('message', (message: { type?: string }) => {
  if (message.type === 'continue') advance()
})
advance()
