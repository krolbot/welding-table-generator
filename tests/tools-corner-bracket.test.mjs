import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import DxfParser from 'dxf-parser'
import JSZip from 'jszip'
import * as THREE from 'three'

let server, bracket, projects, geometry, native, nesting, dxf, viewer, toolExport
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[bracket, projects, geometry, native, nesting, dxf, viewer, toolExport] = await Promise.all([
    '/src/tools/cornerBracket.ts', '/src/tools/project.ts', '/src/geometry.ts', '/src/contourGeometry.ts',
    '/src/nesting.ts', '/src/dxf.ts', '/src/tools/ToolAssembly3d.tsx', '/src/tools/export.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)
const inside = (p, vertices) => {
  let result = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}
const material = (part, p) => inside(p, geometry.contourPoints(part.contours[0], 64))
  && !part.contours.slice(1).some(cut => inside(p, geometry.contourPoints(cut, 64)))
  && !part.holes.some(hole => Math.hypot(p.x - hole.x, p.y - hole.y) < hole.d / 2)

const sizes = [[210, 210], [260, 260], [310, 310], [210, 260], [260, 210]]
const cases = () => sizes.flatMap(([length, width]) => [50, 60, 100].flatMap(height => [4, 8, 12].map(thickness => ({ ...bracket.cornerBracketDefaults, length, width, height, thickness }))))

test('corner reference has one relieved triangular base, two perpendicular walls, twelve holes and one capsule slot', () => {
  const parts = bracket.cornerBracketParts(), [base, holes, slot] = parts
  assert.deepEqual(parts.map(p => [p.name, p.count, p.holes.length, p.contours.length]), [
    ['cornerBase', 1, 9, 1], ['cornerHoleWall', 1, 3, 1], ['cornerSlotWall', 1, 0, 2],
  ])
  assert.deepEqual(native.nativeContourBounds(base.contours[0]), { minX: 0, minY: 0, maxX: 210, maxY: 210 })
  assert.deepEqual(base.holes.map(hole => [hole.x, hole.y]), [[80, 30], [130, 30], [180, 30], [30, 80], [80, 80], [130, 80], [30, 130], [80, 130], [30, 180]])
  assert.equal(material(base, { x: 5, y: 5 }), false, 'relieved elbow')
  assert.equal(material(base, { x: 180, y: 180 }), false, 'open diagonal side')
  assert.equal(material(base, { x: 200, y: 20 }), true, 'short free end retained, not an ideal triangle')
  assert.equal(material(base, { x: 105, y: 105 }), true)
  assert.equal(holes.holes.length, 3)
  const bounds = native.nativeContourBounds(slot.contours[1])
  near(bounds.maxX - bounds.minX, 150)
  near(bounds.maxY - bounds.minY, 16)
  assert.equal(slot.contours[1].filter(segment => segment.type === 'arc').length, 2)
  assert.equal(parts.reduce((count, part) => count + part.count, 0), 3)
})

test('corner size/thickness matrix retains every required hole, noncrossing contours and 5 mm webs', () => {
  for (const config of cases()) for (const part of bracket.cornerBracketParts(config)) {
    for (const contour of part.contours) {
      const points = geometry.contourPoints(contour, 64)
      assert.ok(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
      for (let i = 0; i < contour.length; i++) for (let j = i + 2; j < contour.length; j++) {
        if (i === 0 && j === contour.length - 1) continue
        assert.ok(native.nativeContourDistance([contour[i]], [contour[j]]) > 1e-6)
      }
    }
    for (const hole of part.holes) {
      assert.ok(inside(hole, geometry.contourPoints(part.contours[0], 64)))
      for (const contour of part.contours) assert.ok(native.nativePointContourDistance(hole, contour) >= hole.d / 2 + 5 - 1e-6)
    }
    assert.equal(part.holes.length, part.name === 'cornerBase' ? 9 : part.name === 'cornerHoleWall' ? 3 : 0)
  }
  for (const clearance of [0, 0.2, 1]) bracket.cornerBracketParts({ ...bracket.cornerBracketDefaults, clearance })
})

test('corner rejects impossible holes, slot, joints, profile and nonfinite inputs instead of dropping geometry', () => {
  for (const change of [
    { length: 160 }, { width: 160 }, { holePitch: 100 }, { holeDiameter: 28, height: 40 },
    { slotLength: 210 }, { cornerCut: 100 }, { tipWidth: 150 }, { clearance: -0.1 },
    { tabWidth: 41 }, { thickness: NaN }, { height: Infinity }, { slotLength: 10 },
  ]) assert.throws(() => bracket.cornerBracketParts({ ...bracket.cornerBracketDefaults, ...change }), JSON.stringify(change))
})

test('corner world interfaces seat four flush tabs with the declared clearances and no overlapping stock', () => {
  for (const config of [bracket.cornerBracketDefaults, ...cases().filter((_, i) => i % 9 === 0), { ...bracket.cornerBracketDefaults, clearance: 0 }, { ...bracket.cornerBracketDefaults, clearance: 1 }]) {
    const parts = new Map(bracket.cornerBracketParts(config).map(part => [part.name, part]))
    const placements = bracket.cornerBracketAssembly(config).map(placement => ({ ...placement, part: parts.get(placement.part) }))
    const worldPoint = (placement, p, n = 0) => new THREE.Vector3(...placement.origin).addScaledVector(new THREE.Vector3(...placement.axes[0]), p.x).addScaledVector(new THREE.Vector3(...placement.axes[1]), p.y).addScaledVector(new THREE.Vector3(...placement.axes[2]), n)
    const occupies = (placement, world) => {
      const relative = world.clone().sub(new THREE.Vector3(...placement.origin))
      const local = placement.axes.map(axis => relative.dot(new THREE.Vector3(...axis)))
      return Math.abs(local[2]) < config.thickness / 2 - 1e-6 && material(placement.part, { x: local[0], y: local[1] })
    }
    const boxes = placements.map(p => new THREE.Box3().setFromPoints(geometry.contourPoints(p.part.contours[0]).flatMap(v => [-config.thickness / 2, config.thickness / 2].map(n => worldPoint(p, v, n)))))
    const bounds = boxes.reduce((box, next) => box.union(next), new THREE.Box3())
    bounds.min.toArray().forEach(value => near(value, 0))
    bounds.max.toArray().forEach((value, index) => near(value, [config.length, config.width, config.height][index]))
    const [base, wallX, wallY] = placements, dims = bracket.cornerBracketDimensions(config)
    for (const [wall, stations, along] of [[wallX, dims.xJoints, 'x'], [wallY, dims.yJoints, 'y']]) {
      for (const station of stations) {
        const world = new THREE.Vector3(config.thickness / 2, config.thickness / 2, config.thickness / 2)
        world[along] = station
        assert.equal(occupies(wall, world), true, 'wall tab reaches base midplane')
        assert.equal(occupies(base, world), false, 'base notch receives tab')
        if (config.clearance > 0) {
          world[along] += config.tabWidth / 2 + config.clearance / 4
          assert.equal(occupies(wall, world), false)
          assert.equal(occupies(base, world), false, 'half-clearance remains on each side')
        }
      }
    }
    near(boxes[1].min.x - boxes[2].max.x, config.clearance / 2)
    for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
      const intersection = boxes[i].clone().intersect(boxes[j]), span = intersection.getSize(new THREE.Vector3())
      if (intersection.isEmpty() || Math.min(span.x, span.y, span.z) < 1e-6) continue
      for (let x = intersection.min.x + 0.37; x < intersection.max.x; x += 1.7)
        for (let y = intersection.min.y + 0.37; y < intersection.max.y; y += 1.7)
          for (let z = intersection.min.z + 0.37; z < intersection.max.z; z += 1.7) {
            const p = new THREE.Vector3(x, y, z)
            assert.ok(!(occupies(placements[i], p) && occupies(placements[j], p)), `stock clash at ${p.toArray()}`)
          }
    }
  }
})

test('shared Three extrusion has actual through holes, open capsule and open top/diagonal', () => {
  const parts = bracket.cornerBracketParts(), config = bracket.cornerBracketDefaults
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const group = viewer.toolGroup(projects.defaultCornerBracketProject, material)
  group.updateMatrixWorld(true)
  assert.equal(group.toolMeshes.length, 3)
  const hits = (name, origin, direction) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(group.getObjectByName(`${name}:0`), false).length
  for (const h of parts[0].holes) assert.equal(hits('cornerBase', [h.x, h.y, 20], [0, 0, -1]), 0)
  for (const h of parts[1].holes) assert.equal(hits('cornerHoleWall', [h.x, -10, h.y], [0, 1, 0]), 0)
  const { wallHoleHeight } = bracket.cornerBracketDimensions(config)
  for (const y of [32, 105, 178]) assert.equal(hits('cornerSlotWall', [-10, y, wallHoleHeight], [1, 0, 0]), 0)
  assert.ok(hits('cornerBase', [105, 105, 80], [0, 0, -1]) > 0)
  assert.equal(hits('cornerBase', [180, 180, 80], [0, 0, -1]), 0)
  assert.ok(hits('cornerSlotWall', [-10, 105, 57], [1, 0, 0]) > 0)
  const box = new THREE.Box3().setFromObject(group)
  box.min.toArray().forEach(value => near(value, 0))
  box.max.toArray().forEach((value, i) => near(value, [210, 210, 60][i]))
  group.toolMeshes.forEach(mesh => mesh.geometry.dispose())
  material.dispose()
})

test('all three product schemas round-trip exactly and reject mismatched or unknown corner dimensions', () => {
  for (const input of Object.values(projects.toolDefaults)) {
    const restored = projects.parseToolProject(projects.projectJson(input))
    assert.deepEqual(restored, input)
    assert.equal(projects.projectKey(restored), projects.projectKey(input))
    for (const tool of projects.toolIds.filter(tool => tool !== input.tool)) assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, tool })))
  }
  const input = projects.defaultCornerBracketProject
  assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, size: { ...input.size, surprise: 1 } })))
  assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, size: { ...input.size, holePitch: '50' } })))
  assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, version: 1 })))
})

