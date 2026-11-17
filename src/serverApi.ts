import type { TablePreviewDto, ToolPreviewDto, NestingJobStatusDto } from './apiContracts'

export class ServerApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) { super(message) }
}

const errorFrom = async (response: Response) => {
  try {
    const value = await response.json() as { error?: { code?: string; message?: string } }
    return new ServerApiError(value.error?.code ?? 'request-failed', value.error?.message ?? `Ошибка сервера: ${response.status}`, response.status)
  } catch { return new ServerApiError('request-failed', `Ошибка сервера: ${response.status}`, response.status) }
}

const jsonRequest = async <Result>(url: string, body?: unknown, options: { method?: string; signal?: AbortSignal } = {}): Promise<Result> => {
  const response = await fetch(url, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'), signal: options.signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await errorFrom(response)
  if (response.status === 204) return undefined as Result
  return response.json() as Promise<Result>
}

export const previewTable = (project: unknown, signal?: AbortSignal) => jsonRequest<TablePreviewDto>('/api/preview/table', { project }, { signal })
export const previewTool = (project: unknown, table: unknown, signal?: AbortSignal) => jsonRequest<ToolPreviewDto>('/api/preview/tool', { project, table }, { signal })

const filename = (response: Response, fallback: string) => {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (!encoded) return fallback
  try { return decodeURIComponent(encoded) } catch { return fallback }
}
const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}
export const downloadFromApi = async (url: string, body?: unknown, fallback = 'download') => {
  const response = await fetch(url, { method: 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw await errorFrom(response)
  saveBlob(await response.blob(), filename(response, fallback))
}

export const startNestingJob = (project: unknown, signal?: AbortSignal) => jsonRequest<NestingJobStatusDto>('/api/nesting/jobs', { project }, { signal })
export const readNestingJob = (id: string, signal?: AbortSignal) => jsonRequest<NestingJobStatusDto>(`/api/nesting/jobs/${id}`, undefined, { signal })
export const pauseServerNesting = (id: string) => jsonRequest<NestingJobStatusDto>(`/api/nesting/jobs/${id}/pause`, {}, {})
export const resumeServerNesting = (id: string) => jsonRequest<NestingJobStatusDto>(`/api/nesting/jobs/${id}/resume`, {}, {})
export const deleteServerNesting = (id: string) => jsonRequest<void>(`/api/nesting/jobs/${id}`, undefined, { method: 'DELETE' })
export const downloadNesting = (id: string, sheet?: number) => downloadFromApi(`/api/nesting/jobs/${id}/export${sheet === undefined ? '' : `?sheet=${sheet}`}`, undefined, sheet === undefined ? 'Раскрой.zip' : `Лист_${sheet + 1}.dxf`)
