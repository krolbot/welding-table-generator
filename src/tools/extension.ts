import { contourPoints, type Contour, type FabricationPart, type Hole, type Point } from '../geometry'
import { nativeContourBounds, nativeContourDistance, nativePointContourDistance } from '../nestingNative'

export type ExtensionConfig = { length: number; width: number; height: number; thickness: number }
export const extensionDefaults: ExtensionConfig = { length: 500, width: 200, height: 200, thickness: 6 }
export type ExtensionPartName = 'top' | 'longSide' | 'nearEnd' | 'farEnd' | 'crossRib'
type ExtensionPart = FabricationPart<ExtensionPartName>
type Vector3 = [number, number, number]
export type ExtensionPlacement = { part: ExtensionPartName; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }

const diameter = 16
const pitch = 50
const holeWeb = 8
const jointClearance = 0.2
const tabWidth = 20
const ribDepth = 30
const ribEndTab = 18
const epsilon = 1e-6
const point = (x: number, y: number): Point => ({ x, y })
const line = (from: Point, to: Point): Contour[number] => ({ type: 'line', from, to })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const arcPoint = (center: Point, radius: number, degrees: number): Point => {
  const angle = degrees * Math.PI / 180
  return point(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle))
}
const endpoint = (segment: Contour[number], end: 'from' | 'to') => segment.type === 'line'
  ? segment[end] : arcPoint(segment.center, segment.radius, end === 'from' ? segment.start : segment.end)
const polygon = (vertices: Point[]): Contour => vertices.map((vertex, index) => line(vertex, vertices[(index + 1) % vertices.length]))
const rect = (x: number, y: number, width: number, height: number) => polygon([
  point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height),
])

type Tooth = { centre: number; width: number; depth: number }
// Positive depth projects outwards from a counter-clockwise outline; negative depth makes a notch.
const jointOutline = (vertices: Point[], teeth: Tooth[][]): Contour => {
  const points: Point[] = []
  vertices.forEach((from, index) => {
    const to = vertices[(index + 1) % vertices.length], length = distance(from, to)
    const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length
    const at = (along: number, depth = 0) => point(from.x + along * ux + depth * uy, from.y + along * uy - depth * ux)
    points.push(from)
    let previous = 0
    for (const tooth of [...(teeth[index] ?? [])].sort((a, b) => a.centre - b.centre)) {
      const start = tooth.centre - tooth.width / 2, end = tooth.centre + tooth.width / 2
      if (start <= previous || end >= length) throw new Error('Extension locating joints do not fit the edge')
      points.push(at(start), at(start, tooth.depth), at(end, tooth.depth), at(end))
      previous = end
    }
  })
  return polygon(points)
}
const teeth = (centres: number[], width: number, depth: number): Tooth[] => centres.map(centre => ({ centre, width, depth }))
const stations = (span: number) => Array.from({ length: Math.floor((span - pitch) / pitch) }, (_, index) => (index + 1) * pitch)

const roundedTriangle = (vertices: Point[], radius: number): Contour => {
  const corners = vertices.map((vertex, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length], next = vertices[(index + 1) % vertices.length]
    const previousLength = distance(previous, vertex), nextLength = distance(next, vertex)
    const a = point((previous.x - vertex.x) / previousLength, (previous.y - vertex.y) / previousLength)
    const b = point((next.x - vertex.x) / nextLength, (next.y - vertex.y) / nextLength)
    const angle = Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)))
    const tangent = radius / Math.tan(angle / 2), bisector = Math.hypot(a.x + b.x, a.y + b.y)
    const centreDistance = radius / Math.sin(angle / 2)
    const center = point(vertex.x + (a.x + b.x) * centreDistance / bisector, vertex.y + (a.y + b.y) * centreDistance / bisector)
    return { entry: point(vertex.x + a.x * tangent, vertex.y + a.y * tangent), exit: point(vertex.x + b.x * tangent, vertex.y + b.y * tangent), center, tangent }
  })
  return corners.flatMap((corner, index): Contour => {
    const next = corners[(index + 1) % corners.length]
    if (corner.tangent + next.tangent >= distance(vertices[index], vertices[(index + 1) % vertices.length])) throw new Error('Extension access-window fillets do not fit')
    return [
      { type: 'arc', center: corner.center, radius, start: Math.atan2(corner.entry.y - corner.center.y, corner.entry.x - corner.center.x) * 180 / Math.PI, end: Math.atan2(corner.exit.y - corner.center.y, corner.exit.x - corner.center.x) * 180 / Math.PI },
      line(corner.exit, next.entry),
    ]
  })
}
const verticalSlot = (x: number, y: number, length: number): Contour => {
  const radius = diameter / 2, travel = (length - diameter) / 2
  return [
    line(point(x + radius, y - travel), point(x + radius, y + travel)),
    { type: 'arc', center: point(x, y + travel), radius, start: 0, end: 180 },
    line(point(x - radius, y + travel), point(x - radius, y - travel)),
    { type: 'arc', center: point(x, y - travel), radius, start: 180, end: 360 },
  ]
}
const radialSlot = (center: Point, radius: number): Contour => {
  const half = diameter / 2, start = 200, end = 340
  return [
    { type: 'arc', center, radius: radius + half, start, end },
    { type: 'arc', center: arcPoint(center, radius, end), radius: half, start: end, end: end + 180 },
    { type: 'arc', center, radius: radius - half, start: end, end: start, clockwise: true },
    { type: 'arc', center: arcPoint(center, radius, start), radius: half, start: start + 180, end: start + 360 },
  ]
}

