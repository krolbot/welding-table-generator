import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import JSZip from 'jszip'

let server
let project
let nesting

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  project = await server.ssrLoadModule('/src/tools/project.ts')
  nesting = await server.ssrLoadModule('/src/nesting.ts')
})
after(async () => { await server?.close() })

test('project codec rejects malformed, unknown, versioned and out-of-range data', () => {
  assert.deepEqual(project.parseToolProject(project.projectJson(project.defaultToolProject)), project.defaultToolProject)
  for (const value of [
    '{', JSON.stringify({ ...project.defaultToolProject, version: 2 }),
    JSON.stringify({ ...project.defaultToolProject, extra: true }),
    JSON.stringify({ ...project.defaultToolProject, tool: 'future' }),
    JSON.stringify({ ...project.defaultToolProject, copies: 0 }),
    JSON.stringify({ ...project.defaultToolProject, size: { ...project.defaultToolProject.size, length: Number.NaN } }),
  ]) assert.throws(() => project.parseToolProject(value))
})

test('ZIP contains canonical parts, sheets and manifests, and rejects a tampered layout', async () => {
  const input = { ...project.defaultToolProject, sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 } }
  const key = project.projectKey(input)
  const result = nesting.nestParts(project.projectParts(input), { ...project.projectNestingOptions(input), attempts: 12 })
  assert.equal(project.validProjectLayout(input, result, key), true)
  const archive = project.extensionArchive(input, result, key)
  const readback = await JSZip.loadAsync(await archive.generateAsync({ type: 'nodebuffer' }))
  for (const name of ['project.json', 'layout.json', 'assembly.json', 'README.txt', 'parts/top_1pcs.dxf', 'sheets/Sheet_1.dxf']) assert.ok(readback.file(name), name)
  const tampered = structuredClone(result)
  tampered.placements[0].translation.x = -1
  assert.equal(project.validProjectLayout(input, tampered, key), false)
  assert.throws(() => project.extensionArchive(input, tampered, key), /stale or invalid/)
})
