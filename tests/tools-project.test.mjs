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

test('explicit Tool reset replaces obsolete geometry, preserves sheet and keeps stock out of Tool projects', () => {
  const table = { length: 1450, width: 1150, height: 150, thickness: 8, holeDiameter: 16, pitch: 50, margin: 25, grid: 'square' }
  const sheet = { length: 2875, width: 1444, edgeGap: 11, partGap: 6 }
  const obsoleteExtension = { ...project.defaultToolProject, version: 3, size: { ...project.defaultToolProject.size, length: 537, thickness: 12 }, sheet, copies: 4 }
  const resetExtension = project.resetToolProject(obsoleteExtension, table)
  assert.deepEqual(resetExtension, project.projectAtTable({ ...project.defaultToolProject, sheet }, table))
  assert.equal(Object.hasOwn(resetExtension.size, 'thickness'), false)
  assert.equal(resetExtension.copies, 1)

  const obsoleteBracket = { ...project.defaultCornerBracketProject, version: 4, size: { ...project.defaultCornerBracketProject.size, thickness: 8 }, sheet, copies: 3 }
  const resetBracket = project.resetToolProject(obsoleteBracket, table)
  assert.equal(resetBracket.version, 6)
  assert.equal(Object.hasOwn(resetBracket.size, 'thickness'), false)
  assert.equal(resetBracket.size.cornerCut, 60)
  assert.equal(resetBracket.size.slotLength, 140)
  assert.deepEqual(resetBracket.sheet, sheet)
})

test('nested ZIP contains only sheet DXFs and rejects a tampered layout', async () => {
  const input = { ...project.defaultToolProject, sheet: { length: 3000, width: 1500, edgeGap: 10, partGap: 5 } }
  const table = { thickness: 8 }
  const key = project.projectKey(input, table)
  const result = nesting.nestParts(project.projectParts(input, table), { ...project.projectNestingOptions(input), attempts: 12 })
  assert.equal(project.validProjectLayout(input, table, result, key), true)
  const archive = toolExport.toolArchive(input, result, key, table)
  const readback = await JSZip.loadAsync(await archive.generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(Object.keys(readback.files).filter(name => !name.endsWith('/')), result.sheets.map(sheet => `Лист_${sheet.index + 1}.dxf`))
  assert.equal(project.validProjectLayout(input, table, result, 'old-project-key'), false)
  assert.equal(project.validProjectLayout(input, table, { ...result, placements: result.placements.slice(1) }, key), false)
  assert.equal(project.validProjectLayout(input, table, { ...result, unplaced: [{ part: project.projectParts(input, table)[0], instance: 0 }] }, key), false)
  const tampered = structuredClone(result)
  tampered.placements[0].translation.x = -1
  assert.equal(project.validProjectLayout(input, table, tampered, key), false)
  assert.throws(() => toolExport.toolArchive(input, tampered, key, table), /неполна, устарела/)
})
