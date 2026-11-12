import { contourPoints as approximateContourPoints, type Contour, type Point } from '../geometry.js'
import type { GeometryIssue, MatingInterface, SheetPart, ToolingAssembly, ToolingConfig, ValidationResult } from './model.js'
import { applyDirection, applyTransform, contourEndpoints, finitePoint, isClosedContour } from './primitives.js'

const WEB = 2
const EPS = 1e-5
const issue = (code: string, message: string, path: string): GeometryIssue => ({ code, message, path })
const finite3 = (value: { x: number; y: number; z: number }) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
const distance3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const normalize = (value: { x: number; y: number; z: number }) => {
  const length = Math.hypot(value.x, value.y, value.z)
  return length > EPS ? { x: value.x / length, y: value.y / length, z: value.z / length } : undefined
}
const contourPoints = (contour: Contour): Point[] => contourEndpoints(contour).flatMap(item => [item.start, item.end])
const bbox = (contour: Contour) => {
  const points = contourPoints(contour)
  return {
    minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)),
  }
}

const orientation = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const properIntersection = (a: Point, b: Point, c: Point, d: Point) => {
  const abC = orientation(a, b, c); const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a); const cdB = orientation(c, d, b)
  return abC * abD < -EPS && cdA * cdB < -EPS
}
const selfIntersects = (contour: Contour) => {
  const points = approximateContourPoints(contour, 144)
  if (points.length < 4) return false
  for (let first = 0; first < points.length; first += 1) {
    const nextFirst = (first + 1) % points.length
    for (let second = first + 2; second < points.length; second += 1) {
      const nextSecond = (second + 1) % points.length
      if (first === nextSecond || nextFirst === second) continue
      if (properIntersection(points[first], points[nextFirst], points[second], points[nextSecond])) return true
    }
  }
  return false
}

const pointSegmentDistance = (point: Point, a: Point, b: Point) => {
  const dx = b.x - a.x; const dy = b.y - a.y
  const denominator = dx * dx + dy * dy
  const position = denominator > EPS ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator)) : 0
  return Math.hypot(point.x - (a.x + position * dx), point.y - (a.y + position * dy))
}
const pointOnContour = (point: Point, contour: Contour, tolerance: number) => {
  const points = approximateContourPoints(contour, 144)
  return points.some((current, index) => pointSegmentDistance(point, current, points[(index + 1) % points.length]) <= tolerance)
}
const distanceToContour = (point: Point, contour: Contour) => {
  const points = approximateContourPoints(contour, 144)
  return Math.min(...points.map((current, index) => pointSegmentDistance(point, current, points[(index + 1) % points.length])))
}
const pointInContour = (point: Point, contour: Contour) => {
  const points = approximateContourPoints(contour, 144)
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index]; const b = points[previous]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export const classifyMatingPoint = (part: SheetPart, local: { x: number; y: number; z: number }, tolerance = 0.5): MatingInterface['featureEvidence'] | undefined => {
  if (![local.x, local.y, local.z].every(Number.isFinite) || Math.abs(local.z) > part.thickness / 2 + tolerance) return undefined
  const point = { x: local.x, y: local.y }
  if (part.holes.some(hole => Math.hypot(point.x - hole.x, point.y - hole.y) <= hole.d / 2 + tolerance)) return 'hole'
  if (part.slots.some(slot => Math.abs(point.x - slot.x) <= slot.width / 2 + tolerance && Math.abs(point.y - slot.y) <= slot.height / 2 + tolerance)) return 'slot'
  if (part.contours.slice(1).some(contour => pointOnContour(point, contour, tolerance) || pointInContour(point, contour))) return 'internal-cut'
  if (pointOnContour(point, part.contours[0], tolerance)) return 'outer-edge'
  if (pointInContour(point, part.contours[0])) return 'material-face'
  return undefined
}

