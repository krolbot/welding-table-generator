import JSZip from 'jszip'
import { assertFabricationReady, fabricationError, contourPoints, engravingLines, layoutParts, makeParts, type Contour, type FabricationPart, type Part, type Point } from './geometry'
import { projectConfig, type Config } from './model'
import { nestingOptions, nestingParts } from './nestingSettings'
import { nativeContourBounds } from './nestingNative'
import { transformNestingPoint, transformNestingContour, validateNesting, type NestingPlacement, type NestingResult } from './nesting'

const group = (code: number, value: string | number) => `${code}\n${value}\n`
const line = (from: Point, to: Point, layer = 'OUTLINE') =>
  `0\nLINE\n8\n${layer}\n10\n${from.x.toFixed(3)}\n20\n${from.y.toFixed(3)}\n11\n${to.x.toFixed(3)}\n21\n${to.y.toFixed(3)}\n`
const circle = (center: Point, radius: number) =>
  `0\nCIRCLE\n8\nHOLES\n10\n${center.x.toFixed(3)}\n20\n${center.y.toFixed(3)}\n40\n${radius.toFixed(3)}\n`
const arc = (center: Point, radius: number, start: number, end: number, layer = 'OUTLINE') =>
  `0\nARC\n8\n${layer}\n10\n${center.x.toFixed(3)}\n20\n${center.y.toFixed(3)}\n40\n${radius.toFixed(3)}\n50\n${start.toFixed(3)}\n51\n${end.toFixed(3)}\n`
const shifted = (value: Point, offset: Point): Point => point(value.x + offset.x, value.y + offset.y)
const point = (x: number, y: number): Point => ({ x, y })

