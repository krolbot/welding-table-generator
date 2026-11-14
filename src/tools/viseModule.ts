import { FabricationError, fixtureGridPoints, pointInContour, type Contour, type FabricationPart, type Hole, type Point } from '../geometry'
import { nativePointContourDistance } from '../contourGeometry'
import type { Grid } from '../model'
import { capsuleContour, jointOutline, type EdgeJoint } from '../fabricationProfiles'
import { validateToolPart } from './fabrication'

export type ViseModuleConfig = {
  length: number; width: number; height: number; thickness: number
  holeDiameter: number; holePitch: number; holeInset: number; grid: Grid
  slotWidth: number; slotLength: number; slotInnerRadius: number
  tipHeight: number; tabWidth: number; clearance: number
}
export const viseModuleDefaults: ViseModuleConfig = {
  length: 250, width: 250, height: 100, thickness: 8,
  holeDiameter: 16, holePitch: 50, holeInset: 25, grid: 'square',
  slotWidth: 16, slotLength: 80, slotInnerRadius: 30,
  tipHeight: 50, tabWidth: 20, clearance: 0.2,
}
export const viseModuleLimits: Record<Exclude<keyof ViseModuleConfig, 'grid'>, { min: number; max: number; step: number }> = {
  length: { min: 200, max: 600, step: 50 }, width: { min: 200, max: 600, step: 50 },
  height: { min: 100, max: 200, step: 10 }, thickness: { min: 4, max: 8, step: 1 },
  holeDiameter: { min: 10, max: 28, step: 1 }, holePitch: { min: 40, max: 100, step: 5 }, holeInset: { min: 20, max: 50, step: 1 },
  slotWidth: { min: 10, max: 28, step: 1 }, slotLength: { min: 30, max: 200, step: 5 }, slotInnerRadius: { min: 20, max: 80, step: 1 },
  tipHeight: { min: 40, max: 120, step: 5 }, tabWidth: { min: 12, max: 30, step: 1 }, clearance: { min: 0, max: 1, step: 0.1 },
}
export type ViseModulePartName = 'viseTop' | 'viseMount' | 'viseFront' | 'viseSide'
type Part = FabricationPart<ViseModulePartName>
type Vector3 = [number, number, number]
type Placement = { part: ViseModulePartName; instance: number; origin: Vector3; axes: [Vector3, Vector3, Vector3] }
const point = (x: number, y: number): Point => ({ x, y })
const joints = (centres: number[], width: number, depth: number): EdgeJoint[] => centres.map(centre => ({ centre, width, depth }))
const holeWeb = 8

export const viseModuleDimensions = (config: ViseModuleConfig) => {
  const { length, width, height, thickness, clearance, tipHeight } = config
  const wallInset = thickness + clearance / 2, bodyTop = height - wallInset
  const sideStart = wallInset, sideEnd = length - wallInset, tipBottom = height - tipHeight
  return {
    wallInset, bodyTop, sideStart, sideEnd, tipBottom,
    sideRadius: ((sideEnd - sideStart) ** 2 + tipBottom ** 2) / (2 * tipBottom),
    xJoints: [length / 5, length * 4 / 5], yJoints: [width / 5, width * 4 / 5],
    mountJoint: bodyTop / 2, frontJoint: (tipBottom + bodyTop) / 2,
    holeOrigin: config.holeInset, tabWidth: config.tabWidth, clearance,
  }
}

const assertConfig = (config: ViseModuleConfig) => {
  for (const key of Object.keys(viseModuleLimits) as Array<keyof typeof viseModuleLimits>) {
    const value = config[key], { min, max } = viseModuleLimits[key]
    if (!Number.isFinite(value) || value < min || value > max)
      throw new FabricationError('invalid-dimensions', `Vise module ${key} must be ${min}–${max} mm`, { field: key, min, max })
  }
  if (config.grid !== 'square' && config.grid !== 'staggered')
    throw new FabricationError('invalid-grid', 'Vise module grid must follow a supported table pattern')
  if (config.tipHeight >= config.height || config.slotLength <= config.slotWidth
    || config.tabWidth + config.clearance >= config.tipHeight - config.thickness - config.clearance / 2)
    throw new FabricationError('invalid-dimensions', 'The curved sides, radial slots and locating joints must fit the vise module envelope')
}

