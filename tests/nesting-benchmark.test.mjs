import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('historical 1450×1150 H200 ten-piece set fits one 3000×1500 sheet', async () => {
  const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  try {
    const { defaults } = await server.ssrLoadModule('/src/model.ts')
    const { makeParts } = await server.ssrLoadModule('/src/geometry.ts')
    const { nestParts } = await server.ssrLoadModule('/src/nesting.ts')
    const config = { ...defaults, length: 1450, width: 1150, height: 200, thickness: 8, legMounts: false, ribs: true }
    const result = nestParts(makeParts(config), { sheet: { width: 3000, height: 1500 }, edgeClearance: 10.002, partClearance: 5.002, maxSheets: 32 })
    assert.equal(result.unplaced.length, 0)
    assert.equal(result.placements.length, 10)
    assert.equal(result.sheets.length, 1)
    assert.equal(result.validation.valid, true)
  } finally { await server.close() }
})