const insidePolygon = (value: Point, vertices: Point[]) => {
  let inside = false
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const a = vertices[index], b = vertices[previous]
    if ((a.y > value.y) !== (b.y > value.y) && value.x < (b.x - a.x) * (value.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
const inside = (value: Point, contour: Contour) => insidePolygon(value, contourPoints(contour, 64))
const grid = (part: ExtensionPart, initial: Hole[] = []): Hole[] => {
  const holes = [...initial], [outer, ...cuts] = part.contours
  const outerPoints = contourPoints(outer, 64), cutPoints = cuts.map(cut => contourPoints(cut, 64))
  const rowOffset = part.name === 'top' ? pitch / 2 : Math.max(pitch / 2, part.thickness + diameter / 2 + holeWeb)
  for (let x = pitch / 2; x < part.width; x += pitch) for (let y = part.height - rowOffset; y > 0; y -= pitch) {
    const candidate = point(x, y), radius = diameter / 2
    if (insidePolygon(candidate, outerPoints) && nativePointContourDistance(candidate, outer) >= radius + holeWeb
      && cuts.every((cut, index) => !insidePolygon(candidate, cutPoints[index]) && nativePointContourDistance(candidate, cut) >= radius + holeWeb)
      && holes.every(hole => distance(candidate, hole) >= radius + hole.d / 2 + holeWeb))
      holes.push({ ...candidate, id: `D16-${x}-${y}`, d: diameter, kind: 'grid' })
  }
  return holes
}

export const extensionDimensions = ({ length, width, height, thickness }: ExtensionConfig) => ({
  tipHeight: Math.max(50, height / 4),
  sideTop: height - thickness,
  sideTabs: stations(length),
  endTabs: stations(width),
  rootJoints: [height * .2, height * .5, height * .8],
  // Keep ties between hole columns so clamps can pass through the working surface.
  ribStations: [Math.round(length / (3 * pitch)) * pitch, length - Math.round(length / (3 * pitch)) * pitch],
  ribDepth, ribEndTab, tabWidth, clearance: jointClearance,
})
const assertConfig = (config: ExtensionConfig) => {
  const ranges = { length: [400, 800], width: [200, 400], height: [150, 300], thickness: [4, 10] }
  for (const name of Object.keys(ranges) as (keyof ExtensionConfig)[]) {
    const value = config[name], [min, max] = ranges[name]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Extension ${name} must be finite and ${min}–${max} mm`)
  }
}
const validatePart = (part: ExtensionPart) => {
  const [outer, ...cuts] = part.contours
  for (const contour of part.contours) {
    if (!contour.length || contour.some((segment, index) => distance(endpoint(segment, 'to'), endpoint(contour[(index + 1) % contour.length], 'from')) > epsilon)) throw new Error(`${part.name} contour is not closed`)
    const bounds = nativeContourBounds(contour)
    if (Object.values(bounds).some(value => !Number.isFinite(value)) || bounds.minX < -epsilon || bounds.minY < -epsilon || bounds.maxX > part.width + epsilon || bounds.maxY > part.height + epsilon) throw new Error(`${part.name} contour is outside the blank`)
  }
  for (const [index, cut] of cuts.entries()) {
    if (!inside(endpoint(cut[0], 'from'), outer) || nativeContourDistance(cut, outer) < 3 - epsilon) throw new Error(`${part.name} cut violates the outer web`)
    for (const other of cuts.slice(index + 1)) if (nativeContourDistance(cut, other) < 3 - epsilon || inside(endpoint(cut[0], 'from'), other) || inside(endpoint(other[0], 'from'), cut)) throw new Error(`${part.name} cuts overlap or leave insufficient web`)
  }
  for (const [index, hole] of part.holes.entries()) {
    if (!inside(hole, outer) || nativePointContourDistance(hole, outer) < hole.d / 2 + holeWeb - epsilon
      || cuts.some(cut => inside(hole, cut) || nativePointContourDistance(hole, cut) < hole.d / 2 + holeWeb - epsilon)
      || part.holes.slice(index + 1).some(other => distance(hole, other) < (hole.d + other.d) / 2 + holeWeb - epsilon)) throw new Error(`${part.name} hole violates the material web`)
  }
}

/** Reference topology; unmeasured joint, window and mounting dimensions are proposed, not vendor drawings. */
export const extensionParts = (config: ExtensionConfig = extensionDefaults): ExtensionPart[] => {
  assertConfig(config)
  const { length, width, height, thickness } = config
  const { tipHeight, sideTop, sideTabs, endTabs, rootJoints, ribStations } = extensionDimensions(config)
  const clearance = jointClearance, notchDepth = thickness + clearance / 2
  const slope = (height - tipHeight) / length
  const windowTop = sideTop - 45, rootRail = 55, lowerRail = 30 * Math.hypot(1, slope)
  const windowTip = Math.min(length - 55, (windowTop - lowerRail) / slope)
  const window = roundedTriangle([point(rootRail, slope * rootRail + lowerRail), point(windowTip, windowTop), point(rootRail, windowTop)], 6)
  const tipJoint = tipHeight * .45
  const ribSlot = (x: number) => rect(x - (thickness + clearance) / 2, sideTop - ribDepth / 2 - (ribEndTab + clearance) / 2, thickness + clearance, ribEndTab + clearance)
  const top = jointOutline([point(0, 0), point(length, 0), point(length, width), point(0, width)], [
    teeth(sideTabs, tabWidth + clearance, -notchDepth), teeth(endTabs, tabWidth + clearance, -notchDepth),
    teeth(sideTabs.map(x => length - x), tabWidth + clearance, -notchDepth), teeth(endTabs.map(y => width - y), tabWidth + clearance, -notchDepth),
  ])
  const side = jointOutline([point(0, 0), point(length, height - tipHeight), point(length, sideTop), point(0, sideTop)], [
    [], teeth([tipJoint], tabWidth + clearance, -notchDepth), teeth(sideTabs.map(x => length - x), tabWidth, thickness),
    teeth(rootJoints.map(z => sideTop - z), tabWidth + clearance, -notchDepth),
  ])
  const endOutline = (depth: number, joints: number[]) => {
    const left = thickness + clearance / 2, right = width - left, top = depth - thickness
    return jointOutline([point(left, 0), point(right, 0), point(right, top), point(left, top)], [
      [], teeth(joints, tabWidth, left), teeth(endTabs.map(y => right - y), tabWidth, thickness), teeth(joints.map(z => top - z), tabWidth, left),
    ])
  }
  const inset = thickness + 20
  const pivot = { id: 'mount-pivot', x: width / 2, y: height * .42, d: diameter, kind: 'mount' as const }
  const mountingCuts = [
    ...[inset, width - inset].flatMap(x => [height * .25, height * .75].map(y => verticalSlot(x, y, height * .2))),
    radialSlot(pivot, Math.min(width / 2 - inset - 32, height * .25)),
  ]
  const ribLeft = thickness + clearance / 2, ribRight = width - ribLeft
  const rib = jointOutline([point(ribLeft, 0), point(ribRight, 0), point(ribRight, ribDepth), point(ribLeft, ribDepth)], [
    [], teeth([ribDepth / 2], ribEndTab, ribLeft), teeth([ribRight - width / 2], tabWidth, thickness), teeth([ribDepth / 2], ribEndTab, ribLeft),
  ])
  const part = (name: ExtensionPartName, label: string, width: number, height: number, count: number, contours: Contour[]): ExtensionPart => ({ name, label, width, height, count, thickness, contours, holes: [], slots: [] })
  const parts = [
    part('top', 'Working top', length, width, 1, [top, ...ribStations.map(x => rect(x - (thickness + clearance) / 2, width / 2 - (tabWidth + clearance) / 2, thickness + clearance, tabWidth + clearance))]),
    part('longSide', 'Tapered side', length, height, 2, [side, window, ...ribStations.map(ribSlot)]),
    part('nearEnd', 'Mounting end', width, height, 1, [endOutline(height, rootJoints), ...mountingCuts]),
    part('farEnd', 'Free end', width, tipHeight, 1, [endOutline(tipHeight, [tipJoint])]),
    part('crossRib', 'Cross tie', width, ribDepth + thickness, 2, [rib]),
  ]
  for (const part of parts) {
    if (part.name !== 'crossRib') part.holes = grid(part, part.name === 'nearEnd' ? [pivot] : [])
    validatePart(part)
  }
  return parts
}

/** X points away from the host table; the working top is horizontal and Z is up. */
export const extensionAssembly = (config: ExtensionConfig = extensionDefaults): ExtensionPlacement[] => {
  assertConfig(config)
  const { length, width, height, thickness } = config
  const { tipHeight, ribStations } = extensionDimensions(config)
  const top: ExtensionPlacement['axes'] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const side: ExtensionPlacement['axes'] = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
  const end: ExtensionPlacement['axes'] = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
  return [
    { part: 'top', instance: 0, origin: [0, 0, height - thickness / 2], axes: top },
    { part: 'longSide', instance: 0, origin: [0, thickness / 2, 0], axes: side },
    { part: 'longSide', instance: 1, origin: [0, width - thickness / 2, 0], axes: side },
    { part: 'nearEnd', instance: 0, origin: [thickness / 2, 0, 0], axes: end },
    { part: 'farEnd', instance: 0, origin: [length - thickness / 2, 0, height - tipHeight], axes: end },
    ...ribStations.map((x, instance): ExtensionPlacement => ({ part: 'crossRib', instance, origin: [x, 0, height - thickness - ribDepth], axes: end })),
  ]
}
