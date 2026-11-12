import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import DxfParser from 'dxf-parser'

let server, catalog, project, production, model, dxf, nesting

test.before(async () => {
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  catalog = await server.ssrLoadModule('/src/tooling/catalog.ts')
  project = await server.ssrLoadModule('/src/tooling/project.ts')
  production = await server.ssrLoadModule('/src/tooling/production.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  dxf = await server.ssrLoadModule('/src/dxf.ts')
  nesting = await server.ssrLoadModule('/src/nesting.ts')
})
test.after(async () => server?.close())

const item = (id, index = 0) => ({
  instanceId: `line-${id}`,
  config: catalog.createToolingConfig(id),
  quantity: 1,
  material: ['S235JR', 'S355JR', 'AISI304', 'AlMg3'][index % 4],
})

test('combined project parser preserves legacy tables and rejects unknown, duplicate and invalid basket data', () => {
  const legacy = project.parseCombinedProject({ length: 1200, width: 800, customHoles: [] })
  assert.equal(legacy.version, 2)
  assert.equal(legacy.tooling.length, 0)
  const valid = { version: 2, table: { length: 1200, width: 800 }, includeTable: false, tooling: [item('A01')] }
  assert.deepEqual(project.parseCombinedProject(valid), valid)
  assert.deepEqual(project.decodeCombinedProject(project.encodeCombinedProject(valid)), valid)
  for (const invalid of [
    { ...valid, extra: true },
    { ...valid, tooling: [{ ...item('A01'), extra: true }] },
    { ...valid, tooling: [item('A01'), item('A01')] },
    { ...valid, tooling: [{ ...item('A01'), quantity: 0 }] },
    { ...valid, tooling: [{ ...item('A01'), material: 'wood' }] },
    { ...valid, tooling: [{ ...item('A01'), config: { id: 'A01', values: { ...item('A01').config.values, mystery: 3 } } }] },
  ]) assert.throws(() => project.parseCombinedProject(invalid))
})

test('production model covers exact A01-C07 catalog and groups every real sheet part by material and thickness', () => {
  const items = catalog.TOOLING_IDS.map(item)
  const result = production.buildProductionModel(model.defaults, items, false)
  assert.deepEqual(result.lines.map(line => line.line.config.id), catalog.TOOLING_IDS)
  assert.equal(new Set(result.lines.map(line => line.line.config.id)).size, 34)
  const groupParts = result.groups.flatMap(group => group.parts.map(part => ({ group, part })))
  assert.ok(groupParts.length > 34)
  for (const { group, part } of groupParts) {
    assert.equal(group.material, part.material)
    assert.equal(group.thickness, part.thickness)
    assert.equal(part.process, 'laser-cut')
    assert.ok(part.source.toolingId)
  }
  assert.ok(result.purchased.some(value => value.toolingId === 'C06'))
  assert.ok(result.purchased.some(value => value.toolingId === 'C07'))
  assert.ok(!groupParts.some(({ part }) => result.purchased.some(value => value.id === part.name)))
})

test('mating basket lines fail closed when A10/B08 or A13/B14 interfaces do not match', () => {
  const a10 = item('A10')
  const b08 = item('B08')
  assert.doesNotThrow(() => production.buildProductionModel(model.defaults, [a10, b08], false))
  const badB08 = { ...b08, config: catalog.createToolingConfig('B08', { ...b08.config.values, insertPitch: 90 }) }
  assert.throws(() => production.buildProductionModel(model.defaults, [a10, badB08], false), /A10\/B08/)
  const a13 = item('A13')
  const b14 = item('B14')
  assert.doesNotThrow(() => production.buildProductionModel(model.defaults, [a13, b14], false))
  const badB14 = { ...b14, config: catalog.createToolingConfig('B14', { ...b14.config.values, slatThickness: 4 }) }
  assert.throws(() => production.buildProductionModel(model.defaults, [a13, badB14], false), /A13\/B14/)
})

test('production ZIP keeps separate part files when imported basket IDs sanitize to the same text', () => {
  const first = { ...item('A01'), instanceId: 'same/id' }
  const second = { ...item('A01'), instanceId: 'same?id', config: catalog.createToolingConfig('A01', { ...item('A01').config.values, length: 400 }) }
  const result = production.buildProductionModel(model.defaults, [first, second], false)
  const settings = { sheetLength: 3000, sheetWidth: 1500, edgeGap: 10, partGap: 5, rotations: [0, 90, 180, 270] }
  const layouts = Object.fromEntries(result.groups.map(group => [group.key, nesting.nestParts(group.parts, production.nestingOptionsFor(settings))]))
  const zip = production.productionArchive(result, layouts, settings)
  const partFiles = Object.keys(zip.files).filter(name => name.startsWith('parts/') && name.endsWith('.dxf'))
  assert.deepEqual(partFiles, ['parts/001_A01-stop_1pcs.dxf', 'parts/002_A01-stop_1pcs.dxf'])
})

test('table inclusion and per-line material remain separate and native tooling DXF uses LINE ARC CIRCLE entities', () => {
  const b01 = { ...item('B01'), material: 'AISI304' }
  const a01 = { ...item('A01', 1), material: 'S355JR' }
  const result = production.buildProductionModel(model.defaults, [b01, a01], true)
  assert.ok(result.groups.some(group => group.material === 'S235JR' && group.parts.some(part => part.source.kind === 'table')))
  assert.ok(result.groups.some(group => group.material === 'AISI304' && group.parts.some(part => part.source.toolingId === 'B01')))
  assert.ok(result.groups.some(group => group.material === 'S355JR' && group.parts.some(part => part.source.toolingId === 'A01')))
  const b01Parts = result.groups.flatMap(group => group.parts).filter(part => part.source.toolingId === 'B01')
  const entities = b01Parts.flatMap(part => new DxfParser().parseSync(dxf.nativeDxfForPart(part)).entities)
  assert.ok(entities.some(entity => entity.type === 'LINE'))
  assert.ok(entities.some(entity => entity.type === 'ARC'))
  assert.ok(entities.some(entity => entity.type === 'CIRCLE'))
  assert.ok(entities.every(entity => !['LWPOLYLINE', 'POLYLINE'].includes(entity.type)))
})
