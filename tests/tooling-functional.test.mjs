import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { Vector3 } from 'three'

let server, tooling, primitives, view, validation
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  tooling = await server.ssrLoadModule('/src/tooling/index.ts')
  primitives = await server.ssrLoadModule('/src/tooling/primitives.ts')
  validation = await server.ssrLoadModule('/src/tooling/validation.ts')
  view = await server.ssrLoadModule('/src/tooling/ToolingThree.tsx')
})
after(async () => { await server?.close() })
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`)
const build = (id, values = {}) => tooling.buildDefaultToolingAssembly(id, values)


test('actual Three rotation matches canonical transforms for every catalog instance and compound rotation', () => {
  const transforms = tooling.TOOLING_IDS.flatMap(id => build(id).instances.map(i => i.transform))
  transforms.push(primitives.transform({ x: 12, y: -30, z: 90 }, { x: 37, y: 19, z: -53 }))
  for (const transform of transforms) for (const point of [{ x: 1, y: 2, z: 3 }, { x: -14, y: 23, z: -7 }]) {
    const rendered = new Vector3(point.x, point.y, point.z).applyMatrix4(view.assemblyRotationMatrix(transform)).add(new Vector3(...Object.values(transform.translation)))
    const expected = primitives.applyTransform(point, transform)
    for (const axis of ['x', 'y', 'z']) near(rendered[axis], expected[axis], axis)
  }
})

test('B01 six real tabs penetrate closed top slots through the complete stock thickness', () => {
  for (const thickness of [4, 6, 8]) {
    const assembly = build('B01', { thickness })
    const top = assembly.parts.find(p => p.name === 'B01-top')
    const topInstance = assembly.instances.find(i => i.partName === top.name)
    const joints = assembly.joints.filter(j => j.kind === 'tab')
    assert.equal(joints.length, 6)
    for (const joint of joints) {
      const receiving = topInstance.interfaces.find(i => i.id === joint.first.interfaceId)
      const tabInstance = assembly.instances.find(i => i.id === joint.second.instanceId)
      const tab = assembly.parts.find(p => p.name === tabInstance.partName)
      const slot = top.slots.find(s => Math.abs(s.x - receiving.localOrigin.x) < 1e-7 && Math.abs(s.y - receiving.localOrigin.y) < 1e-7)
      assert.ok(slot, 'joint must use the exact slot centre, not a nearby outer edge')
      assert.ok(Math.abs(slot.x) + slot.width / 2 < top.width / 2)
      assert.ok(Math.abs(slot.y) + slot.height / 2 < top.height / 2)
      const center = primitives.applyTransform(receiving.localOrigin, topInstance.transform)
      for (const dz of [-thickness / 2 + .001, 0, thickness / 2 - .001]) {
        const local = primitives.invertTransform({ ...center, z: center.z + dz }, tabInstance.transform)
        assert.equal(validation.classifyMatingPoint(tab, local, 1e-5), 'material-face')
      }
      const removedTab = structuredClone(assembly)
      const candidate = removedTab.parts.find(p => p.name === tab.name)
      candidate.contours[0] = primitives.rectangle(candidate.width, assembly.config.values.height - thickness)
      assert.equal(tooling.validateToolingAssembly(removedTab).valid, false, 'plain wall cannot masquerade as a tab')
    }
  }
})

test('B01 rejects an arc whose cardinal extremum exits the mounting blank', () => {
  assert.throws(() => build('B01', { width: 150, height: 500, thickness: 20, clearance: 1.5, tabWidth: 15, radialRadius: 150, radialWidth: 40, radialStart: -80, radialEnd: 80 }), /Internal contour extends outside declared part bounds/)
})


test('C03 carriage travels the requested stroke on real bush holes and preserves cut geometry', () => {
  const start = build('C03', { position: 0 }), end = build('C03', { position: 100 })
  assert.deepEqual(start.parts, end.parts)
  const moving = start.instances.filter(i => i.partName.startsWith('C03-carriage'))
  assert.equal(moving.length, 4)
  for (const instance of moving) near(end.instances.find(i => i.id === instance.id).transform.translation.x - instance.transform.translation.x, 100)
  assert.equal(start.purchased.find(p => p.id === 'guide-bush').mounts.length, 4)
  assert.throws(() => build('C03', { position: 101 }), /position/)
})



test('support packs achieve exact height and V inserts retain both outside corners', () => {
  const assembly = build('A07', { supportHeight: 20, thickness: 12 })
  near(assembly.parts.filter(p => p.name !== 'A07-strap').reduce((s, p) => s + p.thickness * p.count, 0), 20)
  near(assembly.instances.find(i => i.partName === 'A07-strap').transform.translation.z, 26)
  const insert = build('A10').parts[0]
  assert.ok(insert.contours[0].some(s => s.type === 'line' && s.from.x === -70 && s.from.y === 50))
})
