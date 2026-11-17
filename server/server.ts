import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNestingJob, deleteNestingJob, exportAllNestingSheets, exportNestingSheet, getNestingJob, pauseNestingJob, resumeNestingJob } from './jobs'
import { errorDto, tableDxf, tablePartsZip, tablePreview, toolDxf, toolPartsZip, toolPreview } from './services'

const port = Number(process.env.PORT ?? 80)
const publicRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

const send = (response: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
  response.writeHead(status, { ...securityHeaders, ...headers })
  response.end(body)
}
const json = (response: ServerResponse, status: number, value: unknown) => send(response, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
const body = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > 2_000_000) throw Object.assign(new Error('Запрос слишком большой.'), { code: 'payload-too-large', status: 413 })
    chunks.push(value)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw Object.assign(new Error('Некорректный JSON запроса.'), { code: 'invalid-json', status: 400 }) }
}
const attachment = (name: string) => `attachment; filename="download${extname(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`
const binary = (response: ServerResponse, value: { name: string; type: string; bytes: Buffer }) => send(response, 200, value.bytes, { 'Content-Type': value.type, 'Content-Length': String(value.bytes.length), 'Content-Disposition': attachment(value.name), 'Cache-Control': 'no-store' })

const api = async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
  if (request.method === 'POST' && pathname === '/api/preview/table') {
    const value = await body(request) as { project?: unknown }
    return json(response, 200, tablePreview(value.project))
  }
  if (request.method === 'POST' && pathname === '/api/preview/tool') {
    const value = await body(request) as { project?: unknown; table?: unknown }
    return json(response, 200, toolPreview(value.project, value.table))
  }
  if (request.method === 'POST' && pathname === '/api/export/table.dxf') {
    const value = await body(request) as { project?: unknown }
    return binary(response, tableDxf(value.project))
  }
  if (request.method === 'POST' && pathname === '/api/export/table-parts.zip') {
    const value = await body(request) as { project?: unknown }
    return binary(response, await tablePartsZip(value.project))
  }
  if (request.method === 'POST' && pathname === '/api/export/tool.dxf') {
    const value = await body(request) as { project?: unknown; table?: unknown }
    return binary(response, toolDxf(value.project, value.table))
  }
  if (request.method === 'POST' && pathname === '/api/export/tool-parts.zip') {
    const value = await body(request) as { project?: unknown; table?: unknown }
    return binary(response, await toolPartsZip(value.project, value.table))
  }
  if (request.method === 'POST' && pathname === '/api/nesting/jobs') {
    const value = await body(request) as { project?: unknown }
    return json(response, 202, createNestingJob(value.project))
  }
  const match = pathname.match(/^\/api\/nesting\/jobs\/([0-9a-f-]+)(?:\/(pause|resume|export))?$/)
  if (match) {
    const [, id, action] = match
    if (request.method === 'GET' && !action) return json(response, 200, getNestingJob(id))
    if (request.method === 'DELETE' && !action) { deleteNestingJob(id); response.writeHead(204, securityHeaders); return response.end() }
    if (request.method === 'POST' && action === 'pause') return json(response, 200, pauseNestingJob(id))
    if (request.method === 'POST' && action === 'resume') return json(response, 200, resumeNestingJob(id))
    if (request.method === 'POST' && action === 'export') {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const sheet = url.searchParams.get('sheet')
      return binary(response, sheet === null ? await exportAllNestingSheets(id) : exportNestingSheet(id, Number(sheet)))
    }
  }
  return json(response, 404, { error: { code: 'not-found', message: 'API-метод не найден.' } })
}

const staticFile = async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
  const requestPath = pathname === '/' ? '/index.html' : pathname
  const safe = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '')
  let path = join(publicRoot, safe)
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not-file')
  } catch { path = join(publicRoot, 'index.html') }
  const bytes = await readFile(path)
  const immutable = path.includes('/assets/')
  send(response, 200, request.method === 'HEAD' ? '' : bytes, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/healthz') return send(response, 200, 'ok\n', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    if (url.pathname.startsWith('/api/')) return await api(request, response, url.pathname)
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: { code: 'method-not-allowed', message: 'Метод не поддерживается.' } })
    await staticFile(request, response, decodeURIComponent(url.pathname))
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 400
    json(response, status, { error: errorDto(error) })
  }
})
server.listen(port, '0.0.0.0', () => console.log(`Welding Table Generator listening on ${port}`))
