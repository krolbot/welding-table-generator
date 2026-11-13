import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

for (const fixture of [
  { name: 'complete datum-fixed 1450×1150 H200 eleven-piece set fits at most two 3000×1500 sheets', height: 200, sheetLength: 3000, mounts: false, attempts: 32, count: 11, maxSheets: 2 },
  { name: 'complete datum-fixed 23-piece kit fits at most two 2520×1500 sheets', height: 150, sheetLength: 2520, mounts: true, attempts: 96, count: 23, maxSheets: 2 },
  { name: 'datum-fixed 23-piece kit including all mounting plates fits one 3000×1500 sheet', height: 150, sheetLength: 3000, mounts: true, attempts: 32, count: 23, maxSheets: 1 },
]) {
  test(fixture.name, async () => {
    const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
    try {
      const { defaults } = await server.ssrLoadModule('/src/model.ts')
      const { nestingParts, nestingOptions } = await server.ssrLoadModule('/src/nestingSettings.ts')
      const { nestParts } = await server.ssrLoadModule('/src/nesting.ts')
      const config = { ...defaults, length: 1450, width: 1150, height: fixture.height, sheetLength: fixture.sheetLength, thickness: 8, legMounts: fixture.mounts, legMountStyle: 'cornerPlate', liftingHoles: fixture.mounts, ribs: true }
      const parts = nestingParts(config)
      const result = nestParts(parts, { ...nestingOptions(config), attempts: fixture.attempts })
      assert.equal(result.unplaced.length, 0)
      assert.equal(result.placements.length, fixture.count)
      assert.ok(result.sheets.length <= fixture.maxSheets)
      assert.equal(result.validation.valid, true)
    } finally { await server.close() }
  })
}
