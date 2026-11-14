import { EndType, inflatePathsD, JoinType } from 'clipper2-ts'
import { FabricationError, fixtureGridPoints, signedContourArea, type Contour, type FabricationPart, type Hole, type Point } from '../geometry'
import { jointOutline, polygonContour, roundedConvexPolygon, type EdgeJoint } from '../fabricationProfiles'
import { validateToolPart } from './fabrication'

export type CompactExtensionConfig = {
  length: number; width: number; height: number; thickness: number
  holeDiameter: number; holePitch: number; holeInset: number
  tipHeight: number; taperRun: number; windowInset: number; windowRadius: number
  tabWidth: number; clearance: number
}
export const compactExtensionDefaults: CompactExtensionConfig = {
  length: 500, width: 100, height: 100, thickness: 6,
  holeDiameter: 16, holePitch: 50, holeInset: 25,
  tipHeight: 40, taperRun: 120, windowInset: 8, windowRadius: 3,
  tabWidth: 20, clearance: 0.2,
}
export const compactExtensionLimits: Record<keyof CompactExtensionConfig, { min: number; max: number; step: number }> = {
  length: { min: 350, max: 800, step: 50 }, width: { min: 80, max: 200, step: 10 },
  height: { min: 80, max: 200, step: 10 }, thickness: { min: 4, max: 9, step: 1 },
  holeDiameter: { min: 10, max: 28, step: 1 }, holePitch: { min: 40, max: 100, step: 5 }, holeInset: { min: 20, max: 50, step: 1 },
  tipHeight: { min: 30, max: 100, step: 5 }, taperRun: { min: 50, max: 250, step: 10 },
  windowInset: { min: 6, max: 15, step: 1 }, windowRadius: { min: 1, max: 8, step: 1 },
  tabWidth: { min: 12, max: 30, step: 1 }, clearance: { min: 0, max: 1, step: 0.1 },
}
export type CompactExtensionPartName = 'compactTop' | 'compactSpine' | 'compactMount'
type Part = FabricationPart<CompactExtensionPartName>
type Vector3 = [number, number, number]
type Placement = { part: CompactExtensionPartName; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }
const holeWeb = 8
const point = (x: number, y: number): Point => ({ x, y })
const rectangle = (x: number, y: number, width: number, height: number) => polygonContour([
  point(x, y), point(x + width, y), point(x + width, y + height), point(x, y + height),
])
const joints = (centres: number[], width: number, depth: number): EdgeJoint[] => centres.map(centre => ({ centre, width, depth }))

export const compactExtensionDimensions = (config: CompactExtensionConfig) => ({
  spineY: config.width / 2,
  spineStart: config.thickness + config.clearance / 2,
  bodyTop: config.height - config.thickness,
  taperStart: config.length - config.taperRun,
  tipBottom: config.height - config.tipHeight,
  topJoints: [config.length / 3, config.length * 2 / 3],
  endJoints: [(config.height - config.thickness) / 3, (config.height - config.thickness) * 2 / 3],
  mountTopJoints: [config.width / 4, config.width * 3 / 4],
  tabWidth: config.tabWidth, clearance: config.clearance,
  holeOrigin: config.holeInset,
})

const assertConfig = (config: CompactExtensionConfig) => {
  for (const key of Object.keys(compactExtensionLimits) as Array<keyof CompactExtensionConfig>) {
    const value = config[key], { min, max } = compactExtensionLimits[key]
    if (!Number.isFinite(value) || value < min || value > max)
      throw new FabricationError('invalid-dimensions', `Compact extension ${key} must be ${min}–${max} mm`, { field: key, min, max })
  }
  if (config.tipHeight >= config.height || config.tipHeight <= config.thickness + 2 * config.windowInset + 2 * config.windowRadius
    || config.taperRun >= config.length / 2 || config.tabWidth + config.clearance >= (config.height - config.thickness) / 3)
    throw new FabricationError('invalid-dimensions', 'The taper, windows and locating joints must fit within the compact extension envelope')
}