test('corner native DXFs, real batch ZIP and assembly manifest agree and stale/tampered cuts are refused', async () => {
  const project = { ...projects.defaultCornerBracketProject, copies: 2, sheet: { length: 600, width: 600, edgeGap: 10, partGap: 5 } }
  const parser = new DxfParser(), key = projects.projectKey(project)
  for (const part of projects.projectModelParts(project)) {
    const parsed = parser.parseSync(dxf.nativeDxfForPart(part))
    assert.equal(parsed.header.$INSUNITS, 4)
    for (const [type, count] of [['LINE', part.contours.flat().filter(s => s.type === 'line').length], ['ARC', part.contours.flat().filter(s => s.type === 'arc').length], ['CIRCLE', part.holes.length]]) assert.equal(parsed.entities.filter(e => e.type === type).length, count)
    assert.ok(parsed.entities.every(e => ['LINE', 'ARC', 'CIRCLE'].includes(e.type)))
    for (const hole of part.holes) assert.ok(parsed.entities.some(e => e.type === 'CIRCLE' && Math.hypot(e.center.x - hole.x, e.center.y - hole.y) < 0.001 && e.radius === hole.d / 2))
  }
  const result = nesting.nestParts(projects.projectParts(project), { ...projects.projectNestingOptions(project), attempts: 12 })
  assert.equal(result.placements.length, 6)
  assert.equal(result.unplaced.length, 0)
  assert.equal(projects.validProjectLayout(project, result, key), true)
  const archive = await JSZip.loadAsync(await toolExport.toolArchive(project, result, key).generateAsync({ type: 'nodebuffer' }))
  for (const name of ['cornerBase', 'cornerHoleWall', 'cornerSlotWall']) assert.ok(archive.file(`parts/${name}_2pcs.dxf`))
  const manifest = JSON.parse(await archive.file('assembly.json').async('string'))
  assert.deepEqual(manifest.placements, projects.projectAssembly(project))
  assert.equal(manifest.placements.length, 3)
  assert.equal(manifest.joinery.clearance, 0.2)
  assert.match(manifest.axes, /Z up/)
  assert.deepEqual(JSON.parse(await archive.file('project.json').async('string')), project)
  let circles = 0, arcs = 0
  for (const sheet of result.sheets) {
    const text = await archive.file(`sheets/Sheet_${sheet.index + 1}.dxf`).async('string')
    assert.equal(text, dxf.nativeDxfForNestedSheet(sheet.placements))
    const parsed = parser.parseSync(text)
    circles += parsed.entities.filter(e => e.type === 'CIRCLE').length
    arcs += parsed.entities.filter(e => e.type === 'ARC').length
  }
  assert.equal(circles, 24)
  assert.equal(arcs, 4)
  assert.equal(projects.validProjectLayout({ ...project, size: { ...project.size, slotLength: 140 } }, result, key), false)
  const tampered = structuredClone(result)
  const changed = tampered.placements.find(placement => placement.part.holes.length > 0)
  assert.ok(changed)
  changed.part.holes.pop()
  assert.throws(() => toolExport.toolArchive(project, tampered, key), /stale or invalid/)
  assert.throws(() => toolExport.toolArchive(project, { ...result, placements: result.placements.slice(1) }, key), /stale or invalid/)
  assert.match(await archive.file('README.txt').async('string'), /design assumptions/)
})