const validateContour = (part: SheetPart, contour: Contour, index: number): GeometryIssue[] => {
  const path = `parts.${part.name}.contours.${index}`
  const issues: GeometryIssue[] = []
  if (!isClosedContour(contour)) issues.push(issue('open-contour', 'Contour is not continuously closed', path))
  if (selfIntersects(contour)) issues.push(issue('self-intersection', 'Contour crosses itself', path))
  contour.forEach((segment, segmentIndex) => {
    if (segment.type === 'line') {
      if (!finitePoint(segment.from) || !finitePoint(segment.to)) issues.push(issue('non-finite-segment', 'Line endpoint is not finite', `${path}.${segmentIndex}`))
      if (Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y) <= EPS) issues.push(issue('degenerate-segment', 'Line segment has zero length', `${path}.${segmentIndex}`))
    } else {
      if (!finitePoint(segment.center) || !Number.isFinite(segment.radius) || segment.radius <= 0 || !Number.isFinite(segment.start) || !Number.isFinite(segment.end)) issues.push(issue('invalid-arc', 'Arc requires finite center, angles and positive radius', `${path}.${segmentIndex}`))
    }
  })
  const bounds = bbox(contour)
  if (index > 0 && (bounds.minX < -part.width / 2 - EPS || bounds.maxX > part.width / 2 + EPS || bounds.minY < -part.height / 2 - EPS || bounds.maxY > part.height / 2 + EPS)) issues.push(issue('cut-outside-part', 'Internal contour extends outside declared part bounds', path))
  return issues
}

const validatePart = (part: SheetPart): GeometryIssue[] => {
  const path = `parts.${part.name}`
  const issues: GeometryIssue[] = []
  for (const [key, value] of Object.entries({ width: part.width, height: part.height, thickness: part.thickness, density: part.densityKgPerMm3 })) if (!Number.isFinite(value) || value <= 0) issues.push(issue('invalid-dimension', `${key} must be finite and positive`, `${path}.${key}`))
  if (!Number.isInteger(part.count) || part.count < 1) issues.push(issue('invalid-count', 'Part count must be a positive integer', `${path}.count`))
  if (!part.contours.length) issues.push(issue('missing-outline', 'Part requires an outer contour', `${path}.contours`))
  part.contours.forEach((contour, index) => issues.push(...validateContour(part, contour, index)))
  if (part.contours[0]) {
    const outer = bbox(part.contours[0])
    if (outer.maxX - outer.minX > part.width + EPS || outer.maxY - outer.minY > part.height + EPS) issues.push(issue('outer-contour-outside-part', 'Outer contour exceeds declared part dimensions', `${path}.contours.0`))
  }
  part.holes.forEach((hole, index) => {
    const holePath = `${path}.holes.${index}`
    if (![hole.x, hole.y, hole.d].every(Number.isFinite) || hole.d <= 0) issues.push(issue('invalid-hole', 'Hole coordinates and diameter must be finite; diameter must be positive', holePath))
    if (Math.abs(hole.x) + hole.d / 2 + WEB > part.width / 2 + EPS || Math.abs(hole.y) + hole.d / 2 + WEB > part.height / 2 + EPS) issues.push(issue('hole-edge-web', `Hole violates ${WEB} mm minimum declared edge web`, holePath))
    const center = { x: hole.x, y: hole.y }
    if (part.contours[0] && !pointInContour(center, part.contours[0]) && !pointOnContour(center, part.contours[0], EPS)) issues.push(issue('hole-outside-material', 'Hole centre is outside the actual outer contour', holePath))
    if (part.contours[0] && distanceToContour(center, part.contours[0]) + EPS < hole.d / 2 + WEB) issues.push(issue('hole-outer-web', `Hole violates ${WEB} mm minimum web to the actual outer contour`, holePath))
  })
  for (let first = 0; first < part.holes.length; first += 1) for (let second = first + 1; second < part.holes.length; second += 1) {
    const a = part.holes[first]; const b = part.holes[second]
    if (Math.hypot(a.x - b.x, a.y - b.y) + EPS < (a.d + b.d) / 2 + WEB) issues.push(issue('hole-collision', 'Holes overlap or violate minimum web', `${path}.holes.${first}/${second}`))
  }
  part.slots.forEach((slot, index) => {
    const slotPath = `${path}.slots.${index}`
    if (![slot.x, slot.y, slot.width, slot.height].every(Number.isFinite) || slot.width <= 0 || slot.height <= 0) issues.push(issue('invalid-slot', 'Slot values must be finite and dimensions positive', slotPath))
    if (Math.abs(slot.x) + slot.width / 2 > part.width / 2 + EPS || Math.abs(slot.y) + slot.height / 2 > part.height / 2 + EPS) issues.push(issue('slot-outside-part', 'Slot bounding box extends outside part', slotPath))
    for (const [holeIndex, hole] of part.holes.entries()) {
      const dx = Math.max(Math.abs(hole.x - slot.x) - slot.width / 2, 0)
      const dy = Math.max(Math.abs(hole.y - slot.y) - slot.height / 2, 0)
      if (Math.hypot(dx, dy) + EPS < hole.d / 2 + WEB) issues.push(issue('hole-slot-collision', 'Hole and slot overlap or violate minimum web', `${holeIndex}/${slotPath}`))
    }
  })
  const internalBounds = part.contours.slice(1).map(contour => bbox(contour))
  for (let first = 0; first < internalBounds.length; first += 1) for (let second = first + 1; second < internalBounds.length; second += 1) {
    const a = internalBounds[first]; const b = internalBounds[second]
    if (a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minY < b.maxY - EPS && a.maxY > b.minY + EPS) issues.push(issue('cut-collision', 'Internal cut bounding regions overlap', `${path}.contours.${first + 1}/${second + 1}`))
  }
  return issues
}

