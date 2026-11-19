import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import * as THREE from 'three'
import DxfParser from 'dxf-parser'
import JSZip from 'jszip'

let server, vise, tools, geometry, contours, viewer, nesting, exporter, model
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[vise, tools, geometry, contours, viewer, nesting, exporter, model] = await Promise.all([
    '/src/tools/viseModule.ts', '/src/tools/project.ts', '/src/geometry.ts', '/src/contourGeometry.ts',
    '/src/tools/ToolAssembly3d.tsx', '/src/nesting.ts', '/src/tools/export.ts', '/src/model.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const stockOf = c => c?.thickness ?? 6
const viseParts = c => vise.viseModuleParts(c, stockOf(c))
const viseDimensions = c => vise.viseModuleDimensions(c, stockOf(c))
const viseAssembly = c => vise.viseModuleAssembly(c, stockOf(c))
const projectParts = p => tools.projectParts(p, { thickness: stockOf(p.size) })
const projectAssembly = p => tools.projectAssembly(p, { thickness: stockOf(p.size) })
const projectModelParts = p => tools.projectModelParts(p, { thickness: stockOf(p.size) })

const projectKey = p => tools.projectKey(p, { thickness: stockOf(p.size) })
const validProjectLayout = (p, result, key) => tools.validProjectLayout(p, { thickness: stockOf(p.size) }, result, key)

const near = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const checkSlotSetbacks = (c, slots, tolerance = 1e-4) => {
  assert.equal(slots.length, 8)
  for (const [index, arcs] of slots.entries()) {
    assert.equal(arcs.length, 2)
    const distance = arc => Math.hypot(arc.center.x - c.length / 2, arc.center.y - c.width / 2)
    const [inner, outer] = [...arcs].sort((a, b) => distance(a) - distance(b))
    const span = Math.hypot(outer.center.x - inner.center.x, outer.center.y - inner.center.y)
    const ux = (outer.center.x - inner.center.x) / span, uy = (outer.center.y - inner.center.y) / span
    near(inner.radius, c.slotWidth / 2, tolerance); near(outer.radius, c.slotWidth / 2, tolerance)
    near(distance(inner) - inner.radius, c.slotInnerRadius, tolerance)
    near(ux, Math.cos(index * Math.PI / 4), tolerance); near(uy, Math.sin(index * Math.PI / 4), tolerance)
    const boundary = { x: outer.center.x + (outer.radius + 15) * ux, y: outer.center.y + (outer.radius + 15) * uy }
    assert.ok(boundary.x >= -tolerance && boundary.x <= c.length + tolerance && boundary.y >= -tolerance && boundary.y <= c.width + tolerance)
    near(Math.min(Math.abs(boundary.x), Math.abs(boundary.y), Math.abs(c.length - boundary.x), Math.abs(c.width - boundary.y)), 0, tolerance)
    if (c.length === c.width && index % 2) {
      near(boundary.x, ux > 0 ? c.length : 0, tolerance)
      near(boundary.y, uy > 0 ? c.width : 0, tolerance)
    }
  }
}
const materialAt = (part, point) => geometry.pointInContour(point, part.contours[0])
  && !part.contours.slice(1).some(cut => geometry.pointInContour(point, cut))
  && !part.holes.some(h => Math.hypot(point.x - h.x, point.y - h.y) < h.d / 2)
const worldParts = config => {
  const parts = new Map(viseParts(config).map(part => [part.name, part]))
  return viseAssembly(config).map(placement => {
    const part = parts.get(placement.part)
    const world = (point, z) => new THREE.Vector3(...placement.origin)
      .addScaledVector(new THREE.Vector3(...placement.axes[0]), point.x)
      .addScaledVector(new THREE.Vector3(...placement.axes[1]), point.y)
      .addScaledVector(new THREE.Vector3(...placement.axes[2]), z)
    const box = new THREE.Box3().setFromPoints(geometry.contourPoints(part.contours[0], 32)
      .flatMap(point => [-part.thickness / 2, part.thickness / 2].map(z => world(point, z))))
    return { ...placement, part, box, solidAt: point => {
      const relative = new THREE.Vector3(...point).sub(new THREE.Vector3(...placement.origin))
      const local = placement.axes.map(axis => relative.dot(new THREE.Vector3(...axis)))
      return Math.abs(local[2]) < part.thickness / 2 - 1e-6 && materialAt(part, { x: local[0], y: local[1] })
    } }
  })
}

test('vise has five cut plates, eight independent native radial slots and an open underside', () => {
  const c = vise.viseModuleDefaults, parts = viseParts(c), [top, mount, front, side] = parts
  assert.deepEqual([c.length, c.width, c.height], [250, 250, 100])
  assert.deepEqual(parts.map(p => [p.name, p.count]), [['viseTop', 1], ['viseMount', 1], ['viseFront', 1], ['viseSide', 2]])
  assert.equal(top.contours.length, 9)
  assert.equal(top.holes.length, 9)
  assert.equal(mount.holes.length, 10)
  assert.equal(front.holes.length, 5)
  assert.equal(front.height, 50, 'the front blank excludes the empty region below it')
  assert.equal(side.contours[0][0].type, 'arc', 'curved free-end profile, not a rectangular box')
  checkSlotSetbacks(c, top.contours.slice(1).map(slot => slot.filter(s => s.type === 'arc')))
  near(contours.nativeContourDistance(top.contours[2], top.contours[0]), (15 + c.slotWidth / 2) / Math.SQRT2 - c.slotWidth / 2)
  assert.equal(materialAt(top, { x: 140, y: 140 }), true, 'central web remains solid between centre hole and radial slots')
})

test('vise size/stock/grid matrix preserves native contours and complete fixed-datum mounting rows', () => {
  let checked = 0
  for (const [length, width] of [[250, 250], [350, 350], [450, 250], [250, 450]]) for (const height of [100, 150])
    for (const thickness of [4, 6, 8]) for (const grid of ['square', 'staggered']) for (const clearance of [0, .2, 1]) {
      const c = { ...vise.viseModuleDefaults, length, width, height, thickness, grid, clearance }
      const parts = viseParts(c), mount = parts.find(p => p.name === 'viseMount')
      checkSlotSetbacks(c, parts[0].contours.slice(1).map(slot => slot.filter(s => s.type === 'arc')))
      const expected = geometry.fixtureGridPoints(width, height, { pitch: c.holePitch, margin: c.holeInset, grid })
      assert.deepEqual(mount.holes.map(h => [h.x, height - h.y, h.d]), expected.map(p => [p.x, p.y, c.holeDiameter]))
      for (const part of parts) for (const contour of part.contours) {
        const b = contours.nativeContourBounds(contour)
        assert.ok(b.minX >= -1e-6 && b.minY >= -1e-6 && b.maxX <= part.width + 1e-6 && b.maxY <= part.height + 1e-6)
        for (let i = 0; i < contour.length; i++) for (let j = i + 2; j < contour.length; j++) {
          if (i === 0 && j === contour.length - 1) continue
          assert.ok(contours.nativeContourDistance([contour[i]], [contour[j]]) > 1e-6, `${part.name}: crossing profile`)
        }
      }
      for (const part of parts) for (const h of part.holes) for (const contour of part.contours)
        assert.ok(contours.nativePointContourDistance(h, contour) >= h.d / 2 + 8 - 1e-6)
      checked++
    }
  assert.equal(checked, 144)
})

test('vise mounting coordinates match actual table skirt holes, including square and staggered phase', () => {
  for (const thickness of [4, 6, 8]) for (const grid of ['square', 'staggered']) {
    const table = { ...model.defaults, length: 800, width: 500, height: 100, thickness, grid, ribs: false, dogBones: false, tabWidth: 25 }
    const p = tools.projectAtTable(tools.defaultViseModuleProject, table)
    const mount = projectModelParts(p).find(part => part.name === 'viseMount')
    const skirt = geometry.makeParts(table).find(part => part.name === 'longSkirt')
    for (const h of mount.holes) {
      const depth = p.size.height - h.y
      assert.ok(skirt.holes.some(s => s.kind === 'grid' && s.d === h.d
        && Math.abs(s.x + table.length / 2 - h.x) < 1e-6
        && Math.abs(geometry.skirtAssemblyY(table) + s.y + depth) < 1e-6), `No host mating hole for ${h.x}/${depth}`)
    }
  }
})

test('vise world joints are flush, centred and clear without intersections at every mating plane', () => {
  for (const changes of [{}, { thickness: 4, clearance: 0 }, { thickness: 6, clearance: 1 }, { length: 350, width: 350, height: 150 }]) {
    const c = { ...vise.viseModuleDefaults, ...changes }, dims = viseDimensions(c)
    const placements = worldParts(c), [top, mount, front, left, right] = placements
    const box = new THREE.Box3(); placements.forEach(p => box.union(p.box))
    for (const axis of ['x', 'y', 'z']) near(box.min[axis], 0)
    near(box.max.x, c.length); near(box.max.y, c.width); near(box.max.z, c.height)
    near(front.box.min.z, c.height - c.tipHeight)
    for (const wall of [mount, front]) for (const y of dims.yJoints) {
      const point = [wall.origin[0], y, c.height - stockOf(c) / 2]
      assert.ok(wall.solidAt(point) && !top.solidAt(point))
    }
    for (const side of [left, right]) {
      for (const x of dims.xJoints) {
        const point = [x, side.origin[1], c.height - stockOf(c) / 2]
        assert.ok(side.solidAt(point) && !top.solidAt(point))
      }
      for (const [end, z] of [[mount, dims.mountJoint], [front, dims.frontJoint]]) {
        const point = [end.origin[0], side.origin[1], z]
        assert.ok(side.solidAt(point) && !end.solidAt(point))
      }
    }
    for (const y of [stockOf(c) / 2, c.width - stockOf(c) / 2]) for (let x = .31; x < c.length; x += 1.3)
      assert.ok(placements.filter(p => p.solidAt([x, y, c.height - stockOf(c) / 2])).length <= 1)
    for (const x of [stockOf(c) / 2, c.length - stockOf(c) / 2]) {
      for (let y = .31; y < c.width; y += 1.3)
        assert.ok(placements.filter(p => p.solidAt([x, y, c.height - stockOf(c) / 2])).length <= 1)
      for (const y of [stockOf(c) / 2, c.width - stockOf(c) / 2]) for (let z = .31; z < c.height; z += 1.3)
        assert.ok(placements.filter(p => p.solidAt([x, y, z])).length <= 1)
    }
  }
})

test('vise shared Three meshes contain actual through slots, round holes and the open underside', () => {
  const p = tools.defaultViseModuleProject, material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const group = viewer.toolGroup(projectParts(p), projectAssembly(p), material); group.updateMatrixWorld(true)
  assert.equal(group.toolMeshes.length, 5)
  const hit = (name, origin, direction) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(group.getObjectByName(`${name}:0`), false).length
  const [top, mount, front, side] = projectModelParts(p)
  for (const h of top.holes) assert.equal(hit(top.name, [h.x, h.y, 200], [0, 0, -1]), 0)
  for (const cut of top.contours.slice(1)) {
    const arcs = cut.filter(s => s.type === 'arc')
    const x = (arcs[0].center.x + arcs[1].center.x) / 2, y = (arcs[0].center.y + arcs[1].center.y) / 2
    assert.equal(hit(top.name, [x, y, 200], [0, 0, -1]), 0)
  }
  for (const h of mount.holes) assert.equal(hit(mount.name, [-50, h.x, h.y], [1, 0, 0]), 0)
  for (const h of front.holes) assert.equal(hit(front.name, [300, h.x, h.y + 50], [-1, 0, 0]), 0)
  for (const h of side.holes) assert.equal(hit(side.name, [h.x, -50, h.y], [0, 1, 0]), 0)
  assert.ok(hit(top.name, [140, 140, 200], [0, 0, -1]) > 0)
  assert.equal(hit(top.name, [220, 220, 200], [0, 0, -1]), 0, 'extended diagonal is an actual through-cut')
  assert.ok(hit(top.name, [240, 240, 200], [0, 0, -1]) > 0, 'corner setback retains material')
  assert.equal(new THREE.Raycaster(new THREE.Vector3(125, 125, 40), new THREE.Vector3(0, 0, -1)).intersectObjects(group.toolMeshes, false).length, 0)
  group.traverse(item => { if (item.isMesh) item.geometry.dispose() }); material.dispose()
})

test('vise JSON, links, real ZIP and native DXF preserve every instance and arc; stale layouts are rejected', async () => {
  const p = { ...tools.defaultViseModuleProject, copies: 2, sheet: { length: 1200, width: 600, edgeGap: 10, partGap: 5 } }
  assert.deepEqual(tools.parseToolProject(tools.projectJson(p)), p)
  assert.deepEqual(tools.parseToolProject(new URLSearchParams({ toolProject: tools.projectJson(p) }).get('toolProject')), p)
  const result = nesting.nestParts(projectParts(p), { ...tools.projectNestingOptions(p), attempts: 12 })
  assert.equal(result.placements.length, 10); assert.equal(result.unplaced.length, 0)
  assert.equal(validProjectLayout(p, result, projectKey(p)), true)
  const zip = await JSZip.loadAsync(await exporter.toolArchive(p, result, projectKey(p), { thickness: stockOf(p.size) }).generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(Object.keys(zip.files).filter(name => !name.endsWith('/')), result.sheets.map(sheet => `Лист_${sheet.index + 1}.dxf`))
  for (const sheet of result.sheets) {
    const parsed = new DxfParser().parseSync(await zip.file(`Лист_${sheet.index + 1}.dxf`).async('string'))
    assert.equal(parsed.entities.filter(e => e.type === 'ARC').length, sheet.placements.reduce((n, p) => n + p.part.contours.flat().filter(s => s.type === 'arc').length, 0))
  }
  assert.equal(validProjectLayout(p, { ...result, placements: result.placements.slice(1) }, projectKey(p)), false)
  assert.throws(() => exporter.toolArchive({ ...p, size: { ...p.size, slotInnerRadius: 31 } }, result, projectKey(p), { thickness: stockOf(p.size) }), error => error.code === 'invalid-layout')
})

test('vise rejects unsafe grid, slots, stock and overlapping cuts instead of losing mandatory holes', () => {
  for (const changes of [{ thickness: 20 }, { height: NaN }, { tipHeight: 100 }, { length: 200, slotInnerRadius: 80 }, { slotInnerRadius: 5 }, { slotWidth: 60 }, { slotWidth: 28 }, { grid: 'bad' }, { holeInset: 20, thickness: 8 }, { holeDiameter: 28 }, { width: 350 }, { length: 350 }])
    assert.throws(() => viseParts({ ...vise.viseModuleDefaults, ...changes }), error => error instanceof geometry.FabricationError)
  for (const changes of [{ version: 2 }, { size: { ...vise.viseModuleDefaults, slotLength: 80 } }, { size: { ...vise.viseModuleDefaults, unknown: 1 } }, { size: { ...vise.viseModuleDefaults, grid: undefined } }])
    assert.throws(() => tools.parseToolProject(tools.projectJson({ ...tools.defaultViseModuleProject, ...changes })))
})

test('retired equal-length vise projects are rejected without a migration path', () => {
  const old = { ...tools.defaultViseModuleProject, version: 1, copies: 2, size: { ...vise.viseModuleDefaults, slotLength: 75 } }
  const original = tools.projectJson(old)
  assert.throws(() => tools.parseToolProject(original), error => error.code === 'unsupported-version')
  assert.throws(() => exporter.toolPartsArchive(old, { thickness: stockOf(old.size) }), error => error.code === 'unsupported-version')
  assert.throws(() => exporter.toolStripDxf(old, { thickness: stockOf(old.size) }), error => error.code === 'unsupported-version')
  assert.equal(tools.projectJson(old), original)
  for (const changes of [{ slotLength: '80' }, { slotLength: 201 }, { slotLength: undefined }, { unexpected: 1 }, { grid: 'bad' }, { slotWidth: 28 }, { width: 350 }])
    assert.throws(() => tools.parseToolProject(tools.projectJson({ ...old, size: { ...old.size, ...changes } })))
})
