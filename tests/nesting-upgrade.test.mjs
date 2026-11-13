import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { FillRule, intersect, pointInPolygon, PointInPolygonResult } from 'clipper2-ts'
let server, nesting, nfp, native, settings, dxf, defaults
before(async () => {
  server = await createServer({ appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } })
  nesting = await server.ssrLoadModule('/src/nesting.ts')
  nfp = await server.ssrLoadModule('/src/nestingNfp.ts')
  native = await server.ssrLoadModule('/src/nestingNative.ts')
  settings = await server.ssrLoadModule('/src/nestingSettings.ts')
  dxf = await server.ssrLoadModule('/src/dxf.ts')
  ;({ defaults } = await server.ssrLoadModule('/src/model.ts'))
})
after(async () => server?.close())
const polygon = (name, points, count = 1) => ({ name, label: name, count, width: 160, height: 160, thickness: 8, holes: [], slots: [], contours: [points.map((from, i) => ({ type: 'line', from: { x: from[0], y: from[1] }, to: { x: points[(i+1)%points.length][0], y: points[(i+1)%points.length][1] } }))] })
const rect = (name, w, h, count = 1) => polygon(name, [[0,0],[w,0],[w,h],[0,h]], count)
const circle = (x, y, radius) => [{ type: 'arc', center: {x,y}, radius, start: 0, end: 360 }]
const options = { sheet: { width: 180, height: 180 }, edgeClearance: 5, partClearance: 2, maxSheets: 2, rotations: [0], attempts: 16 }

test('actual contact placement interlocks U and L on one sheet instead of two bounding-box sheets', () => {
  const u = polygon('top', [[0,0],[160,0],[160,160],[120,160],[120,40],[40,40],[40,160],[0,160]])
  const l = polygon('shortSkirt', [[0,0],[75,0],[75,35],[35,35],[35,110],[0,110]])
  const seed = nesting.nestParts([u,l], {...options, attempts:12})
  const improved = nesting.nestParts([u,l], options)
  assert.equal(seed.sheets.length, 2)
  assert.equal(improved.sheets.length, 1)
  assert.equal(improved.unplaced.length, 0)
  assert.equal(improved.validation.valid, true)
  assert.ok(improved.stats.contactCacheMisses > 0)
})

