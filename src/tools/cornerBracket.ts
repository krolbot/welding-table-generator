import { contourPoints, type Contour, type FabricationPart, type Hole, type Point } from '../geometry'
import { jointOutline, type EdgeJoint } from '../fabricationProfiles'
import { nativeContourBounds, nativeContourDistance, nativePointContourDistance } from '../contourGeometry'

export type CornerBracketConfig = {
  length: number; width: number; height: number; thickness: number
  holeDiameter: number; holePitch: number; slotLength: number
  cornerCut: number; tipWidth: number; tabWidth: number; clearance: number
}
export const cornerBracketDefaults: CornerBracketConfig = {
  length: 210, width: 210, height: 60, thickness: 8,
  holeDiameter: 16, holePitch: 50, slotLength: 150,
  cornerCut: 45, tipWidth: 50, tabWidth: 20, clearance: 0.2,
}
export const cornerBracketLimits: Record<keyof CornerBracketConfig, { min: number; max: number; step: number }> = {
  length: { min: 160, max: 600, step: 10 }, width: { min: 160, max: 600, step: 10 },
  height: { min: 40, max: 150, step: 5 }, thickness: { min: 4, max: 12, step: 1 },
  holeDiameter: { min: 6, max: 28, step: 1 }, holePitch: { min: 25, max: 100, step: 5 },
  slotLength: { min: 30, max: 500, step: 10 }, cornerCut: { min: 10, max: 100, step: 5 },
  tipWidth: { min: 25, max: 150, step: 5 }, tabWidth: { min: 10, max: 40, step: 5 },
  clearance: { min: 0, max: 1, step: 0.1 },
}
export type CornerBracketPartName = 'cornerBase' | 'cornerHoleWall' | 'cornerSlotWall'
type BracketPart = FabricationPart<CornerBracketPartName>
type Vector3 = [number, number, number]
export type CornerBracketPlacement = { part: CornerBracketPartName; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }
const web = 5
const epsilon = 1e-6
const point = (x: number, y: number): Point => ({ x, y })

/** Outside envelope is preserved; unmeasured profile/joint dimensions are explicitly proposed. */
export const cornerBracketDimensions = (config: CornerBracketConfig) => {
  const { length, width, height, thickness, cornerCut, holePitch, clearance } = config
  const stations = (span: number) => [1, 2].map(index => cornerCut + (span - cornerCut) * index / 3)
  const wallBottom = thickness + clearance / 2
  return {
    xJoints: stations(length), yJoints: stations(width), wallBottom,
    wallStart: thickness + clearance / 2,
    holeOrigin: point((length - 3 * holePitch) / 2, (width - 3 * holePitch) / 2),
    wallHoleHeight: (wallBottom + height) / 2,
    tabWidth: config.tabWidth, clearance,
  }
}

const inside = (p: Point, contour: Contour) => {
  const vertices = contourPoints(contour, 64)
  let result = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}

const capsule = (x: number, y: number, length: number, diameter: number): Contour => {
  const r = diameter / 2, a = x - (length - diameter) / 2, b = x + (length - diameter) / 2
  return [
    { type: 'line', from: point(a, y - r), to: point(b, y - r) },
    { type: 'arc', center: point(b, y), radius: r, start: 270, end: 450 },
    { type: 'line', from: point(b, y + r), to: point(a, y + r) },
    { type: 'arc', center: point(a, y), radius: r, start: 90, end: 270 },
  ]
}

const validatePart = (part: BracketPart) => {
  const [outer, ...cuts] = part.contours
  for (const contour of part.contours) {
    const bounds = nativeContourBounds(contour)
    if (Object.values(bounds).some(value => !Number.isFinite(value)) || bounds.minX < -epsilon || bounds.minY < -epsilon || bounds.maxX > part.width + epsilon || bounds.maxY > part.height + epsilon) throw new Error(`${part.label}: contour is outside the blank`)
    for (let i = 0; i < contour.length; i++) for (let j = i + 2; j < contour.length; j++) {
      if (i === 0 && j === contour.length - 1) continue
      if (nativeContourDistance([contour[i]], [contour[j]]) < epsilon) throw new Error(`${part.label}: profile edges intersect`)
    }
  }
  for (const cut of cuts) {
    if (!inside(contourPoints(cut, 64)[0], outer) || nativeContourDistance(cut, outer) < web - epsilon) throw new Error(`${part.label}: slot needs at least ${web} mm of material to every edge`)
  }
  for (const [index, hole] of part.holes.entries()) {
    if (!inside(hole, outer) || nativePointContourDistance(hole, outer) < hole.d / 2 + web - epsilon
      || cuts.some(cut => inside(hole, cut) || nativePointContourDistance(hole, cut) < hole.d / 2 + web - epsilon)
      || part.holes.slice(index + 1).some(other => Math.hypot(other.x - hole.x, other.y - hole.y) < (hole.d + other.d) / 2 + web - epsilon))
      throw new Error(`${part.label}: all mounting holes must retain at least ${web} mm of material to every cut and each other; adjust the size, pitch or profile`)
  }
}

