import type { Config, PartName, RemovedHole } from './model'
import { strokeGlyphs } from './strokeGlyphs.js'

export type Point = { x: number; y: number }
export type Hole = Point & { id: string; d: number; kind: 'grid' | 'custom' | 'mount' | 'lift' }
export type Slot = Point & { width: number; height: number }
export type EngravingLine = { from: Point; to: Point }
export type LineSegment = { type: 'line'; from: Point; to: Point }
export type ArcSegment = { type: 'arc'; center: Point; radius: number; start: number; end: number; clockwise?: boolean }
export type ContourSegment = LineSegment | ArcSegment
export type Contour = ContourSegment[]
export type Part = {
  name: PartName
  width: number
  height: number
  thickness: number
  count: number
  holes: Hole[]
  slots: Slot[]
  contours: Contour[]
  label: string
}
export type PlacedPart = { part: Part; instance: number; position: Point }
export type Layout = { instances: PlacedPart[]; width: number; height: number }

const layoutGap = 80
const densityKgPerMm3 = 7.85e-6
const minimumHoleWeb = 3
const mountHoleWeb = 7
const epsilon = 1e-6
const point = (x: number, y: number): Point => ({ x, y })
const key = (part: PartName, x: number, y: number) => `${part}:${x.toFixed(3)}:${y.toFixed(3)}`
const radians = (degrees: number) => degrees * Math.PI / 180
const arcPoint = (center: Point, radius: number, angle: number) => point(
  center.x + radius * Math.cos(radians(angle)),
  center.y + radius * Math.sin(radians(angle)),
)

const line = (from: Point, to: Point): LineSegment => ({ type: 'line', from, to })
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)

const pointsAlong = (start: number, end: number, count: number) => count < 2
  ? [(start + end) / 2]
  : Array.from({ length: count }, (_, index) => start + (end - start) * index / (count - 1))

/** The reference uses the common 1.5 mm oversize for clearance holes. */
const boltHoleDiameter = (bolt: number) => bolt + 1.5

export type LegCornerPlateSpec = {
  size: number
  thickness: number
  centerX: number
  centerZ: number
  holeDiameter: number
  holeSpacing: number
  jumperLength: number
  jumperWidth: number
  jumperTabWidth: number
  jumperTabDepth: number
  jumperSlotCenter: number
  jumperSlotLength: number
  jumperSlotWidth: number
  weldReliefLength: number
  weldReliefDepth: number
}

export const legCornerPlateSpec = (c: Config): LegCornerPlateSpec | undefined => {
  if (!c.legMounts || c.legMountStyle !== 'cornerPlate') return undefined
  const size = c.legPlateSize
  const thickness = c.thickness
  const centerX = c.length / 2 - size / 2
  const centerZ = c.width / 2 - size / 2
  const holeDiameter = c.legPlateHoleDiameter
  const holeSpacing = c.legPlateHoleSpacing
  const jumperLength = c.height - c.thickness
  const jumperWidth = c.height * 0.3
  const minimumEdgeWeb = 5
  const reliefRadius = c.dogBones ? c.dogBoneDiameter / 2 : 0
  const jumperTabWidth = Math.min(c.tabWidth, jumperWidth - 2 * (minimumEdgeWeb + reliefRadius))
  const jumperTabDepth = thickness
  const jumperSlotCenter = -(c.legProfileSize / 2 + c.thickness / (2 * Math.SQRT2))
  const jumperSlotLength = jumperTabWidth + c.clearance
  const jumperSlotWidth = c.thickness + c.clearance
  const notchDepth = c.thickness + c.clearance
  const notchWidth = c.tabWidth + c.clearance
  const freeEdgeLand = (size - notchWidth) / 2 - thickness
  const weldReliefLength = Math.max(0, Math.min(c.tabWidth, freeEdgeLand))
  const weldReliefDepth = notchDepth
  const holesFit = holeSpacing > 0 && holeDiameter > 0
    && holeSpacing / 2 + holeDiameter / 2 + minimumEdgeWeb <= size / 2
  const legClearsHoles = c.legProfileSize > 0
    && c.legProfileSize / 2 + minimumEdgeWeb <= holeSpacing / 2 - holeDiameter / 2
  const notchesFit = notchWidth + 2 * (minimumEdgeWeb + reliefRadius) <= size
    && notchDepth + minimumEdgeWeb + reliefRadius < size / 2
    && c.tabWidth + 2 * c.thickness <= size
  const weldReliefLand = size / 2 - notchWidth / 2 - weldReliefLength
  const weldReliefFits = weldReliefLength >= minimumEdgeWeb && weldReliefDepth > 0
    && weldReliefLand >= minimumEdgeWeb + reliefRadius
    && holeSpacing / 2 + holeDiameter / 2 + minimumEdgeWeb + reliefRadius <= size / 2 - weldReliefDepth
  const jumperSlotExtent = (jumperSlotLength + jumperSlotWidth) / (2 * Math.SQRT2)
  const jumperFits = jumperTabWidth > 0
    && jumperTabWidth + 2 * (minimumEdgeWeb + reliefRadius) <= jumperWidth
    && jumperLength - jumperTabDepth >= minimumEdgeWeb
    && jumperWidth + 2 * minimumEdgeWeb <= Math.SQRT2 * (size - c.legProfileSize)
    && Math.abs(jumperSlotCenter) + jumperSlotExtent + minimumEdgeWeb + reliefRadius <= size / 2 - notchDepth
  const legClearsNotches = c.legProfileSize / 2 + minimumEdgeWeb + reliefRadius <= size / 2 - notchDepth
  const clearsNotch = (x: number, y: number, notchX: number, notchY: number, width: number, height: number) => {
    const dx = Math.max(Math.abs(x - notchX) - width / 2, 0)
    const dy = Math.max(Math.abs(y - notchY) - height / 2, 0)
    return Math.hypot(dx, dy) >= holeDiameter / 2 + minimumEdgeWeb + reliefRadius
  }
  const holesClearNotches = [-holeSpacing / 2, holeSpacing / 2].every(x =>
    [-holeSpacing / 2, holeSpacing / 2].every(y =>
      clearsNotch(x, y, size / 2 - notchDepth / 2, 0, notchDepth, notchWidth)
      && clearsNotch(x, y, 0, size / 2 - notchDepth / 2, notchWidth, notchDepth),
    ),
  )
  const holesClearJumperSlot = [-holeSpacing / 2, holeSpacing / 2].every(x =>
    [-holeSpacing / 2, holeSpacing / 2].every(y => {
      const dx = x - jumperSlotCenter
      const dy = y - jumperSlotCenter
      const tangent = (dx - dy) * Math.SQRT1_2
      const normal = (dx + dy) * Math.SQRT1_2
      const gapX = Math.max(Math.abs(tangent) - jumperSlotLength / 2, 0)
      const gapY = Math.max(Math.abs(normal) - jumperSlotWidth / 2, 0)
      return Math.hypot(gapX, gapY) >= holeDiameter / 2 + minimumEdgeWeb + reliefRadius
    }),
  )
  const frame = framePositions(c)
  const ribClearance = size / 2 + c.thickness / 2
  const overlapsRib = (center: number, positions: number[]) => positions.some(position =>
    Math.abs(center - position) < ribClearance || Math.abs(-center - position) < ribClearance
  )
  const clearsFrame = !c.ribs || !overlapsRib(centerX, frame.short) && !overlapsRib(centerZ, frame.long)
  if (size <= 0 || thickness <= 0 || holeDiameter <= 0 || centerX < size / 2 || centerZ < size / 2
    || !holesFit || !legClearsHoles || !notchesFit || !weldReliefFits || !jumperFits || !legClearsNotches || !holesClearNotches || !holesClearJumperSlot || !clearsFrame) return undefined
  return {
    size, thickness, centerX, centerZ, holeDiameter, holeSpacing, jumperLength, jumperWidth,
    jumperTabWidth, jumperTabDepth, jumperSlotCenter, jumperSlotLength, jumperSlotWidth,
    weldReliefLength, weldReliefDepth,
  }
}