test('filled NFP includes full containment, unlike a boundary-only Minkowski sweep', () => {
  const a = [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]
  const b = [{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]
  const paths = nfp.solidNoFit(a,b)
  assert.equal(intersect([a],[b.map(p=>({x:p.x+40,y:p.y+40}))],FillRule.NonZero).length > 0,true)
  assert.equal(paths.some(path=>pointInPolygon({x:40,y:40},path)===PointInPolygonResult.IsInside),true)
  const pa=rect('top',100,100), pb=rect('longSkirt',20,20)
  const placed=(part,x,y)=>({part,instance:0,sheet:0,rotation:0,translation:{x,y}})
  assert.equal(nesting.validateNesting([placed(pa,10,10),placed(pb,50,50)],options).valid,false)
})

test('continuous arc distance distinguishes sub-chord clearance and tangent cases', () => {
  for (const gap of [0,0.001,0.2,4.7,5,5.6,20]) {
    assert.ok(Math.abs(native.nativeContourDistance(circle(0,0,50),circle(100+gap,0,50))-gap)<1e-7)
    const line=[{type:'line',from:{x:-100,y:50+gap},to:{x:100,y:50+gap}}]
    assert.ok(Math.abs(native.nativeContourDistance(circle(0,0,50),line)-gap)<1e-7)
  }
  assert.equal(native.nativeContourDistance(circle(0,0,50),circle(20,0,50)),0)
  assert.equal(native.nativeContourDistance(circle(0,0,50),[{type:'line',from:{x:-100,y:0},to:{x:100,y:0}}]),0)
  const a={...rect('top',100,100),contours:[circle(0,0,50)]}
  const placed=x=>({part:a,instance:0,sheet:0,rotation:0,translation:{x,y:70}})
  assert.equal(nesting.validateNesting([placed(60),placed(164.7)],{...options,sheet:{width:300,height:200},partClearance:5,arcTolerance:8}).valid,false)
})

test('45 degree rotation fits a long blank where quarter turns cannot', () => {
  const p=rect('top',150,10)
  const o={...options,sheet:{width:120,height:120},edgeClearance:1,maxSheets:1,attempts:16}
  assert.equal(nesting.nestParts([p],{...o,rotations:[0,90]}).unplaced.length,1)
  const result=nesting.nestParts([p],{...o,rotations:[45,135]})
  assert.equal(result.unplaced.length,0)
  assert.equal(result.validation.valid,true)
  assert.ok([45,135].includes(result.placements[0].rotation))
})

test('progress is deterministic, monotonically improving and resumable at a pass boundary', () => {
  const parts=[rect('top',70,40,3),rect('shortSkirt',40,20,4)]
  const it=nesting.searchNesting(parts,{...options,attempts:30})
  let previous, first
  for (let i=0;i<30;i++) {
    const step=it.next(); assert.equal(step.done,false)
    if (previous) assert.ok(nesting.compareNesting(step.value,previous)<=0)
    previous=step.value; first??=step.value
  }
  assert.equal(it.next().done,true)
  assert.equal(first.stats.attempts,1,'later passes must not mutate a previously published snapshot')
  assert.equal(previous.stats.attempts,30)
  assert.deepEqual(previous,nesting.nestParts(parts,{...options,attempts:30}))
})

test('automatic rotations and batch count share export validation and preserve presentation-only changes', async () => {
  const c={...defaults,length:800,width:500,height:100,ribs:false,dogBones:false,nestingCopies:2}
  const parts=settings.nestingParts(c)
  const rotations=settings.nestingOptions(c).rotations
  assert.equal(rotations.length,24)
  assert.deepEqual(new Set(rotations),new Set(Array.from({length:24},(_,i)=>i*15)))
  assert.deepEqual(settings.nestingOptions({...c,nestingRotations:'fixed'}).rotations,rotations)
  const result=nesting.nestParts(parts,{...settings.nestingOptions(c),attempts:12})
  assert.equal(result.placements.length,10)
  assert.equal(dxf.validateNestedExport(c,result),true)
  assert.equal(dxf.validateNestedExport({...c,nestingCopies:1},result),false)
  assert.equal(dxf.validateNestedExport({...c,sheetPartGap:100},result),false)
  const visual={...c,units:'inch',showDimensions:false,renderHoles:false,highlighting:false,exploded:42}
  assert.equal(settings.nestingKey(c),settings.nestingKey(visual))
  assert.equal(dxf.validateNestedExport(visual,result),true)
  const zip=dxf.nestedArchive(c,result)
  const manifest=JSON.parse(await zip.file('layout.json').async('string'))
  const project=JSON.parse(await zip.file('project.json').async('string'))
  assert.equal(manifest.tableCopies,2)
  assert.equal(manifest.placements.length,10)
  assert.deepEqual(manifest.allowedRotations,rotations)
  assert.equal(project.nestingCopies,2)
  assert.equal('nestingRotations' in project,false)
  assert.equal(manifest.globalOptimalityProven,false)
  assert.equal(Object.keys(zip.files).filter(name=>name.endsWith('.dxf')).length,result.sheets.length)
})

test('automatic sheet layout tries diagonal angles without a user rotation setting', () => {
  const part=rect('top',150,10)
  const config={...defaults,sheetLength:120,sheetWidth:120,sheetEdgeGap:1,sheetPartGap:2}
  const result=nesting.nestParts([part],{...settings.nestingOptions(config),attempts:1,maxSheets:1})
  assert.equal(result.unplaced.length,0)
  assert.equal(result.validation.valid,true)
  assert.ok(result.placements[0].rotation%90!==0)
})

test('automatic refinement preserves the better quarter-turn baseline', () => {
  const config={...defaults,sheetLength:220,sheetWidth:120,sheetEdgeGap:1,sheetPartGap:2}
  const options={...settings.nestingOptions(config),attempts:49,maxSheets:2}
  const snapshots=[...nesting.searchNesting([rect('a',120,40),rect('b',70,30)],options)]
  assert.equal(snapshots.length,49)
  assert.equal(snapshots[48].stats.attempts,49)
  assert.ok(nesting.compareNesting(snapshots[48],snapshots[47])<=0)
  assert.equal(snapshots[48].validation.valid,true)
})

test('invalid geometry, sheet settings and work limits fail closed', () => {
  const selfCross=polygon('top',[[0,0],[100,100],[0,100],[100,0]])
  assert.equal(nesting.nestParts([selfCross],options).unplaced.length,1)
  for (const change of [{rotations:[]},{rotations:[NaN]},{rotations:[10]},{partClearance:-1},{attempts:Infinity},{sheet:{width:NaN,height:100}}]) {
    assert.equal(nesting.nestParts([rect('top',20,20)],{...options,...change}).validation.valid,false)
  }
  assert.equal(nesting.nestParts([rect('top',20,20,257)],options).validation.valid,false)
  assert.equal(nesting.nestParts([rect('top',20,20,-1)],options).validation.valid,false)
})
