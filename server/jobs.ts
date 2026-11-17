import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { dxfForNestedSheet, nestedArchive } from '../src/dxf'
import { projectConfig, type Config } from '../src/model'
import { tableCutEngravings, validateTableCut } from '../src/tableCutJob'
import type { ApiError, NestingJobStatusDto } from '../src/apiContracts'
import type { NestingFinishReason, NestingRun } from '../src/nestingJob'
import { errorDto, parseTableInput, revisionFor } from './services'

const ttlMs = 15 * 60_000
type Job = {
  id: string
  revision: string
  config: Config
  worker: Worker
  running: boolean
  busy: boolean
  status: NestingJobStatusDto['status']
  run: NestingRun | null
  elapsedMs: number
  finishReason: NestingFinishReason | null
  error: ApiError | null
  touchedAt: number
}
const jobs = new Map<string, Job>()

const dto = (job: Job): NestingJobStatusDto => ({
  id: job.id, revision: job.revision, status: job.status, run: job.run,
  elapsedMs: job.elapsedMs, finishReason: job.finishReason, error: job.error,
  engravings: job.run?.phase === 'nesting' ? Object.fromEntries(job.run.result.placements.map(item => [item.part.name, tableCutEngravings(item.part, job.config)])) : {},
})

const stop = (job: Job) => {
  jobs.delete(job.id)
  void job.worker.terminate()
}

setInterval(() => {
  const expiry = Date.now() - ttlMs
  for (const job of jobs.values()) if (job.touchedAt < expiry) stop(job)
}, 60_000).unref()

export const createNestingJob = (input: unknown): NestingJobStatusDto => {
  const config = parseTableInput(input)
  const revision = revisionFor(projectConfig(config))
  const id = randomUUID()
  const worker = new Worker(new URL('./nesting-worker.js', import.meta.url), { workerData: { project: projectConfig(config) } })
  const job: Job = { id, revision, config, worker, running: true, busy: true, status: 'running', run: null, elapsedMs: 0, finishReason: null, error: null, touchedAt: Date.now() }
  jobs.set(id, job)
  worker.on('message', (message: { type: 'result'; run: NestingRun; elapsedMs: number; done: boolean; finishReason?: NestingFinishReason } | { type: 'error'; error: ApiError }) => {
    job.touchedAt = Date.now()
    job.busy = false
    if (message.type === 'error') {
      job.running = false
      job.status = 'error'
      job.error = message.error
      return
    }
    job.run = message.run
    job.elapsedMs = message.elapsedMs
    if (message.done) {
      job.running = false
      job.finishReason = message.finishReason ?? 'exhausted'
      if (message.run.result.validation.valid) job.status = 'done'
      else {
        job.status = 'error'
        job.error = { code: 'invalid-layout', message: 'Сервер отклонил итоговую раскладку как неполную или устаревшую.' }
      }
      return
    }
    if (job.running) {
      job.busy = true
      worker.postMessage({ type: 'continue' })
    } else job.status = 'paused'
  })
  worker.on('error', error => {
    job.running = false
    job.busy = false
    job.status = 'error'
    job.error = errorDto(error, 'Сбой серверного расчёта раскроя')
  })
  worker.on('exit', code => {
    if (code !== 0 && job.status !== 'error') {
      job.running = false
      job.busy = false
      job.status = 'error'
      job.error = { code: 'worker-exit', message: 'Серверный расчёт раскроя был остановлен.' }
    }
  })
  return dto(job)
}

const requireJob = (id: string) => {
  const job = jobs.get(id)
  if (!job) throw Object.assign(new Error('Расчёт не найден или уже удалён.'), { code: 'job-not-found', status: 404 })
  job.touchedAt = Date.now()
  return job
}

export const getNestingJob = (id: string) => dto(requireJob(id))
export const pauseNestingJob = (id: string) => {
  const job = requireJob(id)
  if (job.status !== 'running' && job.status !== 'pausing') return dto(job)
  job.running = false
  job.status = job.busy ? 'pausing' : 'paused'
  return dto(job)
}
export const resumeNestingJob = (id: string) => {
  const job = requireJob(id)
  if (job.status !== 'paused') return dto(job)
  job.running = true
  job.status = 'running'
  if (!job.busy) {
    job.busy = true
    job.worker.postMessage({ type: 'continue' })
  }
  return dto(job)
}
export const deleteNestingJob = (id: string) => {
  const job = requireJob(id)
  stop(job)
}

const exportable = (id: string) => {
  const job = requireJob(id)
  const run = job.run
  if (!run || run.phase !== 'nesting' || !run.result.validation.valid || run.result.unplaced.length || !run.result.placements.length || !validateTableCut(job.config, run.result, run.stock))
    throw Object.assign(new Error('Нет полной проверенной раскладки для экспорта.'), { code: 'invalid-layout', status: 409 })
  return { job, run }
}

export const exportNestingSheet = (id: string, sheetIndex: number) => {
  const { job, run } = exportable(id)
  const placements = run.result.placements.filter(item => item.sheet === sheetIndex)
  if (!placements.length) throw Object.assign(new Error('Выбранный лист не найден.'), { code: 'sheet-not-found', status: 404 })
  return { name: `СварочныйСтол_Лист_${sheetIndex + 1}.dxf`, type: 'application/dxf', bytes: Buffer.from(dxfForNestedSheet(job.config, placements)) }
}

export const exportAllNestingSheets = async (id: string) => {
  const { job, run } = exportable(id)
  const sheets = new Set(run.result.placements.map(item => item.sheet))
  if (sheets.size === 1) return exportNestingSheet(id, [...sheets][0])
  return { name: `СварочныйСтол_Листы_${job.config.length}x${job.config.width}.zip`, type: 'application/zip', bytes: await nestedArchive(job.config, run.result, run.stock).generateAsync({ type: 'nodebuffer' }) }
}
