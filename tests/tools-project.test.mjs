import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import JSZip from 'jszip'

let server
let project
let toolExport
let nesting

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  project = await server.ssrLoadModule('/src/tools/project.ts')
  toolExport = await server.ssrLoadModule('/src/tools/export.ts')
  nesting = await server.ssrLoadModule('/src/nesting.ts')
})
after(async () => { await server?.close() })

test('project codec rejects malformed, unknown, versioned and out-of-range data', () => {
  assert.deepEqual(project.parseToolProject(project.projectJson(project.defaultToolProject)), project.defaultToolProject)
  for (const value of [
    '{', JSON.stringify({ ...project.defaultToolProject, version: 999 }),
    JSON.stringify({ ...project.defaultToolProject, extra: true }),
    JSON.stringify({ ...project.defaultToolProject, tool: 'future' }),
    JSON.stringify({ ...project.defaultToolProject, copies: 0 }),
    JSON.stringify({ ...project.defaultToolProject, size: { ...project.defaultToolProject.size, length: Number.NaN } }),
  ]) assert.throws(() => project.parseToolProject(value))
  assert.throws(() => project.parseToolProject(JSON.stringify({ ...project.defaultToolProject, version: 1 })), /retired box design/)
})

test('ZIP contains canonical parts, sheets and manifests, and rejects a tampered layout', async () => {
  const input = { ...project.defaultToolProject, sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 } }
  const key = project.projectKey(input)
  const result = nesting.nestParts(project.projectParts(input), { ...project.projectNestingOptions(input), attempts: 12 })
  assert.equal(project.validProjectLayout(input, result, key), true)
  const archive = toolExport.toolArchive(input, result, key)
  const readback = await JSZip.loadAsync(await archive.generateAsync({ type: 'nodebuffer' }))
  for (const name of ['project.json', 'layout.json', 'assembly.json', 'README.txt', 'parts/top_1pcs.dxf', 'sheets/Sheet_1.dxf']) assert.ok(readback.file(name), name)
  assert.equal(Object.keys(readback.files).filter(name => /^parts\/.*\.dxf$/.test(name)).length, 5)
  const assembly = JSON.parse(await readback.file('assembly.json').async('string'))
  assert.equal(assembly.version, 2)
  assert.equal(assembly.placements.length, 7)
  assert.equal(assembly.joinery.tipHeight, 50)
  assert.equal(assembly.joinery.clearance, .2)
  assert.match(assembly.axes, /Z up/)
  assert.deepEqual(JSON.parse(await readback.file('project.json').async('string')), input)
  assert.equal(project.validProjectLayout(input, result, 'old-project-key'), false)
  assert.equal(project.validProjectLayout(input, { ...result, placements: result.placements.slice(1) }, key), false)
  assert.equal(project.validProjectLayout(input, { ...result, unplaced: [{ part: project.projectParts(input)[0], instance: 0 }] }, key), false)
  const tampered = structuredClone(result)
  tampered.placements[0].translation.x = -1
  assert.equal(project.validProjectLayout(input, tampered, key), false)
  assert.throws(() => toolExport.toolArchive(input, tampered, key), /stale or invalid/)
})
