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
  const { defaults } = await server.ssrLoadModule('/src/model.ts')
  const { nestingParts, nestingOptions } = await server.ssrLoadModule('/src/nestingSettings.ts')
  const { nestParts } = await server.ssrLoadModule('/src/nesting.ts')
  const cases = reference.cases.filter(c => !selected || c.name === selected)
  assert.ok(cases.length, 'unknown benchmark case')
  for (const fixture of cases) {
    const config = { ...defaults, ...fixture.config }
    const started = performance.now()
    const result = nestParts(nestingParts(config), { ...nestingOptions(config), attempts })
    const report = {
      case: fixture.name, baselineCommit: reference.sourceCommit, baselineSheets: fixture.baselineSheets,
      sheets: result.sheets.length, parts: result.placements.length, unplaced: result.unplaced.length,
      valid: result.validation.valid, milliseconds: Math.round(performance.now() - started), attempts,
      outlineArea: result.outlineArea, metrics: result.metrics, search: result.stats,
    }
    console.log(JSON.stringify(report))
    assert.equal(result.unplaced.length, 0, fixture.name)
    assert.equal(result.validation.valid, true, fixture.name)
    assert.ok(result.sheets.length <= fixture.baselineSheets, `${fixture.name}: sheet-count regression`)
  }
} finally { await server.close() }
