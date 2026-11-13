import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, codec, model, tools
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[codec, model, tools] = await Promise.all(['/src/tableProject.ts', '/src/model.ts', '/src/tools/project.ts'].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const saved = (change = {}) => model.projectConfig({ ...model.defaults, ...change })
const load = value => codec.parseTableProject(JSON.stringify(value))

test('canonical table JSON and URL preserve exact fabrication data and omit retired/display fields', () => {
  const config = { ...model.defaults, ...model.presetValues.D28, preset: 'D28', grid: 'staggered', length: 1460.25, thickness: 8.1,
    customHoles: [{ id: 123, part: 'longSkirt', x: 18.12345, y: 20.98765, d: 10.5 }],
    removedHoles: ['top:-5.000:20.000', { id: 'old', part: 'shortSkirt', x: 25, y: 31, r: 8 }],
  }
  const project = model.projectConfig(config)
  assert.equal(project.schemaVersion, 2)
  for (const key of ['skirtHoleLayout', 'units', 'preset', 'exploded', 'showDimensions']) assert.equal(key in project, false)
  const result = load(project)
  assert.equal(result.kind, 'current')
  assert.deepEqual(model.projectConfig(result.config), project)
  const decoded = codec.parseTableProject(codec.tableProjectFromQuery(codec.tableProjectQuery(config)))
  assert.deepEqual(model.projectConfig(decoded.config), project)
  assert.equal(decoded.kind, 'current')
})

test('legacy projects enter explicit review with origins and manual data preserved, never inferred presets', () => {
  for (const layout of ['canonical', 'compact']) for (const margin of [25, 37, 50, 100]) {
    const original = saved({ margin, customHoles: [{ id: 'manual', part: 'top', x: 1.25, y: 3.75, d: 12 }], removedHoles: ['top:0.000:0.000'] })
    delete original.schemaVersion
    original.skirtHoleLayout = layout
    const result = load(original)
    assert.equal(result.kind, 'migration')
    assert.equal(result.config.margin, margin)
    assert.deepEqual(result.config.customHoles, original.customHoles)
    assert.deepEqual(result.config.removedHoles, original.removedHoles)
    assert.equal('skirtHoleLayout' in result.config, false)
    const current = model.projectConfig(result.config)
    assert.equal(load(current).kind, 'current')
    assert.equal('skirtHoleLayout' in current, false)
  }
  const legacyUrl = new URLSearchParams({ length: '1450', width: '1150', margin: '50', enableRibs: 'true', skirtHoleLayout: 'compact' })
  const result = codec.parseTableProject(codec.tableProjectFromQuery(legacyUrl))
  assert.equal(result.kind, 'migration'); assert.equal(result.config.margin, 50)
})

test('invalid JSON, future versions, unknown fields, coercions, aliases and duplicate hole IDs are rejected structurally', () => {
  assert.throws(() => codec.parseTableProject('{'), error => error.code === 'invalid-json')
  for (const [change, code] of [
    [{ schemaVersion: 99 }, 'unsupported-version'], [{ skirtHoleLayout: 'compact' }, 'unknown-field'],
    [{ length: '1500' }, 'invalid-field'], [{ enableRibs: 1 }, 'invalid-field'], [{ nestingCopies: 1.5 }, 'invalid-field'],
    [{ height: 120 }, 'invalid-field'], [{ holePattern: 'hexagonal' }, 'invalid-field'],
    [{ customHoles: [{ id: 1, part: 'top', x: 0, y: 0, d: 10 }, { id: '1', part: 'top', x: 0, y: 0, d: 10 }] }, 'invalid-field'],
    [{ customHoles: [{ id: 1, part: 'unknown', x: 0, y: 0, d: 10 }] }, 'invalid-field'],
    [{ removedHoles: [{ id: 1, part: 'top', x: 0, y: 0, r: -1 }] }, 'invalid-field'],
  ]) assert.throws(() => load({ ...saved(), ...change }), error => error.code === code)
  const incomplete = saved(); delete incomplete.enableSkirtHoles
  assert.throws(() => load(incomplete), error => error.code === 'missing-field')
  assert.throws(() => codec.tableProjectFromQuery(new URLSearchParams('length=1450&length=1460')), error => error.code === 'invalid-field')
  assert.throws(() => codec.tableProjectFromQuery(new URLSearchParams('state=%7B%7D&state=%7B%7D')), error => error.code === 'invalid-field')
  assert.throws(() => codec.tableProjectFromQuery(new URLSearchParams('state=%7B%7D&length=1450')), error => error.code === 'invalid-field')
  assert.throws(() => codec.tableProjectFromQuery(new URLSearchParams('project=%7B%7D')), error => error.code === 'unsupported-version')
  assert.throws(() => codec.tableProjectFromQuery(new URLSearchParams('customHoles=broken')), error => error.code === 'invalid-field')
  assert.equal(codec.tableProjectFromQuery(new URLSearchParams('workspace=tools&toolProject=%7B%7D')), undefined)
})

test('extension revision 2 requires explicit review; revision 3 preserves dimensions/copies and gates every export', () => {
  const old = { ...tools.defaultToolProject, version: 2, size: { length: 460, width: 230, height: 175, thickness: 8 }, copies: 2 }
  const text = JSON.stringify(old)
  assert.throws(() => tools.parseToolProject(text), error => error.code === 'grid-migration')
  assert.throws(() => tools.toolPartsArchive(old), error => error.code === 'grid-migration')
  assert.throws(() => tools.toolStripDxf(old), error => error.code === 'grid-migration')
  const reviewed = tools.readToolProject(text)
  assert.equal(reviewed.kind, 'migration')
  assert.deepEqual(reviewed.project, { ...old, version: 3 })
  assert.equal(tools.readToolProject(tools.projectJson(reviewed.project)).kind, 'current')
  assert.throws(() => tools.readToolProject(JSON.stringify({ ...old, size: { ...old.size, thickness: 10 } })), error => error.code === 'invalid-dimensions')
  for (const project of [tools.defaultSquareProject, tools.defaultCornerBracketProject]) {
    assert.equal(tools.readToolProject(tools.projectJson(project)).kind, 'current')
    assert.equal(project.version, 2)
  }
})
