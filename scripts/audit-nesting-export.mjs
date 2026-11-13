import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
const JSZip=require('jszip')
const DxfParser=require('dxf-parser')
const clip=require('polygon-clipping')
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),appType:'custom',logLevel:'silent',server:{middlewareMode:true}})
const source=process.argv[2]
if (!source) { await server.close(); throw new Error('Usage: npm run audit:nesting -- path/to/SheetArchive.zip') }
try {
 const {parseTableProject}=await server.ssrLoadModule('/src/tableProject.ts')
 const {engravingLines}=await server.ssrLoadModule('/src/geometry.ts')
 const {nestingParts}=await server.ssrLoadModule('/src/nestingSettings.ts')
 const {nativeContourBounds,nativeContourDistance}=await server.ssrLoadModule('/src/contourGeometry.ts')
 const zip=await JSZip.loadAsync(fs.readFileSync(source))
 const manifest=JSON.parse(await zip.file('layout.json').async('string'))
 const decoded=parseTableProject(await zip.file('project.json').async('string'))
 assert.equal(decoded.kind,'current','audit requires a current grid revision; legacy files must not be silently regenerated')
 const config=decoded.config
 assert.deepEqual(manifest.parts,nestingParts(config),'manifest must match the actual canonical project')
 assert.equal(manifest.schemaVersion,1)
 assert.equal(manifest.placements.length,manifest.parts.reduce((sum,p)=>sum+p.count,0))
 assert.ok(manifest.placements.length>0)
 const parts=new Map(manifest.parts.map(p=>[p.name,p]))
 const identities=new Set()
 for(const placement of manifest.placements){
  const part=parts.get(placement.part),identity=`${placement.part}:${placement.instance}`
  assert.ok(part && Number.isInteger(placement.instance) && placement.instance>=0 && placement.instance<part.count)
  assert.equal(identities.has(identity),false); identities.add(identity)
  assert.ok(Number.isInteger(placement.sheet) && placement.sheet>=0 && placement.sheet<32)
  assert.ok(manifest.allowedRotations.includes(placement.rotation))
 }
 assert.equal(Object.keys(zip.files).filter(n=>n.endsWith('.dxf')).length,new Set(manifest.placements.map(p=>p.sheet)).size)
 const near=(a,b)=>assert.ok(Math.abs(a-b)<0.000501,`${a} != ${b}`)
 const normalize=a=>(a%360+360)%360
 const reports=[]
 for(const name of Object.keys(zip.files).filter(n=>n.endsWith('.dxf'))){
  const index=Number(name.match(/Sheet_(\d+)/)[1])-1
  const placements=manifest.placements.filter(p=>p.sheet===index)
  const parsed=new DxfParser().parseSync(await zip.file(name).async('string'))
  assert.equal(parsed.header.$INSUNITS,4)
  const polygons=[],nativeContours=[]; let cursor=0,errorBound=0
  const read=(type,layer)=>{const e=parsed.entities[cursor++];assert.equal(e.type,type);assert.equal(e.layer,layer);return e}
  for(const p of placements){
   const part=parts.get(p.part), angle=p.rotation*Math.PI/180
   const transform=v=>({x:v.x*Math.cos(angle)-v.y*Math.sin(angle)+p.translation.x,y:v.x*Math.sin(angle)+v.y*Math.cos(angle)+p.translation.y})
   for(let ci=0;ci<part.contours.length;ci++){
    const points=[],native=[]
    for(const s of part.contours[ci]){
     if(s.type==='line'){
      const e=read('LINE','OUTLINE'),a=transform(s.from),b=transform(s.to)
      near(e.vertices[0].x,a.x);near(e.vertices[0].y,a.y);near(e.vertices[1].x,b.x);near(e.vertices[1].y,b.y)
      native.push({type:'line',from:e.vertices[0],to:e.vertices[1]}); points.push([e.vertices[0].x,e.vertices[0].y])
     }else{
      const e=read('ARC','OUTLINE'),c=transform(s.center)
      near(e.center.x,c.x);near(e.center.y,c.y);near(e.radius,s.radius)
      near(e.startAngle*180/Math.PI,normalize((s.clockwise?s.end:s.start)+p.rotation))
      near(e.endAngle*180/Math.PI,normalize((s.clockwise?s.start:s.end)+p.rotation))
      let start=s.clockwise?e.endAngle:e.startAngle,end=s.clockwise?e.startAngle:e.endAngle
      let sweep=s.clockwise?-((start-end+2*Math.PI)%(2*Math.PI)||2*Math.PI):((end-start+2*Math.PI)%(2*Math.PI)||2*Math.PI)
      native.push({type:'arc',center:e.center,radius:e.radius,start:start*180/Math.PI,end:end*180/Math.PI,clockwise:s.clockwise})
      const n=Math.ceil(Math.abs(sweep)/(Math.PI/180))
      errorBound=Math.max(errorBound,e.radius*(1-Math.cos(Math.abs(sweep)/n/2)))
      for(let i=0;i<n;i++){const a=start+sweep*i/n;points.push([e.center.x+e.radius*Math.cos(a),e.center.y+e.radius*Math.sin(a)])}
     }
    }
    if(ci===0){points.push(points[0]);polygons.push(points);nativeContours.push(native)}
   }
   for(const h of part.holes){const e=read('CIRCLE','HOLES'),p=transform(h);near(e.center.x,p.x);near(e.center.y,p.y);near(e.radius,h.d/2)}
   for(const s of engravingLines(part,config)){const e=read('LINE','ENGRAVE'),a=transform(s.from),b=transform(s.to);near(e.vertices[0].x,a.x);near(e.vertices[0].y,a.y);near(e.vertices[1].x,b.x);near(e.vertices[1].y,b.y)}
  }
  assert.equal(cursor,parsed.entities.length)
  let intersections=0,minGap=Infinity,minEdge=Infinity
  for(let i=0;i<polygons.length;i++){
   const b=nativeContourBounds(nativeContours[i]);minEdge=Math.min(minEdge,b.minX,b.minY,manifest.sheet.length-b.maxX,manifest.sheet.width-b.maxY)
   for(let j=0;j<i;j++){
    if(clip.intersection([[polygons[i]]],[[polygons[j]]]).length)intersections++
    minGap=Math.min(minGap,nativeContourDistance(nativeContours[i],nativeContours[j]))
   }
  }
  assert.equal(intersections,0)
  assert.ok(minGap>=manifest.clearance.part-1e-7)
  assert.ok(minEdge>=manifest.clearance.edge-1e-7)
  reports.push({name,parts:placements.length,types:parsed.entities.reduce((x,e)=>(x[e.type]=(x[e.type]||0)+1,x),{}),intersections,minGap,minEdge,polygonChordError:errorBound,matchedEntities:cursor})
 }
 assert.equal(reports.reduce((s,r)=>s+r.parts,0),manifest.placements.length)
 const report={source,engine:manifest.engine,attempts:manifest.search.attempts,tableCopies:manifest.tableCopies,reports}
 console.log(JSON.stringify(report,null,2))
}finally{await server.close()}
