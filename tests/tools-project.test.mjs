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
  assert.throws(() => project.parseToolProject(JSON.stringify({ ...project.defaultToolProject, version: 1 })), error => error.code === 'unsupported-version')
})

test('nested ZIP contains only sheet DXFs and rejects a tampered layout', async () => {
  const input = { ...project.defaultToolProject, sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 } }
  const key = project.projectKey(input)
  const result = nesting.nestParts(project.projectParts(input), { ...project.projectNestingOptions(input), attempts: 12 })
  assert.equal(project.validProjectLayout(input, result, key), true)
  const archive = toolExport.toolArchive(input, result, key, { thickness: input.size.thickness })
  const readback = await JSZip.loadAsync(await archive.generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(Object.keys(readback.files).filter(name => !name.endsWith('/')), result.sheets.map(sheet => `Лист_${sheet.index + 1}.dxf`))
  assert.equal(project.validProjectLayout(input, result, 'old-project-key'), false)
  assert.equal(project.validProjectLayout(input, { ...result, placements: result.placements.slice(1) }, key), false)
  assert.equal(project.validProjectLayout(input, { ...result, unplaced: [{ part: project.projectParts(input)[0], instance: 0 }] }, key), false)
  const tampered = structuredClone(result)
  tampered.placements[0].translation.x = -1
  assert.equal(project.validProjectLayout(input, tampered, key), false)
  assert.throws(() => toolExport.toolArchive(input, tampered, key, { thickness: input.size.thickness }), /неполна, устарела/)
})
