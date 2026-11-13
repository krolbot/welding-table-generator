import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import * as THREE from 'three'
import DxfParser from 'dxf-parser'

const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
const { extensionParts, extensionDefaults, extensionDimensions, extensionAssembly } = await server.ssrLoadModule('/src/tools/extension.ts')
const { extensionGroup } = await server.ssrLoadModule('/src/tools/ToolAssembly3d.tsx')
const { contourPoints } = await server.ssrLoadModule('/src/geometry.ts')
const { nativeContourBounds, nativeContourDistance, nativePointContourDistance } = await server.ssrLoadModule('/src/nestingNative.ts')
const { nativeDxfForPart } = await server.ssrLoadModule('/src/dxf.ts')
await server.close()

const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-4, `${message}: ${a} != ${b}`)
const inside = (p, vertices) => {
  let result = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}
const loops = part => part.contours.map(contour => contourPoints(contour, 64))
const materialAt = (part, paths, p) => inside(p, paths[0]) && !paths.slice(1).some(path => inside(p, path)) && !part.holes.some(hole => Math.hypot(p.x - hole.x, p.y - hole.y) < hole.d / 2)
const cases = []
for (const length of [400, 450, 500, 800]) for (const width of [200, 400]) for (const height of [150, 200, 250, 300]) for (const thickness of [4, 6, 10]) cases.push({ length, width, height, thickness })

test('reference topology: horizontal perforated top, taper, large windows, open underside and narrow ties', () => {
  const parts = extensionParts(), byName = Object.fromEntries(parts.map(part => [part.name, part]))
  assert.deepEqual(parts.map(part => [part.name, part.count]), [['top', 1], ['longSide', 2], ['nearEnd', 1], ['farEnd', 1], ['crossRib', 2]])
  assert.equal(byName.top.holes.length, 40)
  const side = byName.longSide, first = side.contours[0][0]
  assert.deepEqual(first, { type: 'line', from: { x: 0, y: 0 }, to: { x: 500, y: 150 } })
  const window = nativeContourBounds(side.contours[1])
  assert.ok(window.maxX - window.minX > 250 && window.maxY - window.minY > 80, 'large tapered opening, not a 60 mm square')
  assert.equal(side.contours[1].filter(segment => segment.type === 'arc').length, 3)
  assert.equal(byName.nearEnd.contours.length, 6, 'four straight clamp slots and one radial slot')
  assert.equal(byName.nearEnd.contours.at(-1).filter(segment => segment.type === 'arc').length, 4, 'radial slot has rounded ends')
  assert.equal(byName.farEnd.height, 50)
  assert.equal(byName.crossRib.height, 36, '30 mm tie plus a 6 mm locating tab, not a full diaphragm')
  assert.equal(byName.crossRib.holes.length, 0)
  for (const part of parts) assert.ok(part.contours[0].length > 4, `${part.name} must include actual locating geometry`)
  assert.throws(() => extensionParts({ ...extensionDefaults, thickness: NaN }))
  assert.throws(() => extensionParts({ ...extensionDefaults, width: 199 }))
  assert.throws(() => extensionParts({ ...extensionDefaults, height: 301 }))
})

test('96 supported size combinations keep closed noncrossing contours and holes in real material', () => {
  assert.equal(cases.length, 96)
  for (const config of cases) for (const part of extensionParts(config)) {
    if (part.name !== 'crossRib') assert.ok(part.holes.length > 0, `${part.name} retains usable clamp holes at all supported sizes`)
    const paths = loops(part), [outer, ...cuts] = part.contours
    for (const [i, contour] of part.contours.entries()) {
      const bounds = nativeContourBounds(contour)
      assert.ok(bounds.minX >= -1e-6 && bounds.minY >= -1e-6 && bounds.maxX <= part.width + 1e-6 && bounds.maxY <= part.height + 1e-6)
      for (let a = 0; a < contour.length; a++) for (let b = a + 2; b < contour.length; b++) {
        if (a === 0 && b === contour.length - 1) continue
        assert.ok(nativeContourDistance([contour[a]], [contour[b]]) > 1e-6, `${part.name} self intersection ${i}/${a}/${b} ${JSON.stringify(config)}`)
      }
    }
    for (const hole of part.holes) {
      assert.ok(inside(hole, paths[0]) && !paths.slice(1).some(path => inside(hole, path)), 'no hole or material island inside a window')
      assert.ok(nativePointContourDistance(hole, outer) >= hole.d / 2 + 8 - 1e-6)
      for (const cut of cuts) assert.ok(nativePointContourDistance(hole, cut) >= hole.d / 2 + 8 - 1e-6)
    }
  }
})