const grid = (part: PartName, width: number, height: number, c: Config, enabled: boolean): Hole[] => {
  if (!enabled) return []
  const holes: Hole[] = []
  const xs = centeredGridCoordinates(width, c)
  const rowPitch = c.grid === 'staggered' ? c.pitch / 2 : c.pitch
  const compactSkirt = part.endsWith('Skirt') && c.skirtHoleLayout === 'compact'
  // Compact skirts keep the declared coordinate pitch vertically; staggered mode only offsets alternate rows horizontally.
  const verticalPitch = compactSkirt ? c.pitch : rowPitch
  const canonicalRowCount = Math.max(part === 'top' ? 0 : 1, Math.floor((height - (part === 'top' ? 0 : c.thickness) - 2 * c.margin) / rowPitch + epsilon) + 1)
  const compactNominalRowCount = Math.max(1, Math.floor(height / verticalPitch + epsilon))
  const safePitch = compactSkirt ? verticalPitch : rowPitch
  const cornerMount = c.legMounts && c.legMountStyle === 'cornerPlate'
  const skirtSafeRowCount = part.endsWith('Skirt')
    ? Math.max(0, Math.floor((height - (cornerMount ? 2 : 1) * c.thickness - c.holeDiameter - 2 * minimumHoleWeb) / safePitch + epsilon) + 1)
    : Number.POSITIVE_INFINITY
  const rowCount = compactSkirt
    ? Math.min(compactNominalRowCount, skirtSafeRowCount)
    : Math.min(canonicalRowCount, skirtSafeRowCount)
  const ys = Array.from({ length: rowCount }, (_, index) => (index - (rowCount - 1) / 2) * verticalPitch)
  for (let row = 0; row < ys.length; row += 1) {
    const y = ys[row]
    const offset = c.grid === 'staggered' && row % 2 ? c.pitch / 2 : 0
    for (const x of xs) {
      if (x + offset > width / 2 - c.margin + epsilon) continue
      holes.push({ x: x + offset, y, id: key(part, x + offset, y), d: c.holeDiameter, kind: 'grid' })
    }
  }
  return holes
}

const pushHole = (holes: Hole[], part: PartName, x: number, y: number, d: number, kind: Hole['kind'], id?: string) => {
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(d) && d > 0) {
    holes.push({ x, y, d, kind, id: id ?? key(part, x, y) })
  }
}

