import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import DxfParser from 'dxf-parser'
import * as THREE from 'three'
import JSZip from 'jszip'

let server, square, projects, geometry, native, nesting, dxf, viewer
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[square, projects, geometry, native, nesting, dxf, viewer] = await Promise.all([
    '/src/tools/square.ts', '/src/tools/project.ts', '/src/geometry.ts', '/src/contourGeometry.ts',
    '/src/nesting.ts', '/src/dxf.ts', '/src/tools/ToolAssembly3d.tsx',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

test('square reference is one flat L plate with three holes, not a bent angle or dense perforated box', () => {
  const [part] = square.squareParts(square.squareDefaults)
  assert.equal(part.count, 1)
  assert.equal(part.contours.length, 1)
  assert.equal(part.contours[0].length, 6)
  assert.equal(part.slots.length, 0)
  assert.deepEqual(part.holes.map(({ x, y, d }) => ({ x, y, d })), [{ x: 25, y: 25, d: 16 }, { x: 225, y: 25, d: 16 }, { x: 25, y: 225, d: 16 }])
  assert.deepEqual(native.nativeContourBounds(part.contours[0]), { minX: 0, minY: 0, maxX: 250, maxY: 250 })
  near(geometry.signedContourArea(part.contours[0]), 250 * 50 * 2 - 50 ** 2)
  const parsed = new DxfParser().parseSync(dxf.nativeDxfForPart(part))
  assert.equal(parsed.header.$INSUNITS, 4)
  assert.equal(parsed.entities.filter(entity => entity.type === 'LINE').length, 6)
  assert.deepEqual(parsed.entities.filter(entity => entity.type === 'CIRCLE').map(entity => [entity.center.x, entity.center.y, entity.radius]), part.holes.map(hole => [hole.x, hole.y, hole.d / 2]))
})

test('square dimension matrix keeps the material corner, hole webs and exact native profiles', () => {
  let checked = 0
  for (const length of [150, 250, 600]) for (const width of [150, 250, 600]) for (const armWidth of [30, 50, 100]) for (const thickness of [4, 6, 12]) {
    const config = { ...square.squareDefaults, length, width, armWidth, thickness }
    const [part] = square.squareParts(config)
    near(geometry.signedContourArea(part.contours[0]), (length + width) * armWidth - armWidth ** 2)
    near(geometry.partWeight(part), ((length + width) * armWidth - armWidth ** 2 - 3 * Math.PI * 8 ** 2) * thickness * 7.85e-6)
    for (const [index, segment] of part.contours[0].entries()) assert.deepEqual(segment.to, part.contours[0][(index + 1) % 6].from)
    for (const hole of part.holes) assert.ok(native.nativePointContourDistance(hole, part.contours[0]) >= hole.d / 2 + 5 - 1e-6)
    assert.equal(new DxfParser().parseSync(dxf.nativeDxfForPart(part)).entities.length, 9)
    checked += 1
  }
  assert.equal(checked, 81)
})

test('square rejects nonfinite, out-of-range and colliding mounting holes rather than silently omitting them', () => {
  for (const changes of [{ length: 0 }, { armWidth: 120 }, { thickness: Infinity }, { holeDiameter: NaN }, { armWidth: 30, holeDiameter: 28 }, { holeDiameter: 28, endOffset: 15 }, { length: 150, armWidth: 100, endOffset: 80 }]) {
    assert.throws(() => square.squareParts({ ...square.squareDefaults, ...changes }))
  }
})

test('actual shared Three extrusion keeps all three square holes and the open inside corner empty', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  const group = viewer.toolGroup(projects.defaultSquareProject, material)
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  assert.deepEqual(box.min.toArray(), [0, 0, 0])
  assert.deepEqual(box.max.toArray(), [250, 250, 6])
  assert.equal(group.toolMeshes.length, 1)
  const occupies = (x, y) => new THREE.Raycaster(new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1)).intersectObject(group, true).some(hit => hit.object instanceof THREE.Mesh)
  for (const hole of square.squareParts(square.squareDefaults)[0].holes) assert.equal(occupies(hole.x, hole.y), false)
  assert.equal(occupies(125, 125), false)
  assert.equal(occupies(125, 25), true)
  assert.equal(occupies(25, 125), true)
  group.toolMeshes.forEach(mesh => mesh.geometry.dispose())
  material.dispose()
})

test('both tool project types round-trip without changing keys or accepting the other size schema', () => {
  for (const input of [projects.defaultToolProject, projects.defaultSquareProject]) {
    const restored = projects.parseToolProject(projects.projectJson(input))
    assert.deepEqual(restored, input)
    assert.equal(projects.projectKey(restored), projects.projectKey(input))
    assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, size: { ...input.size, unknown: 1 } })))
    assert.throws(() => projects.parseToolProject(JSON.stringify({ ...input, tool: input.tool === 'square' ? 'extension' : 'square' })))
  }
  assert.throws(() => projects.parseToolProject(JSON.stringify({ ...projects.defaultToolProject, version: 1 })), /retired box design/)
})

test('square batch nesting, sheet DXF, part DXF, JSON and actual ZIP agree and reject stale exports', async () => {
  const project = { ...projects.defaultSquareProject, copies: 3, sheet: { length: 600, width: 600, edgeGap: 10, partGap: 5 } }
  const parts = projects.projectParts(project), key = projects.projectKey(project)
  const result = nesting.nestParts(parts, { ...projects.projectNestingOptions(project), attempts: 12 })
  assert.equal(result.placements.length, 3)
  assert.equal(result.unplaced.length, 0)
  assert.equal(projects.validProjectLayout(project, result, key), true)
  const archive = await JSZip.loadAsync(await projects.toolArchive(project, result, key).generateAsync({ type: 'nodebuffer' }))
  assert.ok(archive.file('parts/square_3pcs.dxf'))
  assert.deepEqual(JSON.parse(await archive.file('project.json').async('string')), project)
  const assembly = JSON.parse(await archive.file('assembly.json').async('string'))
  assert.equal(assembly.tool, 'square')
  assert.equal(assembly.placements.length, 1)
  assert.equal(assembly.joinery, undefined)
  const layout = JSON.parse(await archive.file('layout.json').async('string'))
  assert.equal(layout.placements.length, 3)
  let circleCount = 0, lineCount = 0
  for (const sheet of result.sheets) {
    const text = await archive.file(`sheets/Sheet_${sheet.index + 1}.dxf`).async('string')
    assert.equal(text, dxf.nativeDxfForNestedSheet(sheet.placements))
    const parsed = new DxfParser().parseSync(text)
    circleCount += parsed.entities.filter(entity => entity.type === 'CIRCLE').length
    lineCount += parsed.entities.filter(entity => entity.type === 'LINE').length
  }
  assert.equal(circleCount, 9)
  assert.equal(lineCount, 18)
  assert.equal(projects.validProjectLayout({ ...project, size: { ...project.size, length: 300 } }, result, key), false)
  assert.equal(projects.validProjectLayout(projects.defaultToolProject, result, key), false)
  const tampered = structuredClone(result)
  tampered.placements[0].part.holes.pop()
  assert.throws(() => projects.toolArchive(project, tampered, key), /stale or invalid/)
  const strip = new DxfParser().parseSync(projects.toolStripDxf(project))
  assert.equal(strip.entities.filter(entity => entity.type === 'CIRCLE').length, 3)
})
