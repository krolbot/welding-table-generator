import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server
let tooling

before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  tooling = await server.ssrLoadModule('/src/tooling/index.ts')
})

after(async () => { await server?.close() })

test('catalog contains only scoped welding-table accessories, without retired machine parts', () => {
  const active = ['A01', 'A02', 'A04', 'A05', 'A06', 'A07', 'A09', 'A10', 'A12', 'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B10', 'B11', 'C01', 'C02', 'C03', 'C04']
  assert.deepEqual(tooling.TOOLING_IDS, active)
  assert.equal(new Set(tooling.TOOLING_IDS).size, active.length)
  for (const id of ['A03', 'A08', 'A11', 'A13', 'B09', 'B12', 'B13', 'B14', 'C05', 'C06', 'C07']) {
    assert.ok(!tooling.TOOLING_IDS.includes(id), `${id} must not appear in welding-table tooling`)
    assert.throws(() => tooling.createToolingConfig(id), /Unknown tooling id/)
  }
  for (const entry of tooling.toolingCatalog) {
    assert.ok(entry.function.length > 15, `${entry.id} lacks a functional definition`)
    assert.ok(entry.parameters.length >= 2, `${entry.id} lacks parameter definitions`)
    for (const parameter of entry.parameters) {
      assert.ok(parameter.key && parameter.label && parameter.type && parameter.unit)
      if (parameter.type === 'number') assert.ok(parameter.minimum < parameter.maximum && parameter.default >= parameter.minimum && parameter.default <= parameter.maximum)
    }
  }
})

test('all scoped default recipes build validated native geometry and consistent quantities', () => {
  for (const id of tooling.TOOLING_IDS) {
    const assembly = tooling.buildDefaultToolingAssembly(id)
    const validation = tooling.validateToolingAssembly(assembly)
    assert.equal(validation.valid, true, `${id}: ${validation.issues.map(i => i.message).join('; ')}`)
    assert.equal(assembly.id, id)
    assert.equal(assembly.units, 'mm')
    assert.ok(assembly.parts.length > 0 || id === 'C01')
    for (const part of assembly.parts) {
      assert.equal(part.process, 'laser-cut')
      assert.ok(part.material && part.thickness > 0 && part.densityKgPerMm3 > 0)
      assert.equal(assembly.instances.filter(instance => instance.partName === part.name).length, part.count)
      assert.ok(part.contours.length > 0)
      for (const contour of part.contours) assert.ok(contour.every(segment => segment.type === 'line' || segment.type === 'arc'))
    }
    for (const item of assembly.purchased) assert.equal(item.excludedFromSheetNesting, true)
  }
})

test('B01 is the approved open topology with native closed radial cut and transformed joints', () => {
  const assembly = tooling.buildDefaultToolingAssembly('B01')
  assert.deepEqual(assembly.parts.map(part => [part.name, part.count]), [
    ['B01-top', 1], ['B01-side', 2], ['B01-mount-end', 1],
  ])
  assert.equal(assembly.instances.length, 4)
  assert.equal(assembly.parts.some(part => /bottom|far-end/.test(part.name)), false)
  const end = assembly.parts.find(part => part.name === 'B01-mount-end')
  assert.ok(end)
  assert.equal(end.contours.length, 2)
  assert.ok(end.contours[1].some(segment => segment.type === 'arc'))
  assert.ok(assembly.joints.filter(joint => joint.kind === 'tab').length >= 6)
  assert.equal(tooling.validateToolingAssembly(assembly).valid, true)
})

test('parameter overrides change functional geometry and quantities', () => {
  const stop = tooling.buildDefaultToolingAssembly('A01', { slotLength: 240, length: 420 })
  assert.equal(stop.parts[0].width, 420)
  assert.equal(stop.parts[0].slots[0].width, 240)

  const radiusInsert = tooling.buildDefaultToolingAssembly('A10', { profile: 'radius', profileSize: 80 })
  assert.ok(radiusInsert.parts[0].contours[0].some(segment => segment.type === 'arc'))
  const customExtension = tooling.buildDefaultToolingAssembly('B01', { length: 600, width: 250, holePitch: 50, gridMargin: 50, radialRadius: 70 })
  assert.equal(customExtension.parts.find(part => part.name === 'B01-top')?.width, 600)
  assert.ok(customExtension.parts.find(part => part.name === 'B01-mount-end')?.contours[1].some(segment => segment.type === 'arc'))
  const roller = tooling.buildDefaultToolingAssembly('C04', { rollerDiameter: 80 })
  assert.equal(roller.purchased.find(item => item.id === 'roller')?.interfaceParameters.outerDiameter, 80)
})