const sameRemovedHole = (removed: RemovedHole, part: PartName, hole: Hole) => removed.part === part
  && Math.abs(removed.x - hole.x) < 0.001
  && Math.abs(removed.y - hole.y) < 0.001
  && Math.abs(removed.r - hole.d / 2) < 0.001

const removeConfiguredHoles = (part: PartName, holes: Hole[], c: Config) => holes.filter(hole => !c.removedHoles.some(removed =>
  typeof removed === 'string' ? removed === hole.id : sameRemovedHole(removed, part, hole),
))

const legMountHoles = (part: PartName, width: number, height: number, c: Config, holes: Hole[]) => {
  if (!c.legMounts || c.legMountStyle !== 'boltPattern' || (part !== 'longSkirt' && part !== 'shortSkirt')) return
  const inset = c.legEdgeOffset + (part === 'shortSkirt' ? c.thickness : 0)
  const diameter = boltHoleDiameter(c.legBoltDiameter)
  const baseY = -height / 2 + c.thickness / 2 + c.legBottomOffset
  const pattern: Point[] = []
  for (const side of [-1, 1]) {
    for (let col = 0; col < c.legCols; col += 1) {
      for (let row = 0; row < c.legRows; row += 1) {
        const x = side * (width / 2 - inset - col * c.legPatternX)
        const y = baseY + row * c.legPatternY
        pattern.push(point(x, y))
      }
    }
  }
  const bodyWidth = width - (part === 'shortSkirt' ? 2 * c.thickness : 0)
  if (pattern.some(p => Math.abs(p.x) + diameter / 2 > bodyWidth / 2 || Math.abs(p.y) + diameter / 2 > (height - c.thickness) / 2)) return
  pattern.forEach(p => pushHole(holes, part, p.x, p.y, diameter, 'mount'))
}

const decorate = (part: PartName, width: number, height: number, c: Config, base: Hole[]) => {
  const holes = [...base]
  c.customHoles
    .filter(hole => hole.part === part && Math.abs(hole.x) + hole.d / 2 <= width / 2 && Math.abs(hole.y) + hole.d / 2 <= height / 2)
    .forEach(hole => pushHole(holes, part, hole.x, hole.y, hole.d, 'custom', `custom:${String(hole.id)}`))
  legMountHoles(part, width, height, c, holes)
  return removeConfiguredHoles(part, holes, c)
}

// A relief is the long way round a concave material corner, not a circle laid over an untrimmed edge.
const relievedPolygon = (vertices: Point[], c: Config, radiusCap?: (vertex: Point) => number): Contour => {
  const corners = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length]
    const next = vertices[(index + 1) % vertices.length]
    const beforeLength = distance(previous, vertex)
    const afterLength = distance(vertex, next)
    const incoming = point((vertex.x - previous.x) / beforeLength, (vertex.y - previous.y) / beforeLength)
    const outgoing = point((next.x - vertex.x) / afterLength, (next.y - vertex.y) / afterLength)
    const concave = incoming.x * outgoing.y - incoming.y * outgoing.x < -epsilon
    const radius = c.dogBones && concave
      ? Math.min(c.dogBoneDiameter / 2, beforeLength / 2, afterLength / 2, radiusCap?.(vertex) ?? Infinity)
      : 0
    return {
      center: vertex,
      before: point(vertex.x - incoming.x * radius, vertex.y - incoming.y * radius),
      after: point(vertex.x + outgoing.x * radius, vertex.y + outgoing.y * radius),
      radius,
    }
  })
  const result: Contour = []
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]
    const previous = corners[(index + corners.length - 1) % corners.length]
    if (distance(previous.after, corner.before) > epsilon) result.push(line(previous.after, corner.before))
    if (corner.radius) result.push({
      type: 'arc', center: corner.center, radius: corner.radius,
      start: Math.atan2(corner.before.y - corner.center.y, corner.before.x - corner.center.x) * 180 / Math.PI,
      end: Math.atan2(corner.after.y - corner.center.y, corner.after.x - corner.center.x) * 180 / Math.PI,
      clockwise: true,
    })
  }
  return result
}

const topEdgeCenters = (span: number, c: Config, shortSide = false) => {
  const inset = 80 + (shortSide ? c.thickness : 0)
  const regularCount = Math.round((span - 2 * inset) / 250) + 1
  const fittingCount = Math.floor((span - (shortSide ? 2 * c.thickness : 0)) / c.tabWidth)
  const count = Math.max(shortSide ? 1 : 2, Math.min(regularCount, fittingCount))
  return pointsAlong(-span / 2 + inset, span / 2 - inset, count)
}

const skirtEndTabCenters = (low: number, high: number) => {
  const inset = 80
  const count = Math.max(1, Math.round((high - low - 2 * inset) / 250) + 1)
  return pointsAlong(low + inset, high - inset, count)
}

const outerNotches = (name: PartName, c: Config): Slot[] => {
  const depth = c.thickness + c.clearance
  const tab = c.tabWidth + c.clearance
  if (name === 'top') return [
    ...topEdgeCenters(c.length, c).flatMap(x => [-1, 1].map(side => ({ x, y: side * (c.width - depth) / 2, width: tab, height: depth }))),
    ...topEdgeCenters(c.width, c, true).flatMap(y => [-1, 1].map(side => ({ x: side * (c.length - depth) / 2, y, width: depth, height: tab }))),
  ]
  if (name !== 'longSkirt') return []
  return skirtEndTabCenters((-c.height + c.thickness) / 2, (c.height - c.thickness) / 2)
    .flatMap(y => [-1, 1].map(side => ({ x: side * (c.length - depth) / 2, y, width: depth, height: tab })))
}

