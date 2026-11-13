import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import * as THREE from 'three'
import DxfParser from 'dxf-parser'

let server, geometry, model, assembly, mesh, dxf, nesting, extension
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[geometry, model, assembly, mesh, dxf, nesting, extension] = await Promise.all([
    '/src/geometry.ts', '/src/model.ts', '/src/ThreeAssembly.tsx', '/src/assemblyGeometry.ts',
    '/src/dxf.ts', '/src/nestingSettings.ts', '/src/tools/extension.ts',
  ].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const near = (actual, expected, label = '') => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`)
const onLattice = (x, depth, config) => {
  const rowPitch = config.grid === 'square' ? config.pitch : config.pitch / 2
  const row = (depth - config.margin) / rowPitch
  near(row, Math.round(row), 'row phase')
  const column = (x - config.margin - (config.grid === 'staggered' && Math.round(row) % 2 ? config.pitch / 2 : 0)) / config.pitch
  near(column, Math.round(column), 'column phase')
}
const table = (values = {}) => ({ ...model.defaults, length: 1460, width: 1160, tabWidth: 30, ribs: false, legPlateSize: 240, legPlateHoleSpacing: 140, ...values })

test('D16/D28 fixed top and skirt datums survive dimensions, stock, mounts and both lattices', () => {
  let checked = 0
  for (const profile of ['D16', 'D28']) for (const height of [100, 120, 150, 200])
    for (const thickness of profile === 'D16' ? [4, 8, 12] : [8, 16, 27])
      for (const mounting of ['none', 'boltPattern', 'cornerPlate']) for (const grid of ['square', 'staggered'])
        for (const length of [1450, 1460]) {
          const config = table({ ...model.presetValues[profile], height, thickness, length, grid, legMounts: mounting !== 'none', legMountStyle: mounting === 'cornerPlate' ? 'cornerPlate' : 'boltPattern' })
          assert.equal(geometry.fabricationError(config), undefined, JSON.stringify(config))
          for (const part of geometry.makeParts(config).filter(part => ['top', 'longSkirt', 'shortSkirt'].includes(part.name))) {
            const holes = part.holes.filter(hole => hole.kind === 'grid')
            assert.ok(holes.length)
            const depth = hole => part.name === 'top' ? hole.y + part.height / 2 : -geometry.skirtAssemblyY(config) - hole.y
            near(Math.min(...holes.map(depth)), profile === 'D16' ? 25 : 50, `${part.name} first row`)
            for (const hole of holes) {
              onLattice(hole.x + part.width / 2, depth(hole), config)
              assert.ok(geometry.pointInContour(hole, part.contours[0]))
            }
          }
          checked++
        }
  assert.equal(checked, 288)
})

test('actual Three assembly transforms keep opposite faces and top on the same global phase', () => {
  for (const profile of ['D16', 'D28']) for (const grid of ['square', 'staggered']) for (const mounting of ['none', 'cornerPlate']) {
    const config = table({ ...model.presetValues[profile], grid, height: 150, liftingHoles: true, showDimensions: false, legMounts: mounting === 'cornerPlate', legMountStyle: 'cornerPlate' })
    const runtime = { assembly: new THREE.Group(), dimensions: new THREE.Group(), meshes: [], metal: new THREE.MeshStandardMaterial(), colors: mesh.assemblyColors(false), factor: 0, targetFactor: 0, renderHoles: true }
    assembly.rebuildAssembly(runtime, config)
    runtime.assembly.updateMatrixWorld(true)
    const parts = new Map(geometry.makeParts(config).map(part => [part.name, part]))
    const top = runtime.meshes.find(item => item.userData.part === 'top')
    const surface = new THREE.Box3().setFromObject(top).max.y
    const skirtSets = new Map()
    for (const item of runtime.meshes.filter(item => ['longSkirt', 'shortSkirt'].includes(item.userData.part))) {
      const part = parts.get(item.userData.part)
      const points = part.holes.filter(hole => hole.kind === 'grid').map(hole => item.localToWorld(new THREE.Vector3(hole.x, hole.y, 0)))
      near(Math.min(...points.map(p => surface - p.y)), config.margin, 'assembled first row')
      const normalized = points.map(p => {
        const horizontal = part.name === 'longSkirt' ? p.x + config.length / 2 : p.z + config.width / 2
        onLattice(horizontal, surface - p.y, config)
        return [horizontal, surface - p.y].map(n => Number(n.toFixed(6)))
      })
      if (skirtSets.has(part.name)) assert.deepEqual(normalized, skirtSets.get(part.name), 'opposite-face phase')
      else skirtSets.set(part.name, normalized)
    }
    for (const hole of parts.get('top').holes.filter(hole => hole.kind === 'grid')) {
      const p = top.localToWorld(new THREE.Vector3(hole.x, hole.y, 0))
      onLattice(p.x + config.length / 2, p.z + config.width / 2, config)
    }
    mesh.disposeObject3D(runtime.assembly); mesh.disposeObject3D(runtime.dimensions)
  }
})

test('diagonal is the square lattice plus cell centres, not alternate missing square rows', () => {
  const square = geometry.fixtureGridPoints(200, 200, { pitch: 50, margin: 25, grid: 'square' })
  const diagonal = geometry.fixtureGridPoints(200, 200, { pitch: 50, margin: 25, grid: 'staggered' })
  assert.equal(square.length, 16)
  assert.equal(diagonal.length, 25)
  for (const p of [...square, { x: 50, y: 50 }, { x: 100, y: 100 }, { x: 150, y: 150 }]) assert.ok(diagonal.some(other => other.x === p.x && other.y === p.y))
})

test('native DXF and nesting receive the corrected canonical holes including explicit edits', () => {
  const config = table({ grid: 'staggered', customHoles: [{ id: 'manual', part: 'top', x: 0, y: 0, d: 10 }] })
  const removed = geometry.makeParts(config).find(part => part.name === 'top').holes.find(hole => hole.kind === 'grid')
  config.removedHoles = [removed.id]
  assert.equal(geometry.fabricationError(config), undefined)
  const parts = geometry.makeParts(config)
  assert.deepEqual(nesting.nestingParts(config), parts)
  for (const part of parts) {
    const circles = new DxfParser().parseSync(dxf.dxfForPart(part, config)).entities.filter(entity => entity.type === 'CIRCLE')
    assert.equal(circles.length, part.holes.length)
    for (const [i, hole] of part.holes.entries()) {
      near(circles[i].center.x, hole.x); near(circles[i].center.y, hole.y); near(circles[i].radius, hole.d / 2)
    }
  }
  const top = parts.find(part => part.name === 'top')
  assert.equal(top.holes.some(hole => hole.id === removed.id), false)
  assert.equal(top.holes.filter(hole => hole.id === 'custom:manual').length, 1)
})

test('unsafe spacing, stock, custom voids and colliding serialized IDs fail closed', () => {
  for (const [change, code] of [
    [{ pitch: 20, grid: 'staggered' }, 'grid-spacing'], [{ margin: 5 }, 'grid-origin'],
    [{ thickness: 15 }, 'skirt-clearance'], [{ height: 49 }, 'skirt-clearance'], [{ pitch: NaN }, 'invalid-grid'],
    [{ customHoles: [{ id: 'off', part: 'top', x: 10000, y: 0, d: 10 }] }, 'custom-hole'],
    [{ customHoles: [{ id: 1, part: 'top', x: 0, y: 0, d: 10 }, { id: '1', part: 'top', x: 0, y: 0, d: 10 }] }, 'custom-hole'],
  ]) {
    const config = table(change)
    assert.equal(geometry.fabricationError(config)?.code, code)
    assert.throws(() => dxf.fullDxf(config), error => error.code === code)
    assert.throws(() => nesting.nestingParts(config), error => error.code === code)
  }
  const config = table({ liftingHoles: true })
  config.customHoles = [{ id: 'void', part: 'longSkirt', x: 0, y: 0, d: 5 }]
  assert.equal(geometry.fabricationError(config)?.code, 'custom-hole')
})

test('extension grid has the same 25 mm datum in actual placements and rejects stock that would shift it', () => {
  for (const thickness of [4, 6, 9]) for (const width of [200, 230, 400]) for (const height of [150, 175, 300]) {
    const config = { ...extension.extensionDefaults, length: 460, thickness, width, height }
    const parts = new Map(extension.extensionParts(config).map(part => [part.name, part]))
    for (const placement of extension.extensionAssembly(config).filter(item => item.part !== 'crossRib')) {
      const part = parts.get(placement.part), holes = part.holes.filter(hole => hole.kind === 'grid')
      if (placement.part === 'top') {
        near(Math.min(...holes.map(hole => hole.x)), 25)
        near(Math.min(...holes.map(hole => hole.y)), 25)
      } else {
        const depths = holes.map(hole => height - placement.origin[2] - placement.axes[0][2] * hole.x - placement.axes[1][2] * hole.y)
        near(Math.min(...depths), 25)
        for (const depth of depths) near((depth - 25) / 50, Math.round((depth - 25) / 50))
      }
    }
  }
  assert.throws(() => extension.extensionParts({ ...extension.extensionDefaults, thickness: 10 }), error => error.code === 'invalid-dimensions' && error.details.max === 9)
})
