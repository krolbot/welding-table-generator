import type { Contour, Point } from './geometry'

type Segment = Contour[number]
type Arc = Extract<Segment, { type: 'arc' }>
type Line = Extract<Segment, { type: 'line' }>
const eps = 1e-8
const mod = (degrees: number) => (degrees % 360 + 360) % 360
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
const onArc = (arc: Arc, degrees: number) => arc.clockwise
  ? mod(arc.start - degrees) <= (mod(arc.start - arc.end) || 360) + eps
  : mod(degrees - arc.start) <= (mod(arc.end - arc.start) || 360) + eps
const arcPoint = (arc: Arc, degrees: number): Point => ({ x: arc.center.x + arc.radius * Math.cos(degrees * Math.PI / 180), y: arc.center.y + arc.radius * Math.sin(degrees * Math.PI / 180) })
const ends = (segment: Segment): [Point, Point] => segment.type === 'line' ? [segment.from, segment.to] : [arcPoint(segment, segment.start), arcPoint(segment, segment.end)]
const pointLine = (p: Point, line: Line) => {
  const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y
  const square = dx * dx + dy * dy
  const t = square ? Math.max(0, Math.min(1, ((p.x - line.from.x) * dx + (p.y - line.from.y) * dy) / square)) : 0
  return distance(p, { x: line.from.x + t * dx, y: line.from.y + t * dy })
}
const pointArc = (p: Point, arc: Arc) => onArc(arc, angle(arc.center, p))
  ? Math.abs(distance(p, arc.center) - arc.radius)
  : Math.min(...ends(arc).map(end => distance(p, end)))
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const lineLine = (a: Line, b: Line) => {
  const c1 = cross(a.from, a.to, b.from), c2 = cross(a.from, a.to, b.to)
  const c3 = cross(b.from, b.to, a.from), c4 = cross(b.from, b.to, a.to)
  if ((c1 > 0) !== (c2 > 0) && (c3 > 0) !== (c4 > 0)) return 0
  return Math.min(pointLine(a.from, b), pointLine(a.to, b), pointLine(b.from, a), pointLine(b.to, a))
}
const lineArc = (line: Line, arc: Arc) => {
  let best = Math.min(...ends(line).map(p => pointArc(p, arc)), ...ends(arc).map(p => pointLine(p, line)))
  const dx = line.to.x - line.from.x, dy = line.to.y - line.from.y
  const squared = dx * dx + dy * dy
  if (!squared) return best
  const fx = line.from.x - arc.center.x, fy = line.from.y - arc.center.y
  const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - arc.radius ** 2
  const discriminant = b * b - 4 * squared * c
  if (discriminant >= -eps) {
    for (const sign of [-1, 1]) {
      const t = (-b + sign * Math.sqrt(Math.max(0, discriminant))) / (2 * squared)
      const p = { x: line.from.x + t * dx, y: line.from.y + t * dy }
      if (t >= -eps && t <= 1 + eps && onArc(arc, angle(arc.center, p))) return 0
    }
  }
  // Interior extrema are circle points whose radius is perpendicular to the line.
  const normal = Math.atan2(dx, -dy) * 180 / Math.PI
  for (const degrees of [normal, normal + 180]) if (onArc(arc, degrees)) best = Math.min(best, pointLine(arcPoint(arc, degrees), line))
  return best
}
const arcArc = (a: Arc, b: Arc) => {
  let best = Math.min(...ends(a).map(p => pointArc(p, b)), ...ends(b).map(p => pointArc(p, a)))
  const d = distance(a.center, b.center)
  if (d < eps) return best // Concentric arc extrema are captured by endpoints/radial projections.
  const direction = angle(a.center, b.center)
  for (const da of [direction, direction + 180]) for (const db of [direction, direction + 180]) {
    if (onArc(a, da) && onArc(b, db)) best = Math.min(best, distance(arcPoint(a, da), arcPoint(b, db)))
  }
  if (d <= a.radius + b.radius + eps && d >= Math.abs(a.radius - b.radius) - eps) {
    const x = (a.radius ** 2 - b.radius ** 2 + d * d) / (2 * d)
    const h = Math.sqrt(Math.max(0, a.radius ** 2 - x * x))
    const ux = (b.center.x - a.center.x) / d, uy = (b.center.y - a.center.y) / d
    for (const sign of [-1, 1]) {
      const p = { x: a.center.x + x * ux - sign * h * uy, y: a.center.y + x * uy + sign * h * ux }
      if (onArc(a, angle(a.center, p)) && onArc(b, angle(b.center, p))) return 0
    }
  }
  return best
}

export const nativeContourBounds = (contour: Contour) => {
  const points = contour.flatMap(segment => segment.type === 'line' ? ends(segment) : [
    ...ends(segment), ...[0, 90, 180, 270].filter(degrees => onArc(segment, degrees)).map(degrees => arcPoint(segment, degrees)),
  ])
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) }
}

/** Analytic boundary distance. Containment must be checked separately (positive boundary distance is not separation). */
export const nativePointContourDistance = (point: Point, contour: Contour): number => Math.min(...contour.map(segment =>
  segment.type === 'line' ? pointLine(point, segment) : pointArc(point, segment)))

export const nativeContourDistance = (a: Contour, b: Contour): number => {
  let closest = Infinity
  for (const left of a) for (const right of b) {
    const value = left.type === 'line'
      ? right.type === 'line' ? lineLine(left, right) : lineArc(left, right)
      : right.type === 'line' ? lineArc(right, left) : arcArc(left, right)
    closest = Math.min(closest, value)
    if (closest < eps) return 0
  }
  return closest
}