const findInterface = (assembly: ToolingAssembly, instanceId: string, interfaceId: string): { instance: ToolingAssembly['instances'][number]; face: MatingInterface } | undefined => {
  const instance = assembly.instances.find(item => item.id === instanceId)
  const face = instance?.interfaces.find(item => item.id === interfaceId)
  return instance && face ? { instance, face } : undefined
}

export const validateToolingAssembly = (assembly: ToolingAssembly): ValidationResult => {
  const issues: GeometryIssue[] = []
  if (assembly.units !== 'mm') issues.push(issue('units', 'Canonical tooling units must be mm', 'units'))
  const names = new Set<string>()
  for (const part of assembly.parts) {
    if (names.has(part.name)) issues.push(issue('duplicate-part-name', 'Part names must be unique', `parts.${part.name}`))
    names.add(part.name); issues.push(...validatePart(part))
  }
  const instanceIds = new Set<string>()
  for (const instance of assembly.instances) {
    if (instanceIds.has(instance.id)) issues.push(issue('duplicate-instance-id', 'Instance IDs must be unique', `instances.${instance.id}`))
    instanceIds.add(instance.id)
    if (!names.has(instance.partName)) issues.push(issue('unknown-part', 'Instance references an unknown part', `instances.${instance.id}.partName`))
    if (!finite3(instance.transform.translation) || ![instance.transform.rotation.x, instance.transform.rotation.y, instance.transform.rotation.z].every(Number.isFinite)) issues.push(issue('invalid-transform', 'Transform values must be finite', `instances.${instance.id}.transform`))
    if (instance.transform.units !== 'mm' || instance.transform.rotation.unit !== 'deg' || instance.transform.rotation.order !== 'XYZ') issues.push(issue('transform-contract', 'Transforms must use mm, degrees and XYZ order', `instances.${instance.id}.transform`))
  }
  for (const part of assembly.parts) {
    const actual = assembly.instances.filter(instance => instance.partName === part.name).length
    if (actual !== part.count) issues.push(issue('instance-count', `Part count ${part.count} does not match ${actual} assembly instances`, `parts.${part.name}.count`))
  }
  for (const joint of assembly.joints) {
    const first = findInterface(assembly, joint.first.instanceId, joint.first.interfaceId); const second = findInterface(assembly, joint.second.instanceId, joint.second.interfaceId)
    if (!first || !second) { issues.push(issue('broken-joint-reference', 'Joint references a missing instance/interface', `joints.${joint.id}`)); continue }
    if (first.face.kind !== joint.kind || second.face.kind !== joint.kind) issues.push(issue('joint-kind', 'Joint and interface kinds differ', `joints.${joint.id}`))
    for (const endpoint of [first, second]) {
      const part = assembly.parts.find(item => item.name === endpoint.instance.partName)
      const evidence = part ? classifyMatingPoint(part, endpoint.face.localOrigin, Math.max(joint.tolerance, 0.5)) : undefined
      if (!evidence) issues.push(issue('joint-feature', 'Joint interface is not supported by part material or a cut feature', `joints.${joint.id}.${endpoint.instance.id}`))
      else if (evidence !== endpoint.face.featureEvidence) issues.push(issue('joint-feature-changed', 'Joint feature evidence no longer matches the part geometry', `joints.${joint.id}.${endpoint.instance.id}`))
    }
    const firstWorld = applyTransform(first.face.localOrigin, first.instance.transform); const secondWorld = applyTransform(second.face.localOrigin, second.instance.transform)
    if (distance3(firstWorld, secondWorld) > joint.tolerance + EPS) issues.push(issue('joint-position', 'Mating origins do not coincide after assembly transforms', `joints.${joint.id}`))
    const axisA = normalize(applyDirection(first.face.localAxis, first.instance.transform)); const axisB = normalize(applyDirection(second.face.localAxis, second.instance.transform))
    if (!axisA || !axisB || Math.abs(axisA.x * axisB.x + axisA.y * axisB.y + axisA.z * axisB.z) < 1 - 1e-6) issues.push(issue('joint-axis', 'Mating axes are not coaxial after assembly transforms', `joints.${joint.id}`))
    if (Math.abs(first.face.size.width - second.face.size.width) > joint.tolerance || Math.abs(first.face.size.depth - second.face.size.depth) > joint.tolerance || Math.abs((first.face.size.diameter ?? 0) - (second.face.size.diameter ?? 0)) > joint.tolerance) issues.push(issue('joint-size', 'Mating interface sizes differ', `joints.${joint.id}`))
  }
  if (assembly.instances.length > 1 && assembly.joints.length > 0) {
    const connected = new Set<string>([assembly.instances[0].id])
    let changed = true
    while (changed) {
      changed = false
      for (const joint of assembly.joints) {
        if (connected.has(joint.first.instanceId) && !connected.has(joint.second.instanceId)) { connected.add(joint.second.instanceId); changed = true }
        if (connected.has(joint.second.instanceId) && !connected.has(joint.first.instanceId)) { connected.add(joint.first.instanceId); changed = true }
      }
    }
    for (const instance of assembly.instances) if (!connected.has(instance.id)) issues.push(issue('disconnected-instance', 'Structural instance is not connected to the assembly joint graph', `instances.${instance.id}`))
  }
  for (const item of assembly.purchased) if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.excludedFromSheetNesting !== true) issues.push(issue('purchased-bom', 'Purchased BOM quantity must be positive and item excluded from nesting', `purchased.${item.id}`))
  return { valid: issues.length === 0, issues }
}

