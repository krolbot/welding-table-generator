import { FabricationError, pointInContour as inside, type Contour, type FabricationPart, type Point } from '../geometry'
import { nativeContourBounds, nativeContourDistance, nativePointContourDistance } from '../contourGeometry'

const epsilon = 1e-6
const point = (x: number, y: number): Point => ({ x, y })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const arcPoint = (center: Point, radius: number, degrees: number): Point => {
  const angle = degrees * Math.PI / 180
  return point(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle))
}
const endpoint = (segment: Contour[number], end: 'from' | 'to') => segment.type === 'line'
  ? segment[end] : arcPoint(segment.center, segment.radius, end === 'from' ? segment.start : segment.end)

export const validateToolPart = (part: FabricationPart, { holeWeb, cutWeb }: { holeWeb: number; cutWeb: number }) => {
  const [outer, ...cuts] = part.contours
  for (const contour of part.contours) {
    if (!contour.length || contour.some((segment, index) => distance(endpoint(segment, 'to'), endpoint(contour[(index + 1) % contour.length], 'from')) > epsilon)) throw new FabricationError('contour-closure', `${part.name} contour is not closed`, { part: part.name })
    const bounds = nativeContourBounds(contour)
    if (Object.values(bounds).some(value => !Number.isFinite(value)) || bounds.minX < -epsilon || bounds.minY < -epsilon || bounds.maxX > part.width + epsilon || bounds.maxY > part.height + epsilon) throw new FabricationError('contour-bounds', `${part.name} contour is outside the blank`, { part: part.name })
  }
  for (const [index, cut] of cuts.entries()) {
    if (!inside(endpoint(cut[0], 'from'), outer) || nativeContourDistance(cut, outer) < cutWeb - epsilon) throw new FabricationError('cut-clearance', `${part.name} cut violates the outer web`, { part: part.name })
    for (const other of cuts.slice(index + 1)) if (nativeContourDistance(cut, other) < cutWeb - epsilon || inside(endpoint(cut[0], 'from'), other) || inside(endpoint(other[0], 'from'), cut)) throw new FabricationError('cut-clearance', `${part.name} cuts overlap or leave insufficient web`, { part: part.name })
  }
  for (const [index, hole] of part.holes.entries()) {
    if (!inside(hole, outer) || nativePointContourDistance(hole, outer) < hole.d / 2 + holeWeb - epsilon
      || cuts.some(cut => inside(hole, cut) || nativePointContourDistance(hole, cut) < hole.d / 2 + holeWeb - epsilon)
      || part.holes.slice(index + 1).some(other => distance(hole, other) < (hole.d + other.d) / 2 + holeWeb - epsilon)) throw new FabricationError('hole-clearance', `${part.name} hole violates the material web`, { part: part.name, hole: hole.id })
  }
}
