import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let extension
let dxf
let nesting

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  extension = await server.ssrLoadModule('/src/tools/extension.ts')
  dxf = await server.ssrLoadModule('/src/dxf.ts')
  nesting = await server.ssrLoadModule('/src/nesting.ts')
})

after(async () => { await server?.close() })

const endpoint = (segment, end) => {
  if (segment.type === 'line') return segment[end]
  const radians = segment[end === 'from' ? 'start' : 'end'] * Math.PI / 180
  return { x: segment.center.x + segment.radius * Math.cos(radians), y: segment.center.y + segment.radius * Math.sin(radians) }
}
const pointSegmentDistance = (value, from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y, squared = dx * dx + dy * dy
  const factor = squared ? Math.max(0, Math.min(1, ((value.x - from.x) * dx + (value.y - from.y) * dy) / squared)) : 0
  return Math.hypot(value.x - from.x - factor * dx, value.y - from.y - factor * dy)
}

test('creates the canonical seven-piece open-bottom extension with nominal mating dimensions', () => {
  assert.deepEqual(extension.extensionDefaults, { length: 500, width: 200, height: 200, thickness: 6 })
  const parts = extension.extensionParts(extension.extensionDefaults)
  assert.deepEqual(parts.map(part => [part.name, part.count]), [['top', 1], ['longSide', 2], ['nearEnd', 1], ['farEnd', 1], ['crossRib', 2]])
  const byName = Object.fromEntries(parts.map(part => [part.name, part]))
  assert.deepEqual([byName.top.width, byName.top.height], [500, 200])
  for (const name of ['longSide', 'nearEnd', 'farEnd', 'crossRib']) assert.equal(byName[name].height, 194)
  for (const name of ['nearEnd', 'farEnd', 'crossRib']) assert.equal(byName[name].width, 188)
  assert.deepEqual({ sidePlanes: [[0, 6], [194, 200]], endPlanes: [[0, 6], [494, 500]], ribPlanes: [500 / 3, 1000 / 3] }, {
    sidePlanes: [[0, extension.extensionDefaults.thickness], [extension.extensionDefaults.width - extension.extensionDefaults.thickness, extension.extensionDefaults.width]],
    endPlanes: [[0, extension.extensionDefaults.thickness], [extension.extensionDefaults.length - extension.extensionDefaults.thickness, extension.extensionDefaults.length]],
    ribPlanes: [extension.extensionDefaults.length / 3, 2 * extension.extensionDefaults.length / 3],
  })
  const world = extension.extensionAssembly(extension.extensionDefaults).map(({ part, instance, origin, axes }) => {
    const blank = byName[part]
    const vertices = [0, blank.width].flatMap(x => [0, blank.height].flatMap(y => [-blank.thickness / 2, blank.thickness / 2].map(z =>
      origin.map((coordinate, axis) => coordinate + axes[0][axis] * x + axes[1][axis] * y + axes[2][axis] * z))))
    return { part, instance, min: origin.map((_, axis) => Math.min(...vertices.map(vertex => vertex[axis]))), max: origin.map((_, axis) => Math.max(...vertices.map(vertex => vertex[axis]))) }
  })
  assert.deepEqual(world.find(item => item.part === 'top').min,[0,0,194])
  assert.deepEqual(world.find(item => item.part === 'top').max,[500,200,200])
  assert.deepEqual(world.find(item => item.part === 'nearEnd').min,[0,6,0])
  assert.deepEqual(world.find(item => item.part === 'farEnd').max,[500,194,194])
  assert.ok(world.every(item => item.min.every((value, axis) => value >= -1e-6 && item.max[axis] <= [500,200,200][axis] + 1e-6)))
})

test('uses closed native cuts, D16 grids, and a radial slot that emits DXF arcs', () => {
  const parts = extension.extensionParts()
  for (const part of parts) for (const contour of part.contours) {
    assert.ok(contour.length >= 3)
    contour.forEach((segment, index) => assert.ok(Math.hypot(endpoint(segment, 'to').x - endpoint(contour[(index + 1) % contour.length], 'from').x, endpoint(segment, 'to').y - endpoint(contour[(index + 1) % contour.length], 'from').y) < 1e-6))
  }
  const top = parts.find(part => part.name === 'top')
  const side = parts.find(part => part.name === 'longSide')
  const farEnd = parts.find(part => part.name === 'farEnd')
  const nearEnd = parts.find(part => part.name === 'nearEnd')
  assert.ok(top.holes.length > 0 && side.holes.length > 0)
  assert.ok([...top.holes, ...side.holes].every(hole => hole.d === 16 && hole.kind === 'grid' && hole.x % 50 === 25 && hole.y % 50 === 25))
  assert.equal(nearEnd.holes.length,16)
  assert.ok(nearEnd.holes.every(hole => (hole.x + 6) % 50 === 25 && hole.y % 50 === 25))
  assert.equal(farEnd.contours[1].filter(segment => segment.type === 'arc').length, 2)
  const dxfText = dxf.nativeDxfForPart(farEnd)
  assert.equal((dxfText.match(/\nARC\n/g) ?? []).length, 2)
})

test('keeps all grid holes clear of edges and the assumed long-side access window', () => {
  const side = extension.extensionParts().find(part => part.name === 'longSide')
  const window = side.contours[1]
  for (const hole of side.holes) {
    assert.ok(hole.x - 8 >= 8 && hole.y - 8 >= 8 && hole.x + 8 <= side.width - 8 && hole.y + 8 <= side.height - 8)
    const clearance = Math.min(...window.map(segment => pointSegmentDistance(hole, segment.from, segment.to)))
    assert.ok(clearance >= 16)
  }
})

test('a grid centre inside the access window never becomes a spurious material island', () => {
  const side = extension.extensionParts({ length: 450, width: 200, height: 250, thickness: 6 }).find(part => part.name === 'longSide')
  assert.ok(side.contours[1].some(segment => segment.from?.x === 195 && segment.from?.y === 92))
  assert.equal(side.holes.some(hole => hole.x === 225 && hole.y === 125), false)
  const window = side.contours[1].map(segment => segment.from)
  const minX = Math.min(...window.map(point => point.x)), maxX = Math.max(...window.map(point => point.x))
  const minY = Math.min(...window.map(point => point.y)), maxY = Math.max(...window.map(point => point.y))
  assert.ok(side.holes.every(hole => hole.x < minX || hole.x > maxX || hole.y < minY || hole.y > maxY))
})

test('rejects invalid configurations and nests the actual default cut list', () => {
  assert.throws(() => extension.extensionParts({ ...extension.extensionDefaults, width: 199 }), /width/)
  assert.throws(() => extension.extensionParts({ ...extension.extensionDefaults, thickness: Number.NaN }), /finite/)
  const parts = extension.extensionParts({ length: 400, width: 200, height: 150, thickness: 10 })
  assert.equal(parts.length, 5)
  const result = nesting.nestParts(extension.extensionParts(), {
    sheet: { width: 2600, height: 1000 }, edgeClearance: 10, partClearance: 5, rotations: [0, 90], maxSheets: 1, attempts: 4,
  })
  assert.equal(result.unplaced.length, 0)
  assert.equal(result.validation.valid, true)
  assert.equal(result.placements.length, 7)
  assert.equal(nesting.validateNesting(result.placements, { sheet: { width: 2600, height: 1000 }, edgeClearance: 10, partClearance: 5, rotations: [0, 90], maxSheets: 1, attempts: 4 }).valid, true)
})
