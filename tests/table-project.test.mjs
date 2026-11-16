import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, codec, model, tools, toolExport
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[codec, model, tools, toolExport] = await Promise.all(['/src/tableProject.ts', '/src/model.ts', '/src/tools/project.ts', '/src/tools/export.ts'].map(path => server.ssrLoadModule(path)))
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
  assert.equal(project.schemaVersion, 3)
  for (const key of ['skirtHoleLayout', 'units', 'preset', 'exploded', 'showDimensions']) assert.equal(key in project, false)
  const result = load(project)
  assert.equal(result.kind, 'current')
  assert.deepEqual(model.projectConfig(result.config), project)
  const decoded = codec.parseTableProject(codec.tableProjectFromQuery(codec.tableProjectQuery(config)))
  assert.deepEqual(model.projectConfig(decoded.config), project)
  assert.equal(decoded.kind, 'current')
})

test('legacy and incomplete projects are rejected instead of entering a migration flow', () => {
  const missingVersion = saved(); delete missingVersion.schemaVersion
  const oldVersion = { ...saved(), schemaVersion: 2 }; delete oldVersion.nestingTools
  const retiredField = { ...saved(), skirtHoleLayout: 'compact' }
  for (const value of [missingVersion, oldVersion, retiredField]) assert.throws(() => load(value))
  assert.throws(() => codec.parseTableProject(codec.tableProjectFromQuery(new URLSearchParams({ length: '1450', width: '1150' }))))
})

test('invalid JSON, future versions, unknown fields, coercions, aliases and duplicate hole IDs are rejected structurally', () => {
  assert.throws(() => codec.parseTableProject('{'), error => error.code === 'invalid-json')
  for (const [change, code] of [
    [{ schemaVersion: 99 }, 'unsupported-version'], [{ skirtHoleLayout: 'compact' }, 'unknown-field'],
    [{ length: '1500' }, 'invalid-field'], [{ enableRibs: 1 }, 'invalid-field'], [{ nestingCopies: 1.5 }, 'invalid-field'],
    [{ height: 120 }, 'unknown-field'], [{ holePattern: 'hexagonal' }, 'invalid-field'],
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

test('retired tool revisions are rejected and current revisions preserve exact dimensions', () => {
  const old = { ...tools.defaultToolProject, version: 2, size: { length: 460, width: 230, height: 175, thickness: 8 }, copies: 2 }
  const text = JSON.stringify(old)
  assert.throws(() => tools.parseToolProject(text), error => error.code === 'unsupported-version')
  assert.throws(() => toolExport.toolPartsArchive(old, { thickness: old.size.thickness }), error => error.code === 'unsupported-version')
  assert.throws(() => toolExport.toolStripDxf(old, { thickness: old.size.thickness }), error => error.code === 'unsupported-version')
  for (const project of [tools.defaultSquareProject, tools.defaultCornerBracketProject]) {
    assert.deepEqual(tools.parseToolProject(tools.projectJson(project)), project)
    assert.equal(project.version, 3)
  }
})
