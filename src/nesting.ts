import type { Contour, Part, Point } from './geometry'

export type Rotation = 0 | 90 | 180 | 270
export type NestingOptions = {
  sheet: { width: number; height: number }
  edgeClearance?: number
  partClearance?: number
  rotations?: readonly Rotation[]
  maxSheets?: number
  /** Bounded deterministic search, performed in a worker by the UI. */
  attempts?: number
  /** Maximum chord sagitta in mm used only for placement; validation re-tessellates more finely. */
  arcTolerance?: number
}

export type NestingPlacement = {
  part: Part
  instance: number
  sheet: number
  rotation: Rotation
  /** Rigid translation in source-part coordinates; source contours are never rewritten. */
  translation: Point
}

export type UnplacedPart = { part: Part; instance: number; reason: 'invalid-geometry' | 'no-sheet-space' }
export type NestingSheet = { index: number; placements: NestingPlacement[] }
export type NestingViolation = { sheet: number; message: string }
export type NestingValidation = { valid: boolean; violations: NestingViolation[] }
export type NestingResult = {
  sheets: NestingSheet[]
  placements: NestingPlacement[]
  unplaced: UnplacedPart[]
  validation: NestingValidation
  /** Approximate sum of outside silhouettes, without subtracting internal cuts. */
  outlineArea: number
}

type Box = { minX: number; minY: number; maxX: number; maxY: number }
type Polygon = { points: Point[]; error: number; box: Box }
type Shape = { polygon: Polygon; rotation: Rotation }

const epsilon = 1e-7
const defaultArcTolerance = 0.05
const defaultEdgeClearance = 10
const defaultPartClearance = 5
const rotations: readonly Rotation[] = [0, 90, 180, 270]

const finite = (value: number) => Number.isFinite(value)
const subtract = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y })
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const equal = (a: Point, b: Point) => distance(a, b) <= epsilon
const bounds = (points: Point[]): Box => points.reduce((box, point) => ({
  minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
  maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y),
}), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })

const arcSweep = (segment: Extract<Contour[number], { type: 'arc' }>) => segment.clockwise
  ? -((segment.start - segment.end + 360) % 360 || 360)
  : ((segment.end - segment.start + 360) % 360 || 360)

const arcPoint = (center: Point, radius: number, degrees: number): Point => {
  const angle = degrees * Math.PI / 180
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
}

const segmentStart = (segment: Contour[number]) => segment.type === 'line'
  ? segment.from
  : arcPoint(segment.center, segment.radius, segment.start)
const segmentEnd = (segment: Contour[number]) => segment.type === 'line'
  ? segment.to
  : arcPoint(segment.center, segment.radius, segment.end)

const maxStepDegrees = (radius: number, tolerance: number) => {
  if (tolerance >= radius) return 180
  return Math.max(0.1, 2 * Math.acos(1 - tolerance / radius) * 180 / Math.PI)
}

/** Tessellation is deliberately conservative through the returned sagitta guard. */
const tessellateOuter = (contour: Contour, tolerance: number): Polygon | undefined => {
  if (contour.length < 3) return undefined
  const points: Point[] = []
  let error = 0
  for (let index = 0; index < contour.length; index += 1) {
    const segment = contour[index]
    const next = contour[(index + 1) % contour.length]
    if (!finite(segmentStart(segment).x) || !finite(segmentStart(segment).y) || !equal(segmentEnd(segment), segmentStart(next))) return undefined
    if (segment.type === 'line') {
      points.push(segment.from)
      continue
    }
    if (!finite(segment.center.x) || !finite(segment.center.y) || !finite(segment.radius) || segment.radius <= 0) return undefined
    const sweep = arcSweep(segment)
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / maxStepDegrees(segment.radius, tolerance)))
    error = Math.max(error, segment.radius * (1 - Math.cos(Math.abs(sweep) * Math.PI / 180 / steps / 2)))
    for (let step = 0; step < steps; step += 1) points.push(arcPoint(segment.center, segment.radius, segment.start + sweep * step / steps))
  }
  const cleaned = points.filter((point, index) => !index || !equal(point, points[index - 1]))
  if (cleaned.length < 3 || equal(cleaned[0], cleaned[cleaned.length - 1]) || Math.abs(area(cleaned)) <= epsilon || !simple(cleaned)) return undefined
  return { points: cleaned, error, box: bounds(cleaned) }
}

const area = (polygon: Point[]) => polygon.reduce((sum, point, index) => {
  const next = polygon[(index + 1) % polygon.length]
  return sum + point.x * next.y - next.x * point.y
}, 0) / 2

const onSegment = (a: Point, b: Point, point: Point) => Math.abs(cross(subtract(b, a), subtract(point, a))) <= epsilon
  && point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon
  && point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon

const intersects = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = cross(subtract(b, a), subtract(c, a))
  const abD = cross(subtract(b, a), subtract(d, a))
  const cdA = cross(subtract(d, c), subtract(a, c))
  const cdB = cross(subtract(d, c), subtract(b, c))
  if (Math.abs(abC) <= epsilon && onSegment(a, b, c)) return true
  if (Math.abs(abD) <= epsilon && onSegment(a, b, d)) return true
  if (Math.abs(cdA) <= epsilon && onSegment(c, d, a)) return true
  if (Math.abs(cdB) <= epsilon && onSegment(c, d, b)) return true
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0)
}

const simple = (polygon: Point[]) => polygon.every((from, index) => polygon.every((otherFrom, otherIndex) => {
  const count = polygon.length
  if (otherIndex <= index || otherIndex === index + 1 || index === 0 && otherIndex === count - 1) return true
  return !intersects(from, polygon[(index + 1) % count], otherFrom, polygon[(otherIndex + 1) % count])
}))

const pointInPolygon = (point: Point, polygon: Point[]) => {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    if (onSegment(a, b, point)) return true
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const pointSegmentDistance = (point: Point, from: Point, to: Point) => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const squared = dx * dx + dy * dy
  if (squared <= epsilon) return distance(point, from)
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / squared))
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t })
}

const polygonDistance = (a: Point[], b: Point[]) => {
  let closest = Infinity
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) {
    const aEnd = a[(i + 1) % a.length]
    const bEnd = b[(j + 1) % b.length]
    if (intersects(a[i], aEnd, b[j], bEnd)) return 0
    closest = Math.min(closest, pointSegmentDistance(a[i], b[j], bEnd), pointSegmentDistance(b[j], a[i], aEnd))
  }
  return closest
}

const rotate = (point: Point, rotation: Rotation): Point => rotation === 0 ? point
  : rotation === 90 ? { x: -point.y, y: point.x }
    : rotation === 180 ? { x: -point.x, y: -point.y }
      : { x: point.y, y: -point.x }

const translated = (polygon: Polygon, translation: Point): Polygon => {
  const points = polygon.points.map(point => ({ x: point.x + translation.x, y: point.y + translation.y }))
  return { points, error: polygon.error, box: bounds(points) }
}

const makeShape = (part: Part, rotation: Rotation, tolerance: number): Shape | undefined => {
  const polygon = tessellateOuter(part.contours[0] ?? [], tolerance)
  if (!polygon) return undefined
  const points = polygon.points.map(point => rotate(point, rotation))
  return { rotation, polygon: { points, error: polygon.error, box: bounds(points) } }
}

const validOptions = (options: NestingOptions) => finite(options.sheet.width) && finite(options.sheet.height)
  && options.sheet.width > 0 && options.sheet.height > 0
  && finite(options.edgeClearance ?? defaultEdgeClearance) && (options.edgeClearance ?? defaultEdgeClearance) >= 0
  && finite(options.partClearance ?? defaultPartClearance) && (options.partClearance ?? defaultPartClearance) >= 0
  && finite(options.arcTolerance ?? defaultArcTolerance) && (options.arcTolerance ?? defaultArcTolerance) > 0
  && Number.isInteger(options.maxSheets ?? 1) && (options.maxSheets ?? 1) >= 0
  && Number.isInteger(options.attempts ?? 12) && (options.attempts ?? 12) >= 1 && (options.attempts ?? 12) <= 32
  && (options.rotations ?? rotations).length > 0
  && (options.rotations ?? rotations).every(rotation => rotations.includes(rotation))

const isInsideSheet = (polygon: Polygon, options: NestingOptions) => {
  const clearance = options.edgeClearance ?? defaultEdgeClearance
  const { width, height } = options.sheet
  return polygon.box.minX >= clearance + polygon.error - epsilon
    && polygon.box.minY >= clearance + polygon.error - epsilon
    && polygon.box.maxX <= width - clearance - polygon.error + epsilon
    && polygon.box.maxY <= height - clearance - polygon.error + epsilon
}

const compatible = (a: Polygon, b: Polygon, clearance: number) => {
  const required = clearance + a.error + b.error
  const dx = Math.max(a.box.minX - b.box.maxX, b.box.minX - a.box.maxX, 0)
  const dy = Math.max(a.box.minY - b.box.maxY, b.box.minY - a.box.maxY, 0)
  // Most candidate pairs are far apart; exact segment checks are only needed near touching bounds.
  if ((dx > epsilon || dy > epsilon) && Math.hypot(dx, dy) >= required - epsilon) return true
  return !pointInPolygon(a.points[0], b.points)
    && !pointInPolygon(b.points[0], a.points)
    && polygonDistance(a.points, b.points) >= Math.max(required - epsilon, epsilon)
}