const topOutline = (c: Config): Contour => {
  const edge = (span: number, halfDepth: number, centers: number[]) => {
    const halfTab = (c.tabWidth + c.clearance) / 2
    const depth = c.thickness + c.clearance
    return [point(-span / 2, -halfDepth), ...centers.flatMap(center => [
      point(center - halfTab, -halfDepth), point(center - halfTab, -halfDepth + depth),
      point(center + halfTab, -halfDepth + depth), point(center + halfTab, -halfDepth),
    ])]
  }
  const vertices: Point[] = []
  for (let side = 0; side < 4; side += 1) {
    const span = side % 2 ? c.width : c.length
    const depth = (side % 2 ? c.length : c.width) / 2
    for (const p of edge(span, depth, topEdgeCenters(span, c, Boolean(side % 2)))) {
      vertices.push(side === 0 ? p : side === 1 ? point(-p.y, p.x) : side === 2 ? point(-p.x, -p.y) : point(p.y, -p.x))
    }
  }
  return relievedPolygon(vertices, c)
}

const slot = (x: number, y: number, width: number, height: number, c: Config) => ({
  x, y, width, height,
  contour: relievedPolygon([
    point(x - width / 2, y - height / 2), point(x - width / 2, y + height / 2),
    point(x + width / 2, y + height / 2), point(x + width / 2, y - height / 2),
  ], c),
})

const jumperPlateSlot = (c: Config, spec: LegCornerPlateSpec) => {
  const center = spec.jumperSlotCenter
  const halfLength = spec.jumperSlotLength / 2
  const halfWidth = spec.jumperSlotWidth / 2
  const placed = (along: number, across: number) => point(
    center + (along + across) * Math.SQRT1_2,
    center + (-along + across) * Math.SQRT1_2,
  )
  return {
    x: center,
    y: center,
    width: spec.jumperSlotLength,
    height: spec.jumperSlotWidth,
    contour: relievedPolygon([
      placed(-halfLength, -halfWidth), placed(-halfLength, halfWidth),
      placed(halfLength, halfWidth), placed(halfLength, -halfWidth),
    ], c),
  }
}

const centeredGridCoordinates = (span: number, c: Config) => {
  const count = Math.max(0, Math.floor((span - 2 * c.margin) / c.pitch + epsilon) + 1)
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * c.pitch)
}

const ribPositions = (span: number, c: Config, fixedCount?: number) => {
  if (!c.ribs) return []
  let count = fixedCount ?? Math.max(1, Math.ceil(span / c.ribSpacing) - 1)
  const gridCoordinates = centeredGridCoordinates(span, c)
  const gaps = gridCoordinates.slice(1).map((value, index) => (value + gridCoordinates[index]) / 2)
  if (fixedCount === undefined && count % 2 && gaps.length && !gaps.some(value => Math.abs(value) < epsilon)) count += 1
  return Array.from({ length: count }, (_, index) => {
    const desired = (index + 1) * span / (count + 1) - span / 2
    if (Math.abs(desired) < epsilon || !gaps.length) return desired
    return gaps.reduce((closest, value) => {
      const difference = Math.abs(value - desired) - Math.abs(closest - desired)
      return difference < -epsilon || Math.abs(difference) < epsilon && Math.abs(value) < Math.abs(closest) ? value : closest
    })
  })
}

const ribTabs = (span: number, intersections: number[], c: Config) => {
  const boundaries = [-span / 2 + c.thickness, ...intersections, span / 2 - c.thickness]
  const centers = boundaries.slice(1).flatMap((value, index) => {
    const previous = boundaries[index]
    if (value - previous < c.tabWidth) return []
    const count = Math.max(1, Math.floor((value - previous) / 250))
    return Array.from({ length: count }, (_, tab) => previous + (tab + 1) * (value - previous) / (count + 1))
  })
  return centers.length ? centers : [0]
}

export const framePositions = (c: Config) => ({
  short: ribPositions(c.length, c), long: ribPositions(c.width, c, 2),
})

const internalSlots = (c: Config) => {
  if (!c.ribs) return []
  const positions = framePositions(c)
  const result: ReturnType<typeof slot>[] = []
  for (const y of positions.long) {
    for (const x of ribTabs(c.length, positions.short, c)) result.push(slot(x, y, c.tabWidth + c.clearance, c.thickness + c.clearance, c))
  }
  for (const x of positions.short) {
    for (const y of ribTabs(c.width, positions.long, c)) result.push(slot(x, y, c.thickness + c.clearance, c.tabWidth + c.clearance, c))
  }
  return result
}

const skirtSlots = (name: PartName, c: Config) => {
  if (!c.ribs || (name !== 'longSkirt' && name !== 'shortSkirt')) return []
  const positions = framePositions(c)
  const centers = name === 'longSkirt' ? positions.short : positions.long
  return centers.map(x => slot(x, c.thickness / 2, c.thickness + c.clearance, c.tabWidth + c.clearance, c))
}

