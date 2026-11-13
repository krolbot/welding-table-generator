import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import DxfParser from 'dxf-parser'

let server, geometry, native, dxf, settings, model
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[geometry, native, dxf, settings, model] = await Promise.all([
    '/src/geometry.ts', '/src/contourGeometry.ts', '/src/dxf.ts', '/src/nestingSettings.ts', '/src/model.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })

const config = (values = {}) => ({
  ...model.defaults, length: 1450, width: 1150, height: 150,
  legMounts: true, legMountStyle: 'cornerPlate', engraving: false, ...values,
})
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)
const parse = text => new DxfParser().parseSync(text)
const circle = hole => [{ type: 'arc', center: { x: hole.x, y: hole.y }, radius: hole.d / 2, start: 0, end: 360 }]

const segmentDistance = (line, point) => {
  const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y
  const squared = dx * dx + dy * dy
  const t = squared ? Math.max(0, Math.min(1, ((point.x - line.from.x) * dx + (point.y - line.from.y) * dy) / squared)) : 0
  return Math.hypot(point.x - line.from.x - t * dx, point.y - line.from.y - t * dy)
}

test('four plain leg mounting plates match the corner plates and retain native fabrication geometry', () => {
  for (const values of [
    { height: 100, thickness: 6 },
    { height: 150, thickness: 8 },
    { height: 200, thickness: 12, legPlateSize: 180, legPlateHoleSpacing: 120, legProfileSize: 80 },
  ]) {
    const c = config(values)
    const spec = geometry.legCornerPlateSpec(c)
    assert.ok(spec, JSON.stringify(values))
    const parts = geometry.makeParts(c)
    const upper = parts.find(p => p.name === 'legCornerPlate')
    const lower = parts.find(p => p.name === 'legMountPlate')
    assert.ok(upper && lower)
    assert.equal(lower.count, 4)
    assert.equal(lower.thickness, c.thickness)
    assert.deepEqual(lower.slots, [])
    assert.equal(lower.contours.length, 1)
    assert.equal(lower.contours[0].length, 4)
    assert.ok(lower.contours[0].every(s => s.type === 'line'))
    assert.deepEqual(native.nativeContourBounds(lower.contours[0]), {
      minX: -c.legPlateSize / 2, minY: -c.legPlateSize / 2,
      maxX: c.legPlateSize / 2, maxY: c.legPlateSize / 2,
    })
    const holes = p => p.holes.map(({ x, y, d, kind }) => ({ x, y, d, kind }))
    assert.equal(lower.holes.length, 4)
    assert.deepEqual(holes(lower), holes(upper))
    near(geometry.partWeight(lower, c), (c.legPlateSize ** 2 - Math.PI * c.legPlateHoleDiameter ** 2) * c.thickness * 7.85e-6)
    assert.equal(spec.legTubeLength + lower.thickness, c.legLength)
    const entities = parse(dxf.dxfForPart(lower, c)).entities
    assert.equal(entities.filter(e => e.type === 'LINE').length, 4)
    assert.equal(entities.filter(e => e.type === 'CIRCLE').length, 4)
    assert.equal(entities.length, 8)
    const layout = geometry.layoutParts(c).instances.filter(p => p.part.name === lower.name)
    assert.equal(layout.length, 4)
    assert.deepEqual(layout.map(p => p.instance), [0, 1, 2, 3])
    assert.equal(settings.nestingParts({ ...c, nestingCopies: 2 }).find(p => p.name === lower.name).count, 8)
  }
})

test('mounting plates remain absent in legacy and disabled mount modes', () => {
  for (const values of [{ legMounts: false }, { legMountStyle: 'boltPattern' }]) {
    const c = config(values)
    assert.equal(geometry.legCornerPlateSpec(c), undefined)
    assert.ok(geometry.makeParts(c).every(p => !p.name.startsWith('leg')))
    assert.ok(geometry.layoutParts(c).instances.every(p => !p.part.name.startsWith('leg')))
  }
  assert.equal(model.readPart('leg_mount_plate'), 'legMountPlate')
  const c = config({ customHoles: [{ id: 'probe', part: 'legMountPlate', x: 0, y: 0, d: 12 }] })
  assert.equal(model.projectConfig(c).customHoles[0].part, 'leg_mount_plate')
})

test('every rib bay has one circle with native clearance from the entire mating contour', () => {
  for (const values of [
    { length: 500, width: 400, height: 50, thickness: 1, ribSpacing: 200, ribAccessHoleDiameter: 20 },
    { height: 100, thickness: 6, ribAccessHoleDiameter: 50 },
    { height: 150, thickness: 8, ribAccessHoleDiameter: 80 },
    { height: 200, thickness: 12, ribSpacing: 600, ribAccessHoleDiameter: 100 },
  ]) for (const dogBones of [false, true]) {
    const c = config({ ...values, legMounts: false, ribAccessHoles: true, dogBones, dogBoneDiameter: 5, clearance: 2.5 })
    const spec = geometry.ribAccessHoleSpec(c)
    assert.ok(spec.valid, JSON.stringify({ values, dogBones, spec }))
    const frame = geometry.framePositions(c)
    const plain = geometry.makeParts({ ...c, ribAccessHoles: false })
    for (const part of geometry.makeParts(c).filter(p => p.name.endsWith('Rib'))) {
      assert.deepEqual(part.contours, plain.find(p => p.name === part.name).contours)
      const boundaries = [-part.width / 2 + c.thickness, ...(part.name === 'longRib' ? frame.short : frame.long), part.width / 2 - c.thickness]
      assert.equal(part.holes.length, boundaries.length - 1)
      for (let i = 0; i < boundaries.length - 1; i++) {
        const holes = part.holes.filter(h => h.x > boundaries[i] && h.x < boundaries[i + 1])
        assert.equal(holes.length, 1)
        assert.equal(holes[0].d, c.ribAccessHoleDiameter)
        assert.equal(holes[0].y, 0)
        const gap = native.nativeContourDistance(part.contours[0], circle(holes[0]))
        assert.ok(gap >= spec.web - 1e-7, `${part.name} ${JSON.stringify(values)}: gap ${gap} < ${spec.web}`)
      }
      const circles = parse(dxf.dxfForPart(part, c)).entities.filter(e => e.type === 'CIRCLE')
      assert.equal(circles.length, part.holes.length)
      circles.forEach((e, i) => {
        near(e.center.x, Number(part.holes[i].x.toFixed(3)))
        near(e.center.y, part.holes[i].y)
        near(e.radius, part.holes[i].d / 2)
      })
    }
  }
})

test('access holes update material, cutting, markings and serialized settings without changing disabled geometry', () => {
  const c = config({ ribAccessHoles: true, nameMarking: true })
  const parts = geometry.makeParts(c)
  const holes = parts.filter(p => p.name.endsWith('Rib')).flatMap(p => p.holes.flatMap(h => Array.from({ length: p.count }, () => h)))
  const withHoles = geometry.totals(c), without = geometry.totals({ ...c, ribAccessHoles: false })
  assert.equal(withHoles.holes - without.holes, holes.length)
  near(without.kg - withHoles.kg, holes.reduce((sum, h) => sum + Math.PI * (h.d / 2) ** 2 * c.thickness * 7.85e-6, 0))
  near(withHoles.cut - without.cut, holes.reduce((sum, h) => sum + Math.PI * h.d / 1000, 0))
  for (const part of parts.filter(p => p.name.endsWith('Rib'))) {
    for (const mark of geometry.engravingLines(part, c)) for (const h of part.holes) {
      assert.ok(segmentDistance(mark, h) - h.d / 2 >= 3 - 1e-7)
    }
  }
  const json = JSON.parse(JSON.stringify(model.projectConfig(c)))
  assert.equal(json.ribAccessHoles, true)
  assert.equal(json.ribAccessHoleDiameter, 80)
  assert.deepEqual(geometry.makeParts({ ...c, ribs: false }), geometry.makeParts({ ...c, ribs: false, ribAccessHoles: false }))
  assert.equal(dxf.fullDxf({ ...c, ribs: false }), dxf.fullDxf({ ...c, ribs: false, ribAccessHoles: false }))
})

test('invalid corner mounting geometry cannot silently omit the leg plates from exports', () => {
  const c = config({ legPlateSize: 80, legPlateHoleSpacing: 100 })
  assert.equal(geometry.legCornerPlateSpec(c), undefined)
  assert.equal(geometry.fabricationError(c)?.code, 'leg-plates')
  assert.throws(() => dxf.fullDxf(c), /leg plates/)
  assert.throws(() => settings.nestingParts(c), /leg plates/)
  assert.equal(geometry.fabricationError({ ...c, legMounts: false }), undefined)
  assert.equal(geometry.fabricationError({ ...c, legMountStyle: 'boltPattern' }), undefined)
})

test('oversize access holes fail closed in every fabrication export path', async () => {
  const good = config({ ribAccessHoles: true })
  const max = geometry.ribAccessHoleSpec(good).maxDiameter
  const fitting = { ...good, ribAccessHoleDiameter: max }
  assert.equal(geometry.fabricationError(fitting), undefined)
  for (const bad of [max + 0.001, 0, -1, Infinity, NaN]) {
    const c = { ...good, ribAccessHoleDiameter: bad }
    assert.equal(geometry.fabricationError(c)?.code, 'rib-access')
    const part = geometry.makeParts(good)[0]
    assert.throws(() => dxf.dxfForPart(part, c), /do not fit/)
    assert.throws(() => dxf.fullDxf(c), /do not fit/)
    assert.throws(() => dxf.dxfForNestedSheet(c, []), /do not fit/)
    assert.throws(() => settings.nestingParts(c), /do not fit/)
    assert.equal(dxf.validateNestedExport(c, {}), false)
    assert.throws(() => dxf.nestedArchive(c, {}), /incomplete, stale or invalid/)
    await assert.rejects(dxf.downloadZip(c), /do not fit/)
  }
})
