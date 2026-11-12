import {
  area, difference, EndType, FillRule, inflatePaths, JoinType, minkowskiDiff,
  simplifyPath, translatePath, union, type Path64, type Paths64,
} from 'clipper2-ts'
import type { Point } from './geometry'

// All Clipper operations use explicit integer micrometres, never the two-decimal D wrappers.
const scale = 1000
const maxPairVertices = 16384
const maxCacheVertices = 250000
const positive = (path: Path64) => area(path) < 0 ? path.slice().reverse() : path
const integerPath = (points: readonly Point[]) => positive(points.map(p => ({ x: Math.round(p.x * scale), y: Math.round(p.y * scale) })))
const rotate = (p: Point, degrees: number): Point => {
  const angle = degrees * Math.PI / 180
  return { x: Math.round(p.x * Math.cos(angle) - p.y * Math.sin(angle)), y: Math.round(p.x * Math.sin(angle) + p.y * Math.cos(angle)) }
}

export type ContactShape = { id: number; rotation: number; points: Point[]; error: number }
export type Obstacle = { shape: ContactShape; translation: Point }

/** Filled overlap region, including complete containment in either direction.
 * Clipper's boundary sweep alone has an unsafe hole when one solid contains the other.
 * A-B[0] and A[0]-B fill exactly those containment cases, not every hole indiscriminately.
 */
export const solidNoFit = (a: Path64, b: Path64): Paths64 => union([
  ...minkowskiDiff(b, a, true),
  translatePath(a, -b[0].x, -b[0].y),
  positive(b.map(p => ({ x: a[0].x - p.x, y: a[0].y - p.y }))),
], FillRule.NonZero)

export class ContactCache {
  private readonly paths = new Map<string, Paths64>()
  private vertices = 0
  hits = 0
  misses = 0
  coarsened = 0

  private get(a: ContactShape, b: ContactShape, clearance: number): Paths64 {
    const relative = (b.rotation - a.rotation + 360) % 360
    const key = `${a.id}:${b.id}:${relative}:${clearance}`
    let value = this.paths.get(key)
    if (value) { this.hits++; return value }
    this.misses++
    // Rotation covariance shares contact geometry across all absolute orientations.
    let pa = integerPath(a.points.map(p => {
      const r = -a.rotation * Math.PI / 180
      return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
    }))
    let pb = integerPath(b.points.map(p => {
      const r = -a.rotation * Math.PI / 180
      return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
    }))
    let simplification = 0
    while (pa.length * pb.length > maxPairVertices && simplification < 2 * scale) {
      simplification = simplification ? simplification * 2 : 0.025 * scale
      pa = positive(simplifyPath(pa, simplification))
      pb = positive(simplifyPath(pb, simplification))
    }
    if (simplification) this.coarsened++
    if (pa.length * pb.length > maxPairVertices) throw new Error('Contour is too complex for the bounded contact search')
    // Round-offset chords and integer conversion get their own reserve, in addition to input arc errors.
    const offsetTolerance = 0.01
    const guard = clearance + a.error + b.error + offsetTolerance + 0.004 + 2 * simplification / scale
    value = inflatePaths(solidNoFit(pa, pb), guard * scale, JoinType.Round, EndType.Polygon, 2, offsetTolerance * scale)
    const size = value.reduce((sum, path) => sum + path.length, 0)
    while (this.vertices + size > maxCacheVertices && this.paths.size) {
      const oldest = this.paths.keys().next().value!
      const removed = this.paths.get(oldest)!
      this.vertices -= removed.reduce((sum, path) => sum + path.length, 0)
      this.paths.delete(oldest)
    }
    if (size <= maxCacheVertices) { this.paths.set(key, value); this.vertices += size }
    return value
  }

  candidates(shape: ContactShape, obstacles: readonly Obstacle[], region: { minX: number; minY: number; maxX: number; maxY: number }, clearance: number): Point[] {
    // Round inward: candidates may never exceed the analytically inset sheet bounds.
    const left = Math.ceil(region.minX * scale), bottom = Math.ceil(region.minY * scale)
    const right = Math.floor(region.maxX * scale), top = Math.floor(region.maxY * scale)
    if (left > right || bottom > top) return []
    const corners = [{ x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: top }, { x: left, y: top }]
    const forbidden = obstacles.flatMap(obstacle => this.get(obstacle.shape, shape, clearance).map(path => path.map(p => {
      const rotated = rotate(p, obstacle.shape.rotation)
      return { x: rotated.x + Math.round(obstacle.translation.x * scale), y: rotated.y + Math.round(obstacle.translation.y * scale) }
    })))
    // Includes NFP intersections with each other and sheet edges, not just raw NFP vertices.
    const feasible = left === right || bottom === top ? [] : difference([corners], forbidden, FillRule.NonZero)
    const unique = new Map<string, Point>()
    for (const p of [...corners, ...feasible.flat()]) unique.set(`${p.x}:${p.y}`, { x: p.x / scale, y: p.y / scale })
    return [...unique.values()]
  }
}
