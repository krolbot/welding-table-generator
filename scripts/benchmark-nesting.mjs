import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const reference = JSON.parse(await fs.readFile(new URL('../benchmarks/nesting-baseline.json', import.meta.url), 'utf8'))
const attempts = Number(process.argv[2] ?? 96)
const selected = process.argv[3]
assert.ok(Number.isInteger(attempts) && attempts >= 1 && attempts <= 4096, 'attempts must be 1..4096')
const server = await createServer({ root, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
try {
  const { parseTableProject } = await server.ssrLoadModule('/src/tableProject.ts')
  const { nestingParts, nestingOptions } = await server.ssrLoadModule('/src/nestingSettings.ts')
  const { nestParts } = await server.ssrLoadModule('/src/nesting.ts')
  const cases = reference.cases.filter(c => !selected || c.name === selected)
  assert.ok(cases.length, 'unknown benchmark case')
  for (const fixture of cases) {
    // Historical parameters are explicitly reapplied to the corrected grid, preserving their saved origin.
    const { config } = parseTableProject(JSON.stringify(fixture.config))
    const parts = nestingParts(config)
    const started = performance.now()
    const result = nestParts(parts, { ...nestingOptions(config), attempts })
    const report = {
      case: fixture.name, inventory: 'current-datum-grid', comparison: 'historical geometry differs; sheet counts are informational', baselineCommit: reference.sourceCommit, baselineSheets: fixture.baselineSheets,
      sheets: result.sheets.length, parts: result.placements.length, unplaced: result.unplaced.length,
      valid: result.validation.valid, milliseconds: Math.round(performance.now() - started), attempts,
      outlineArea: result.outlineArea, metrics: result.metrics, search: result.stats,
    }
    console.log(JSON.stringify(report))
    assert.equal(result.unplaced.length, 0, fixture.name)
    assert.equal(result.validation.valid, true, fixture.name)
  }
} finally { await server.close() }