test('tab and mortise centres mate in world space without positive-volume plate clashes', () => {
  for (const config of [extensionDefaults, cases[2], cases.at(-1), { length: 450, width: 200, height: 250, thickness: 6 }]) {
    const parts = new Map(extensionParts(config).map(part => [part.name, part]))
    const placements = extensionAssembly(config).map(placement => {
      const part = parts.get(placement.part), paths = loops(part)
      const localPoints = paths[0].flatMap(point => [-part.thickness / 2, part.thickness / 2].map(z => new THREE.Vector3(...placement.origin).addScaledVector(new THREE.Vector3(...placement.axes[0]), point.x).addScaledVector(new THREE.Vector3(...placement.axes[1]), point.y).addScaledVector(new THREE.Vector3(...placement.axes[2]), z)))
      const box = new THREE.Box3().setFromPoints(localPoints)
      return { ...placement, part, paths, box }
    })
    assert.equal(placements.length, 7)
    const solidAt = (placement, world) => {
      const relative = world.clone().sub(new THREE.Vector3(...placement.origin))
      const local = placement.axes.map(axis => relative.dot(new THREE.Vector3(...axis)))
      return Math.abs(local[2]) < placement.part.thickness / 2 - 1e-6 && materialAt(placement.part, placement.paths, { x: local[0], y: local[1] })
    }
    const assembled = new THREE.Box3()
    placements.forEach(placement => assembled.union(placement.box))
    close(assembled.min.x, 0, 'assembly min X'); close(assembled.min.y, 0, 'assembly min Y'); close(assembled.min.z, 0, 'assembly min Z')
    close(assembled.max.x, config.length, 'assembly length'); close(assembled.max.y, config.width, 'assembly width'); close(assembled.max.z, config.height, 'assembly height')
    for (let a = 0; a < placements.length; a++) for (let b = a + 1; b < placements.length; b++) {
      const left = placements[a], right = placements[b], overlap = left.box.clone().intersect(right.box)
      if (overlap.isEmpty()) continue
      const span = overlap.getSize(new THREE.Vector3())
      if (Math.min(span.x, span.y, span.z) < .01) continue
      const values = axis => {
        const min = overlap.min[axis], max = overlap.max[axis]
        const count = max - min <= config.thickness + .01 ? 2 : Math.ceil((max - min) / 2)
        return Array.from({ length: count + 1 }, (_, index) => min + .01 + (max - min - .02) * index / count)
      }
      for (const x of values('x')) for (const y of values('y')) for (const z of values('z')) {
        const world = new THREE.Vector3(x, y, z)
        assert.ok(!(solidAt(left, world) && solidAt(right, world)), `clash ${left.part.name}/${right.part.name} at ${x},${y},${z}; ${JSON.stringify(config)}`)
      }
    }
    const dims = extensionDimensions(config), top = placements.find(p => p.part.name === 'top')
    const side = placements.find(p => p.part.name === 'longSide')
    const near = placements.find(p => p.part.name === 'nearEnd')
    for (const x of dims.sideTabs) {
      const world = new THREE.Vector3(x, config.thickness / 2, config.height - config.thickness / 2)
      assert.ok(solidAt(side, world) && !solidAt(top, world), 'side tab seats in the top edge notch')
    }
    for (const z of dims.rootJoints) {
      const world = new THREE.Vector3(config.thickness / 2, config.thickness / 2, z)
      assert.ok(solidAt(near, world) && !solidAt(side, world), 'mounting-end tab seats in side notch')
    }
    for (const x of dims.ribStations) {
      const tie = placements.find(p => p.part.name === 'crossRib' && p.origin[0] === x)
      const topJoint = new THREE.Vector3(x, config.width / 2, config.height - config.thickness / 2)
      const sideJoint = new THREE.Vector3(x, config.thickness / 2, config.height - config.thickness - dims.ribDepth / 2)
      assert.ok(solidAt(tie, topJoint) && !solidAt(top, topJoint))
      assert.ok(solidAt(tie, sideJoint) && !solidAt(side, sideJoint))
      const cut = parts.get('longSide').contours[dims.ribStations.indexOf(x) + 2], bounds = nativeContourBounds(cut)
      close(bounds.maxX - bounds.minX, config.thickness + dims.clearance, 'tie slot thickness clearance')
      close(bounds.maxY - bounds.minY, dims.ribEndTab + dims.clearance, 'tie slot height clearance')
    }
  }
})