const candidateTranslations = (shape: Shape, placed: NestingPlacement[], sheet: number, options: NestingOptions, cache: Map<NestingPlacement, Polygon>) => {
  const edge = options.edgeClearance ?? defaultEdgeClearance
  const gap = options.partClearance ?? defaultPartClearance
  const xs = new Set([edge + shape.polygon.error - shape.polygon.box.minX])
  const ys = new Set([edge + shape.polygon.error - shape.polygon.box.minY])
  for (const placement of placed) {
    if (placement.sheet !== sheet) continue
    const polygon = cache.get(placement)
    if (!polygon) continue
    xs.add(polygon.box.maxX + gap + polygon.error + shape.polygon.error - shape.polygon.box.minX)
    ys.add(polygon.box.maxY + gap + polygon.error + shape.polygon.error - shape.polygon.box.minY)
  }
  return [...ys].sort((a, b) => a - b).flatMap(y => [...xs].sort((a, b) => a - b).map(x => ({ x, y })))
}

/**
 * Places complete exterior contours only. Holes are deliberately not nestable material: a part may not be
 * positioned through another part's cutout, which keeps the result safe for common sheet-cut workflows.
 */
const nestPass = (parts: readonly Part[], options: NestingOptions, order: number): NestingResult => {
  const empty: NestingResult = { sheets: [], placements: [], unplaced: [], validation: { valid: true, violations: [] }, outlineArea: 0 }
  if (!validOptions(options)) {
    for (const part of parts) for (let instance = 0; instance < Math.max(1, Number.isInteger(part.count) ? part.count : 1); instance += 1) {
      empty.unplaced.push({ part, instance, reason: 'invalid-geometry' })
    }
    empty.validation = { valid: false, violations: [{ sheet: -1, message: 'Invalid nesting options' }] }
    return empty
  }
  const tolerance = options.arcTolerance ?? defaultArcTolerance
  const allowedRotations = [...new Set(options.rotations ?? rotations)]
  const records = parts.flatMap(part => {
    if (Number.isInteger(part.count) && part.count >= 0) return Array.from({ length: part.count }, (_, instance) => ({ part, instance }))
    return [{ part, instance: 0 }]
  })
    .sort((a, b) => {
      const aShape = makeShape(a.part, 0, tolerance)
      const bShape = makeShape(b.part, 0, tolerance)
      const score = (shape: Shape | undefined, name: string, instance: number) => {
        if (!shape) return Infinity
        const width = shape.polygon.box.maxX - shape.polygon.box.minX
        const height = shape.polygon.box.maxY - shape.polygon.box.minY
        const metric = order % 4 === 1 ? Math.max(width, height) : order % 4 === 2 ? width : order % 4 === 3 ? height : width * height
        if (order < 4) return metric
        let hash = (order * 2654435761 + instance) >>> 0
        for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
        return metric * (0.7 + (hash % 6001) / 10000)
      }
      return score(bShape, b.part.name, b.instance) - score(aShape, a.part.name, a.instance) || a.part.name.localeCompare(b.part.name) || a.instance - b.instance
    })
  const cache = new Map<NestingPlacement, Polygon>()
  const maxSheets = options.maxSheets ?? 1

  for (const record of records) {
    const shapes = allowedRotations.map(rotation => makeShape(record.part, rotation, tolerance)).filter((shape): shape is Shape => Boolean(shape))
    if (!shapes.length) {
      empty.unplaced.push({ ...record, reason: 'invalid-geometry' })
      continue
    }
    let selected: NestingPlacement | undefined
    let selectedPolygon: Polygon | undefined
    for (let sheet = 0; sheet < maxSheets && !selected; sheet += 1) {
      for (const shape of shapes) {
        for (const translation of candidateTranslations(shape, empty.placements, sheet, options, cache)) {
          const polygon = translated(shape.polygon, translation)
          if (!isInsideSheet(polygon, options)) continue
          const gap = options.partClearance ?? defaultPartClearance
          if (empty.placements.some(placement => placement.sheet === sheet && !compatible(polygon, cache.get(placement)!, gap))) continue
          const candidate = { part: record.part, instance: record.instance, sheet, rotation: shape.rotation, translation }
          const preferLeft = order % 8 >= 4
          const primary = preferLeft ? polygon.box.maxX : polygon.box.maxY
          const secondary = preferLeft ? polygon.box.maxY : polygon.box.maxX
          const selectedPrimary = selectedPolygon ? preferLeft ? selectedPolygon.box.maxX : selectedPolygon.box.maxY : Infinity
          const selectedSecondary = selectedPolygon ? preferLeft ? selectedPolygon.box.maxY : selectedPolygon.box.maxX : Infinity
          if (!selected || primary < selectedPrimary - epsilon
            || Math.abs(primary - selectedPrimary) <= epsilon && (secondary < selectedSecondary - epsilon
              || Math.abs(secondary - selectedSecondary) <= epsilon && (sheet < selected.sheet || sheet === selected.sheet && shape.rotation < selected.rotation))) {
            selected = candidate
            selectedPolygon = polygon
          }
        }
      }
    }
    if (!selected || !selectedPolygon) {
      empty.unplaced.push({ ...record, reason: 'no-sheet-space' })
      continue
    }
    empty.placements.push(selected)
    cache.set(selected, selectedPolygon)
  }
  const usedSheets = [...new Set(empty.placements.map(placement => placement.sheet))]
  empty.sheets = usedSheets.map(index => ({ index, placements: empty.placements.filter(placement => placement.sheet === index) }))
  empty.validation = validateNesting(empty.placements, options)
  return empty
}

