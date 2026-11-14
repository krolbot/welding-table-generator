import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import JSZip from 'jszip'
import DxfParser from 'dxf-parser'
import * as THREE from 'three'

let server, model, tools, cut, jobs, nesting, settings, codec, dxf, geometry, viewer
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[model, tools, cut, jobs, nesting, settings, codec, dxf, geometry, viewer] = await Promise.all([
    '/src/model.ts', '/src/tools/project.ts', '/src/tableCutJob.ts', '/src/nestingJob.ts', '/src/nesting.ts',
    '/src/nestingSettings.ts', '/src/tableProject.ts', '/src/dxf.ts', '/src/geometry.ts', '/src/ThreeAssembly.tsx',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const table = (changes = {}) => ({ ...model.defaults, length: 800, width: 500, height: 100, tabWidth: 25, ribs: false, dogBones: false, showDimensions: false, ...changes })
const selection = (id, tool, changes = {}) => ({ id, project: { ...tools.toolDefaults[tool], ...changes, size: { ...tools.toolDefaults[tool].size, thickness: 8, ...changes.size } } })
const baseline = c => nesting.nestParts(settings.nestingParts(c), { ...settings.nestingOptions(c), attempts: 12 })
const finish = (c, base = baseline(c), attempts = 12) => {
  const job = cut.tableNestingJob(c, { key: cut.tableLayoutKey(c), result: base })
  job.options.attempts = attempts
  const runs = [...jobs.searchNestingJob(job)]
  assert.equal(runs[0].phase, 'nesting', 'the actual existing table layout must be reused')
  return runs.at(-1)
}

test('selected tools preserve exact native geometry and independent quantities with collision-free provenance', () => {
  const c = table({ nestingCopies: 2, nestingTools: [selection('one', 'extension'), selection('two', 'square', { copies: 2 }), selection('three', 'square'), selection('four', 'cornerBracket'), selection('five', 'compactExtension', { copies: 2 })] })
  const inventory = cut.tableCutInventory(c)
  assert.equal(new Set(inventory.parts.map(p => p.name)).size, inventory.parts.length)
  assert.ok(inventory.parts.find(p => p.name === 'top'))
  assert.ok(inventory.parts.find(p => p.name === 'tool:one:top'))
  for (const row of c.nestingTools) for (const original of tools.projectModelParts(row.project)) {
    const actual = inventory.parts.find(p => p.name === `tool:${row.id}:${original.name}`)
    assert.deepEqual({ ...actual, name: original.name, label: original.label, count: original.count }, original)
    assert.equal(actual.count, original.count * row.project.copies, 'tool quantities are not multiplied by table count')
    assert.equal(inventory.sources[actual.name].perCopy, original.count)
    assert.deepEqual(cut.tableCutEngravings(actual, c), [], 'tool top never inherits table engraving')
  }
  assert.deepEqual(geometry.makeParts(c), geometry.makeParts({ ...c, nestingTools: [] }), 'accepted table geometry is unchanged')
  assert.throws(() => cut.tableCutInventory(table({ nestingTools: [selection('bad', 'square', { size: { thickness: 6 } })] })), error => error.code === 'thickness-mismatch' && error.selectionId === 'bad')
  const many = Array.from({ length: 4 }, (_, i) => selection(`extension-${i}`, 'extension', { copies: 10 }))
  assert.throws(() => cut.tableCutInventory(table({ nestingTools: many })), error => error.code === 'part-limit')
})

test('schema 3 round-trips selected tools exactly; v2 imports empty tools without a grid migration', () => {
  const c = table({ nestingTools: [selection('ext', 'extension'), selection('bracket', 'cornerBracket', { copies: 3 }), selection('compact', 'compactExtension', { copies: 2 })] })
  const saved = model.projectConfig(c)
  assert.equal(saved.schemaVersion, 3)
  assert.deepEqual(model.projectConfig(codec.parseTableProject(JSON.stringify(saved)).config), saved)
  assert.deepEqual(model.projectConfig(codec.parseTableProject(codec.tableProjectFromQuery(codec.tableProjectQuery(c))).config), saved)
  const v2 = { ...model.projectConfig(table()), schemaVersion: 2 }; delete v2.nestingTools
  const loaded = codec.parseTableProject(JSON.stringify(v2))
  assert.equal(loaded.kind, 'current'); assert.deepEqual(loaded.config.nestingTools, [])
  assert.deepEqual(geometry.makeParts(loaded.config), geometry.makeParts(table()))
  const rows = saved.nestingTools
  for (const invalid of [null, [{ ...rows[0], unknown: true }], [rows[0], rows[0]], [{ ...rows[0], id: '../bad' }], [{ ...rows[0], project: { ...rows[0].project, version: 2 } }]]) {
    assert.throws(() => codec.parseTableProject(JSON.stringify({ ...saved, nestingTools: invalid })))
  }
  assert.throws(() => codec.parseTableProject(JSON.stringify({ ...v2, nestingTools: rows })))
})

test('compact thickness inherits the table across geometry, selection and project links without changing other tools', () => {
  const source = selection('compact', 'compactExtension', { copies: 2, size: { thickness: 6 } })
  const original = structuredClone(source)
  for (const thickness of [4, 6, 8]) {
    const c = table({ thickness, nestingTools: [source] })
    const inventory = cut.tableCutInventory(c), resolved = inventory.selections[0]
    assert.equal(resolved.id, source.id)
    assert.equal(resolved.project.copies, 2)
    assert.deepEqual(resolved.project.size, { ...source.project.size, thickness })
    assert.ok(inventory.parts.every(part => part.thickness === thickness))
    for (const expected of tools.projectModelParts(resolved.project)) {
      const actual = inventory.parts.find(part => part.name === `tool:compact:${expected.name}`)
      assert.deepEqual(actual.contours, expected.contours)
      assert.deepEqual(actual.holes, expected.holes)
    }
    const json = JSON.stringify(model.projectConfig(c))
    const loaded = codec.parseTableProject(json).config
    assert.deepEqual(loaded.nestingTools, inventory.selections)
    const query = codec.tableProjectQuery(loaded)
    query.set('toolProject', tools.projectJson(resolved.project))
    assert.deepEqual(model.projectConfig(codec.parseTableProject(codec.tableProjectFromQuery(query)).config), model.projectConfig(loaded))
    assert.equal(codec.tableProjectFromQuery(new URLSearchParams({ toolProject: tools.projectJson(source.project) })), undefined)
  }
  assert.deepEqual(source, original, 'inherited stock never mutates an input snapshot')
  for (const id of tools.toolIds.filter(id => id !== 'compactExtension')) {
    const project = tools.toolDefaults[id]
    assert.strictEqual(tools.projectAtTableThickness(project, 4), project)
  }
  for (const thickness of [3, 9, 10]) {
    assert.throws(() => tools.toolSelectionsAtTableThickness([source], thickness))
    assert.deepEqual(source, original, 'failed stock changes preserve dimensions, quantity and original stock')
  }
})

test('compact shared export records inherited stock and refuses the previous layout after a thickness change', async () => {
  const c = table({ nestingTools: [selection('compact', 'compactExtension', { copies: 2, size: { thickness: 6 } })] })
  const run = finish(c)
  assert.equal(cut.validateTableCut(c, run.result, run.stock), true)
  const zip = await JSZip.loadAsync(await dxf.nestedArchive(c, run.result, run.stock).generateAsync({ type: 'nodebuffer' }))
  const manifest = JSON.parse(await zip.file('layout.json').async('string'))
  const project = JSON.parse(await zip.file('project.json').async('string'))
  assert.equal(manifest.selectedTools[0].project.size.thickness, c.thickness)
  assert.equal(project.nestingTools[0].project.size.thickness, c.thickness)
  assert.deepEqual(manifest.selectedTools, project.nestingTools)
  assert.ok(manifest.parts.every(part => part.thickness === c.thickness))
  const changed = { ...c, thickness: 6, nestingTools: tools.toolSelectionsAtTableThickness(c.nestingTools, 6) }
  assert.notEqual(settings.nestingKey(changed), settings.nestingKey(c))
  assert.equal(cut.validateTableCut(changed, run.result, run.stock), false)
  assert.throws(() => dxf.nestedArchive(changed, run.result, run.stock), error => error.code === 'invalid-layout')
})

test('complete mixed job fits existing stock and real ZIP preserves all circles, arcs, engraving and provenance', async () => {
  const c = table({ nestingTools: [selection('ext', 'extension'), selection('square', 'square', { copies: 2 }), selection('bracket', 'cornerBracket'), selection('compact', 'compactExtension', { copies: 2 })] })
  const base = baseline(c), run = finish(c, base)
  assert.equal(cut.validateTableCut(c, run.result, run.stock), true)
  assert.ok(run.result.sheets.length <= base.sheets.length)
  const zip = await JSZip.loadAsync(await dxf.nestedArchive(c, run.result, run.stock).generateAsync({ type: 'nodebuffer' }))
  const manifest = JSON.parse(await zip.file('layout.json').async('string'))
  assert.deepEqual(manifest.selectedTools, c.nestingTools)
  assert.deepEqual(manifest.parts, cut.tableCutInventory(c).parts)
  assert.deepEqual(manifest.capacity.tableLayout, base)
  assert.equal(manifest.capacity.sheetLimit, base.sheets.length)
  assert.deepEqual(JSON.parse(await zip.file('project.json').async('string')), model.projectConfig(c))
  for (const sheet of run.result.sheets) {
    const parsed = new DxfParser().parseSync(await zip.file(`Sheet_${sheet.index + 1}.dxf`).async('string'))
    assert.equal(parsed.header.$INSUNITS, 4)
    assert.equal(parsed.entities.filter(e => e.type === 'CIRCLE').length, sheet.placements.reduce((n, p) => n + p.part.holes.length, 0))
    assert.equal(parsed.entities.filter(e => e.type === 'ARC').length, sheet.placements.reduce((n, p) => n + p.part.contours.flat().filter(s => s.type === 'arc').length, 0))
    assert.equal(parsed.entities.filter(e => e.layer === 'ENGRAVE').length, sheet.placements.reduce((n, p) => n + cut.tableCutEngravings(p.part, c).length, 0))
  }
  for (const p of manifest.placements) assert.equal(p.copy, Math.floor(p.instance / p.source.perCopy))
  assert.throws(() => dxf.fullDxf(c), error => error.code === 'sheet-export-required')
  await assert.rejects(dxf.downloadZip(c), error => error.code === 'sheet-export-required')
})

test('insufficient existing capacity blocks the whole job, including partially placed tools and an extra-sheet result', () => {
  const c = table({ sheetLength: 1000, sheetWidth: 1000, nestingTools: [selection('many', 'extension', { copies: 10 })] })
  const base = baseline(c), inventory = cut.tableCutInventory(c), run = finish(c, base, 2)
  assert.equal(base.unplaced.length, 0)
  assert.ok(inventory.parts.reduce((n, p) => n + Math.abs(geometry.signedContourArea(p.contours[0])) * p.count, 0) > base.sheets.length * c.sheetLength * c.sheetWidth)
  assert.ok(run.result.unplaced.length > 0)
  assert.ok(run.result.placements.some(p => p.part.name.startsWith('tool:')))
  assert.ok(run.result.sheets.length <= base.sheets.length)
  assert.equal(cut.validateTableCut(c, run.result, run.stock), false)
  assert.throws(() => dxf.nestedArchive(c, run.result, run.stock), error => error.code === 'invalid-layout')
  const extra = nesting.nestParts(inventory.parts, { ...settings.nestingOptions(c), attempts: 1 })
  assert.equal(extra.unplaced.length, 0)
  assert.ok(extra.sheets.length > base.sheets.length)
  assert.equal(cut.validateTableCut(c, extra, run.stock), false)
})

test('export refuses stale tools, stock, quantities, duplicates, changed sheet arrays and tampered capacity', () => {
  const c = table({ nestingTools: [selection('square', 'square')] }), run = finish(c)
  assert.equal(cut.validateTableCut(c, run.result, run.stock), true)
  assert.equal(cut.validateTableCut({ ...c, thickness: 6 }, run.result, run.stock), false)
  assert.equal(cut.validateTableCut({ ...c, nestingTools: [selection('square', 'square', { copies: 2 })] }, run.result, run.stock), false)
  assert.equal(cut.validateTableCut(c, run.result, { kind: 'new-sheets' }), false)
  const mutations = [
    r => { r.placements[0].part.holes.pop() },
    r => { r.placements[0].translation.x = -100 },
    r => { r.placements[0] = r.placements[1] },
    r => { r.sheets[0].placements.pop() },
  ]
  for (const mutate of mutations) { const changed = structuredClone(run.result); mutate(changed); assert.equal(cut.validateTableCut(c, changed, run.stock), false) }
  const stock = structuredClone(run.stock); stock.baseline.sheets.push({ index: 1, placements: [] })
  assert.equal(cut.validateTableCut(c, run.result, stock), false)
  const job = cut.tableNestingJob(c, { key: cut.tableLayoutKey(c), result: stock.baseline })
  assert.throws(() => jobs.searchNestingJob(job).next(), error => error.code === 'stale-baseline')
  assert.equal(settings.nestingKey(c), settings.nestingKey({ ...c, units: 'inch', exploded: 75, showDimensions: true }))
})

test('first-time mixed job exposes a non-exportable table-capacity phase before bounded shared search', () => {
  const c = table({ nestingTools: [selection('square', 'square')] })
  const job = cut.tableNestingJob(c); job.options.attempts = 2
  const it = jobs.searchNestingJob(job), first = it.next().value
  assert.equal(first.phase, 'capacity')
  assert.equal(first.result.placements.some(p => p.part.name.startsWith('tool:')), false)
  assert.equal(cut.validateTableCut(c, first.result, { kind: 'new-sheets' }), false)
  let last = first
  for (const run of it) last = run
  assert.equal(last.phase, 'nesting')
  assert.equal(cut.validateTableCut(c, last.result, last.stock), true)
  assert.ok(last.result.sheets.length <= last.stock.baseline.sheets.length)
})

test('actual shared Three sheet renderer keeps every mixed part and the same rigid placements as DXF', () => {
  const c = table({ nestingTools: [selection('ext', 'extension'), selection('square', 'square'), selection('bracket', 'cornerBracket'), selection('compact', 'compactExtension')] })
  const run = finish(c)
  const runtime = { assembly: new THREE.Group(), dimensions: new THREE.Group(), meshes: [], metal: new THREE.MeshStandardMaterial(), colors: { edge: 0, dim: 0 }, renderHoles: true, factor: 0, targetFactor: 0 }
  viewer.rebuildSheets(runtime, c, run.result)
  runtime.assembly.updateMatrixWorld(true)
  const placements = run.result.sheets.flatMap(s => s.placements)
  assert.equal(runtime.meshes.length, placements.length)
  runtime.meshes.forEach((mesh, index) => {
    const p = placements[index], sheetPosition = run.result.sheets.findIndex(s => s.index === p.sheet)
    const transformed = nesting.transformNestingPoint({ x: 12.3, y: 45.6 }, p)
    const actual = mesh.localToWorld(new THREE.Vector3(12.3, 45.6, 0))
    const offset = (sheetPosition - (run.result.sheets.length - 1) / 2) * c.sheetLength * 1.08
    assert.ok(Math.abs(actual.x - (offset + transformed.x - c.sheetLength / 2)) < 1e-6)
    assert.ok(Math.abs(actual.z - (c.sheetWidth / 2 - transformed.y)) < 1e-6)
    assert.equal(mesh.userData.part, p.part.name)
    assert.equal(mesh.userData.holesCount, p.part.holes.length)
    if (p.part.name.startsWith('tool:')) assert.equal(mesh.userData.dims, `${p.part.width.toFixed(0)} × ${p.part.height.toFixed(0)} mm`)
  })
  runtime.metal.dispose()
})