export const assertToolingAssembly = (assembly: ToolingAssembly): void => {
  const result = validateToolingAssembly(assembly)
  if (!result.valid) throw new Error(`Invalid ${assembly.id} tooling assembly:\n${result.issues.map(item => `${item.path}: ${item.message}`).join('\n')}`)
}

const configNumber = (config: ToolingConfig, key: string): number => {
  const value = config.values[key]
  if (typeof value !== 'number') throw new Error(`${config.id}.${key}: expected numeric interface parameter`)
  return value
}

export const assertA10B08Compatibility = (insert: ToolingConfig<'A10'>, holder: ToolingConfig<'B08'>): void => {
  const errors: string[] = []
  if (Math.abs(configNumber(insert, 'holderPitch') - configNumber(holder, 'insertPitch')) > EPS) errors.push('bolt pitch')
  if (configNumber(insert, 'holderDiameter') + EPS < configNumber(holder, 'insertDiameter')) errors.push('bolt diameter')
  if (configNumber(insert, 'length') > configNumber(holder, 'width') + EPS) errors.push('insert envelope')
  if (errors.length) throw new Error(`A10/B08 incompatible: ${errors.join(', ')}`)
}

export const assertA13B14Compatibility = (slat: ToolingConfig<'A13'>, module: ToolingConfig<'B14'>): void => {
  const errors: string[] = []
  if (Math.abs(configNumber(slat, 'thickness') - configNumber(module, 'slatThickness')) > EPS) errors.push('slat thickness')
  if (Math.abs(configNumber(slat, 'height') - configNumber(module, 'slatHeight')) > EPS) errors.push('slat height')
  if (Math.abs(configNumber(slat, 'seatDepth') - configNumber(module, 'seatDepth')) > EPS) errors.push('seat depth')
  if (Math.abs(configNumber(slat, 'seatWidth') - configNumber(module, 'seatWidth')) > EPS) errors.push('rail seat width')
  if (Math.abs(configNumber(slat, 'span') - configNumber(module, 'width')) > EPS) errors.push('slat span')
  if (configNumber(slat, 'quantity') !== configNumber(module, 'slatCount')) errors.push('slat quantity')
  if (errors.length) throw new Error(`A13/B14 incompatible: ${errors.join(', ')}`)
}
