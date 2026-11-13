import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let nesting
let geometry
let defaults
let dxf

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  nesting = await server.ssrLoadModule('/src/nesting.ts')
  geometry = await server.ssrLoadModule('/src/geometry.ts')
  dxf = await server.ssrLoadModule('/src/dxf.ts')
  ;({ defaults } = await server.ssrLoadModule('/src/model.ts'))
})

after(async () => {
  await server?.close()
})

const rectangle = (name, width, height, count = 1) => ({
  name,
  width,
  height,
  thickness: 8,
  count,
  holes: [],
  slots: [],
  label: name,
  contours: [[
    { type: 'line', from: { x: -width / 2, y: -height / 2 }, to: { x: width / 2, y: -height / 2 } },
    { type: 'line', from: { x: width / 2, y: -height / 2 }, to: { x: width / 2, y: height / 2 } },
    { type: 'line', from: { x: width / 2, y: height / 2 }, to: { x: -width / 2, y: height / 2 } },
    { type: 'line', from: { x: -width / 2, y: height / 2 }, to: { x: -width / 2, y: -height / 2 } },
  ]],
})

const circle = (name, radius, count = 1) => ({
  ...rectangle(name, radius * 2, radius * 2, count),
  contours: [[0, 90, 180, 270].map(start => ({
    type: 'arc', center: { x: 0, y: 0 }, radius, start, end: (start + 90) % 360,
  }))],
})

test('returns rigid transforms, honors allowed rotations, and opens another sheet instead of forcing a fit', () => {
  const part = rectangle('longSkirt', 70, 40, 2)
  const result = nesting.nestParts([part], {
    sheet: { width: 100, height: 70 }, edgeClearance: 5, partClearance: 5, rotations: [0], maxSheets: 2,
  })

  assert.equal(result.unplaced.length, 0)
  assert.equal(result.sheets.length, 2)
  assert.equal(result.placements.every(placement => placement.rotation === 0), true)
  assert.equal(result.validation.valid, true)
  assert.deepEqual(nesting.transformNestingPoint({ x: -35, y: -20 }, result.placements[0]), { x: 5, y: 5 })
})

test('uses actual tab contour bounds rather than nominal width and reports the excess part as unplaced', () => {
  const tabbed = rectangle('top', 100, 100, 2)
  tabbed.contours[0] = [
    { type: 'line', from: { x: -60, y: -50 }, to: { x: 60, y: -50 } },
    { type: 'line', from: { x: 60, y: -50 }, to: { x: 60, y: 50 } },
    { type: 'line', from: { x: 60, y: 50 }, to: { x: -60, y: 50 } },
    { type: 'line', from: { x: -60, y: 50 }, to: { x: -60, y: -50 } },
  ]
  const result = nesting.nestParts([tabbed], {
    sheet: { width: 225, height: 120 }, edgeClearance: 10, partClearance: 5, rotations: [0], maxSheets: 1,
  })

  assert.equal(result.placements.length, 1)
  assert.deepEqual(result.unplaced.map(item => item.reason), ['no-sheet-space'])
  assert.equal(result.validation.valid, true)
})

test('independent finer arc validation rejects a manual clearance violation', () => {
  const part = circle('legCornerPlate', 50)
  const options = { sheet: { width: 250, height: 140 }, edgeClearance: 5, partClearance: 10, rotations: [0], maxSheets: 1, arcTolerance: 8 }
  const validation = nesting.validateNesting([
    { part, instance: 0, sheet: 0, rotation: 0, translation: { x: 60, y: 70 } },
    { part, instance: 1, sheet: 0, rotation: 0, translation: { x: 160, y: 70 } },
  ], options)

  assert.equal(validation.valid, false)
  assert.match(validation.violations.map(item => item.message).join('\n'), /overlap or violate part clearance/)
})

test('validation rejects crossing contours at zero clearance and non-finite placement', () => {
  const horizontal = rectangle('top', 100, 20)
  const vertical = rectangle('shortSkirt', 20, 100)
  const options = { sheet: { width: 200, height: 200 }, edgeClearance: 0, partClearance: 0, rotations: [0], maxSheets: 1 }
  const make = (part, x, y) => ({ part, instance: 0, sheet: 0, rotation: 0, translation: { x, y } })
  assert.equal(nesting.validateNesting([make(horizontal, 100, 100), make(vertical, 100, 100)], options).valid, false)
  assert.equal(nesting.validateNesting([make(horizontal, NaN, 100)], options).valid, false)
})

test('nests the realistic 1450×1150 corner-tab table deterministically with validated multi-sheet output', () => {
  const config = {
    ...defaults,
    length: 1450,
    width: 1150,
    height: 150,
    thickness: 8,
    ribs: true,
    ribSpacing: 400,
    clearance: 0.2,
    dogBones: true,
    dogBoneDiameter: 2,
    legMounts: true,
    legMountStyle: 'cornerPlate',
    liftingHoles: true,
  }
  const parts = geometry.makeParts(config)
  const source = JSON.stringify(parts.map(part => part.contours))
  const options = { sheet: { width: 3000, height: 1500 }, edgeClearance: 10.002, partClearance: 5.002, maxSheets: 32 }
  const first = nesting.nestParts(parts, options)
  const second = nesting.nestParts(parts, options)

  assert.equal(first.unplaced.length, 0)
  assert.equal(first.validation.valid, true)
  assert.equal(first.placements.length, parts.reduce((sum, part) => sum + part.count, 0))
  assert.equal(JSON.stringify(parts.map(part => part.contours)), source, 'nesting must not rewrite source contours')
  assert.deepEqual(
    first.placements.map(({ part, instance, sheet, rotation, translation }) => [part.name, instance, sheet, rotation, translation]),
    second.placements.map(({ part, instance, sheet, rotation, translation }) => [part.name, instance, sheet, rotation, translation]),
  )
  assert.deepEqual(nesting.validateNesting(first.placements, options), first.validation)

  assert.equal(dxf.validateNestedExport(config, first), true)
  assert.equal(dxf.validateNestedExport({ ...config, length: config.length + 50 }, first), false)
  const duplicated = { ...first, placements: [first.placements[0], ...first.placements.slice(0, -1)] }
  assert.equal(dxf.validateNestedExport(config, duplicated), false)
})
