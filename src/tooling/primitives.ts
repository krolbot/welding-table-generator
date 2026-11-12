import type { ArcSegment, Contour, Hole, LineSegment, Point, Slot } from '../geometry.js'
import { materialDensityKgPerMm3, type AssemblyTransform, type PartInput, type Point3, type SheetPart } from './model.js'

const EPS = 1e-8
export const pt = (x: number, y: number): Point => ({ x, y })
export const line = (from: Point, to: Point): LineSegment => ({ type: 'line', from, to })
export const arc = (center: Point, radius: number, start: number, end: number, clockwise = false): ArcSegment => ({
  type: 'arc', center, radius, start, end, ...(clockwise ? { clockwise: true } : {}),
})

export const polygon = (points: readonly Point[]): Contour => points.map((from, index) => line(from, points[(index + 1) % points.length]))
export const rectangle = (width: number, height: number, center = pt(0, 0)): Contour => polygon([
  pt(center.x - width / 2, center.y - height / 2),
  pt(center.x + width / 2, center.y - height / 2),
  pt(center.x + width / 2, center.y + height / 2),
  pt(center.x - width / 2, center.y + height / 2),
])

export const chamferedRectangle = (width: number, height: number, chamfer: number): Contour => polygon([
  pt(-width / 2 + chamfer, -height / 2), pt(width / 2 - chamfer, -height / 2),
  pt(width / 2, -height / 2 + chamfer), pt(width / 2, height / 2 - chamfer),
  pt(width / 2 - chamfer, height / 2), pt(-width / 2 + chamfer, height / 2),
  pt(-width / 2, height / 2 - chamfer), pt(-width / 2, -height / 2 + chamfer),
])

/** Closed obround cut with native tangent lines and semicircular arcs. */
export const capsule = (length: number, width: number, center = pt(0, 0), angleDeg = 0): Contour => {
  const radius = width / 2
  const halfStraight = (length - width) / 2
  const raw: Contour = [
    line(pt(-halfStraight, -radius), pt(halfStraight, -radius)),
    arc(pt(halfStraight, 0), radius, -90, 90),
    line(pt(halfStraight, radius), pt(-halfStraight, radius)),
    arc(pt(-halfStraight, 0), radius, 90, 270),
  ]
  return transformContour(raw, center, angleDeg)
}

/** Closed annular-sector slot: two radial arcs joined by end lines. */
export const radialSlot = (center: Point, radius: number, width: number, startDeg: number, endDeg: number): Contour => {
  const outer = radius + width / 2
  const inner = radius - width / 2
  const polar = (r: number, angle: number) => pt(center.x + r * Math.cos(angle * Math.PI / 180), center.y + r * Math.sin(angle * Math.PI / 180))
  return [
    arc(center, outer, startDeg, endDeg),
    line(polar(outer, endDeg), polar(inner, endDeg)),
    arc(center, inner, endDeg, startDeg, true),
    line(polar(inner, startDeg), polar(outer, startDeg)),
  ]
}

export const transformContour = (contour: Contour, translation: Point, angleDeg: number): Contour => {
  const angle = angleDeg * Math.PI / 180
  const rotate = (point: Point) => pt(
    translation.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    translation.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  )
  return contour.map(segment => segment.type === 'line'
    ? line(rotate(segment.from), rotate(segment.to))
    : arc(rotate(segment.center), segment.radius, segment.start + angleDeg, segment.end + angleDeg, Boolean(segment.clockwise)))
}

export const circleHole = (id: string, x: number, y: number, d: number, kind: Hole['kind'] = 'mount'): Hole => ({ id, x, y, d, kind })
export const slotBox = (x: number, y: number, width: number, height: number): Slot => ({ x, y, width, height })

