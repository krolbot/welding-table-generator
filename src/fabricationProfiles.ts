import type { Contour, Point } from './contourGeometry'
import { FabricationError } from './geometry'

const point = (x: number, y: number): Point => ({ x, y })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const line = (from: Point, to: Point): Contour[number] => ({ type: 'line', from, to })

/** True circular fillets on a convex counter-clockwise polygon. */
export const roundedConvexPolygon = (vertices: Point[], radius: number): Contour => {
  if (vertices.length < 3 || !Number.isFinite(radius) || radius <= 0) throw new FabricationError('invalid-dimensions', 'A rounded polygon needs vertices and a positive radius')
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
    if (corner.tangent + next.tangent >= distance(vertices[index], vertices[(index + 1) % vertices.length])) throw new FabricationError('cut-clearance', 'Access-window fillets do not fit')
    return [
      { type: 'arc', center: corner.center, radius, start: Math.atan2(corner.entry.y - corner.center.y, corner.entry.x - corner.center.x) * 180 / Math.PI, end: Math.atan2(corner.exit.y - corner.center.y, corner.exit.x - corner.center.x) * 180 / Math.PI },
      line(corner.exit, next.entry),
    ]
  })
}


export type EdgeJoint = { centre: number; width: number; depth: number }

export const polygonContour = (vertices: Point[]): Contour => vertices.map((from, index) => ({
  type: 'line', from, to: vertices[(index + 1) % vertices.length],
}))

/** Positive depth projects outwards from a counter-clockwise outline; negative depth makes a notch. */
export const jointOutline = (vertices: Point[], joints: EdgeJoint[][]): Contour => {
  const points: Point[] = []
  vertices.forEach((from, index) => {
    const to = vertices[(index + 1) % vertices.length], length = Math.hypot(to.x - from.x, to.y - from.y)
    const ux = (to.x - from.x) / length, uy = (to.y - from.y) / length
    const at = (along: number, depth = 0) => ({ x: from.x + along * ux + depth * uy, y: from.y + along * uy - depth * ux })
    points.push(from)
    let previous = 0
    for (const joint of [...(joints[index] ?? [])].sort((a, b) => a.centre - b.centre)) {
      const start = joint.centre - joint.width / 2, end = joint.centre + joint.width / 2
      if (start <= previous || end >= length) throw new Error('Locating joints do not fit the edge')
      points.push(at(start), at(start, joint.depth), at(end, joint.depth), at(end))
      previous = end
    }
  })
  return polygonContour(points)
}