const skirtOutline = (width: number, c: Config, short: boolean): Contour => {
  const cornerMount = c.legMounts && c.legMountStyle === 'cornerPlate'
  const finishedLow = -c.height / 2
  const plateSeat = finishedLow + (cornerMount ? c.thickness : c.thickness / 2)
  const high = c.height / 2 - (cornerMount ? c.thickness : c.thickness / 2)
  const tabHigh = high + c.thickness
  const outer = width / 2
  const body = outer - (short ? c.thickness : 0)
  const halfEar = (c.tabWidth + (short ? 0 : c.clearance)) / 2
  const inner = outer - c.thickness - c.clearance
  const cornerPlate = legCornerPlateSpec(c)
  const bottomTabDepth = cornerPlate?.thickness ?? 0
  const bottomTabCenters = cornerPlate
    ? [-1, 1].map(sign => sign * (short ? cornerPlate.centerZ : cornerPlate.centerX))
    : []
  const bottom: Point[] = cornerPlate ? [point(-body, plateSeat)] : [point(-body, plateSeat), point(body, plateSeat)]
  if (cornerPlate) {
    const [leftCenter, rightCenter] = bottomTabCenters
    const leftSeatEnd = Math.min(body, leftCenter + cornerPlate.size / 2)
    const rightSeatStart = Math.max(-body, rightCenter - cornerPlate.size / 2)
    bottom.push(
      point(leftCenter - c.tabWidth / 2, plateSeat),
      point(leftCenter - c.tabWidth / 2, plateSeat - bottomTabDepth),
      point(leftCenter + c.tabWidth / 2, plateSeat - bottomTabDepth),
      point(leftCenter + c.tabWidth / 2, plateSeat),
      point(leftSeatEnd, plateSeat),
      point(leftSeatEnd, finishedLow),
      point(rightSeatStart, finishedLow),
      point(rightSeatStart, plateSeat),
      point(rightCenter - c.tabWidth / 2, plateSeat),
      point(rightCenter - c.tabWidth / 2, plateSeat - bottomTabDepth),
      point(rightCenter + c.tabWidth / 2, plateSeat - bottomTabDepth),
      point(rightCenter + c.tabWidth / 2, plateSeat),
      point(body, plateSeat),
    )
  }
  const right = skirtEndTabCenters(plateSeat, high).flatMap(center => short
    ? [point(body, center - halfEar), point(outer, center - halfEar), point(outer, center + halfEar), point(body, center + halfEar)]
    : [point(outer, center - halfEar), point(inner, center - halfEar), point(inner, center + halfEar), point(outer, center + halfEar)])
  const vertices = [...bottom, ...right, point(body, high)]
  for (const center of topEdgeCenters(width, c, short).reverse()) {
    vertices.push(point(center + c.tabWidth / 2, high), point(center + c.tabWidth / 2, tabHigh), point(center - c.tabWidth / 2, tabHigh), point(center - c.tabWidth / 2, high))
  }
  vertices.push(point(-body, high), ...right.slice().reverse().map(p => point(-p.x, p.y)))
  return relievedPolygon(vertices, c)
}

const ribOutline = (width: number, c: Config, long: boolean): Contour => {
  const low = -c.height / 2 + c.thickness
  const high = c.height / 2 - c.thickness
  const tabHigh = c.height / 2
  const body = width / 2 - c.thickness
  const outer = width / 2
  const positions = framePositions(c)
  const crossings = long ? positions.short : positions.long
  const halfLap = (c.thickness + c.clearance) / 2
  const crossLapReliefRadius = c.thickness / 4 + c.clearance / 2
  const vertices = [point(-body, low)]
  if (long) for (const center of crossings) vertices.push(
    point(center - halfLap, low), point(center - halfLap, 0),
    point(center + halfLap, 0), point(center + halfLap, low),
  )
  vertices.push(point(body, low), point(body, -c.tabWidth / 2), point(outer, -c.tabWidth / 2), point(outer, c.tabWidth / 2), point(body, c.tabWidth / 2), point(body, high))
  const topFeatures = [
    ...ribTabs(width, crossings, c).map(center => ({ center, half: c.tabWidth / 2, end: tabHigh })),
    ...(long ? [] : crossings.map(center => ({ center, half: halfLap, end: 0 }))),
  ].sort((a, b) => b.center - a.center)
  for (const feature of topFeatures) vertices.push(
    point(feature.center + feature.half, high), point(feature.center + feature.half, feature.end),
    point(feature.center - feature.half, feature.end), point(feature.center - feature.half, high),
  )
  vertices.push(point(-body, high), point(-body, c.tabWidth / 2), point(-outer, c.tabWidth / 2), point(-outer, -c.tabWidth / 2), point(-body, -c.tabWidth / 2))
  return relievedPolygon(vertices, c, vertex => Math.abs(vertex.y) < epsilon ? crossLapReliefRadius : Infinity)
}

const liftingCutout = (c: Config): Contour => {
  const radius = Math.min(25, (c.height - c.thickness) / 5)
  const halfStraight = 80 - radius
  return [
    line(point(-halfStraight, radius), point(halfStraight, radius)),
    { type: 'arc', center: point(halfStraight, 0), radius, start: 90, end: -90, clockwise: true },
    line(point(halfStraight, -radius), point(-halfStraight, -radius)),
    { type: 'arc', center: point(-halfStraight, 0), radius, start: -90, end: 90, clockwise: true },
  ]
}

