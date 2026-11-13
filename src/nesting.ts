import { signedContourArea, type Contour, type FabricationPart, type Point } from './geometry'
import { ContactCache, type ContactShape } from './nestingNfp'
import { nativeContourBounds, nativeContourDistance } from './contourGeometry'

type Part = FabricationPart

export type Rotation = number
export type NestingOptions = {
  sheet: { width: number; height: number }
  edgeClearance?: number
  partClearance?: number
  rotations?: readonly Rotation[]
  maxSheets?: number
  /** Bounded deterministic search, performed in a worker by the UI (12 seed orders, then contour search). */
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
  /** Analytic sum of outside silhouettes, without subtracting internal cuts. */
  outlineArea: number
  metrics: NestingMetrics
  stats: { attempts: number; improvements: number; contactCacheHits: number; contactCacheMisses: number; coarsenedPairs: number }
}
export type NestingMetrics = {
  sheetLowerBound: number
  remnantArea: number
  footprintArea: number
  sheets: Array<{ index: number; used: Box; remnant: { x: number; y: number; width: number; height: number } }>
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
  if (!contour.length) return undefined
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

const rotate = (point: Point, rotation: Rotation): Point => {
  const angle = rotation * Math.PI / 180
  const cos = Math.abs(Math.cos(angle)) < epsilon ? 0 : Math.cos(angle)
  const sin = Math.abs(Math.sin(angle)) < epsilon ? 0 : Math.sin(angle)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

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
  && options.sheet.width > 0 && options.sheet.height > 0 && options.sheet.width <= 1000000 && options.sheet.height <= 1000000
  && finite(options.edgeClearance ?? defaultEdgeClearance) && (options.edgeClearance ?? defaultEdgeClearance) >= 0
  && finite(options.partClearance ?? defaultPartClearance) && (options.partClearance ?? defaultPartClearance) >= 0
  && finite(options.arcTolerance ?? defaultArcTolerance) && (options.arcTolerance ?? defaultArcTolerance) > 0
  && Number.isInteger(options.maxSheets ?? 1) && (options.maxSheets ?? 1) >= 0 && (options.maxSheets ?? 1) <= 32
  && Number.isInteger(options.attempts ?? 12) && (options.attempts ?? 12) >= 1 && (options.attempts ?? 12) <= 4096
  && (options.rotations ?? rotations).length > 0
  && (options.rotations ?? rotations).length <= 24
  && (options.rotations ?? rotations).every(rotation => finite(rotation) && rotation >= 0 && rotation < 360 && rotation % 15 === 0)

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

type RecordInstance = { part: Part; instance: number; id: number }
type PreparedShape = Shape & ContactShape
const emptyResult = (): NestingResult => ({
  sheets: [], placements: [], unplaced: [], validation: { valid: true, violations: [] }, outlineArea: 0,
  metrics: { sheetLowerBound: 0, remnantArea: 0, footprintArea: 0, sheets: [] },
  stats: { attempts: 0, improvements: 0, contactCacheHits: 0, contactCacheMisses: 0, coarsenedPairs: 0 },
})

export const compareNesting = (a: NestingResult, b: NestingResult) => Number(b.validation.valid) - Number(a.validation.valid)
  || a.unplaced.length - b.unplaced.length || a.sheets.length - b.sheets.length
  || b.metrics.remnantArea - a.metrics.remnantArea || a.metrics.footprintArea - b.metrics.footprintArea

const measureResult = (result: NestingResult, options: NestingOptions, polygons: Map<NestingPlacement, Polygon>, totalArea: number) => {
  const edge = options.edgeClearance ?? defaultEdgeClearance
  const gap = options.partClearance ?? defaultPartClearance
  const { width, height } = options.sheet
  const usableArea = Math.max(0, width - 2 * edge) * Math.max(0, height - 2 * edge)
  const sheets = result.sheets.map(sheet => {
    const boxes = sheet.placements.map(p => polygons.get(p)!)
    const used = {
      minX: Math.min(...boxes.map(p => p.box.minX - p.error)), minY: Math.min(...boxes.map(p => p.box.minY - p.error)),
      maxX: Math.max(...boxes.map(p => p.box.maxX + p.error)), maxY: Math.max(...boxes.map(p => p.box.maxY + p.error)),
    }
    const right = { x: used.maxX + gap, y: edge, width: Math.max(0, width - edge - used.maxX - gap), height: Math.max(0, height - 2 * edge) }
    const top = { x: edge, y: used.maxY + gap, width: Math.max(0, width - 2 * edge), height: Math.max(0, height - edge - used.maxY - gap) }
    return { index: sheet.index, used, remnant: right.width * right.height >= top.width * top.height ? right : top }
  })
  result.metrics = {
    sheetLowerBound: usableArea > 0 ? Math.ceil(totalArea / usableArea - epsilon) : 0, sheets,
    remnantArea: sheets.reduce((sum, sheet) => sum + sheet.remnant.width * sheet.remnant.height, 0),
    footprintArea: sheets.reduce((sum, { used }) => sum + (used.maxX - used.minX) * (used.maxY - used.minY), 0),
  }
  result.outlineArea = result.placements.reduce((sum, p) => sum + Math.abs(signedContourArea(p.part.contours[0])), 0)
}

/** Deterministic anytime search. Every yielded incumbent has passed the finer, independent clearance check.
 * The first 12 cheap seed orders retain the previous search's solutions; subsequent orders use actual
 * contour contact regions and deterministic elite-order mutations. Holes are intentionally not nestable.
 * Consumers can stop between passes; the UI can terminate its worker immediately during an expensive pass.
 */
function* searchNestingCore(parts: readonly Part[], options: NestingOptions): Generator<NestingResult> {
  if (!validOptions(options) || parts.some(p => !Number.isInteger(p.count) || p.count < 0) || parts.reduce((n, p) => n + p.count, 0) > 256) {
    const invalid = emptyResult()
    invalid.validation = { valid: false, violations: [{ sheet: -1, message: 'Invalid nesting options or part count (limit 256)' }] }
    yield invalid
    return
  }
  const tolerance = options.arcTolerance ?? defaultArcTolerance
  const contactCache = new ContactCache()
  const shapes = new Map<Part, PreparedShape[]>()
  parts.forEach((part, id) => shapes.set(part, [...new Set(options.rotations ?? rotations)].flatMap(rotation => {
    const shape = makeShape(part, rotation, tolerance)
    return shape ? [{ ...shape, id, points: shape.polygon.points, error: shape.polygon.error }] : []
  })))
  const records = parts.flatMap((part, id) => Array.from({ length: part.count }, (_, instance) => ({ part, id, instance })))
  const totalArea = parts.reduce((sum, part) => sum + (shapes.get(part)?.length ? Math.abs(signedContourArea(part.contours[0])) * part.count : 0), 0)
  const elites: Array<{ result: NestingResult; order: RecordInstance[] }> = []
  let best: NestingResult | undefined
  let improvements = 0
  let randomState = 0x6d2b79f5
  const random = (max: number) => { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) % max }
  for (let attempt = 0; attempt < (options.attempts ?? 32); attempt++) {
    const seedOrder = attempt < 24 ? attempt % 12 : attempt
    let ordered = records.slice().sort((a, b) => {
      const score = (record: RecordInstance) => {
        const shape = shapes.get(record.part)?.[0]
        if (!shape) return Infinity
        const width = shape.polygon.box.maxX - shape.polygon.box.minX, height = shape.polygon.box.maxY - shape.polygon.box.minY
        const metric = seedOrder % 4 === 1 ? Math.max(width, height) : seedOrder % 4 === 2 ? width : seedOrder % 4 === 3 ? height : width * height
        if (seedOrder < 4) return metric
        let hash = (seedOrder * 2654435761 + record.instance) >>> 0
        for (const char of record.part.name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
        return metric * (0.7 + (hash % 6001) / 10000)
      }
      return score(b) - score(a) || a.part.name.localeCompare(b.part.name) || a.instance - b.instance
    })
    const preferred = new Map<string, number>()
    const recordKey = (record: Pick<RecordInstance, 'id' | 'instance'>) => `${record.id}:${record.instance}`
    if (attempt >= 24 && elites.length && attempt % 5 !== 4) {
      const parent = elites[random(elites.length)]
      ordered = parent.order.slice()
      for (const p of parent.result.placements) preferred.set(`${parts.indexOf(p.part)}:${p.instance}`, p.rotation)
      for (let mutation = 0; mutation < 1 + attempt % 4 && ordered.length > 1; mutation++) {
        const from = random(ordered.length), to = random(ordered.length)
        const [record] = ordered.splice(from, 1)
        ordered.splice(to, 0, record)
        const rotated = ordered[random(ordered.length)]
        const variants = shapes.get(rotated.part)!
        if (variants.length) preferred.set(recordKey(rotated), variants[random(variants.length)].rotation)
      }
    }
    const result = emptyResult()
    const polygons = new Map<NestingPlacement, Polygon>()
    const prepared = new Map<NestingPlacement, PreparedShape>()
    const contourSearch = attempt >= 12
    const gap = options.partClearance ?? defaultPartClearance, edge = options.edgeClearance ?? defaultEdgeClearance
    for (const record of ordered) {
      const preferredRotation = preferred.get(recordKey(record))
      // Seed passes try every angle; contact passes test one fine angle for one part family at a time.
      const refinePart = record.id === attempt % parts.length
      const variants = shapes.get(record.part)!.filter(shape => !contourSearch || shape.rotation % 90 === 0
        || refinePart && (shape.rotation === (Math.floor(attempt / parts.length) * 7 % 24) * 15
          || shape.rotation === preferredRotation))
        .sort((a, b) => Number(b.rotation === preferredRotation) - Number(a.rotation === preferredRotation))
      if (!variants.length) { result.unplaced.push({ ...record, reason: 'invalid-geometry' }); continue }
      let selected: NestingPlacement | undefined, selectedPolygon: Polygon | undefined, selectedShape: PreparedShape | undefined
      let selectedScore = [Infinity, Infinity]
      // Only try occupied sheets plus one new sheet; an identical empty sheet cannot fix an oversize part.
      const occupied = result.placements.reduce((max, p) => Math.max(max, p.sheet + 1), 0)
      for (let sheet = 0; sheet < Math.min(options.maxSheets ?? 1, occupied + 1) && !selected; sheet++) {
        const placed = result.placements.filter(p => p.sheet === sheet)
        for (const shape of variants) {
          const box = shape.polygon.box, error = shape.polygon.error
          const region = { minX: edge + error - box.minX, minY: edge + error - box.minY, maxX: options.sheet.width - edge - error - box.maxX, maxY: options.sheet.height - edge - error - box.maxY }
          if (region.minX > region.maxX || region.minY > region.maxY) continue
          const preferLeft = seedOrder % 8 >= 4
          const score = (translation: Point): number[] => preferLeft
            ? [box.maxX + translation.x, box.maxY + translation.y]
            : [box.maxY + translation.y, box.maxX + translation.x]
          const lowerBound = score({ x: region.minX, y: region.minY })
          if (lowerBound[0] > selectedScore[0] + epsilon || Math.abs(lowerBound[0] - selectedScore[0]) <= epsilon && lowerBound[1] >= selectedScore[1] - epsilon) continue
          const candidates = candidateTranslations(shape, placed, sheet, options, polygons)
          if (contourSearch) candidates.push(...contactCache.candidates(shape, placed.map(p => ({ shape: prepared.get(p)!, translation: p.translation })), region, gap))
          candidates.sort((a, b) => { const sa = score(a), sb = score(b); return sa[0] - sb[0] || sa[1] - sb[1] })
          for (const translation of candidates) {
            const candidateScore = score(translation)
            if (candidateScore[0] > selectedScore[0] + epsilon || Math.abs(candidateScore[0] - selectedScore[0]) <= epsilon && candidateScore[1] >= selectedScore[1] - epsilon) continue
            const polygon = translated(shape.polygon, translation)
            if (!isInsideSheet(polygon, options) || placed.some(p => !compatible(polygon, polygons.get(p)!, gap))) continue
            selected = { part: record.part, instance: record.instance, sheet, rotation: shape.rotation, translation }
            selectedPolygon = polygon; selectedShape = shape; selectedScore = candidateScore
            break
          }
          if (selected && preferredRotation === shape.rotation) break
        }
      }
      if (!selected || !selectedPolygon || !selectedShape) { result.unplaced.push({ ...record, reason: 'no-sheet-space' }); continue }
      result.placements.push(selected); polygons.set(selected, selectedPolygon); prepared.set(selected, selectedShape)
    }
    result.sheets = [...new Set(result.placements.map(p => p.sheet))].map(index => ({ index, placements: result.placements.filter(p => p.sheet === index) }))
    measureResult(result, options, polygons, totalArea)
    // Validate contenders, not every losing mutation. Never replace a valid incumbent with an invalid one.
    if (!best || compareNesting(result, best) < 0) {
      result.validation = validateNesting(result.placements, options)
      if (!best || compareNesting(result, best) < 0) { best = result; improvements++ }
    }
    if (result.validation.valid && elites.length < 6 || result.validation.valid && compareNesting(result, elites[elites.length - 1].result) < 0) {
      elites.push({ result, order: ordered }); elites.sort((a, b) => compareNesting(a.result, b.result)); elites.splice(6)
    }
    yield { ...best!, stats: { attempts: attempt + 1, improvements, contactCacheHits: contactCache.hits, contactCacheMisses: contactCache.misses, coarsenedPairs: contactCache.coarsened } }
  }
}

export function* searchNesting(parts: readonly Part[], options: NestingOptions): Generator<NestingResult> {
  const angles = options.rotations ?? rotations
  const passes = options.attempts ?? 32
  if (!validOptions(options) || parts.some(part => !Number.isInteger(part.count) || part.count < 0)
    || parts.reduce((count, part) => count + part.count, 0) > 256
    || angles.length !== 24 || ![0, 90, 180, 270].every(angle => angles.includes(angle)) || passes <= 12) {
    yield* searchNestingCore(parts, options)
    return
  }

  const edge = options.edgeClearance ?? defaultEdgeClearance
  const quarterFitsEach = parts.every(part => part.count === 0 || [0, 90, 180, 270].some(angle => {
    const polygon = makeShape(part, angle, options.arcTolerance ?? defaultArcTolerance)?.polygon
    return polygon && polygon.box.maxX - polygon.box.minX + 2 * (edge + polygon.error) <= options.sheet.width
      && polygon.box.maxY - polygon.box.minY + 2 * (edge + polygon.error) <= options.sheet.height
  }))
  if (!quarterFitsEach) {
    yield* searchNestingCore(parts, options)
    return
  }

  // Keep the proven quarter-turn search intact before refining the incumbent with finer angles.
  const quarterPasses = Math.min(48, passes)
  let best: NestingResult | undefined
  let attempts = 0, improvements = 0, contactCacheHits = 0, contactCacheMisses = 0, coarsenedPairs = 0
  for (const result of searchNestingCore(parts, { ...options, rotations: [0, 90, 180, 270], attempts: quarterPasses })) {
    attempts = result.stats.attempts
    improvements = result.stats.improvements
    contactCacheHits = result.stats.contactCacheHits
    contactCacheMisses = result.stats.contactCacheMisses
    coarsenedPairs = result.stats.coarsenedPairs
    best = result
    yield { ...best, stats: { attempts, improvements, contactCacheHits, contactCacheMisses, coarsenedPairs } }
  }
  if (passes === quarterPasses) return
  for (const result of searchNestingCore(parts, { ...options, attempts: passes - quarterPasses })) {
    attempts = quarterPasses + result.stats.attempts
    if (!best || compareNesting(result, best) < 0) { best = result; improvements++ }
    yield { ...best!, stats: {
      attempts, improvements,
      contactCacheHits: contactCacheHits + result.stats.contactCacheHits,
      contactCacheMisses: contactCacheMisses + result.stats.contactCacheMisses,
      coarsenedPairs: coarsenedPairs + result.stats.coarsenedPairs,
    } }
  }
}

export const nestParts = (parts: readonly Part[], options: NestingOptions): NestingResult => {
  let best = emptyResult()
  for (const result of searchNesting(parts, options)) best = result
  return best
}

/** Validate original LINE/ARC boundaries analytically; fine polygons supply topology/containment checks. */
export const validateNesting = (placements: readonly NestingPlacement[], options: NestingOptions): NestingValidation => {
  const violations: NestingViolation[] = []
  if (!validOptions(options)) return { valid: false, violations: [{ sheet: -1, message: 'Invalid nesting options' }] }
  const tolerance = Math.min((options.arcTolerance ?? defaultArcTolerance) / 4, 0.01)
  const maxSheets = options.maxSheets ?? 1
  const shapes = placements.map(placement => ({ placement, shape: makeShape(placement.part, placement.rotation, tolerance),
    native: transformNestingContour(placement.part.contours[0] ?? [], placement),
  }))
  for (const { placement, shape, native } of shapes) {
    if (!shape || !finite(placement.translation.x) || !finite(placement.translation.y)
      || !(options.rotations ?? rotations).includes(placement.rotation)
      || placement.sheet < 0 || placement.sheet >= maxSheets || !Number.isInteger(placement.sheet)) {
      violations.push({ sheet: placement.sheet, message: `Invalid placement for ${placement.part.name}` })
      continue
    }
    const box = nativeContourBounds(native)
    const edge = options.edgeClearance ?? defaultEdgeClearance
    if (box.minX < edge - epsilon || box.minY < edge - epsilon || box.maxX > options.sheet.width - edge + epsilon || box.maxY > options.sheet.height - edge + epsilon) violations.push({ sheet: placement.sheet, message: `${placement.part.name} violates sheet edge clearance` })
  }
  const gap = options.partClearance ?? defaultPartClearance
  for (let index = 0; index < shapes.length; index += 1) for (let other = index + 1; other < shapes.length; other += 1) {
    const a = shapes[index]
    const b = shapes[other]
    if (a.placement.sheet !== b.placement.sheet || !a.shape || !b.shape) continue
    const aPolygon = translated(a.shape.polygon, a.placement.translation)
    const bPolygon = translated(b.shape.polygon, b.placement.translation)
    const dx = Math.max(aPolygon.box.minX - bPolygon.box.maxX, bPolygon.box.minX - aPolygon.box.maxX, 0)
    const dy = Math.max(aPolygon.box.minY - bPolygon.box.maxY, bPolygon.box.minY - aPolygon.box.maxY, 0)
    if ((dx > epsilon || dy > epsilon) && Math.hypot(dx, dy) > gap + aPolygon.error + bPolygon.error) continue
    if (pointInPolygon(aPolygon.points[0], bPolygon.points) || pointInPolygon(bPolygon.points[0], aPolygon.points)
      || nativeContourDistance(a.native, b.native) < Math.max(epsilon, gap - epsilon)) violations.push({ sheet: a.placement.sheet, message: `${a.placement.part.name} and ${b.placement.part.name} overlap or violate part clearance` })
  }
  return { valid: violations.length === 0, violations }
}

export const transformNestingContour = (contour: Contour, placement: Pick<NestingPlacement, 'rotation' | 'translation'>): Contour => contour.map(segment => segment.type === 'line'
  ? { ...segment, from: transformNestingPoint(segment.from, placement), to: transformNestingPoint(segment.to, placement) }
  : { ...segment, center: transformNestingPoint(segment.center, placement), start: segment.start + placement.rotation, end: segment.end + placement.rotation })

/** Applies the exact rigid transform returned by nestParts to any source coordinate. */
export const transformNestingPoint = (point: Point, placement: Pick<NestingPlacement, 'rotation' | 'translation'>): Point => {
  const rotated = rotate(point, placement.rotation)
  return { x: rotated.x + placement.translation.x, y: rotated.y + placement.translation.y }
}
