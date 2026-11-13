import type { Contour, FabricationPart, Hole, Point } from '../geometry'

export type ExtensionConfig = { length: number; width: number; height: number; thickness: number }
export const extensionDefaults: ExtensionConfig = { length: 500, width: 200, height: 200, thickness: 6 }

export type ExtensionPartName = 'top' | 'longSide' | 'nearEnd' | 'farEnd' | 'crossRib'
type ExtensionPart = FabricationPart<ExtensionPartName>
type Vector3 = [number, number, number]
export type ExtensionPlacement = { part: ExtensionPartName; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }

const holeDiameter = 16
const pitch = 50
const web = 8
const point = (x: number, y: number): Point => ({ x, y })
const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6
const arcPoint = (center: Point, radius: number, degrees: number): Point => {
  const radians = degrees * Math.PI / 180
  return point(center.x + radius * Math.cos(radians), center.y + radius * Math.sin(radians))
}
const rectangle = (width: number, height: number): Contour => [
  { type: 'line', from: point(0, 0), to: point(width, 0) },
  { type: 'line', from: point(width, 0), to: point(width, height) },
  { type: 'line', from: point(width, height), to: point(0, height) },
  { type: 'line', from: point(0, height), to: point(0, 0) },
]
const endpoint = (segment: Contour[number], end: 'from' | 'to') => segment.type === 'line'
  ? segment[end]
  : arcPoint(segment.center, segment.radius, end === 'from' ? segment.start : segment.end)
const bounds = (contour: Contour) => {
  const points = contour.flatMap(segment => segment.type === 'line' ? [segment.from, segment.to] : [
    endpoint(segment, 'from'), endpoint(segment, 'to'),
    ...[0, 90, 180, 270].filter(angle => {
      const span = segment.clockwise
        ? (segment.start - segment.end + 360) % 360
        : (segment.end - segment.start + 360) % 360
      const travel = segment.clockwise
        ? (segment.start - angle + 360) % 360
        : (angle - segment.start + 360) % 360
      return travel <= (span || 360)
    }).map(angle => arcPoint(segment.center, segment.radius, angle)),
  ])
  return { minX: Math.min(...points.map(value => value.x)), minY: Math.min(...points.map(value => value.y)), maxX: Math.max(...points.map(value => value.x)), maxY: Math.max(...points.map(value => value.y)) }
}
const pointSegmentDistance = (value: Point, from: Point, to: Point) => {
  const dx = to.x - from.x, dy = to.y - from.y
  const squared = dx * dx + dy * dy
  const factor = squared ? Math.max(0, Math.min(1, ((value.x - from.x) * dx + (value.y - from.y) * dy) / squared)) : 0
  return Math.hypot(value.x - from.x - factor * dx, value.y - from.y - factor * dy)
}
const pointContourDistance = (value: Point, contour: Contour) => Math.min(...contour.map(segment => segment.type === 'line'
  ? pointSegmentDistance(value, segment.from, segment.to)
  : Math.abs(Math.hypot(value.x - segment.center.x, value.y - segment.center.y) - segment.radius),
))
// shortcut: cut bounds conservatively exclude extra holes for nonrectangular cuts; upgrade to point-in-contour if that matters.
const insideCutBounds = (value: Point, contour: Contour) => {
  const cut = bounds(contour)
  return value.x >= cut.minX && value.x <= cut.maxX && value.y >= cut.minY && value.y <= cut.maxY
}
const grid = (width: number, height: number, excluded: Contour[] = [], startX = pitch / 2): Hole[] => {
  const holes: Hole[] = []
  for (let x = startX; x <= width - web - holeDiameter / 2 + 1e-6; x += pitch) for (let y = pitch / 2; y <= height - web - holeDiameter / 2 + 1e-6; y += pitch) {
    const candidate = point(x, y)
    const clearsEdge = x - holeDiameter / 2 >= web && y - holeDiameter / 2 >= web
      && x + holeDiameter / 2 <= width - web && y + holeDiameter / 2 <= height - web
    if (clearsEdge && excluded.every(contour => !insideCutBounds(candidate, contour) && pointContourDistance(candidate, contour) >= holeDiameter / 2 + web)) holes.push({ id: `D16-${x}-${y}`, x, y, d: holeDiameter, kind: 'grid' })
  }
  return holes
}

const radialSlot = (width: number): Contour => {
  const center = point(width / 2, 30)
  const outerRadius = 48
  const innerRadius = 32
  const start = 20
  const end = 160
  const outerStart = arcPoint(center, outerRadius, start)
  const outerEnd = arcPoint(center, outerRadius, end)
  const innerEnd = arcPoint(center, innerRadius, end)
  const innerStart = arcPoint(center, innerRadius, start)
  return [
    { type: 'arc', center, radius: outerRadius, start, end },
    { type: 'line', from: outerEnd, to: innerEnd },
    { type: 'arc', center, radius: innerRadius, start: end, end: start, clockwise: true },
    { type: 'line', from: innerStart, to: outerStart },
  ]
}