test('strict configuration and geometric compatibility fail closed', () => {
  assert.throws(() => tooling.createToolingConfig('A01', { unknown: 1 }), /unknown parameter/)
  assert.throws(() => tooling.createToolingConfig('A01', { length: Number.NaN }), /finite number/)
  assert.throws(() => tooling.createToolingConfig('A09', { quantity: 2.5 }), /integer count/)
  assert.throws(() => tooling.createToolingConfig('A04', { eccentricity: 100 }), /outside/)
  assert.throws(() => tooling.buildDefaultToolingAssembly('A10', { width: 30, profileSize: 200 }), /does not fit/)

  const a10 = tooling.createToolingConfig('A10')
  const b08 = tooling.createToolingConfig('B08')
  assert.doesNotThrow(() => tooling.assertA10B08Compatibility(a10, b08))
  assert.throws(() => tooling.assertA10B08Compatibility(tooling.createToolingConfig('A10', { holderPitch: 70 }), b08), /bolt pitch/)


})

test('validator rejects broken native geometry and unplanned cut collisions', () => {
  const open = tooling.buildDefaultToolingAssembly('A01')
  open.parts[0].contours[0] = open.parts[0].contours[0].slice(0, -1)
  assert.ok(tooling.validateToolingAssembly(open).issues.some(item => item.code === 'open-contour'))

  const collision = tooling.buildDefaultToolingAssembly('A05')
  collision.parts[0].holes[1] = { ...collision.parts[0].holes[0], id: 'forced-overlap' }
  assert.ok(tooling.validateToolingAssembly(collision).issues.some(item => item.code === 'hole-collision'))

  const crossed = tooling.buildDefaultToolingAssembly('A01')
  crossed.parts[0].contours[0] = [
    { type: 'line', from: { x: -10, y: -10 }, to: { x: 10, y: 10 } },
    { type: 'line', from: { x: 10, y: 10 }, to: { x: -10, y: 10 } },
    { type: 'line', from: { x: -10, y: 10 }, to: { x: 10, y: -10 } },
    { type: 'line', from: { x: 10, y: -10 }, to: { x: -10, y: -10 } },
  ]
  assert.ok(tooling.validateToolingAssembly(crossed).issues.some(item => item.code === 'self-intersection'))

  const brokenJoint = tooling.buildDefaultToolingAssembly('B04')
  brokenJoint.instances[0].interfaces[0].localOrigin.z += 100
  const brokenJointIssues = tooling.validateToolingAssembly(brokenJoint).issues
  assert.ok(brokenJointIssues.some(item => item.code === 'joint-position'))
  assert.ok(brokenJointIssues.some(item => item.code === 'joint-feature'))

  const disconnected = tooling.buildDefaultToolingAssembly('B10')
  disconnected.joints = disconnected.joints.slice(0, 1)
  assert.ok(tooling.validateToolingAssembly(disconnected).issues.some(item => item.code === 'disconnected-instance'))
})

test('sheet BOM groups real material/thickness combinations and uses material density', () => {
  const assembly = tooling.buildDefaultToolingAssembly('B04')
  assert.ok(assembly.sheetBom.length > 0)
  assert.ok(assembly.sheetBom.every(item => item.material === 'S235JR' && item.quantity > 0 && item.netMassKg > 0))
  assert.equal(tooling.materialDensityKgPerMm3.S235JR, 7.85e-6)
  assert.equal(tooling.materialDensityKgPerMm3.AISI304, 7.93e-6)
  assert.equal(tooling.materialDensityKgPerMm3.AlMg3, 2.66e-6)
})

test('hybrid catalog keeps mechanisms purchased and separate from sheet parts', () => {
  const c01 = tooling.buildDefaultToolingAssembly('C01', { includeAdapter: false })
  assert.equal(c01.parts.length, 0)
  assert.equal(c01.purchased[0].id, 'precision-pin')
  const c04 = tooling.buildDefaultToolingAssembly('C04')
  assert.ok(c04.parts.length > 0)
  assert.ok(c04.purchased.some(item => item.id === 'roller'))

})