export const gridHoles = (width: number, height: number, diameter: number, pitch: number, margin: number, idPrefix = 'grid'): Hole[] => {
  const nx = Math.floor((width - 2 * margin) / pitch) + 1
  const ny = Math.floor((height - 2 * margin) / pitch) + 1
  if (nx < 1 || ny < 1) return []
  return Array.from({ length: nx * ny }, (_, index) => {
    const ix = index % nx
    const iy = Math.floor(index / nx)
    return circleHole(`${idPrefix}-${ix}-${iy}`, (ix - (nx - 1) / 2) * pitch, (iy - (ny - 1) / 2) * pitch, diameter, 'grid')
  })
}

export const makePart = (input: PartInput): SheetPart => {
  const material = input.material ?? 'S235JR'
  return {
    name: input.name,
    role: input.role,
    width: input.width,
    height: input.height,
    thickness: input.thickness,
    count: input.count ?? 1,
    material,
    densityKgPerMm3: materialDensityKgPerMm3[material],
    process: 'laser-cut',
    holes: input.holes ?? [],
    slots: input.slots ?? [],
    contours: input.contours,
    label: input.label ?? input.name,
    interfaces: input.interfaces ?? [],
  }
}

export const identityTransform = (x = 0, y = 0, z = 0): AssemblyTransform => ({
  units: 'mm', translation: { x, y, z }, rotation: { x: 0, y: 0, z: 0, unit: 'deg', order: 'XYZ' },
})
export const transform = (translation: Point3, rotation: Point3 = { x: 0, y: 0, z: 0 }): AssemblyTransform => ({
  units: 'mm', translation, rotation: { ...rotation, unit: 'deg', order: 'XYZ' },
})

const rotateX = (p: Point3, degrees: number): Point3 => {
  const a = degrees * Math.PI / 180
  return { x: p.x, y: p.y * Math.cos(a) - p.z * Math.sin(a), z: p.y * Math.sin(a) + p.z * Math.cos(a) }
}
const rotateY = (p: Point3, degrees: number): Point3 => {
  const a = degrees * Math.PI / 180
  return { x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) }
}
const rotateZ = (p: Point3, degrees: number): Point3 => {
  const a = degrees * Math.PI / 180
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a), z: p.z }
}

export const applyTransform = (p: Point3, t: AssemblyTransform): Point3 => {
  const rotated = rotateZ(rotateY(rotateX(p, t.rotation.x), t.rotation.y), t.rotation.z)
  return { x: rotated.x + t.translation.x, y: rotated.y + t.translation.y, z: rotated.z + t.translation.z }
}
export const applyDirection = (p: Point3, t: AssemblyTransform): Point3 => rotateZ(rotateY(rotateX(p, t.rotation.x), t.rotation.y), t.rotation.z)
export const invertTransform = (p: Point3, t: AssemblyTransform): Point3 => {
  const shifted = { x: p.x - t.translation.x, y: p.y - t.translation.y, z: p.z - t.translation.z }
  return rotateX(rotateY(rotateZ(shifted, -t.rotation.z), -t.rotation.y), -t.rotation.x)
}
export const invertDirection = (p: Point3, t: AssemblyTransform): Point3 => rotateX(rotateY(rotateZ(p, -t.rotation.z), -t.rotation.y), -t.rotation.x)

export const contourEndpoints = (contour: Contour): Array<{ start: Point; end: Point }> => contour.map(segment => {
  if (segment.type === 'line') return { start: segment.from, end: segment.to }
  const at = (degrees: number) => pt(segment.center.x + segment.radius * Math.cos(degrees * Math.PI / 180), segment.center.y + segment.radius * Math.sin(degrees * Math.PI / 180))
  return { start: at(segment.start), end: at(segment.end) }
})
export const isClosedContour = (contour: Contour, tolerance = 1e-5): boolean => {
  if (contour.length < 2) return false
  const endpoints = contourEndpoints(contour)
  return endpoints.every((item, index) => {
    const next = endpoints[(index + 1) % endpoints.length]
    return Math.hypot(item.end.x - next.start.x, item.end.y - next.start.y) <= tolerance
  })
}
export const finitePoint = (point: Point) => Number.isFinite(point.x) && Number.isFinite(point.y)
export const almostEqual = (a: number, b: number, tolerance = EPS) => Math.abs(a - b) <= tolerance