const assertConfig = (config: ExtensionConfig) => {
  for (const [name, value] of Object.entries(config)) if (!Number.isFinite(value)) throw new Error(`Extension ${name} must be finite`)
  if (config.length < 400 || config.length > 800) throw new Error('Extension length must be 400–800 mm')
  if (config.width < 200 || config.width > 400) throw new Error('Extension width must be 200–400 mm')
  if (config.height < 150 || config.height > 300) throw new Error('Extension height must be 150–300 mm')
  if (config.thickness < 4 || config.thickness > 10) throw new Error('Extension thickness must be 4–10 mm')
  if (config.width - 2 * config.thickness < 2 * (48 + web) || config.height - config.thickness < 80 + 2 * web) throw new Error('Extension end faces cannot retain required slot webs')
}

const validatePart = (part: ExtensionPart) => {
  if (!Number.isFinite(part.width) || !Number.isFinite(part.height) || part.width <= 0 || part.height <= 0 || part.count <= 0) throw new Error(`Invalid ${part.name} dimensions`)
  const outer = part.contours[0]
  if (!outer || outer.length < 3 || !outer.every((segment, index) => close(endpoint(segment, 'to'), endpoint(outer[(index + 1) % outer.length], 'from')))) throw new Error(`Invalid ${part.name} outer contour topology`)
  for (const contour of part.contours.slice(1)) {
    if (contour.length < 3 || !contour.every((segment, index) => close(endpoint(segment, 'to'), endpoint(contour[(index + 1) % contour.length], 'from')))) throw new Error(`Invalid ${part.name} cut contour topology`)
    const cut = bounds(contour)
    if (cut.minX < web || cut.minY < web || cut.maxX > part.width - web || cut.maxY > part.height - web) throw new Error(`${part.name} cut violates edge web`)
  }
  for (const hole of part.holes) {
    if (!Number.isFinite(hole.x) || !Number.isFinite(hole.y) || hole.d <= 0 || hole.x - hole.d / 2 < web || hole.y - hole.d / 2 < web || hole.x + hole.d / 2 > part.width - web || hole.y + hole.d / 2 > part.height - web) throw new Error(`${part.name} hole violates edge web`)
    if (part.contours.slice(1).some(contour => insideCutBounds(hole, contour) || pointContourDistance(hole, contour) < hole.d / 2 + web)) throw new Error(`${part.name} hole violates cut web`)
  }
}

/** Independently engineered butt-welded analogue; all dimensions are nominal mm, not vendor-confirmed. */
export const extensionParts = (config: ExtensionConfig = extensionDefaults): FabricationPart<'top' | 'longSide' | 'nearEnd' | 'farEnd' | 'crossRib'>[] => {
  assertConfig(config)
  const { length, width, height, thickness } = config
  const insideWidth = width - 2 * thickness
  const wallHeight = height - thickness
  const accessWindow = rectangle(60, 60).map(segment => segment.type === 'line'
    ? { ...segment, from: point(segment.from.x + length / 2 - 30, segment.from.y + wallHeight / 2 - 30), to: point(segment.to.x + length / 2 - 30, segment.to.y + wallHeight / 2 - 30) }
    : segment)
  const parts: ExtensionPart[] = [
    { name: 'top', label: 'Top — assumed 50 mm D16 grid', width: length, height: width, thickness, count: 1, holes: grid(length, width), slots: [], contours: [rectangle(length, width)] },
    { name: 'longSide', label: 'Long sides — assumed access window and D16 grid', width: length, height: wallHeight, thickness, count: 2, holes: grid(length, wallHeight, [accessWindow]), slots: [], contours: [rectangle(length, wallHeight), accessWindow] },
    { name: 'nearEnd', label: 'Near end — assumed D16/50 table-clamp interface', width: insideWidth, height: wallHeight, thickness, count: 1, holes: grid(insideWidth, wallHeight, [], pitch / 2 - thickness), slots: [], contours: [rectangle(insideWidth, wallHeight)] },
    { name: 'farEnd', label: 'Far end — assumed curved radial slot', width: insideWidth, height: wallHeight, thickness, count: 1, holes: [], slots: [], contours: [rectangle(insideWidth, wallHeight), radialSlot(insideWidth)] },
    { name: 'crossRib', label: 'Cross ribs — assumed L/3 and 2L/3 butt-weld positions', width: insideWidth, height: wallHeight, thickness, count: 2, holes: [], slots: [], contours: [rectangle(insideWidth, wallHeight)] },
  ]
  parts.forEach(validatePart)
  return parts
}

/** Part-local XY maps onto assembly axes; origin lies on the thickness midplane. */
export const extensionAssembly = (config: ExtensionConfig = extensionDefaults): ExtensionPlacement[] => {
  extensionParts(config)
  const { length, width, height, thickness } = config
  const top: ExtensionPlacement['axes'] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const side: ExtensionPlacement['axes'] = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
  const end: ExtensionPlacement['axes'] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
  return [
    { part: 'top', instance: 0, origin: [0, 0, height - thickness / 2], axes: top },
    { part: 'longSide', instance: 0, origin: [0, thickness / 2, 0], axes: side },
    { part: 'longSide', instance: 1, origin: [0, width - thickness / 2, 0], axes: side },
    { part: 'nearEnd', instance: 0, origin: [thickness / 2, thickness, 0], axes: end },
    { part: 'farEnd', instance: 0, origin: [length - thickness / 2, thickness, 0], axes: end },
    { part: 'crossRib', instance: 0, origin: [length / 3, thickness, 0], axes: end },
    { part: 'crossRib', instance: 1, origin: [length * 2 / 3, thickness, 0], axes: end },
  ]
}