const cornerPlateOutline = (c: Config, spec: LegCornerPlateSpec): Contour => {
  const half = spec.size / 2
  const halfNotch = (c.tabWidth + c.clearance) / 2
  const weldStart = -halfNotch - spec.weldReliefLength
  const inner = half - spec.weldReliefDepth
  return relievedPolygon([
    point(-half, -half), point(half, -half),
    point(half, weldStart), point(inner, weldStart),
    point(inner, halfNotch), point(half, halfNotch),
    point(half, half),
    point(halfNotch, half), point(halfNotch, inner),
    point(weldStart, inner), point(weldStart, half), point(-half, half),
  ], c)
}

const legJumperOutline = (c: Config, spec: LegCornerPlateSpec): Contour => {
  const halfWidth = spec.jumperWidth / 2
  const halfLength = spec.jumperLength / 2
  const halfTab = spec.jumperTabWidth / 2
  const bodyBottom = -halfLength + spec.jumperTabDepth
  return relievedPolygon([
    point(-halfTab, -halfLength), point(halfTab, -halfLength),
    point(halfTab, bodyBottom), point(halfWidth, bodyBottom),
    point(halfWidth, halfLength), point(-halfWidth, halfLength),
    point(-halfWidth, bodyBottom), point(-halfTab, bodyBottom),
  ], c)
}

const definition = (c: Config): Array<{ name: PartName; width: number; height: number; thickness: number; count: number; label: string; outline: Contour; grid: boolean }> => {
  const positions = framePositions(c)
  const cornerPlate = legCornerPlateSpec(c)
  return [
    { name: 'top', width: c.length, height: c.width, thickness: c.thickness, count: 1, label: 'TOP PLATE', outline: topOutline(c), grid: true },
    { name: 'longSkirt', width: c.length, height: c.height, thickness: c.thickness, count: 2, label: 'LONG SKIRT', outline: skirtOutline(c.length, c, false), grid: c.skirtHoles },
    { name: 'shortSkirt', width: c.width, height: c.height, thickness: c.thickness, count: 2, label: 'SHORT SKIRT', outline: skirtOutline(c.width, c, true), grid: c.skirtHoles },
    { name: 'longRib', width: c.length, height: c.height - c.thickness, thickness: c.thickness, count: positions.long.length, label: 'LONG RIB', outline: ribOutline(c.length, c, true), grid: false },
    { name: 'shortRib', width: c.width, height: c.height - c.thickness, thickness: c.thickness, count: positions.short.length, label: 'SHORT RIB', outline: ribOutline(c.width, c, false), grid: false },
    { name: 'legCornerPlate', width: cornerPlate?.size ?? 0, height: cornerPlate?.size ?? 0, thickness: cornerPlate?.thickness ?? c.thickness, count: cornerPlate ? 4 : 0, label: `LEG CORNER PLATE T${c.thickness}`, outline: cornerPlate ? cornerPlateOutline(c, cornerPlate) : [], grid: false },
    { name: 'legJumper', width: cornerPlate?.jumperWidth ?? 0, height: cornerPlate?.jumperLength ?? 0, thickness: cornerPlate?.thickness ?? c.thickness, count: cornerPlate ? 4 : 0, label: `LEG JUMPER ${cornerPlate?.jumperLength ?? 0}X${cornerPlate?.jumperWidth ?? 0} T${c.thickness}`, outline: cornerPlate ? legJumperOutline(c, cornerPlate) : [], grid: false },
  ]
}

export const makeParts = (c: Config): Part[] => {
  const internal = internalSlots(c)
  const lifting = c.liftingHoles && c.height - c.thickness >= 50 ? liftingCutout(c) : null
  const cornerPlate = legCornerPlateSpec(c)
  return definition(c).filter(item => item.count > 0).map(item => {
    const slots = [
      ...(item.name === 'top' ? internal : skirtSlots(item.name, c)),
      ...(item.name === 'legCornerPlate' && cornerPlate ? [jumperPlateSlot(c, cornerPlate)] : []),
    ]
    const exclusions = [...slots, ...outerNotches(item.name, c)]
    const mounts: Hole[] = []
    legMountHoles(item.name, item.width, item.height, c, mounts)
    const plateHoles: Hole[] = []
    if (item.name === 'legCornerPlate' && cornerPlate) {
      for (const x of [-cornerPlate.holeSpacing / 2, cornerPlate.holeSpacing / 2]) {
        for (const y of [-cornerPlate.holeSpacing / 2, cornerPlate.holeSpacing / 2]) {
          pushHole(plateHoles, item.name, x, y, cornerPlate.holeDiameter, 'mount')
        }
      }
    }
    return {
      name: item.name,
      width: item.width,
      height: item.height,
      thickness: item.thickness,
      count: item.count,
      label: item.label,
      holes: decorate(item.name, item.width, item.height, c, [...grid(item.name, item.width, item.height, c, item.grid), ...plateHoles]).filter(hole => {
        if (hole.kind !== 'grid') return true
        if (exclusions.some(slot => Math.abs(hole.x - slot.x) < slot.width / 2 + hole.d / 2 + minimumHoleWeb && Math.abs(hole.y - slot.y) < slot.height / 2 + hole.d / 2 + minimumHoleWeb)) return false
        if (mounts.some(mount => {
          const inset = (hole.d + mount.d) / 2 + mountHoleWeb
          return Math.abs(hole.x - mount.x) < inset && Math.abs(hole.y - mount.y) < inset
        })) return false
        return !(lifting && item.name === 'longSkirt' && Math.abs(hole.x) <= 100 && Math.abs(hole.y) < Math.min(25, (c.height - c.thickness) / 5) + hole.d / 2)
      }),
      slots: slots.map(({ x, y, width, height }) => ({ x, y, width, height })),
      contours: [item.outline, ...slots.map(itemSlot => itemSlot.contour), ...(lifting && item.name === 'longSkirt' ? [lifting] : [])],
    }
  })
}

