import { nativeContourBounds } from './contourGeometry'
import type { ArcSegment, ContourSegment, FabricationPart, Point } from './geometry'

export type DrawingInstance = { part: FabricationPart; position: Point; rotation: number }
export type SnapPoint = Point & { kind: 'free' | 'vertex' | 'midpoint' | 'centre' | 'edge'; label: string }
type Anchor = { point: Point; kind: Exclude<SnapPoint['kind'], 'free' | 'edge'>; label: string }
export type DrawingFeatures = { anchors: Anchor[]; edges: Array<{ segment: ContourSegment; label: string }>; targets: Array<{ label: string; bounds: DrawingBounds }> }
export type Measurement = { id: string; start: SnapPoint; end: SnapPoint }
export type DrawingCamera = { scale: number; x: number; y: number }
export type DrawingBounds = { width: number; height: number; x?: number; y?: number }
const radians = (degrees: number) => degrees * Math.PI / 180
const mod = (degrees: number) => (degrees % 360 + 360) % 360
const arcPoint = (arc: ArcSegment, angle: number): Point => ({ x: arc.center.x + arc.radius * Math.cos(radians(angle)), y: arc.center.y + arc.radius * Math.sin(radians(angle)) })
const arcSweep = (arc: ArcSegment) => (arc.clockwise ? -1 : 1) * (mod(arc.clockwise ? arc.start - arc.end : arc.end - arc.start) || 360)
const onArc = (arc: ArcSegment, angle: number) => mod(arc.clockwise ? arc.start - angle : angle - arc.start) <= Math.abs(arcSweep(arc)) + 1e-8
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export function drawingFeatures(instances: DrawingInstance[]): DrawingFeatures {
  const features: DrawingFeatures = { anchors: [], edges: [], targets: [] }
  for (const { part, position, rotation } of instances) {
    const cos = Math.cos(radians(rotation)), sin = Math.sin(radians(rotation))
    const transform = (p: Point): Point => ({ x: position.x + p.x * cos - p.y * sin, y: position.y + p.x * sin + p.y * cos })
    const box = nativeContourBounds(part.contours[0])
    const corners = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }].map(transform)
    const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y))
    features.targets.push({ label: part.label, bounds: { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y } })
    const anchor = (point: Point, kind: Anchor['kind']) => features.anchors.push({ point, kind, label: part.label })
    for (const contour of part.contours) for (const original of contour) {
      const segment: ContourSegment = original.type === 'line'
        ? { type: 'line', from: transform(original.from), to: transform(original.to) }
        : { ...original, center: transform(original.center), start: original.start + rotation, end: original.end + rotation }
      features.edges.push({ segment, label: part.label })
      if (segment.type === 'line') {
        anchor(segment.from, 'vertex'); anchor(segment.to, 'vertex')
        anchor({ x: (segment.from.x + segment.to.x) / 2, y: (segment.from.y + segment.to.y) / 2 }, 'midpoint')
      } else {
        anchor(arcPoint(segment, segment.start), 'vertex'); anchor(arcPoint(segment, segment.end), 'vertex')
        anchor(arcPoint(segment, segment.start + arcSweep(segment) / 2), 'midpoint')
        anchor(segment.center, 'centre')
      }
    }
    for (const hole of part.holes) {
      const center = transform(hole)
      anchor(center, 'centre')
      const circle: ArcSegment = { type: 'arc', center, radius: hole.d / 2, start: rotation, end: rotation + 360 }
      features.edges.push({ segment: circle, label: part.label })
      for (const angle of [0, 90, 180, 270]) anchor(arcPoint(circle, angle + rotation), 'vertex')
    }
  }
  return features
}

function nearestEdge(point: Point, segment: ContourSegment): Point {
  if (segment.type === 'line') {
    const dx = segment.to.x - segment.from.x, dy = segment.to.y - segment.from.y
    const squared = dx * dx + dy * dy
    const t = squared ? Math.max(0, Math.min(1, ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy) / squared)) : 0
    return { x: segment.from.x + t * dx, y: segment.from.y + t * dy }
  }
  const angle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x) * 180 / Math.PI
  if (onArc(segment, angle)) return arcPoint(segment, angle)
  const start = arcPoint(segment, segment.start), end = arcPoint(segment, segment.end)
  return distance(point, start) <= distance(point, end) ? start : end
}

export function snapDrawingPoint(point: Point, features: Pick<DrawingFeatures, 'anchors' | 'edges'>, tolerance: number): SnapPoint {
  let nearest: SnapPoint = { ...point, kind: 'free', label: '' }, best = tolerance
  for (const anchor of features.anchors) {
    const gap = distance(point, anchor.point)
    if (gap < best) { nearest = { ...anchor.point, kind: anchor.kind, label: anchor.label }; best = gap }
  }
  // Explicit datums win over an arbitrary nearby point on the boundary.
  if (nearest.kind !== 'free') return nearest
  for (const { segment, label } of features.edges) {
    const candidate = nearestEdge(point, segment), gap = distance(point, candidate)
    if (gap < best) { nearest = { ...candidate, kind: 'edge', label }; best = gap }
  }
  return nearest
}

export const measurementValues = ({ start, end }: Pick<Measurement, 'start' | 'end'>) => ({
  length: distance(start, end), dx: end.x - start.x, dy: end.y - start.y,
  angle: Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI,
})

export const drawingPoint = (screen: Point, camera: DrawingCamera): Point => ({ x: (screen.x - camera.x) / camera.scale, y: (camera.y - screen.y) / camera.scale })
export const screenPoint = (point: Point, camera: DrawingCamera): Point => ({ x: camera.x + point.x * camera.scale, y: camera.y - point.y * camera.scale })
export function fitDrawing(bounds: DrawingBounds, viewport: DrawingBounds): DrawingCamera {
  const scale = Math.max(0.0001, Math.min(Math.max(1, viewport.width - 64) / Math.max(1, bounds.width), Math.max(1, viewport.height - 64) / Math.max(1, bounds.height)))
  return { scale, x: (viewport.width - bounds.width * scale) / 2 - (bounds.x ?? 0) * scale, y: (viewport.height + bounds.height * scale) / 2 + (bounds.y ?? 0) * scale }
}
export function resizeDrawing(camera: DrawingCamera, previous: DrawingBounds, next: DrawingBounds, framing: DrawingBounds): DrawingCamera {
  const centre = drawingPoint({ x: previous.width / 2, y: previous.height / 2 }, camera)
  const scale = camera.scale * fitDrawing(framing, next).scale / fitDrawing(framing, previous).scale
  return { scale, x: next.width / 2 - centre.x * scale, y: next.height / 2 + centre.y * scale }
}
export function zoomDrawing(camera: DrawingCamera, anchor: Point, requested: number, limits: { min: number; max: number }): DrawingCamera {
  const scale = Math.max(limits.min, Math.min(limits.max, requested)), ratio = scale / camera.scale
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio }
}
