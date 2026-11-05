import JSZip from 'jszip'
import { engravingLines, layoutParts, makeParts, outline, type Part, type Point, type Slot } from './geometry'
import type { Config } from './model'

const group = (code: number, value: string | number) => `${code}\n${value}\n`
const line = (from: Point, to: Point, layer = 'OUTLINE') =>
  `0\nLINE\n8\n${layer}\n10\n${from.x}\n20\n${from.y}\n11\n${to.x}\n21\n${to.y}\n`
const circle = (x: number, y: number, radius: number) =>
  `0\nCIRCLE\n8\nHOLES\n10\n${x}\n20\n${y}\n40\n${radius}\n`
const arc = (x: number, y: number, radius: number, start: number, end: number, layer = 'HOLES') =>
  `0\nARC\n8\n${layer}\n10\n${x}\n20\n${y}\n40\n${radius}\n50\n${start}\n51\n${end}\n`
const text = (value: string, x: number, y: number, height: number) =>
  `0\nTEXT\n8\nENGRAVE\n10\n${x}\n20\n${y}\n40\n${height}\n1\n${value}\n72\n1\n73\n2\n11\n${x}\n21\n${y}\n`

const header = () => `0\nSECTION\n2\nHEADER\n${group(9, '$ACADVER')}${group(1, 'AC1009')}${group(9, '$INSUNITS')}${group(70, 4)}${group(9, '$MEASUREMENT')}${group(70, 1)}0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n4\n${['0', 'OUTLINE', 'ENGRAVE', 'HOLES'].map(name => `0\nLAYER\n2\n${name}\n70\n0\n62\n7\n6\nCONTINUOUS\n`).join('')}0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`
const footer = '0\nENDSEC\n0\nEOF\n'
const shifted = (point: Point, offset: Point): Point => ({ x: point.x + offset.x, y: point.y + offset.y })

const slotEntities = (slot: Slot, c: Config, offset: Point) => {
  const x1 = slot.x - slot.width / 2 + offset.x
  const x2 = slot.x + slot.width / 2 + offset.x
  const y1 = slot.y - slot.height / 2 + offset.y
  const y2 = slot.y + slot.height / 2 + offset.y
  let result = line({ x: x1, y: y1 }, { x: x2, y: y1 }, 'HOLES')
    + line({ x: x2, y: y1 }, { x: x2, y: y2 }, 'HOLES')
    + line({ x: x2, y: y2 }, { x: x1, y: y2 }, 'HOLES')
    + line({ x: x1, y: y2 }, { x: x1, y: y1 }, 'HOLES')
  if (c.dogBones) {
    const radius = c.dogBoneDiameter / 2
    result += arc(x1, y1, radius, 180, 270)
    result += arc(x2, y1, radius, 270, 360)
    result += arc(x2, y2, radius, 0, 90)
    result += arc(x1, y2, radius, 90, 180)
  }
  return result
}

const partEntities = (part: Part, c: Config, offset: Point = { x: 0, y: 0 }) => {
  const contour = outline(part, c).map(point => shifted(point, offset))
  let result = contour.map((point, index) => line(point, contour[(index + 1) % contour.length])).join('')
  result += part.holes.map(hole => circle(hole.x + offset.x, hole.y + offset.y, hole.d / 2)).join('')
  result += part.slots.map(slot => slotEntities(slot, c, offset)).join('')
  result += engravingLines(part, c)
    .map(mark => line(shifted(mark.from, offset), shifted(mark.to, offset), 'ENGRAVE'))
    .join('')
  if (c.nameMarking) result += text(part.label, offset.x, offset.y, Math.max(12, Math.min(30, part.height / 6)))
  return result
}

export const dxfForPart = (part: Part, c: Config) => header() + partEntities(part, c) + footer
export const fullDxf = (c: Config) => {
  const layout = layoutParts(c)
  return header()
    + layout.instances.map(item => partEntities(item.part, c, item.position)).join('')
    + footer
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
  download(
    await zip.generateAsync({ type: 'blob' }),
    `WeldingTable_Parts_${c.length}x${c.width}.zip`,
  )
}