export const cornerBracketParts = (config: CornerBracketConfig = cornerBracketDefaults): BracketPart[] => {
  for (const key of Object.keys(cornerBracketLimits) as Array<keyof CornerBracketConfig>) {
    const value = config[key], { min, max } = cornerBracketLimits[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Corner bracket ${key} must be between ${min} and ${max} mm`)
  }
  const { length, width, height, thickness, holeDiameter, holePitch, slotLength, cornerCut, tipWidth, tabWidth, clearance } = config
  if (cornerCut >= Math.min(length, width) / 2 || tipWidth >= Math.min(length, width) / 2) throw new Error('Corner cuts must leave two long seating edges and an open diagonal side')
  if (slotLength <= holeDiameter) throw new Error('Clamp slot length must exceed its width')
  const { xJoints, yJoints, wallBottom, wallStart, wallHoleHeight, holeOrigin } = cornerBracketDimensions(config)
  const joints = (centres: number[], width: number, depth: number): EdgeJoint[] => centres.map(centre => ({ centre, width, depth }))
  const base = jointOutline([
    point(cornerCut, 0), point(length, 0), point(length, tipWidth),
    point(tipWidth, width), point(0, width), point(0, cornerCut),
  ], [
    joints(xJoints.map(x => x - cornerCut), tabWidth + clearance, -wallBottom), [], [], [],
    joints(yJoints.map(y => width - y), tabWidth + clearance, -wallBottom), [],
  ])
  const wall = (span: number, start: number, stations: number[]) => jointOutline([
    point(start, wallBottom), point(span, wallBottom), point(span, height), point(start, height),
  ], [joints(stations.map(x => x - start), tabWidth, wallBottom), [], [], []])
  const hole = (id: string, x: number, y: number): Hole => ({ id, x, y, d: holeDiameter, kind: 'mount' })
  const baseHoles: Hole[] = []
  // Nine fixed mounting positions: triangular four-row grid, with the relieved elbow position absent.
  for (let row = 0; row < 4; row++) for (let column = 0; column < 4 - row; column++) {
    if (row === 0 && column === 0) continue
    baseHoles.push(hole(`base:${column}:${row}`, holeOrigin.x + column * holePitch, holeOrigin.y + row * holePitch))
  }
  const part = (name: CornerBracketPartName, label: string, width: number, height: number, contours: Contour[], holes: Hole[]): BracketPart => ({ name, label, width, height, thickness, count: 1, contours, holes, slots: [] })
  const parts = [
    part('cornerBase', 'Corner base', length, width, [base], baseHoles),
    part('cornerHoleWall', 'Perforated wall', length, height, [wall(length, wallStart, xJoints)], [-1, 0, 1].map((index, i) => hole(`wall:${i}`, length / 2 + index * holePitch, wallHoleHeight))),
    part('cornerSlotWall', 'Slotted wall', width, height, [wall(width, 0, yJoints), capsule(width / 2, wallHoleHeight, slotLength, holeDiameter)], []),
  ]
  parts.forEach(validatePart)
  return parts
}

/** Base in XY, perforated wall at Y=0, slotted wall at X=0; Z up, diagonal side open. */
export const cornerBracketAssembly = (config: CornerBracketConfig = cornerBracketDefaults): CornerBracketPlacement[] => [
  { part: 'cornerBase', instance: 0, origin: [0, 0, config.thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  { part: 'cornerHoleWall', instance: 0, origin: [0, config.thickness / 2, 0], axes: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },
  { part: 'cornerSlotWall', instance: 0, origin: [config.thickness / 2, 0, 0], axes: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] },
]
