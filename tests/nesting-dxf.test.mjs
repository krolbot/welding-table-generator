import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'vite'

test('sheet DXF rotates native outlines, arcs, holes and engraving exactly', async () => {
  const server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  try {
    const geometry = await server.ssrLoadModule('/src/geometry.ts')
    const dxf = await server.ssrLoadModule('/src/dxf.ts')
    const nesting = await server.ssrLoadModule('/src/nesting.ts')
    const { defaults } = await server.ssrLoadModule('/src/model.ts')
    const config = { ...defaults, engraving: true, nameMarking: true, liftingHoles: true }
    const part = geometry.makeParts(config).find(value => value.name === 'longSkirt')
    for (const rotation of [0, 90, 180, 270]) {
      const placement = { part, instance: 0, sheet: 0, rotation, translation: { x: 1000, y: 1200 } }
      const text = dxf.dxfForNestedSheet(config, [placement])
      const raw = text.split('0\nSECTION\n2\nENTITIES\n')[1].split('0\nENDSEC\n')[0]
      const entities = raw.split(/(?=0\n(?:LINE|ARC|CIRCLE)\n)/).filter(Boolean).map(entity => {
        const fields = entity.trim().split('\n')
        return Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => [fields[i * 2], fields[i * 2 + 1]]))
      })
      const expected = point => nesting.transformNestingPoint(point, placement)
      const near = (actual, target) => assert.ok(Math.abs(Number(actual) - target) < 0.00051)
      let index = 0
      for (const contour of part.contours) for (const segment of contour) {
        const entity = entities[index++]
        assert.equal(entity[0], segment.type === 'line' ? 'LINE' : 'ARC')
        const target = expected(segment.type === 'line' ? segment.from : segment.center)
        near(entity[10], target.x); near(entity[20], target.y)
        if (segment.type === 'line') {
          const end = expected(segment.to); near(entity[11], end.x); near(entity[21], end.y)
        } else {
          near(entity[40], segment.radius)
          near(entity[50], ((segment.clockwise ? segment.end : segment.start) + rotation + 360) % 360)
          near(entity[51], ((segment.clockwise ? segment.start : segment.end) + rotation + 360) % 360)
        }
      }
      for (const hole of part.holes) {
        const entity = entities[index++], center = expected(hole)
        assert.equal(entity[0], 'CIRCLE'); near(entity[10], center.x); near(entity[20], center.y); near(entity[40], hole.d / 2)
      }
      for (const mark of geometry.engravingLines(part, config)) {
        const entity = entities[index++], from = expected(mark.from), to = expected(mark.to)
        assert.equal(entity[0], 'LINE'); assert.equal(entity[8], 'ENGRAVE')
        near(entity[10], from.x); near(entity[20], from.y); near(entity[11], to.x); near(entity[21], to.y)
      }
      assert.equal(index, entities.length)
    }
  } finally { await server.close() }
})