/** Three cut plates observed across the references; exact window and joint dimensions are proposed. */
export const compactExtensionParts = (config: CompactExtensionConfig = compactExtensionDefaults): Part[] => {
  assertConfig(config)
  const { length, width, height, thickness, holeDiameter, holePitch, holeInset, tabWidth, clearance, windowInset, windowRadius } = config
  const { spineY, spineStart, bodyTop, taperStart, tipBottom, topJoints, endJoints, mountTopJoints } = compactExtensionDimensions(config)
  const top = jointOutline([point(0, 0), point(length, 0), point(length, width), point(0, width)], [
    [], [], [], joints(mountTopJoints.map(y => width - y), tabWidth + clearance, -spineStart),
  ])
  const spine = jointOutline([point(spineStart, 0), point(taperStart, 0), point(length, tipBottom), point(length, bodyTop), point(spineStart, bodyTop)], [
    [], [], [], joints(topJoints.map(x => length - x), tabWidth, thickness), joints(endJoints.map(z => bodyTop - z), tabWidth, spineStart),
  ])
  const mount = jointOutline([point(0, 0), point(width, 0), point(width, bodyTop), point(0, bodyTop)], [
    [], [], joints(mountTopJoints.map(y => width - y), tabWidth, thickness), [],
  ])
  // Five cells share an alternating diagonal truss. Insetting each cell leaves real material between cuts.
  const station = (fraction: number) => spineStart + (taperStart - spineStart) * fraction
  const bottomNear = point(station(.1), 0), topNear = point(station(.3), bodyTop)
  const bottomMiddle = point(station(.5), 0), topFar = point(station(.7), bodyTop), bottomFar = point(station(.9), 0)
  const cells: Point[][] = [
    [point(spineStart, 0), bottomNear, topNear, point(spineStart, bodyTop)],
    [bottomNear, bottomMiddle, topNear],
    [topNear, bottomMiddle, topFar],
    [bottomMiddle, bottomFar, topFar],
    [bottomFar, point(taperStart, 0), point(length, tipBottom), point(length, bodyTop), topFar],
  ]
  const windows = cells.map((cell, index) => {
    const paths = inflatePathsD([cell], -windowInset, JoinType.Miter, EndType.Polygon, 8, 6)
    if (paths.length !== 1 || paths[0].length < 3)
      throw new FabricationError('cut-clearance', 'The spine window collapses at these dimensions', { window: index })
    const vertices = signedContourArea(polygonContour(paths[0])) > 0 ? paths[0] : paths[0].slice().reverse()
    return roundedConvexPolygon(vertices, windowRadius)
  })
  const grid = (span: number, depth: number): Hole[] => fixtureGridPoints(span, depth, { pitch: holePitch, margin: holeInset, grid: 'square' })
    .map(({ x, y }) => ({ id: `grid:${x}:${y}`, x, y, d: holeDiameter, kind: 'grid' }))
  const topHoles = grid(length, width)
  const mountHoles = grid(width, height).map(hole => ({ ...hole, y: height - hole.y }))
  if (!topHoles.length || !mountHoles.length)
    throw new FabricationError('missing-grid-row', 'Both working and mounting plates need a usable fixed-origin grid')
  // Keep the full hole inventory: incompatible stock/grid combinations fail rather than losing holes.
  if (topHoles.some(hole => Math.abs(hole.y - spineY) < (holeDiameter + thickness) / 2 + holeWeb)
    || mountHoles.some(hole => Math.abs(hole.x - spineY) < (holeDiameter + thickness) / 2 + holeWeb))
    throw new FabricationError('hole-clearance', 'The hole grid crosses the central spine. Adjust width, pitch or origin; holes will not be silently removed.')
  const part = (name: CompactExtensionPartName, label: string, width: number, height: number, contours: Contour[], holes: Hole[]): Part => ({
    name, label, width, height, thickness, count: 1, contours, holes, slots: [],
  })
  const parts = [
    part('compactTop', 'Compact working top', length, width, [top, ...topJoints.map(x => rectangle(x - (tabWidth + clearance) / 2, spineY - (thickness + clearance) / 2, tabWidth + clearance, thickness + clearance))], topHoles),
    part('compactSpine', 'Central windowed spine', length, height, [spine, ...windows], []),
    part('compactMount', 'Compact mounting end', width, height, [mount, ...endJoints.map(z => rectangle(spineY - (thickness + clearance) / 2, z - (tabWidth + clearance) / 2, thickness + clearance, tabWidth + clearance))], mountHoles),
  ]
  for (const part of parts) validateToolPart(part, { holeWeb, cutWeb: 3 })
  return parts
}

/** X away from the host table, central spine at Y=width/2, working face Z=height. */
export const compactExtensionAssembly = (config: CompactExtensionConfig = compactExtensionDefaults): Placement[] => {
  assertConfig(config)
  return [
    { part: 'compactTop', instance: 0, origin: [0, 0, config.height - config.thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    { part: 'compactSpine', instance: 0, origin: [0, config.width / 2, 0], axes: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },
    { part: 'compactMount', instance: 0, origin: [config.thickness / 2, 0, 0], axes: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] },
  ]
}
