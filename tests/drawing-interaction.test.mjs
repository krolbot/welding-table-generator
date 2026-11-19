import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, drawing, navigation, tools, table
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  ;[drawing, navigation, tools, table] = await Promise.all(['/src/drawingInteraction.ts', '/src/viewNavigation.ts', '/src/tools/project.ts', '/src/tableProject.ts'].map(path => server.ssrLoadModule(path)))
})
after(async () => { await server?.close() })
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)

test('workspace URLs preserve shared data and expose view destinations', () => {
  assert.equal(table.tableProjectFromQuery(new URLSearchParams('workspace=table&view=2d')), undefined)
  assert.equal(table.tableProjectFromQuery(new URLSearchParams('workspace=tools&view=3d&state=original')), 'original')
  assert.equal(navigation.readWorkspaceRoute(new URL('https://example.test/?workspace=table&toolProject=original')).workspace, 'table')
  const url = new URL('https://example.test/?toolProject=original&state=table#anchor')
  assert.deepEqual(navigation.readWorkspaceRoute(url), { workspace: 'tools', view: '2d' })
  const next = navigation.workspaceUrl(url, { workspace: 'tools', view: '3d' })
  assert.equal(next.searchParams.get('toolProject'), 'original')
  assert.equal(next.searchParams.get('state'), 'table')
  assert.equal(next.hash, '#anchor')
  assert.deepEqual(navigation.readWorkspaceRoute(next), { workspace: 'tools', view: '3d' })
  const tableUrl = navigation.workspaceUrl(next, { workspace: 'table', view: 'sheet' })
  assert.equal(tableUrl.searchParams.get('toolProject'), 'original')
  assert.equal(tableUrl.searchParams.get('state'), 'table')
  assert.deepEqual(navigation.readWorkspaceRoute(tableUrl), { workspace: 'table', view: 'sheet' })
  assert.deepEqual(navigation.readWorkspaceRoute(new URL('https://example.test/?view=wrong'), { table: '3d' }), { workspace: 'table', view: '2d' })
})

test('zoom and clamps retain the world point under the pointer', () => {
  const camera = drawing.fitDrawing({ width: 3000, height: 1500 }, { width: 900, height: 600 })
  const pointer = { x: 417, y: 232 }, world = drawing.drawingPoint(pointer, camera)
  for (const scale of [camera.scale / 1000, camera.scale * 2, camera.scale * 1000]) {
    const next = drawing.zoomDrawing(camera, pointer, scale, { min: 0.01, max: 30 })
    const kept = drawing.drawingPoint(pointer, next)
    near(world.x, kept.x); near(world.y, kept.y)
    assert.ok(next.scale >= 0.01 && next.scale <= 30)
    const screen = drawing.screenPoint(kept, next)
    near(screen.x, pointer.x); near(screen.y, pointer.y)
  }
})

test('part focus centres translated and rotated bounds without moving geometry', () => {
  const project = tools.toolDefaults.viseModule
  const part = tools.projectParts(project, { thickness: 8 })[0]
  const features = drawing.drawingFeatures([{ part, position: { x: 900, y: -600 }, rotation: 90 }])
  assert.equal(features.targets.length, 1)
  const bounds = features.targets[0].bounds, viewport = { width: 780, height: 560 }
  const camera = drawing.fitDrawing(bounds, viewport)
  const centre = drawing.screenPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, camera)
  near(centre.x, viewport.width / 2); near(centre.y, viewport.height / 2)
  for (const x of [bounds.x, bounds.x + bounds.width]) for (const y of [bounds.y, bounds.y + bounds.height]) {
    const point = drawing.screenPoint({ x, y }, camera)
    assert.ok(point.x >= 0 && point.x <= viewport.width && point.y >= 0 && point.y <= viewport.height)
  }
})