const boundsFor = (parts: Array<{ part: FabricationPart; offset: Point }>) => {
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

const nativePartEntities = (part: FabricationPart, offset: Point = point(0, 0)) =>
  part.contours.map(contour => contourEntities(contour, offset)).join('')
  + part.holes.map(hole => circle(shifted(hole, offset), hole.d / 2)).join('')

export const nativeDxfForPart = (part: FabricationPart) => {
  if (!part.contours.length) throw new Error('Cannot export a part without a contour')
  const offset = point(0, 0)
  return header(boundsFor([{ part, offset }])) + nativePartEntities(part, offset) + footer
}

export const nativeDxfForNestedSheet = (placements: readonly NestingPlacement[]) => {
  if (!placements.length) throw new Error('Cannot export an empty sheet')
  const boxes = placements.map(value => nativeContourBounds(transformNestingContour(value.part.contours[0], value)))
  const bounds = { minX: Math.min(...boxes.map(value => value.minX)), minY: Math.min(...boxes.map(value => value.minY)), maxX: Math.max(...boxes.map(value => value.maxX)), maxY: Math.max(...boxes.map(value => value.maxY)) }
  const entities = placements.map(placement => {
    const transform = (value: Point) => transformNestingPoint(value, placement)
    const normalize = (angle: number) => ((angle + placement.rotation) % 360 + 360) % 360
    return placement.part.contours.map(contour => contour.map(segment => segment.type === 'line'
      ? line(transform(segment.from), transform(segment.to))
      : arc(transform(segment.center), segment.radius, normalize(segment.clockwise ? segment.end : segment.start), normalize(segment.clockwise ? segment.start : segment.end)),
    ).join('')).join('') + placement.part.holes.map(hole => circle(transform(hole), hole.d / 2)).join('')
  }).join('')
  return header(bounds) + entities + footer
}

export const dxfForPart = (part: Part, c: Config) => {
  assertFabricationReady(c)
  const offset = point(0, 0)
  return header(boundsFor([{ part, offset }])) + partEntities(part, c, offset) + footer
}

export const fullDxf = (c: Config) => {
  assertFabricationReady(c)
  const layout = layoutParts(c)
  const parts = layout.instances.map(item => ({ part: item.part, offset: item.position }))
  return header(boundsFor(parts)) + parts.map(item => partEntities(item.part, c, item.offset)).join('') + footer
}

export const dxfForNestedSheet = (c: Config, placements: readonly NestingPlacement[]) => {
  assertFabricationReady(c)
  if (!placements.length) throw new Error('Cannot export an empty sheet')
  const sourceParts = nestingParts(c)
  const boxes = placements.map(p => nativeContourBounds(transformNestingContour(p.part.contours[0], p)))
  const bounds = { minX: Math.min(...boxes.map(b => b.minX)), minY: Math.min(...boxes.map(b => b.minY)), maxX: Math.max(...boxes.map(b => b.maxX)), maxY: Math.max(...boxes.map(b => b.maxY)) }
  const entities = placements.map(placement => {
    const transform = (value: Point) => transformNestingPoint(value, placement)
    const normalize = (angle: number) => ((angle + placement.rotation) % 360 + 360) % 360
    let result = placement.part.contours.map(contour => contour.map(segment => segment.type === 'line'
      ? line(transform(segment.from), transform(segment.to))
      : arc(transform(segment.center), segment.radius, normalize(segment.clockwise ? segment.end : segment.start), normalize(segment.clockwise ? segment.start : segment.end)),
    ).join('')).join('')
    result += placement.part.holes.map(hole => circle(transform(hole), hole.d / 2)).join('')
    const sourcePart = sourceParts.find(part => part.name === placement.part.name)
    if (!sourcePart) throw new Error(`Stale nesting part: ${placement.part.name}`)
    result += engravingLines(sourcePart, c).map(mark => line(transform(mark.from), transform(mark.to), 'ENGRAVE')).join('')
    return result
  }).join('')
  return header(bounds) + entities + footer
}

export const validateNestedExport = (c: Config, result: NestingResult) => {
  if (fabricationError(c)) return false
  const parts = nestingParts(c)
  const keys = new Set<string>()
  const options = nestingOptions(c)
  if (result.unplaced.length || result.placements.length !== parts.reduce((sum, part) => sum + part.count, 0)) return false
  for (const placement of result.placements) {
    const part = parts.find(candidate => candidate.name === placement.part.name)
    const key = `${placement.part.name}:${placement.instance}`
    if (!part || JSON.stringify(placement.part) !== JSON.stringify(part) || !Number.isInteger(placement.instance) || placement.instance < 0 || placement.instance >= part.count || keys.has(key)) return false
    keys.add(key)
  }
  const sheets = [...new Set(result.placements.map(p => p.sheet))].sort((a, b) => a - b)
  if (sheets.some((index, i) => index !== i)) return false
  return result.validation.valid && result.placements.length > 0 && validateNesting(result.placements, options).valid
}

export const nestedArchive = (c: Config, result: NestingResult) => {
  if (!validateNestedExport(c, result)) throw new Error('The sheet layout is incomplete, stale or invalid')
  const zip = new JSZip()
  const sheetIndexes = [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b)
  sheetIndexes.forEach(index => zip.file(`Sheet_${index + 1}.dxf`, dxfForNestedSheet(c, result.placements.filter(placement => placement.sheet === index))))
  zip.file('README.txt', `Sheet size: ${c.sheetLength} x ${c.sheetWidth} mm\nMinimum edge gap: ${c.sheetEdgeGap} mm\nMinimum part gap: ${c.sheetPartGap} mm\nSheet count: ${sheetIndexes.length}\nAll parts placed: ${result.placements.length}\nCoordinates are nominal geometry. Kerf, lead-ins, clamps and cutting order require CAM verification.\n`)
  zip.file('project.json', JSON.stringify(projectConfig(c), null, 2))
  zip.file('layout.json', JSON.stringify({
    schemaVersion: 1, engine: 'contour-nfp-v2', units: 'mm', tableCopies: c.nestingCopies,
    sheet: { length: c.sheetLength, width: c.sheetWidth, thickness: c.thickness },
    clearance: { edge: c.sheetEdgeGap, part: c.sheetPartGap, serializationReserve: 0.002 },
    allowedRotations: nestingOptions(c).rotations,
    search: result.stats, metrics: result.metrics, outlineArea: result.outlineArea,
    parts: nestingParts(c),
    placements: result.placements.map(p => ({ part: p.part.name, instance: p.instance, sheet: p.sheet, rotation: p.rotation, translation: p.translation })),
    coordinateConvention: 'Millimetres, sheet lower-left origin, counterclockwise rotation about part origin followed by translation',
    holesNestable: false, nominalContours: true, globalOptimalityProven: false,
  }, null, 2))
  return zip
}

export const downloadNestedZip = async (c: Config, result: NestingResult) => {
  const zip = nestedArchive(c, result)
  download(await zip.generateAsync({ type: 'blob' }), `WeldingTable_Sheets_${c.length}x${c.width}.zip`)
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
  assertFabricationReady(c)
  const zip = new JSZip()
  makeParts(c).forEach((part, index) => {
    zip.file(`${index + 1}_${part.label.replaceAll(' ', '_')}_${part.count}pcs.dxf`, dxfForPart(part, c))
  })
  zip.file(`0_Layout_All_${c.length}x${c.width}.dxf`, fullDxf(c))
  download(await zip.generateAsync({ type: 'blob' }), `WeldingTable_Parts_${c.length}x${c.width}.zip`)
}
