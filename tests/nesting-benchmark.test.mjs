import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

for (const fixture of [
  { name: 'historical 1450×1150 H200 ten-piece set fits one 3000×1500 sheet', height: 200, sheetLength: 3000, mounts: false, attempts: 32, count: 10 },
  { name: 'contour search replays the historical 18-piece inventory on 2520×1500', height: 150, sheetLength: 2520, mounts: true, attempts: 96, count: 18, historicalInventory: true },
  { name: 'current 22-piece table including four leg mounting plates fits one 3000×1500 sheet', height: 150, sheetLength: 3000, mounts: true, attempts: 32, count: 22 },
]) {
  test(fixture.name, async () => {
    const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
    try {
      const { defaults } = await server.ssrLoadModule('/src/model.ts')
      const { nestingParts, nestingOptions } = await server.ssrLoadModule('/src/nestingSettings.ts')
      const { nestParts } = await server.ssrLoadModule('/src/nesting.ts')
      const config = { ...defaults, length: 1450, width: 1150, height: fixture.height, sheetLength: fixture.sheetLength, thickness: 8, legMounts: fixture.mounts, legMountStyle: 'cornerPlate', liftingHoles: fixture.mounts, ribs: true }
      const parts = nestingParts(config).filter(part => !fixture.historicalInventory || part.name !== 'legMountPlate')
      const result = nestParts(parts, { ...nestingOptions(config), attempts: fixture.attempts })
      assert.equal(result.unplaced.length, 0)
      assert.equal(result.placements.length, fixture.count)
      assert.equal(result.sheets.length, 1)
      assert.equal(result.validation.valid, true)
    } finally { await server.close() }
  })
}