export const layoutParts = (c: Config): Layout => {
  // Fabrication layout is packed from the top plate at Y=0 upward, exactly as
  // exported full DXF: top, skirts, longitudinal ribs, transverse ribs and optional leg supports.
  const order: PartName[] = ['top', 'longSkirt', 'shortSkirt', 'longRib', 'shortRib', 'legCornerPlate', 'legJumper']
  const parts = makeParts(c).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  const packed = parts.map(part => ({
    part,
    width: part.width - (part.name === 'shortSkirt' || part.name.endsWith('Rib') ? 2 * c.thickness : 0),
    height: part.name === 'top' || (part.name.endsWith('Skirt') && c.legMounts && c.legMountStyle === 'cornerPlate') || part.name === 'legCornerPlate' || part.name === 'legJumper'
      ? part.height
      : part.height - (part.name.endsWith('Rib') ? 2 * c.thickness : c.thickness),
  }))
  const count = parts.reduce((sum, part) => sum + part.count, 0)
  const height = packed.reduce((sum, item) => sum + item.height * item.part.count, 0) + Math.max(0, count - 1) * layoutGap
  const width = Math.max(...packed.map(item => item.width))
  const instances: PlacedPart[] = []
  let cursor = 0
  for (const { part, width: bodyWidth, height: bodyHeight } of packed) {
    for (let instance = 0; instance < part.count; instance += 1) {
      instances.push({ part, instance, position: point(bodyWidth / 2, cursor + bodyHeight / 2) })
      cursor += bodyHeight + layoutGap
    }
  }
  return { instances, width, height }
}

export const engravingLines = (part: Part, c: Config): EngravingLine[] => {
  const lines: EngravingLine[] = []
  if (c.engraving && part.name === 'top') {
    const xs = centeredGridCoordinates(part.width, c)
    const ys = centeredGridCoordinates(part.height, c)
    const step = c.grid === 'staggered' ? c.pitch / 2 : c.pitch
    const offset = c.engravingMode === 'between' ? step / 2 : 0
    const halfW = ((xs.length - 1) * c.pitch) / 2 + offset
    const halfH = ((ys.length - 1) * c.pitch) / 2 + offset
    for (let x = -halfW; x <= halfW + epsilon; x += step) lines.push({ from: point(x, -halfH), to: point(x, halfH) })
    for (let y = -halfH; y <= halfH + epsilon; y += step) lines.push({ from: point(-halfW, y), to: point(halfW, y) })
  }
  if (c.nameMarking) {
    const order: PartName[] = ['top', 'longSkirt', 'shortSkirt', 'longRib', 'shortRib', 'legCornerPlate', 'legJumper']
    const value = `${order.indexOf(part.name) + 1} ${part.label}`
    const skirt = part.name.endsWith('Skirt')
    const bodyHalfWidth = part.width / 2 - (part.name === 'shortSkirt' || part.name.endsWith('Rib') ? c.thickness : 0)
    const bodyHeight = part.name === 'top' || part.name === 'legCornerPlate' || part.name === 'legJumper'
      ? part.height
      : skirt ? c.height - c.thickness : c.height - 2 * c.thickness
    const inset = Math.min(2 * c.thickness, bodyHeight * 0.12)
    const glyphBounds = value.split('').flatMap((character, index) => (strokeGlyphs[character] ?? [])
      .flatMap(([x1, , x2]) => [index + x1 / 6, index + x2 / 6]))
    const minGlyphX = Math.min(...glyphBounds)
    const maxGlyphX = Math.max(...glyphBounds)
    const nominalHeight = part.name === 'top' ? 45 : Math.min(45, Math.max(14, bodyHeight * 0.13))
    const height = Math.min(nominalHeight, (2 * (bodyHalfWidth - inset)) / maxGlyphX)
    const unit = height / 6
    const halfH = bodyHeight / 2
    const centeredLongSkirt = skirt && part.name === 'longSkirt' && !c.legMounts && bodyHeight <= 3 * height
    const rightLongSkirt = skirt && part.name === 'longSkirt' && !c.legMounts && !centeredLongSkirt && bodyHeight * 0.13 < 14
    const topAlignedLongRib = part.name === 'longRib' && bodyHeight >= 2 * bodyHalfWidth
    const origin = point(
      centeredLongSkirt ? -(minGlyphX + maxGlyphX) * height / 2
        : rightLongSkirt ? bodyHalfWidth - inset - maxGlyphX * height
          : -bodyHalfWidth + inset,
      centeredLongSkirt ? -height / 2
        : topAlignedLongRib || skirt && c.legMounts ? halfH - inset - height : -halfH + inset,
    )
    for (let index = 0; index < value.length; index += 1) {
      for (const [x1, y1, x2, y2] of strokeGlyphs[value[index]] ?? []) lines.push({
        from: point(origin.x + index * height + x1 * unit, origin.y + y1 * unit),
        to: point(origin.x + index * height + x2 * unit, origin.y + y2 * unit),
      })
    }
  }
  return lines
}