/** Five flat plates from the reference; exact grids, curves, slots and joints are proposed. */
export const viseModuleParts = (config: ViseModuleConfig = viseModuleDefaults): Part[] => {
  assertConfig(config)
  const { length, width, height, thickness, holeDiameter, holePitch, holeInset, tabWidth, clearance } = config
  const { wallInset, bodyTop, sideStart, sideEnd, tipBottom, sideRadius, xJoints, yJoints, mountJoint, frontJoint } = viseModuleDimensions(config)
  const top = jointOutline([point(0, 0), point(length, 0), point(length, width), point(0, width)], [
    joints(xJoints, tabWidth + clearance, -wallInset), joints(yJoints, tabWidth + clearance, -wallInset),
    joints(xJoints.map(x => length - x), tabWidth + clearance, -wallInset), joints(yJoints.map(y => width - y), tabWidth + clearance, -wallInset),
  ])
  const end = (depth: number, joint: number) => {
    const top = depth - wallInset
    return jointOutline([point(0, 0), point(width, 0), point(width, top), point(0, top)], [
      [], joints([joint], tabWidth + clearance, -wallInset),
      joints(yJoints.map(y => width - y), tabWidth, wallInset), joints([top - joint], tabWidth + clearance, -wallInset),
    ])
  }
  const side = jointOutline([point(sideStart, 0), point(sideEnd, tipBottom), point(sideEnd, bodyTop), point(sideStart, bodyTop)], [
    [], joints([frontJoint - tipBottom], tabWidth, wallInset),
    joints(xJoints.map(x => sideEnd - x), tabWidth, wallInset), joints([bodyTop - mountJoint], tabWidth, wallInset),
  ])
  side[0] = { type: 'arc', center: point(sideStart, sideRadius), radius: sideRadius, start: 270, end: 360 + Math.atan2(tipBottom - sideRadius, sideEnd - sideStart) * 180 / Math.PI }
  const hole = (id: string, x: number, y: number): Hole => ({ id, x, y, d: holeDiameter, kind: 'mount' })
  const grid = (span: number, depth: number) => fixtureGridPoints(span, depth, { pitch: holePitch, margin: holeInset, grid: config.grid })
    .map(p => hole(`grid:${p.x}:${p.y}`, p.x, height - p.y))
  const topNear = holeInset + holePitch
  const lastStation = (span: number) => holeInset + Math.floor((span - 2 * holeInset) / holePitch) * holePitch
  const topFar = (span: number) => holeInset + (Math.floor((span - 2 * holeInset) / holePitch) - 1) * holePitch
  if (topFar(length) <= topNear || topFar(width) <= topNear)
    throw new FabricationError('missing-grid-row', 'The vise module needs eight peripheral top holes and usable staggered wall rows')
  const radialSlots = Array.from({ length: 8 }, (_, index) => {
    const angle = index * 45, radians = angle * Math.PI / 180, radius = config.slotInnerRadius + config.slotLength / 2
    return capsuleContour(point(length / 2 + radius * Math.cos(radians), width / 2 + radius * Math.sin(radians)), config.slotLength, config.slotWidth, angle)
  })
  const topHoles = [
    ...[topNear, topFar(length)].flatMap(x => [hole(`top:${x}:near`, x, holeInset), hole(`top:${x}:far`, x, lastStation(width))]),
    ...[topNear, topFar(width)].flatMap(y => [hole(`top:near:${y}`, holeInset, y), hole(`top:far:${y}`, lastStation(length), y)]),
    hole('center', length / 2, width / 2),
  ]
  // Only lower side rows are clipped to the curved silhouette; mounting holes and the full upper row are mandatory.
  const sideHoles = grid(length, height).filter(p => p.y === height - holeInset
    || pointInContour(p, side) && nativePointContourDistance(p, [side[0]]) >= holeDiameter / 2 + holeWeb)
  const mountHoles = grid(width, height), frontHoles = grid(width, config.tipHeight).map(p => ({ ...p, y: p.y - tipBottom }))
  if (!mountHoles.length || !frontHoles.length || !sideHoles.length)
    throw new FabricationError('missing-grid-row', 'Every vise module wall needs a usable table-grid row')
  const part = (name: ViseModulePartName, label: string, width: number, height: number, count: number, contours: Contour[], holes: Hole[]): Part => ({
    name, label, width, height, thickness, count, contours, holes, slots: [],
  })
  const parts = [
    part('viseTop', 'Vise working top', length, width, 1, [top, ...radialSlots], topHoles),
    part('viseMount', 'Vise mounting wall', width, height, 1, [end(height, mountJoint)], mountHoles),
    part('viseFront', 'Vise free-end wall', width, config.tipHeight, 1, [end(config.tipHeight, frontJoint - tipBottom)], frontHoles),
    part('viseSide', 'Vise curved side', length, height, 2, [side], sideHoles),
  ]
  for (const part of parts) validateToolPart(part, { holeWeb, cutWeb: 8 })
  return parts
}

/** X away from the mounting wall; working face Z=height. Underside remains open. */
export const viseModuleAssembly = (config: ViseModuleConfig = viseModuleDefaults): Placement[] => {
  assertConfig(config)
  const { length, width, height, thickness } = config
  return [
    { part: 'viseTop', instance: 0, origin: [0, 0, height - thickness / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    { part: 'viseMount', instance: 0, origin: [thickness / 2, 0, 0], axes: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] },
    { part: 'viseFront', instance: 0, origin: [length - thickness / 2, 0, height - config.tipHeight], axes: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] },
    { part: 'viseSide', instance: 0, origin: [0, thickness / 2, 0], axes: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },
    { part: 'viseSide', instance: 1, origin: [0, width - thickness / 2, 0], axes: [[1, 0, 0], [0, 0, 1], [0, -1, 0]] },
  ]
}