test('actual extruded 3D meshes leave mounting slots, holes, access windows and mortises open', () => {
  const config = extensionDefaults, parts = new Map(extensionParts(config).map(part => [part.name, part]))
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), group = extensionGroup(config, material)
  group.updateMatrixWorld(true)
  const mesh = name => group.getObjectByName(`${name}:0`)
  const hits = (name, origin, direction, far = 1000) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction), 0, far).intersectObject(mesh(name), false).length
  for (const hole of parts.get('top').holes) assert.equal(hits('top', [hole.x, hole.y, 210], [0, 0, -1]), 0)
  assert.ok(hits('top', [20, 50, 210], [0, 0, -1]) > 0)
  assert.equal(hits('longSide', [150, -10, 120], [0, 1, 0]), 0, 'side window is genuinely cut')
  assert.ok(hits('longSide', [30, -10, 190], [0, 1, 0]) > 0)
  assert.equal(hits('longSide', [150, -10, 179], [0, 1, 0]), 0, 'tie mortise is cut through')
  assert.ok(hits('crossRib', [150, -10, 179], [0, 1, 0]) > 0, 'tie tab occupies that mortise')
  for (const [y, z] of [[26, 50], [174, 150], [100, 84], [100, 42]]) assert.equal(hits('nearEnd', [-10, y, z], [1, 0, 0]), 0)
  assert.equal(hits('top', [150, 100, 210], [0, 0, -1]), 0)
  assert.ok(hits('crossRib', [150, 100, 210], [0, 0, -1]) > 0)
  const bounds = new THREE.Box3().setFromObject(group)
  close(bounds.max.z, 200, 'working top remains horizontal at H')
  group.traverse(item => { if (item.isMesh) item.geometry.dispose() })
  material.dispose()
})

test('native DXF retains every exact line, arc and D16 hole, not a rectangular stand-in', () => {
  const parser = new DxfParser()
  for (const config of [extensionDefaults, cases[2], cases.at(-1)]) for (const part of extensionParts(config)) {
    const dxf = parser.parseSync(nativeDxfForPart(part)), entities = dxf.entities
    assert.equal(dxf.header.$INSUNITS, 4)
    assert.equal(entities.filter(entity => entity.type === 'LINE').length, part.contours.flat().filter(segment => segment.type === 'line').length)
    assert.equal(entities.filter(entity => entity.type === 'ARC').length, part.contours.flat().filter(segment => segment.type === 'arc').length)
    const circles = entities.filter(entity => entity.type === 'CIRCLE')
    assert.equal(circles.length, part.holes.length)
    for (const hole of part.holes) assert.ok(circles.some(circle => Math.abs(circle.center.x - hole.x) < .001 && Math.abs(circle.center.y - hole.y) < .001 && circle.radius === hole.d / 2))
    part.contours.flat().forEach((segment, index) => {
      const entity = entities[index]
      const samePoint = (a, b) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= .001)
      if (segment.type === 'line') {
        assert.equal(entity.type, 'LINE')
        samePoint(entity.vertices[0], segment.from)
        samePoint(entity.vertices[1], segment.to)
      } else {
        assert.equal(entity.type, 'ARC')
        samePoint(entity.center, segment.center)
        assert.ok(Math.abs(entity.radius - segment.radius) <= .001)
        const radians = angle => ((angle % 360 + 360) % 360) * Math.PI / 180
        assert.ok(Math.abs(entity.startAngle - radians(segment.clockwise ? segment.end : segment.start)) <= .00002)
        assert.ok(Math.abs(entity.endAngle - radians(segment.clockwise ? segment.start : segment.end)) <= .00002)
      }
      assert.equal(entity.layer, 'OUTLINE')
    })
    assert.ok(entities.every(entity => ['LINE', 'ARC', 'CIRCLE'].includes(entity.type)))
  }
})
