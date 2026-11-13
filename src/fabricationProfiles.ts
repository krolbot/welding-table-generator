import type { Contour, Point } from './contourGeometry'

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
