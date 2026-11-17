import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import JSZip from 'jszip'
import DxfParser from 'dxf-parser'

let server, model, tools, exporter, geometry, settings, cut, codec, dxf
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[model, tools, exporter, geometry, settings, cut, codec, dxf] = await Promise.all([
    '/src/model.ts', '/src/tools/project.ts', '/src/tools/export.ts', '/src/geometry.ts',
    '/src/nestingSettings.ts', '/src/tableCutJob.ts', '/src/tableProject.ts', '/src/dxf.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => server?.close())

const table = thickness => ({ ...model.defaults, thickness })
const mountConfig = changes => ({ ...model.defaults, legMounts: true, legMountStyle: 'boltPattern', ...changes })

// Independently integrate the native contours as fine polygons; no production area helper is used.
const sampledArea = contour => {
  const points = contour.flatMap(segment => {
    if (segment.type === 'line') return [segment.from]
    const raw = (segment.end - segment.start + 360) % 360 || 360
    const sweep = segment.clockwise ? -((segment.start - segment.end + 360) % 360 || 360) : raw
    const steps = Math.ceil(Math.abs(sweep) * 4)
    return Array.from({ length: steps }, (_, index) => {
      const angle = (segment.start + sweep * index / steps) * Math.PI / 180
      return { x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) }
    })
  })
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
}
const sampledVolume = part => (sampledArea(part.contours[0])
  - part.contours.slice(1).reduce((sum, contour) => sum + sampledArea(contour), 0)
  - part.holes.reduce((sum, hole) => sum + Math.PI * (hole.d / 2) ** 2, 0)) * part.thickness

test('all five tool projects use the host stock in parts, mass, assembly, native DXF, ZIP and JSON', async () => {
  assert.equal(tools.toolIds.length, 5)
  for (const thickness of [4, 6, 8]) for (const id of tools.toolIds) {
    const host = table(thickness), project = tools.projectAtTable(tools.toolDefaults[id], host)
    assert.equal(project.size.thickness, thickness, id)
    assert.deepEqual(tools.parseToolProject(tools.projectJson(project)), project)
    const parts = tools.projectModelParts(project)
    assert.ok(parts.length > 0 && parts.every(part => part.thickness === thickness), id)
    assert.ok(parts.every(part => Number.isFinite(geometry.partWeight(part)) && geometry.partWeight(part) > 0), id)
    assert.ok(tools.projectAssembly(project).length > 0, id)
    const archive = await JSZip.loadAsync(await exporter.toolPartsArchive(project, host).generateAsync({ type: 'nodebuffer' }))
    assert.deepEqual(Object.keys(archive.files).filter(name => !name.endsWith('/')).sort(), parts.map(part => `детали/${part.name}_${part.count * project.copies}шт.dxf`).sort())
    for (const part of parts) {
      const parsed = new DxfParser().parseSync(await archive.file(`детали/${part.name}_${part.count * project.copies}шт.dxf`).async('string'))
      assert.equal(parsed.entities.filter(entity => entity.type === 'CIRCLE').length, part.holes.length, `${id}/${part.name}`)
      assert.equal(parsed.entities.filter(entity => entity.type === 'ARC').length, part.contours.flat().filter(segment => segment.type === 'arc').length, `${id}/${part.name}`)
    }
    assert.throws(() => exporter.toolPartsArchive(project, table(thickness + 1)), error => error.code === 'stock-mismatch')
    assert.throws(() => exporter.toolStripDxf(project, table(thickness + 1)), error => error.code === 'stock-mismatch')
  }
})

test('independent sampled native contours confirm material volume and steel-mass estimates', () => {
  const densityKgPerMm3 = 7850 / 1e9 // Assumed steel density, not a material-grade certificate.
  for (const thickness of [4, 6, 8]) {
    const host = table(thickness)
    const products = [
      ...geometry.makeParts(host),
      ...tools.toolIds.flatMap(id => tools.projectModelParts(tools.projectAtTable(tools.toolDefaults[id], host))),
    ]
    for (const part of products) {
      const volume = sampledVolume(part)
      const mass = geometry.partWeight(part)
      assert.ok(volume > 0 && mass > 0, `${part.name} at T${thickness}`)
      assert.ok(Math.abs(mass - volume * densityKgPerMm3) < Math.max(0.0001, mass * 0.0001), `${part.name} at T${thickness}: ${mass} vs ${volume * densityKgPerMm3}`)
    }
  }
})

test('retired stock schemas are rejected while current tools inherit active table stock', () => {
  for (const id of ['extension', 'square', 'cornerBracket']) {
    const current = tools.projectAtTable(tools.toolDefaults[id], table(6))
    const original = JSON.stringify({ ...current, version: current.version - 1 })
    assert.throws(() => tools.parseToolProject(original), error => error.code === 'unsupported-version')
    assert.throws(() => tools.readToolProjectAtTable(original, table(8)), error => error.code === 'unsupported-version')
    const unreviewed = { ...table(8), nestingTools: [{ id, project: current }] }
    const loaded = codec.parseTableProject(JSON.stringify(model.projectConfig(unreviewed))).config
    assert.equal(loaded.nestingTools[0].project.size.thickness, 8)
    assert.throws(() => cut.tableCutInventory(unreviewed), error => error.code === 'thickness-mismatch')
    assert.throws(() => exporter.toolPartsArchive(current, table(8)), error => error.code === 'stock-mismatch')
    assert.throws(() => exporter.toolStripDxf(current, table(8)), error => error.code === 'stock-mismatch')
    assert.ok(cut.tableCutInventory(loaded).parts.every(part => part.thickness === 8))
  }
  for (const id of ['compactExtension', 'viseModule']) {
    const project = tools.projectAtTable(tools.toolDefaults[id], table(6))
    const loaded = tools.readToolProjectAtTable(tools.projectJson(project), table(8))
    assert.equal(loaded.size.thickness, 8)
  }
})

test('bolt patterns cannot silently disappear, overlap, cross lifting cuts, or produce false DXFs', () => {
  for (const changes of [
    { legEdgeOffset: 1000 },
    { legPatternX: 0, legPatternY: 0 },
    { legCols: 1, legRows: 1, legEdgeOffset: 950, legBottomOffset: 96, liftingHoles: true },
  ]) {
    const config = mountConfig(changes)
    assert.equal(geometry.fabricationError(config)?.code, 'leg-bolt-clearance', JSON.stringify(changes))
    assert.throws(() => dxf.fullDxf(config), error => error.code === 'leg-bolt-clearance')
    assert.throws(() => settings.nestingParts(config), error => error.code === 'leg-bolt-clearance')
  }
  const valid = mountConfig({ legBottomOffset: 20, legPatternY: 35 })
  assert.equal(geometry.fabricationError(valid), undefined)
  for (const part of geometry.makeParts(valid).filter(item => item.name.endsWith('Skirt'))) {
    const mounts = part.holes.filter(hole => hole.kind === 'mount')
    assert.equal(mounts.length, 2 * valid.legCols * valid.legRows)
    assert.equal(new Set(mounts.map(hole => `${hole.x}:${hole.y}`)).size, mounts.length)
    const entities = new DxfParser().parseSync(dxf.dxfForPart(part, valid)).entities
    assert.equal(entities.filter(entity => entity.type === 'CIRCLE').length, part.holes.length)
  }
})

test('zero-width and oversized tabs are rejected without allocating infinite geometry', () => {
  const zero = { ...model.defaults, tabWidth: 0 }
  assert.equal(geometry.fabricationError(zero)?.code, 'tab-width')
  assert.throws(() => geometry.makeParts(zero), error => error.code === 'tab-width')
  assert.throws(() => settings.nestingParts(zero), error => error.code === 'tab-width')
  assert.throws(() => codec.parseTableProject(JSON.stringify(model.projectConfig(zero))), /tabWidth/)
  const tooTall = { ...model.defaults, height: 50, thickness: 40, tabWidth: 5, skirtHoles: false }
  assert.equal(geometry.fabricationError(tooTall)?.code, 'tab-width')
  assert.throws(() => dxf.fullDxf(tooTall), error => error.code === 'tab-width')
})
