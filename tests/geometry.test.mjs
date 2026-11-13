import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let geometry
let dxf
let defaults

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  geometry = await server.ssrLoadModule('/src/geometry.ts')
  dxf = await server.ssrLoadModule('/src/dxf.ts')
  ;({ defaults } = await server.ssrLoadModule('/src/model.ts'))
})

after(async () => {
  await server?.close()
})

const fullConfig = () => ({
  ...defaults,
  length: 1450,
  width: 1150,
  height: 150,
  thickness: 8,
  grid: 'square',
  ribs: true,
  ribSpacing: 400,
  clearance: 0.2,
  dogBones: true,
  dogBoneDiameter: 2,
  legMounts: true,
  legMountStyle: 'cornerPlate',
  liftingHoles: true,
  engraving: true,
  nameMarking: true,
})

const bounds = points => ({
  minX: Math.min(...points.map(point => point.x)),
  maxX: Math.max(...points.map(point => point.x)),
  minY: Math.min(...points.map(point => point.y)),
  maxY: Math.max(...points.map(point => point.y)),
})

const segmentDistance = (line, point) => {
  const dx = line.to.x - line.from.x
  const dy = line.to.y - line.from.y
  const lengthSquared = dx * dx + dy * dy
  if (!lengthSquared) return Math.hypot(point.x - line.from.x, point.y - line.from.y)
  const t = Math.max(0, Math.min(1, ((point.x - line.from.x) * dx + (point.y - line.from.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (line.from.x + t * dx), point.y - (line.from.y + t * dy))
}

test('lifting cutout uses the nearest rib-free long-skirt bay', () => {
  const config = fullConfig()
  const skirt = geometry.makeParts(config).find(part => part.name === 'longSkirt')
  assert.ok(skirt)

  const cutoutBounds = skirt.contours.slice(1)
    .map(contour => bounds(geometry.contourPoints(contour, 72)))
    .find(box => Math.abs(box.maxX - box.minX - 160) < 0.001 && Math.abs(box.maxY - box.minY - 50) < 0.001)
  assert.ok(cutoutBounds)

  const centerX = (cutoutBounds.minX + cutoutBounds.maxX) / 2
  assert.equal(Math.abs(centerX), 0)
  const slotBounds = skirt.contours.slice(1, 1 + skirt.slots.length)
    .map(contour => bounds(geometry.contourPoints(contour, 72)))
  for (const box of slotBounds) {
    const slotCenter = (box.minX + box.maxX) / 2
    const web = Math.abs(centerX - slotCenter) - (80 + (box.maxX - box.minX) / 2)
    assert.ok(web >= 3, `lifting cutout leaves only ${web} mm beside rib slot at ${slotCenter}`)
  }
})

test('part-name engraving keeps a 3 mm web around every cut hole', () => {
  const config = { ...fullConfig(), engraving: false }
  for (const part of geometry.makeParts(config)) {
    const lines = geometry.engravingLines(part, config)
    assert.ok(lines.length > 0, `${part.name} lost its complete part marking`)
    for (const line of lines) {
      for (const hole of part.holes) {
        const clearance = segmentDistance(line, hole) - hole.d / 2
        assert.ok(clearance >= 3 - 1e-6, `${part.name} engraving clears ${hole.id} by only ${clearance} mm`)
      }
    }
  }
})

test('name clipping does not change grid engraving', () => {
  const config = fullConfig()
  const topWithoutNames = geometry.makeParts({ ...config, nameMarking: false }).find(part => part.name === 'top')
  const topWithNames = geometry.makeParts(config).find(part => part.name === 'top')
  assert.ok(topWithoutNames && topWithNames)

  const gridLines = geometry.engravingLines(topWithoutNames, { ...config, nameMarking: false })
  const combined = geometry.engravingLines(topWithNames, config)
  assert.deepEqual(combined.slice(0, gridLines.length), gridLines)
  assert.ok(combined.length > gridLines.length)
})

test('lifting and name-marking contracts hold across boundary configurations and DXF', () => {
  const cases = [
    { length: 500, width: 500, height: 100, thickness: 4, ribSpacing: 200, clearance: 0, dogBones: false },
    { length: 800, width: 600, height: 100, thickness: 6, ribSpacing: 250, clearance: 0, dogBones: true, dogBoneDiameter: 2 },
    { length: 1800, width: 900, height: 200, thickness: 10, ribSpacing: 450, clearance: 1, dogBones: true, dogBoneDiameter: 4 },
    { length: 1200, width: 800, height: 120, thickness: 8, ribSpacing: 400, clearance: 1, dogBones: false, ribs: false },
  ]

  for (const values of cases) {
    // Small lifting/marking fixtures do not accommodate the corner-leg assembly.
    const config = { ...fullConfig(), ...values, engraving: false, legMounts: false }
    const parts = geometry.makeParts(config)
    const skirt = parts.find(part => part.name === 'longSkirt')
    assert.ok(skirt)
    const cutout = skirt.contours.slice(1)
      .map(contour => bounds(geometry.contourPoints(contour, 72)))
      .find(box => Math.abs(box.maxX - box.minX - 160) < 0.001)
    assert.ok(cutout, `missing lifting cutout for ${config.length}×${config.width}`)
    const centerX = (cutout.minX + cutout.maxX) / 2
    assert.ok(config.length / 2 - Math.abs(centerX) - 80 >= 3)
    const slotBounds = skirt.contours.slice(1, 1 + skirt.slots.length)
      .map(contour => bounds(geometry.contourPoints(contour, 72)))
    for (const box of slotBounds) {
      const slotCenter = (box.minX + box.maxX) / 2
      const web = Math.abs(centerX - slotCenter) - (80 + (box.maxX - box.minX) / 2)
      assert.ok(web >= 3 - 1e-6)
    }
    if (!config.ribs) assert.equal(centerX, 0)

    for (const part of parts) {
      const lines = geometry.engravingLines(part, config)
      assert.ok(lines.every(line => Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y) > 1e-6))
      for (const line of lines) for (const hole of part.holes) {
        assert.ok(segmentDistance(line, hole) - hole.d / 2 >= 3 - 1e-6)
      }
      const exported = dxf.dxfForPart(part, config)
      assert.match(exported, /\$ACADVER\n1\nAC1009/)
      assert.match(exported, /\$INSUNITS\n70\n4/)
      assert.doesNotMatch(exported, /NaN|Infinity/)
    }
    assert.doesNotMatch(dxf.fullDxf(config), /NaN|Infinity/)
  }
})
