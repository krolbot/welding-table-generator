import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import * as THREE from 'three'
import DxfParser from 'dxf-parser'
import JSZip from 'jszip'

let server, compact, project, geometry, contours, dxf, exporter, nesting, viewer
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[compact, project, geometry, contours, dxf, exporter, nesting, viewer] = await Promise.all([
    '/src/tools/compactExtension.ts', '/src/tools/project.ts', '/src/geometry.ts', '/src/contourGeometry.ts',
    '/src/dxf.ts', '/src/tools/export.ts', '/src/nesting.ts', '/src/tools/ToolAssembly3d.tsx',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-4, `${a} != ${b}`)
const materialAt = (part, point) => geometry.pointInContour(point, part.contours[0])
  && !part.contours.slice(1).some(cut => geometry.pointInContour(point, cut))
  && !part.holes.some(hole => Math.hypot(point.x - hole.x, point.y - hole.y) < hole.d / 2)

const worldParts = config => {
  const parts = new Map(compact.compactExtensionParts(config).map(part => [part.name, part]))
  return compact.compactExtensionAssembly(config).map(placement => {
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

test('compact reference has exactly three plates, one central spine, five windows, twenty top and four end holes', () => {
  const c = compact.compactExtensionDefaults, parts = compact.compactExtensionParts(c)
  assert.deepEqual([c.length, c.width, c.height, c.thickness], [500, 100, 100, 6])
  assert.deepEqual(parts.map(p => [p.name, p.count, p.holes.length]), [['compactTop', 1, 20], ['compactSpine', 1, 0], ['compactMount', 1, 4]])
  assert.equal(parts[1].contours.length, 6)
  assert.ok(parts[1].contours.slice(1).every(c => c.some(s => s.type === 'arc')))
  const bottom = parts[1].contours[0][0]
  assert.deepEqual(bottom.to, { x: 380, y: 0 }, 'constant-depth root, not a full-length wedge')
  assert.deepEqual(parts[1].contours[0][1].to, { x: 500, y: 50 }, 'deeper free end retains room for the wider webs')
  assert.deepEqual([...new Set(parts[0].holes.map(h => h.y))], [25, 75])
  assert.deepEqual(parts[2].holes.map(h => [h.x, h.y]), [[25, 75], [75, 75], [25, 25], [75, 25]])
  assert.equal(compact.compactExtensionAssembly(c)[1].origin[1], 50)
  assert.equal(project.projectAssembly(project.defaultToolProject).length, 7, 'existing wedge is a separate retained product')
})

test('16/32 mm compact webs fit the deeper end without changing assembly joints or saved dimensions', () => {
  assert.equal(compact.compactExtensionDefaults.windowInset, 16)
  assert.equal(compact.compactExtensionDefaults.tipHeight, 50)
  for (const thickness of [4, 6, 8]) {
    const size = { ...compact.compactExtensionDefaults, thickness }
    const previousSize = { ...size, windowInset: 8, tipHeight: 40 }
    const parts = compact.compactExtensionParts(size), previous = compact.compactExtensionParts(previousSize)
    assert.deepEqual([parts[0], parts[2]], [previous[0], previous[2]])
    assert.deepEqual(parts[1].contours[0][0], previous[1].contours[0][0])
    assert.deepEqual(parts[1].contours[0].slice(3), previous[1].contours[0].slice(3), 'top and mounting joints unchanged')
    assert.deepEqual(parts[1].contours[0][1].to, { x: 500, y: 50 })
    assert.deepEqual(parts[1].contours[0][2].from, { x: 500, y: 50 })
    assert.deepEqual(compact.compactExtensionAssembly(size), compact.compactExtensionAssembly(previousSize))
    const windows = parts[1].contours.slice(1)
    assert.equal(windows.length, 5)
    near(Math.min(...windows.map(cut => contours.nativeContourDistance(cut, parts[1].contours[0]))), 16)
    near(Math.min(...windows.flatMap((cut, i) => windows.slice(i + 1).map(other => contours.nativeContourDistance(cut, other)))), 32)
    windows.forEach((cut, i) => assert.ok(Math.abs(geometry.signedContourArea(cut)) < Math.abs(geometry.signedContourArea(previous[1].contours[i + 1]))))
    for (const savedSize of [size, previousSize, { ...previousSize, windowInset: 12 }]) {
      const saved = { ...project.defaultCompactExtensionProject, size: savedSize }
      assert.deepEqual(project.parseToolProject(project.projectJson(saved)), saved)
    }
  }
})

test('compact size matrix preserves saved profiles and rejects combinations where window fillets cannot fit', () => {
  let checked = 0, rejected = 0
  for (const profile of [{ windowInset: 8, tipHeight: 40 }, { windowInset: 12, tipHeight: 40 }, { windowInset: 16, tipHeight: 50 }]) for (const length of [350, 500, 800]) for (const width of [100, 200]) for (const height of [100, 150, 200]) for (const thickness of [4, 6, 8]) {
    const c = { ...compact.compactExtensionDefaults, ...profile, length, width, height, thickness }
    if (length === 350 && (profile.windowInset === 12 || profile.windowInset === 16 && height === 200)) {
      assert.throws(() => compact.compactExtensionParts(c), error => error?.code === 'cut-clearance')
      rejected++
      continue
    }
    const parts = compact.compactExtensionParts(c)
    for (const part of parts) {
      for (const contour of part.contours) {
        const b = contours.nativeContourBounds(contour)
        assert.ok(b.minX >= -1e-6 && b.minY >= -1e-6 && b.maxX <= part.width + 1e-6 && b.maxY <= part.height + 1e-6)
        for (let i = 0; i < contour.length; i++) for (let j = i + 2; j < contour.length; j++) {
          if (i === 0 && j === contour.length - 1) continue
          assert.ok(contours.nativeContourDistance([contour[i]], [contour[j]]) > 1e-6, `${part.name}: crossing profile`)
        }
      }
      for (const hole of part.holes) {
        assert.ok(geometry.pointInContour(hole, part.contours[0]))
        assert.ok(contours.nativePointContourDistance(hole, part.contours[0]) >= hole.d / 2 + 8 - 1e-6)
        for (const cut of part.contours.slice(1)) {
          assert.equal(geometry.pointInContour(hole, cut), false)
          assert.ok(contours.nativePointContourDistance(hole, cut) >= hole.d / 2 + 8 - 1e-6)
        }
      }
    }
    const windows = parts[1].contours.slice(1)
    for (const cut of windows) assert.ok(contours.nativeContourDistance(parts[1].contours[0], cut) >= c.windowInset - 1e-5)
    windows.forEach((cut, i) => windows.slice(i + 1).forEach(other => assert.ok(contours.nativeContourDistance(cut, other) >= c.windowInset * 2 - 1e-5)))
    assert.equal(Math.max(...parts[2].holes.map(h => h.y)), height - 25)
    checked++
  }
  assert.equal(checked, 54 + 36 + 48)
  assert.equal(rejected, 18 + 6)
})

test('compact joints share world-space centres, flush faces and actual clearance without plate clashes', () => {
  for (const changes of [{}, { thickness: 9, clearance: 0 }, { thickness: 4, clearance: 1 }, { length: 800, width: 200, height: 150, thickness: 8 }]) {
    const c = { ...compact.compactExtensionDefaults, ...changes }, dims = compact.compactExtensionDimensions(c)
    const placements = worldParts(c), [top, spine, mount] = placements
    const assembly = new THREE.Box3()
    placements.forEach(p => assembly.union(p.box))
    for (const axis of ['x', 'y', 'z']) near(assembly.min[axis], 0)
    near(assembly.max.x, c.length); near(assembly.max.y, c.width); near(assembly.max.z, c.height)
    for (const x of dims.topJoints) {
      const point = [x, c.width / 2, c.height - c.thickness / 2]
      assert.ok(spine.solidAt(point) && !top.solidAt(point))
    }
    for (const z of dims.endJoints) {
      const point = [c.thickness / 2, c.width / 2, z]
      assert.ok(spine.solidAt(point) && !mount.solidAt(point))
    }
    for (const y of dims.mountTopJoints) {
      const point = [c.thickness / 2, y, c.height - c.thickness / 2]
      assert.ok(mount.solidAt(point) && !top.solidAt(point))
    }
    const slot = contours.nativeContourBounds(top.part.contours[1])
    near(slot.maxX - slot.minX, c.tabWidth + c.clearance)
    near(slot.maxY - slot.minY, c.thickness + c.clearance)
    for (let x = .37; x < c.length; x += 1.7) {
      const point = [x, c.width / 2, c.height - c.thickness / 2]
      assert.equal(top.solidAt(point) && spine.solidAt(point), false, 'top/spine collision')
    }
    for (let z = .37; z < c.height; z += 1.7) {
      const point = [c.thickness / 2, c.width / 2, z]
      assert.equal(mount.solidAt(point) && spine.solidAt(point), false, 'mount/spine collision')
    }
    for (let y = .37; y < c.width; y += 1.7) {
      const point = [c.thickness / 2, y, c.height - c.thickness / 2]
      assert.equal(top.solidAt(point) && mount.solidAt(point), false, 'top/mount collision')
    }
  }
})

test('real compact 3D meshes cut every hole and window and occupy the canonical envelope', () => {
  const p = project.defaultCompactExtensionProject, material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const group = viewer.toolGroup(p, material); group.updateMatrixWorld(true)
  assert.equal(group.toolMeshes.length, 3)
  const box = new THREE.Box3().setFromObject(group)
  near(box.max.x, 500); near(box.max.y, 100); near(box.max.z, 100)
  const hit = (name, origin, direction) => new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(group.getObjectByName(`${name}:0`), false).length
  const [top, spine, mount] = project.projectModelParts(p)
  for (const h of top.holes) assert.equal(hit(top.name, [h.x, h.y, 200], [0, 0, -1]), 0)
  for (const h of mount.holes) assert.equal(hit(mount.name, [-50, h.x, h.y], [1, 0, 0]), 0)
  for (const cut of spine.contours.slice(1)) {
    const vertices = geometry.contourPoints(cut, 32)
    const center = vertices.reduce((s, v) => ({ x: s.x + v.x / vertices.length, y: s.y + v.y / vertices.length }), { x: 0, y: 0 })
    assert.equal(hit(spine.name, [center.x, -50, center.y], [0, 1, 0]), 0)
  }
  assert.ok(hit(spine.name, [250, -50, 90], [0, 1, 0]) > 0)
  group.traverse(item => { if (item.isMesh) item.geometry.dispose() }); material.dispose()
})

test('compact codec and native archives preserve exact settings, every instance, circle and arc', async () => {
  const p = { ...project.defaultCompactExtensionProject, copies: 2, sheet: { length: 1200, width: 600, edgeGap: 10, partGap: 5 } }
  assert.deepEqual(project.parseToolProject(project.projectJson(p)), p)
  assert.deepEqual(project.parseToolSelections([{ id: 'compact-pair', project: p }]), [{ id: 'compact-pair', project: p }])
  const result = nesting.nestParts(project.projectParts(p), { ...project.projectNestingOptions(p), attempts: 12 })
  assert.equal(result.placements.length, 6); assert.equal(result.unplaced.length, 0)
  assert.equal(project.validProjectLayout(p, result, project.projectKey(p)), true)
  const zip = await JSZip.loadAsync(await exporter.toolArchive(p, result, project.projectKey(p)).generateAsync({ type: 'nodebuffer' }))
  assert.deepEqual(JSON.parse(await zip.file('project.json').async('string')), p)
  assert.equal(JSON.parse(await zip.file('assembly.json').async('string')).placements.length, 3)
  const parser = new DxfParser()
  for (const part of project.projectParts(p)) {
    const parsed = parser.parseSync(await zip.file(`parts/${part.name}_${part.count}pcs.dxf`).async('string'))
    assert.equal(parsed.header.$INSUNITS, 4)
    assert.equal(parsed.entities.filter(e => e.type === 'ARC').length, part.contours.flat().filter(s => s.type === 'arc').length)
    assert.equal(parsed.entities.filter(e => e.type === 'LINE').length, part.contours.flat().filter(s => s.type === 'line').length)
    for (const h of part.holes) assert.ok(parsed.entities.some(e => e.type === 'CIRCLE' && Math.hypot(e.center.x - h.x, e.center.y - h.y) < .001 && e.radius === h.d / 2))
  }
  for (const sheet of result.sheets) {
    const parsed = parser.parseSync(await zip.file(`sheets/Sheet_${sheet.index + 1}.dxf`).async('string'))
    assert.equal(parsed.entities.filter(e => e.type === 'CIRCLE').length, sheet.placements.reduce((n, p) => n + p.part.holes.length, 0))
  }
  assert.equal(project.validProjectLayout(p, { ...result, placements: result.placements.slice(1) }, project.projectKey(p)), false)
  assert.throws(() => exporter.toolArchive({ ...p, size: { ...p.size, windowRadius: 2 } }, result, project.projectKey(p)), error => error.code === 'invalid-layout')
})

test('invalid compact dimensions and crossed hole corridors fail explicitly instead of omitting geometry', () => {
  for (const changes of [{ thickness: 10 }, { thickness: 9 }, { width: 150 }, { height: NaN }, { tipHeight: 100 }, { tipHeight: 40 }, { tipHeight: 45, thickness: 8 }, { windowInset: 17 }, { taperRun: 250 }, { holeDiameter: 28 }]) {
    assert.throws(() => compact.compactExtensionParts({ ...compact.compactExtensionDefaults, ...changes }), error => error instanceof geometry.FabricationError)
  }
  for (const changes of [{ version: 2 }, { size: { ...compact.compactExtensionDefaults, unknown: 1 } }]) {
    assert.throws(() => project.parseToolProject(project.projectJson({ ...project.defaultCompactExtensionProject, ...changes })))
  }
})