/** Try distinct deterministic orderings and keep the best complete, validated result. */
export const nestParts = (parts: readonly Part[], options: NestingOptions): NestingResult => {
  const attempts = validOptions(options) ? options.attempts ?? 12 : 1
  const candidates = Array.from({ length: attempts }, (_, order) => nestPass(parts, options, order))
  const footprint = (result: NestingResult) => result.sheets.reduce((sum, sheet) => {
    const polygons = sheet.placements.flatMap(placement => {
      const shape = makeShape(placement.part, placement.rotation, options.arcTolerance ?? defaultArcTolerance)
      return shape ? [translated(shape.polygon, placement.translation).box] : []
    })
    if (!polygons.length) return sum
    const width = Math.max(...polygons.map(box => box.maxX)) - Math.min(...polygons.map(box => box.minX))
    const height = Math.max(...polygons.map(box => box.maxY)) - Math.min(...polygons.map(box => box.minY))
    return sum + width * height
  }, 0)
  candidates.sort((a, b) => Number(b.validation.valid) - Number(a.validation.valid)
    || a.unplaced.length - b.unplaced.length || a.sheets.length - b.sheets.length || footprint(a) - footprint(b))
  const best = candidates[0]
  best.outlineArea = best.placements.reduce((sum, placement) => {
    const shape = makeShape(placement.part, placement.rotation, options.arcTolerance ?? defaultArcTolerance)
    return sum + (shape ? Math.abs(area(shape.polygon.points)) : 0)
  }, 0)
  return best
}

/** Independently re-tessellates arcs at a finer tolerance before accepting a layout. */
export const validateNesting = (placements: readonly NestingPlacement[], options: NestingOptions): NestingValidation => {
  const violations: NestingViolation[] = []
  if (!validOptions(options)) return { valid: false, violations: [{ sheet: -1, message: 'Invalid nesting options' }] }
  const tolerance = Math.min((options.arcTolerance ?? defaultArcTolerance) / 4, 0.01)
  const maxSheets = options.maxSheets ?? 1
  const shapes = placements.map(placement => ({ placement, shape: makeShape(placement.part, placement.rotation, tolerance) }))
  for (const { placement, shape } of shapes) {
    if (!shape || !finite(placement.translation.x) || !finite(placement.translation.y)
      || !(options.rotations ?? rotations).includes(placement.rotation)
      || placement.sheet < 0 || placement.sheet >= maxSheets || !Number.isInteger(placement.sheet)) {
      violations.push({ sheet: placement.sheet, message: `Invalid placement for ${placement.part.name}` })
      continue
    }
    const polygon = translated(shape.polygon, placement.translation)
    if (!isInsideSheet(polygon, options)) violations.push({ sheet: placement.sheet, message: `${placement.part.name} violates sheet edge clearance` })
  }
  const gap = options.partClearance ?? defaultPartClearance
  for (let index = 0; index < shapes.length; index += 1) for (let other = index + 1; other < shapes.length; other += 1) {
    const a = shapes[index]
    const b = shapes[other]
    if (a.placement.sheet !== b.placement.sheet || !a.shape || !b.shape) continue
    const aPolygon = translated(a.shape.polygon, a.placement.translation)
    const bPolygon = translated(b.shape.polygon, b.placement.translation)
    if (!compatible(aPolygon, bPolygon, gap)) violations.push({ sheet: a.placement.sheet, message: `${a.placement.part.name} and ${b.placement.part.name} overlap or violate part clearance` })
  }
  return { valid: violations.length === 0, violations }
}

/** Applies the exact rigid transform returned by nestParts to any source coordinate. */
export const transformNestingPoint = (point: Point, placement: Pick<NestingPlacement, 'rotation' | 'translation'>): Point => {
  const rotated = rotate(point, placement.rotation)
  return { x: rotated.x + placement.translation.x, y: rotated.y + placement.translation.y }
}
