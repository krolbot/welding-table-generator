import JSZip from 'jszip'
import { contourPoints, engravingLines, layoutParts, makeParts, type Contour, type Part, type Point } from './geometry'
import type { Config } from './model'

const group = (code: number, value: string | number) => `${code}\n${value}\n`
const line = (from: Point, to: Point, layer = 'OUTLINE') =>
  `0\nLINE\n8\n${layer}\n10\n${from.x.toFixed(3)}\n20\n${from.y.toFixed(3)}\n11\n${to.x.toFixed(3)}\n21\n${to.y.toFixed(3)}\n`
const circle = (center: Point, radius: number) =>
  `0\nCIRCLE\n8\nHOLES\n10\n${center.x.toFixed(3)}\n20\n${center.y.toFixed(3)}\n40\n${radius.toFixed(3)}\n`
const arc = (center: Point, radius: number, start: number, end: number, layer = 'OUTLINE') =>
  `0\nARC\n8\n${layer}\n10\n${center.x.toFixed(3)}\n20\n${center.y.toFixed(3)}\n40\n${radius.toFixed(3)}\n50\n${start.toFixed(3)}\n51\n${end.toFixed(3)}\n`
const shifted = (value: Point, offset: Point): Point => point(value.x + offset.x, value.y + offset.y)
const point = (x: number, y: number): Point => ({ x, y })

const boundsFor = (parts: Array<{ part: Part; offset: Point }>) => {
  const values = parts.flatMap(({ part, offset }) => part.contours.flatMap(contour => contourPoints(contour, 72).map(value => shifted(value, offset))))
  const xs = values.map(value => value.x)
  const ys = values.map(value => value.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

const header = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) =>
  `0\nSECTION\n2\nHEADER\n${group(9, '$ACADVER')}${group(1, 'AC1009')}${group(9, '$INSUNITS')}${group(70, 4)}${group(9, '$MEASUREMENT')}${group(70, 1)}${group(9, '$EXTMIN')}${group(10, bounds.minX.toFixed(3))}${group(20, bounds.minY.toFixed(3))}${group(30, '0.0')}${group(9, '$EXTMAX')}${group(10, bounds.maxX.toFixed(3))}${group(20, bounds.maxY.toFixed(3))}${group(30, '0.0')}0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n4\n${[
    ['0', 7], ['OUTLINE', 7], ['ENGRAVE', 3], ['HOLES', 1],
  ].map(([name, color]) => `0\nLAYER\n2\n${name}\n70\n0\n62\n${color}\n6\nCONTINUOUS\n`).join('')}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
const footer = '0\nENDSEC\n0\nEOF\n'

const contourEntities = (contour: Contour, offset: Point) => contour.map(segment => segment.type === 'line'
  ? line(shifted(segment.from, offset), shifted(segment.to, offset))
  : arc(shifted(segment.center, offset), segment.radius, ((segment.clockwise ? segment.end : segment.start) % 360 + 360) % 360, ((segment.clockwise ? segment.start : segment.end) % 360 + 360) % 360),
).join('')

const partEntities = (part: Part, c: Config, offset: Point = point(0, 0)) => {
  let result = part.contours.map(contour => contourEntities(contour, offset)).join('')
  result += part.holes.map(hole => circle(shifted(hole, offset), hole.d / 2)).join('')
  result += engravingLines(part, c)
    .map(mark => line(shifted(mark.from, offset), shifted(mark.to, offset), 'ENGRAVE'))
    .join('')
  return result
}

export const dxfForPart = (part: Part, c: Config) => {
  const offset = point(0, 0)
  return header(boundsFor([{ part, offset }])) + partEntities(part, c, offset) + footer
}

export const fullDxf = (c: Config) => {
  const layout = layoutParts(c)
  const parts = layout.instances.map(item => ({ part: item.part, offset: item.position }))
  return header(boundsFor(parts)) + parts.map(item => partEntities(item.part, c, item.offset)).join('') + footer
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

export const downloadFull = (c: Config) =>
  download(new Blob([fullDxf(c)], { type: 'application/dxf' }), `WeldingTable_Assembly_${c.length}x${c.width}.dxf`)

export const downloadZip = async (c: Config) => {
  const zip = new JSZip()
  makeParts(c).forEach((part, index) => {
    zip.file(`${index + 1}_${part.label.replaceAll(' ', '_')}_${part.count}pcs.dxf`, dxfForPart(part, c))
  })
  zip.file(`0_Layout_All_${c.length}x${c.width}.dxf`, fullDxf(c))
  download(await zip.generateAsync({ type: 'blob' }), `WeldingTable_Parts_${c.length}x${c.width}.zip`)
}