test('viewport resizing retains focused framing and user pan/zoom when a dock opens', () => {
  const framing = { x: 900, y: -400, width: 250, height: 100 }
  const previous = { width: 1078, height: 729 }, next = { width: 788, height: 729 }
  const fitted = drawing.fitDrawing(framing, previous)
  const resized = drawing.resizeDrawing(fitted, previous, next, framing)
  const expected = drawing.fitDrawing(framing, next)
  near(resized.scale, expected.scale); near(resized.x, expected.x); near(resized.y, expected.y)
  const panned = { ...fitted, x: fitted.x + 75, y: fitted.y - 20 }
  const before = drawing.drawingPoint({ x: previous.width / 2, y: previous.height / 2 }, panned)
  const moved = drawing.resizeDrawing(panned, previous, next, framing)
  const after = drawing.drawingPoint({ x: next.width / 2, y: next.height / 2 }, moved)
  near(before.x, after.x); near(before.y, after.y)
})

test('snapping uses native arc projections, including clockwise wrap, not tessellation', () => {
  for (const clockwise of [false, true]) {
    const arc = { type: 'arc', center: { x: 20, y: 10 }, radius: 10, start: clockwise ? 20 : 340, end: clockwise ? 340 : 20, clockwise }
    const point = { x: 31, y: 10 }, features = { anchors: [], edges: [{ segment: arc, label: 'curve' }] }
    const snapped = drawing.snapDrawingPoint(point, features, 2)
    near(snapped.x, 30); near(snapped.y, 10); assert.equal(snapped.kind, 'edge')
    assert.equal(drawing.snapDrawingPoint({ x: 9, y: 10 }, features, 2).kind, 'free')
  }
})

test('rotated nested parts retain exact hole centres and edge coordinates', () => {
  const part = { name: 'test', label: 'Plate', width: 100, height: 100, thickness: 6, count: 1, slots: [], holes: [{ id: 'h', x: 20, y: 30, d: 16, kind: 'grid' }], contours: [[{ type: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]] }
  const features = drawing.drawingFeatures([{ part, position: { x: 200, y: 300 }, rotation: 90 }])
  const hole = drawing.snapDrawingPoint({ x: 170.2, y: 320.1 }, features, 1)
  near(hole.x, 170); near(hole.y, 320); assert.equal(hole.kind, 'centre')
  const edge = drawing.snapDrawingPoint({ x: 200.2, y: 337.5 }, features, 1)
  near(edge.x, 200); near(edge.y, 337.5); assert.equal(edge.kind, 'edge')
})

test('vise native radial tips and corners yield the real 15 mm setbacks', () => {
  const project = tools.toolDefaults.viseModule
  const part = tools.projectParts(project, { thickness: 8 }).find(part => part.name === 'viseTop')
  assert.ok(part)
  const features = drawing.drawingFeatures([{ part, position: { x: 0, y: 0 }, rotation: 0 }])
  const arcs = part.contours.slice(1).flat().filter(segment => segment.type === 'arc')
  const cx = project.size.length / 2, cy = project.size.width / 2
  const outer = arcs.filter(arc => Math.hypot(arc.center.x - cx, arc.center.y - cy) > 60)
  assert.equal(outer.length, 8)
  for (const arc of outer) {
    const length = Math.hypot(arc.center.x - cx, arc.center.y - cy), ux = (arc.center.x - cx) / length, uy = (arc.center.y - cy) / length
    const tip = { x: arc.center.x + ux * arc.radius, y: arc.center.y + uy * arc.radius }
    const start = drawing.snapDrawingPoint(tip, features, 0.01)
    near(start.x, tip.x); near(start.y, tip.y)
    const boundary = { x: tip.x + 15 * ux, y: tip.y + 15 * uy }
    const end = drawing.snapDrawingPoint(boundary, features, 0.01)
    assert.notEqual(start.kind, 'free'); assert.notEqual(end.kind, 'free')
    near(drawing.measurementValues({ start, end }).length, 15)
  }
})
