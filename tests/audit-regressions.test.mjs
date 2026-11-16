import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import DxfParser from 'dxf-parser'
import * as THREE from 'three'

let server, geometry, model, dxf, nesting, layout, settings, projects, toolExport, assembly, assemblyGeometry
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[geometry, model, dxf, nesting, layout, settings, projects, toolExport, assembly, assemblyGeometry] = await Promise.all([
    '/src/geometry.ts', '/src/model.ts', '/src/dxf.ts', '/src/nesting.ts',
    '/src/fabricationLayout.ts', '/src/nestingSettings.ts', '/src/tools/project.ts', '/src/tools/export.ts',
    '/src/ThreeAssembly.tsx', '/src/assemblyGeometry.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })

test('snapped ribs occupy distinct grid gaps with unique mating cuts in fabrication DXF', () => {
  const config = { ...model.defaults, length: 889, width: 4312, height: 389, thickness: 24,
    tabWidth: 39, clearance: 1.002, holeDiameter: 8, pitch: 133, margin: 132,
    grid: 'square', ribs: true, ribSpacing: 247, dogBones: true, dogBoneDiameter: 3.2, skirtHoles: false }
  assert.deepEqual(geometry.framePositions(config).short, [-246, -113, 20, 153])
  assert.equal(geometry.fabricationError(config), undefined)
  const top = geometry.makeParts(config).find(part => part.name === 'top')
  assert.equal(new Set(top.contours.slice(1).map(contour => JSON.stringify(contour))).size, top.contours.length - 1)
  const parsed = new DxfParser().parseSync(dxf.dxfForPart(top, config))
  assert.equal(parsed.header.$INSUNITS, 4)
  assert.equal(parsed.entities.filter(entity => entity.layer === 'OUTLINE').length, top.contours.flat().length)
  assert.equal(parsed.entities.filter(entity => entity.layer === 'HOLES').length, top.holes.length)
})

test('rib tabs fit the actual top outline and never make crossing DXF cuts', () => {
  const config = { ...model.defaults, length: 1709, width: 3107, height: 315, thickness: 38,
    tabWidth: 129, clearance: 1.419, holeDiameter: 28, pitch: 224, margin: 55,
    grid: 'staggered', ribs: true, ribSpacing: 289, dogBones: true, dogBoneDiameter: 2.7, legMounts: false }
  const top = geometry.makeParts(config).find(part => part.name === 'top')
  assert.ok(top)
  assert.equal(geometry.fabricationError(config), undefined)
  assert.equal(geometry.internalCutsInsideOuter(top, 3), true)
  assert.equal(top.slots.some(slot => Math.abs(slot.x + 752) < 1 && Math.abs(slot.y - 629.5) < 1), false)
  assert.equal(top.slots.some(slot => Math.abs(slot.x + 575.5) < 1 && Math.abs(slot.y - 629.5) < 1), true)
  assert.equal(new Set(top.contours.slice(1).map(contour => JSON.stringify(contour))).size, top.contours.length - 1)
  const parsed = new DxfParser().parseSync(dxf.dxfForPart(top, config))
  assert.equal(parsed.header.$INSUNITS, 4)
  assert.equal(parsed.entities.filter(entity => entity.layer === 'OUTLINE').length, top.contours.flat().length)
  assert.equal(parsed.entities.filter(entity => entity.layer === 'HOLES').length, top.holes.length)

  const runtime = { assembly: new THREE.Group(), dimensions: new THREE.Group(), meshes: [],
    metal: new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), colors: assemblyGeometry.assemblyColors(false),
    factor: 0, targetFactor: 0, renderHoles: true }
  assembly.rebuildAssembly(runtime, { ...config, showDimensions: false })
  runtime.assembly.updateMatrixWorld(true)
  const topMesh = runtime.meshes.find(item => item.userData.part === 'top')
  const surface = new THREE.Box3().setFromObject(topMesh).max.y
  const hits = (x, y) => {
    const world = topMesh.localToWorld(new THREE.Vector3(x, y, 0))
    return new THREE.Raycaster(new THREE.Vector3(world.x, surface + 20, world.z), new THREE.Vector3(0, -1, 0)).intersectObject(topMesh, false).length
  }
  assert.equal(hits(-575.5, 629.5), 0, 'the valid slot must be open in the assembled 3D plate')
  assert.ok(hits(-752, 629.5) > 0, 'the former crossing slot is absent from 2D and solid in 3D')
  assemblyGeometry.disposeObject3D(runtime.assembly)
  assemblyGeometry.disposeObject3D(runtime.dimensions)
})

test('nesting refuses a second exterior island represented as an internal cut', () => {
  const square = (x, y, size) => [
    [{ x, y }, { x: x + size, y }], [{ x: x + size, y }, { x: x + size, y: y + size }],
    [{ x: x + size, y: y + size }, { x, y: y + size }], [{ x, y: y + size }, { x, y }],
  ].map(([from, to]) => ({ type: 'line', from, to }))
  const part = { name: 'islands', label: 'islands', width: 100, height: 100, thickness: 6,
    count: 1, holes: [], slots: [], contours: [square(0, 0, 100), square(150, 0, 20)] }
  const options = { sheet: { width: 400, height: 200 }, edgeClearance: 0, partClearance: 0, rotations: [0], maxSheets: 1 }
  assert.equal(geometry.internalCutsInsideOuter(part), false)
  assert.equal(nesting.validateNesting([{ part, instance: 0, sheet: 0, rotation: 0, translation: { x: 0, y: 0 } }], options).valid, false)
})

test('table-only batch estimate uses exactly the same instances as its nesting inventory', () => {
  const config = { ...model.defaults, nestingCopies: 3 }
  const single = layout.fabricationEstimate(settings.nestingParts({ ...config, nestingCopies: 1 }), { length: config.sheetLength, width: config.sheetWidth })
  const batch = layout.fabricationEstimate(settings.nestingParts(config), { length: config.sheetLength, width: config.sheetWidth })
  assert.ok(single.kg > 0 && single.cut > 0 && single.holes > 0)
  assert.ok(Math.abs(batch.kg - single.kg * 3) < 1e-7)
  assert.ok(Math.abs(batch.cut - single.cut * 3) < 1e-7)
  assert.equal(batch.holes, single.holes * 3)
})

test('standalone strip DXF and estimate inventory agree for two copies of every Tool family', () => {
  for (const [name, original] of Object.entries(projects.toolDefaults)) {
    const project = { ...original, copies: 2 }
    const parts = projects.projectParts(project)
    const estimated = layout.fabricationEstimate(parts, project.sheet)
    const parsed = new DxfParser().parseSync(toolExport.toolStripDxf(project, { thickness: project.size.thickness }))
    assert.equal(parsed.entities.filter(entity => entity.type === 'CIRCLE').length, estimated.holes, name)
    assert.equal(parts.reduce((sum, part) => sum + part.count, 0),
      projects.projectModelParts(original).reduce((sum, part) => sum + part.count, 0) * 2, name)
  }
})