const signedArea = (contour: Contour) => contour.reduce((sum, segment) => {
  if (segment.type === 'line') return sum + (segment.from.x * segment.to.y - segment.to.x * segment.from.y) / 2
  const end = segment.start + arcSweep(segment)
  const startRad = radians(segment.start)
  const endRad = radians(end)
  return sum + (
    segment.center.x * segment.radius * (Math.sin(endRad) - Math.sin(startRad))
    - segment.center.y * segment.radius * (Math.cos(endRad) - Math.cos(startRad))
    + segment.radius ** 2 * (endRad - startRad)
  ) / 2
}, 0)

export const contourLength = (contour: Contour) => contour.reduce((sum, segment) => {
  if (segment.type === 'line') return sum + distance(segment.from, segment.to)
  return sum + segment.radius * Math.abs(radians(arcSweep(segment)))
}, 0)

export const partWeight = (part: Part, _c: Config) => {
  const contourArea = Math.abs(signedArea(part.contours[0])) - part.contours.slice(1).reduce((area, contour) => area + Math.abs(signedArea(contour)), 0)
  const holeArea = part.holes.reduce((area, hole) => area + Math.PI * (hole.d / 2) ** 2, 0)
  return (contourArea - holeArea) * part.thickness * densityKgPerMm3
}

export const totals = (c: Config) => {
  const parts = makeParts(c)
  const holes = parts.reduce((sum, part) => sum + part.holes.length * part.count, 0)
  const cut = parts.reduce((sum, part) => {
    const contourCut = part.contours.reduce((partSum, contour) => partSum + contourLength(contour), 0)
    const holeCut = part.holes.reduce((partSum, hole) => partSum + Math.PI * hole.d, 0)
    return sum + (contourCut + holeCut) * part.count
  }, 0) / 1000
  const kg = parts.reduce((sum, part) => sum + partWeight(part, c) * part.count, 0)
  const engraving = parts.reduce((total, part) => total + engravingLines(part, c).reduce((sum, mark) => sum + distance(mark.from, mark.to), 0) * part.count, 0) / 1000
  const fit = parts.every(part =>
    (part.width <= c.sheetLength && part.height <= c.sheetWidth)
    || (part.height <= c.sheetLength && part.width <= c.sheetWidth),
  )
  return { parts, holes, cut, kg, engraving, fit }
}

export const contourPoints = (contour: Contour, arcSteps = 8): Point[] => contour.flatMap(segment => {
  if (segment.type === 'line') return [segment.from]
  const end = segment.start + arcSweep(segment)
  const steps = Math.max(2, Math.ceil(Math.abs(end - segment.start) / 360 * arcSteps))
  return Array.from({ length: steps }, (_, index) => arcPoint(segment.center, segment.radius, segment.start + (end - segment.start) * index / steps))
})

const arcSweep = (segment: ArcSegment) => segment.clockwise
  ? -((segment.start - segment.end + 360) % 360 || 360)
  : ((segment.end - segment.start + 360) % 360 || 360)

const svgNumber = (value: number) => Number(value.toFixed(3)).toString()
export const svgContourPath = (contour: Contour) => contour.map((segment, index) => {
  if (segment.type === 'line') {
    const start = `${svgNumber(segment.from.x)} ${svgNumber(segment.from.y)}`
    const end = `${svgNumber(segment.to.x)} ${svgNumber(segment.to.y)}`
    return `${index ? '' : `M ${start} `}L ${end}`
  }
  const start = arcPoint(segment.center, segment.radius, segment.start)
  const end = arcPoint(segment.center, segment.radius, segment.end)
  const sweep = Math.abs(arcSweep(segment)) > 180 ? 1 : 0
  return `${index ? '' : `M ${svgNumber(start.x)} ${svgNumber(start.y)} `}A ${svgNumber(segment.radius)} ${svgNumber(segment.radius)} 0 ${sweep} ${segment.clockwise ? 0 : 1} ${svgNumber(end.x)} ${svgNumber(end.y)}`
}).join(' ') + ' Z'

/**
 * Shared even-odd SVG path in fabrication coordinates.  Consumers should use
 * `fill-rule="evenodd"` and flip Y once (`scale(1 -1)`) for screen SVG.
 */
export const partSvgPath = (part: Part, _c: Config) => [
  ...part.contours.map(svgContourPath),
  ...part.holes.map(hole => `M ${svgNumber(hole.x - hole.d / 2)} ${svgNumber(hole.y)} a ${svgNumber(hole.d / 2)} ${svgNumber(hole.d / 2)} 0 1 0 ${svgNumber(hole.d)} 0 a ${svgNumber(hole.d / 2)} ${svgNumber(hole.d / 2)} 0 1 0 -${svgNumber(hole.d)} 0 Z`),
].join(' ')
