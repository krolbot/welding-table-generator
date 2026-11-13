import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'
import * as THREE from 'three'

const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
const { fitCameraToBounds } = await server.ssrLoadModule('/src/assemblyGeometry.ts')
await server.close()

test('shared camera fit keeps model and annotation bounds inside both mobile and desktop viewports', () => {
  for (const aspect of [.65, 1.4, 2.3]) for (const extent of [250, 2000]) for (const zUp of [false, true]) {
    const camera = new THREE.PerspectiveCamera(45, aspect, 1, 100000)
    camera.up.set(...(zUp ? [0, 0, 1] : [0, 1, 0]))
    camera.position.set(...(zUp ? [-extent, -extent, extent] : [extent, extent, extent]))
    const bounds = new THREE.Box3(new THREE.Vector3(-extent * .2, -extent * .3, -extent * .2), new THREE.Vector3(extent, extent * .7, extent * .4))
    const target = fitCameraToBounds(camera, new THREE.Vector3(), bounds)
    assert.deepEqual(target.toArray(), bounds.getCenter(new THREE.Vector3()).toArray())
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const projected = new THREE.Vector3(x, y, z).project(camera)
      assert.ok(Math.abs(projected.x) < .9, `horizontal clipping: ${projected.x}`)
      assert.ok(Math.abs(projected.y) < .9, `vertical clipping: ${projected.y}`)
      assert.ok(projected.z > -1 && projected.z < 1)
    }
  }
})
