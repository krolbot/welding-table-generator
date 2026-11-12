import { createToolingConfig, getToolingEntry, validateToolingConfig } from './catalog.js'
import type {
  AssemblyInstance, AssemblyJoint, JointAt, MatingInterface, ParameterValue, PurchasedComponent,
  SheetPart, ToolingAssembly, ToolingConfig, ToolingId,
} from './model.js'
import {
  arc, capsule, circleHole, gridHoles, identityTransform, invertDirection, invertTransform, line,
  makePart, polygon, pt, radialSlot, rectangle, slotBox, transform,
} from './primitives.js'
import { assertToolingAssembly, classifyMatingPoint } from './validation.js'
import { buildSheetBom } from './bom.js'

const numberValue = (config: ToolingConfig, key: string): number => {
  const value = config.values[key]
  if (typeof value !== 'number') throw new Error(`${config.id}.${key}: expected number`)
  return value
}
const boolValue = (config: ToolingConfig, key: string): boolean => {
  const value = config.values[key]
  if (typeof value !== 'boolean') throw new Error(`${config.id}.${key}: expected boolean`)
  return value
}
const stringValue = (config: ToolingConfig, key: string): string => {
  const value = config.values[key]
  if (typeof value !== 'string') throw new Error(`${config.id}.${key}: expected string`)
  return value
}
const nv = numberValue
const count = (config: ToolingConfig, key: string) => Math.trunc(nv(config, key))
const defaultMaterial = 'S235JR' as const
const MIN_WEB = 3

class AssemblyBuilder {
  readonly parts: SheetPart[] = []
  readonly instances: AssemblyInstance[] = []
  readonly purchased: PurchasedComponent[] = []
  readonly joints: AssemblyJoint[] = []
  readonly warnings: string[] = []
  private interfaceIndex = 0

  constructor(readonly config: ToolingConfig) {}

  part(input: Parameters<typeof makePart>[0]): SheetPart {
    const part = makePart(input)
    this.parts.push(part)
    return part
  }

  instance(part: SheetPart, placement = identityTransform(), id = `${part.name}-${this.instances.filter(item => item.partName === part.name).length + 1}`): AssemblyInstance {
    const instance: AssemblyInstance = { id, partName: part.name, transform: placement, interfaces: [] }
    this.instances.push(instance)
    return instance
  }

  buy(id: string, description: string, quantity: number, interfaceParameters: Readonly<Record<string, number | string>>): void {
    this.purchased.push({ id, description, quantity, interfaceParameters, excludedFromSheetNesting: true })
  }

  mountPurchased(id: string, instance: AssemblyInstance, holeId: string): void {
    const component = this.purchased.find(item => item.id === id)
    if (!component) throw new Error(`Unknown purchased component ${id}`)
    ;(component.mounts ??= []).push({ instanceId: instance.id, holeId })
  }

  purchasedEnvelope(id: string, start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }, diameter: number): void {
    const component = this.purchased.find(item => item.id === id)
    if (!component) throw new Error(`Unknown purchased component ${id}`)
    ;(component.envelopes ??= []).push({ start, end, diameter, representationOnly: true })
  }

  warn(message: string): void { this.warnings.push(message) }

  mate(kind: MatingInterface['kind'], first: AssemblyInstance, second: AssemblyInstance, at: JointAt, description: string, tolerance = 0.05): void {
    const index = ++this.interfaceIndex
    const add = (instance: AssemblyInstance, suffix: string): MatingInterface => {
      const localOrigin = invertTransform(at.world, instance.transform)
      const part = this.parts.find(item => item.name === instance.partName)
      const featureEvidence = part ? classifyMatingPoint(part, localOrigin, Math.max(tolerance, 0.5)) : undefined
      if (!part || !featureEvidence) throw new Error(`${this.config.id}.${instance.id}: joint ${index} does not land on part material or a cut feature`)
      const interfaceValue: MatingInterface = {
        id: `if-${index}-${suffix}`,
        kind,
        localOrigin,
        localAxis: invertDirection(at.axis, instance.transform),
        size: { ...at.size },
        featureEvidence,
      }
      instance.interfaces.push(interfaceValue)
      return interfaceValue
    }
    const firstInterface = add(first, 'a')
    const secondInterface = add(second, 'b')
    this.joints.push({
      id: `joint-${index}`, kind,
      first: { instanceId: first.id, interfaceId: firstInterface.id },
      second: { instanceId: second.id, interfaceId: secondInterface.id },
      tolerance, description,
    })
  }

  axialMate(kind: 'pivot' | 'bolt' | 'bearing-seat' | 'linear-guide', first: AssemblyInstance, second: AssemblyInstance, a: { x: number; y: number }, b: { x: number; y: number }, diameter: number, description: string): void {
    const index = ++this.interfaceIndex
    const faces = [first, second].map((instance, i) => {
      const part = this.parts.find(p => p.name === instance.partName)!
      const localOrigin = { ...(i ? b : a), z: 0 }
      const featureEvidence = classifyMatingPoint(part, localOrigin, 0.01)
      if (!featureEvidence) throw new Error(`${instance.id}: missing axial interface`)
      const face: MatingInterface = { id: `if-${index}-${i}`, kind, localOrigin, localAxis: { x: 0, y: 0, z: 1 }, size: { width: diameter, depth: part.thickness, diameter }, featureEvidence }
      instance.interfaces.push(face)
      return face
    })
    this.joints.push({ id: `joint-${index}`, kind, first: { instanceId: first.id, interfaceId: faces[0].id }, second: { instanceId: second.id, interfaceId: faces[1].id }, tolerance: 0.05, description })
  }

  finish(): ToolingAssembly {
    const entry = getToolingEntry(this.config.id)
    const assembly: ToolingAssembly = {
      id: this.config.id,
      name: entry.name,
      units: 'mm',
      config: this.config,
      parts: this.parts,
      instances: this.instances,
      sheetBom: buildSheetBom(this.parts),
      purchased: this.purchased,
      joints: this.joints,
      warnings: this.warnings,
    }
    assertToolingAssembly(assembly)
    return assembly
  }
}

const rectangularPart = (builder: AssemblyBuilder, name: string, role: string, width: number, height: number, thickness: number, options: {
  count?: number
  holes?: ReturnType<typeof circleHole>[]
  cuts?: ReturnType<typeof rectangle>[]
  material?: 'S235JR' | 'S355JR' | 'AISI304' | 'AlMg3'
} = {}) => builder.part({
  name, role, width, height, thickness, count: options.count, material: options.material ?? defaultMaterial,
  holes: options.holes, contours: [rectangle(width, height), ...(options.cuts ?? [])],
})

const topTabbedRectangle = (width: number, bodyHeight: number, depth: number, centers: readonly number[], tabWidth: number, bottom = false) => {
  if (centers.some(x => Math.abs(x) + tabWidth / 2 >= width / 2)) throw new Error('Tab does not fit the wall width')
  const points = [pt(-width / 2, -bodyHeight / 2), pt(width / 2, -bodyHeight / 2), pt(width / 2, bodyHeight / 2)]
  for (const x of [...centers].sort((a, b) => b - a)) points.push(pt(x + tabWidth / 2, bodyHeight / 2), pt(x + tabWidth / 2, bodyHeight / 2 + depth), pt(x - tabWidth / 2, bodyHeight / 2 + depth), pt(x - tabWidth / 2, bodyHeight / 2))
  points.push(pt(-width / 2, bodyHeight / 2))
  return polygon(bottom ? points.map(p => pt(p.x, -p.y)) : points)
}

const boltPair = (diameter: number, spacing: number, axis: 'x' | 'y' = 'x', prefix = 'mount') => [-1, 1].map(sign =>
  circleHole(`${prefix}-${sign > 0 ? 'p' : 'n'}`, axis === 'x' ? sign * spacing / 2 : 0, axis === 'y' ? sign * spacing / 2 : 0, diameter))

const fourHoles = (diameter: number, pitchX: number, pitchY: number, prefix = 'mount') => [-1, 1].flatMap(sx => [-1, 1].map(sy => circleHole(`${prefix}-${sx}-${sy}`, sx * pitchX / 2, sy * pitchY / 2, diameter)))

const addFastenerSet = (builder: AssemblyBuilder, prefix: string, quantity: number, diameter: number, purpose: string) => {
  builder.buy(`${prefix}-bolt`, `${purpose} bolt`, quantity, { nominalDiameter: diameter })
  builder.buy(`${prefix}-washer`, `${purpose} washer`, quantity, { nominalDiameter: diameter })
  builder.buy(`${prefix}-nut`, `${purpose} nut`, quantity, { nominalDiameter: diameter })
}

const addFlatItems = (builder: AssemblyBuilder, config: ToolingConfig): boolean => {
  const t = nv(config, 'thickness')
  switch (config.id) {
    case 'A01': {
      const length = nv(config, 'length'); const width = nv(config, 'width')
      const slotLength = nv(config, 'slotLength'); const slotWidth = nv(config, 'slotWidth')
      const mountD = nv(config, 'mountDiameter'); const mountPitch = nv(config, 'mountPitch')
      const mountX = slotLength / 2 + mountPitch / 2
      const part = builder.part({ name: 'A01-stop', role: 'straight working edge', width: length, height: width, thickness: t,
        holes: [-1, 1].map(sign => circleHole(`mount-${sign}`, sign * mountX, 0, mountD)), slots: [slotBox(0, 0, slotLength, slotWidth)], contours: [rectangle(length, width), capsule(slotLength, slotWidth)] })
      builder.instance(part); addFastenerSet(builder, 'table', 2, mountD, 'table mounting')
      return true
    }
    case 'A02': {
      const ax = nv(config, 'armX'); const ay = nv(config, 'armY'); const w = nv(config, 'armWidth'); const angle = nv(config, 'angle')
      const radians = angle * Math.PI / 180
      const raw = [pt(0, 0), pt(ax, 0), pt(ax, w), pt(w / Math.tan(radians / 2), w), pt(w + ay * Math.cos(radians), ay * Math.sin(radians)), pt(ay * Math.cos(radians), ay * Math.sin(radians))]
      const minX = Math.min(...raw.map(point => point.x)); const maxX = Math.max(...raw.map(point => point.x)); const minY = Math.min(...raw.map(point => point.y)); const maxY = Math.max(...raw.map(point => point.y)); const center = pt((minX + maxX) / 2, (minY + maxY) / 2)
      const outer = raw.map(point => pt(point.x - center.x, point.y - center.y))
      const mountD = nv(config, 'mountDiameter'); const mountPitch = nv(config, 'mountPitch')
      const mountY = w / 2 - center.y
      const part = builder.part({ name: 'A02-angle', role: 'two angular reference edges', width: maxX - minX, height: maxY - minY, thickness: t,
        holes: [-1, 1].map((sign, index) => circleHole(`mount-${index + 1}`, ax / 2 + sign * mountPitch / 2 - center.x, mountY, mountD)), contours: [polygon(outer)] })
      builder.instance(part); addFastenerSet(builder, 'table', 2, mountD, 'table mounting')
      return true
    }
    case 'A03': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const pivot = nv(config, 'pivotDiameter')
      const radius = nv(config, 'slotRadius'); const sw = nv(config, 'slotWidth'); const amin = nv(config, 'angleMin'); const amax = nv(config, 'angleMax')
      const baseSize = 2 * (radius + sw / 2 + MIN_WEB)
      const base = rectangularPart(builder, 'A03-base', 'pivot base', baseSize, baseSize, t, { holes: [circleHole('pivot', 0, 0, pivot)], cuts: [radialSlot(pt(0, 0), radius, sw, amin, amax)] })
      const arm = rectangularPart(builder, 'A03-arm', 'pivoting reference arm', length, width, t, { holes: [circleHole('pivot', -length / 2 + width / 2, 0, pivot), circleHole('lock', -length / 2 + width / 2 + radius, 0, sw)] })
      const ib = builder.instance(base); const ia = builder.instance(arm, identityTransform(length / 2 - width / 2, 0, t))
      const contactZ = t / 2
      builder.mate('pivot', ib, ia, { world: { x: 0, y: 0, z: contactZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: pivot, depth: 2 * t, diameter: pivot } }, 'arm pivot')
      builder.mate('bolt', ib, ia, { world: { x: radius, y: 0, z: contactZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: sw, depth: 2 * t, diameter: sw } }, 'radial lock')
      addFastenerSet(builder, 'pivot', 1, pivot, 'pivot'); addFastenerSet(builder, 'lock', 1, sw, 'angle lock')
      return true
    }
    case 'A04': {
      const diameter = nv(config, 'diameter'); const ecc = nv(config, 'eccentricity'); const bore = nv(config, 'boreDiameter')
      const outline = [
        { type: 'arc' as const, center: pt(0, 0), radius: diameter / 2, start: 0, end: 180 },
        { type: 'arc' as const, center: pt(0, 0), radius: diameter / 2, start: 180, end: 360 },
      ]
      const part = builder.part({ name: 'A04-eccentric', role: 'eccentric contact cam', width: diameter, height: diameter, thickness: t, holes: [circleHole('pivot', ecc, 0, bore)], contours: [outline] })
      builder.instance(part); addFastenerSet(builder, 'pivot', 1, bore, 'eccentric pivot')
      return true
    }
    case 'A05': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const dd = nv(config, 'deviceDiameter'); const px = nv(config, 'devicePitchX'); const py = nv(config, 'devicePitchY')
      const part = rectangularPart(builder, 'A05-adapter', 'dual-pattern adapter plate', length, width, t, { holes: [...boltPair(md, mp, 'x', 'table'), ...fourHoles(dd, px, py, 'device')] })
      builder.instance(part); addFastenerSet(builder, 'table', 2, md, 'table mounting'); addFastenerSet(builder, 'device', 4, dd, 'device mounting')
      return true
    }
    case 'A06': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const d = nv(config, 'mountDiameter'); const pitch = nv(config, 'mountPitch'); const offset = nv(config, 'gridOffset'); const rows = nv(config, 'rowSpacing')
      const holes = [-1, 1].flatMap(side => [-1, 1].map(row => circleHole(`grid-${side}-${row}`, side * pitch / 2 + (side > 0 ? offset : 0), row * rows / 2, d)))
      const part = rectangularPart(builder, 'A06-strap', 'offset-grid joining strap', length, width, t, { holes })
      builder.instance(part); addFastenerSet(builder, 'join', 4, d, 'module joining')
      return true
    }
    case 'A07': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const stud = nv(config, 'studDiameter'); const slotLength = nv(config, 'slotLength'); const support = nv(config, 'supportHeight')
      const strap = builder.part({ name: 'A07-strap', role: 'clamping beam', width: length, height: width, thickness: t, slots: [slotBox(0, 0, slotLength, stud + 2)], contours: [rectangle(length, width), capsule(slotLength, stud + 2)] })
      builder.instance(strap, identityTransform(0, 0, support + t / 2))
      const fullCount = Math.floor(support / t)
      const remainder = support - fullCount * t
      if (fullCount) {
        const shim = rectangularPart(builder, 'A07-support', 'fulcrum stack plate', width, width, t, { count: fullCount })
        for (let index = 0; index < fullCount; index += 1) builder.instance(shim, identityTransform(length / 2 - width / 2, 0, (index + .5) * t))
      }
      if (remainder > 1e-6) {
        const shim = rectangularPart(builder, 'A07-support-adjustment', 'exact-height fulcrum shim', width, width, remainder)
        builder.instance(shim, identityTransform(length / 2 - width / 2, 0, fullCount * t + remainder / 2))
      }
      builder.buy('clamp-stud', 'Threaded clamping stud', 1, { nominalDiameter: stud }); builder.buy('clamp-nut', 'Clamping nut', 1, { nominalDiameter: stud }); builder.buy('clamp-washer', 'Clamping washer', 1, { nominalDiameter: stud })
      builder.warn('Clamp force is not rated; verify strap bending, support stability and stud alignment by calculation and test.')
      return true
    }
    case 'A08': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const spacing = nv(config, 'holeSpacing'); const d = nv(config, 'boltDiameter')
      const part = rectangularPart(builder, 'A08-draw-strap', 'assembly draw strap', length, width, t, { holes: boltPair(d, spacing) })
      builder.instance(part); addFastenerSet(builder, 'draw', 2, d, 'assembly drawing')
      return true
    }
    case 'A09': {
      const width = nv(config, 'outerWidth'); const length = nv(config, 'outerLength'); const slotWidth = nv(config, 'slotWidth'); const quantity = count(config, 'quantity')
      const halfW = width / 2; const halfL = length / 2
      const outline = polygon([pt(-halfW, -halfL), pt(halfW, -halfL), pt(halfW, halfL), pt(slotWidth / 2, halfL), pt(slotWidth / 2, 0), pt(-slotWidth / 2, 0), pt(-slotWidth / 2, halfL), pt(-halfW, halfL)])
      const part = builder.part({ name: 'A09-u-shim', role: 'removable open shim', width, height: length, thickness: t, count: quantity, contours: [outline] })
      for (let index = 0; index < quantity; index += 1) builder.instance(part, identityTransform(0, 0, index * t), `A09-u-shim-${index + 1}`)
      return true
    }
    case 'A10': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const pitch = nv(config, 'holderPitch'); const d = nv(config, 'holderDiameter'); const size = nv(config, 'profileSize'); const profile = stringValue(config, 'profile')
      const half = length / 2
      const veeDepth = size / (2 * Math.tan(nv(config, 'veeAngle') * Math.PI / 360))
      if (size > length - 2 * MIN_WEB || size / 2 > width - MIN_WEB) throw new Error(`A10.profileSize: ${size} does not fit ${length} x ${width} insert envelope with ${MIN_WEB} mm web`)
      const notch = profile === 'vee'
        ? polygon([pt(-half, width / 2), pt(-size / 2, width / 2), pt(0, width / 2 - veeDepth), pt(size / 2, width / 2), pt(half, width / 2), pt(half, -width / 2), pt(-half, -width / 2)])
        : [
            line(pt(-half, -width / 2), pt(half, -width / 2)),
            line(pt(half, -width / 2), pt(half, width / 2)),
            line(pt(half, width / 2), pt(size / 2, width / 2)),
            arc(pt(0, width / 2), size / 2, 0, 180, true),
            line(pt(-size / 2, width / 2), pt(-half, width / 2)),
            line(pt(-half, width / 2), pt(-half, -width / 2)),
          ]
      const part = builder.part({ name: 'A10-insert', role: `${profile} replaceable contact insert`, width: length, height: width, thickness: t, holes: boltPair(d, pitch), contours: [notch] })
      builder.instance(part); addFastenerSet(builder, 'insert', 2, d, 'B08 insert mounting')
      return true
    }
    case 'A11': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const pitch = nv(config, 'toothPitch'); const gap = nv(config, 'gap'); const teeth = count(config, 'toothCount')
      const usable = Math.min(length - 2 * MIN_WEB, (teeth - 1) * pitch + gap)
      const start = -usable / 2
      const top: ReturnType<typeof pt>[] = [pt(-length / 2, width / 2)]
      for (let index = 0; index < teeth; index += 1) {
        const x = start + index * pitch
        top.push(pt(x - gap / 2, width / 2), pt(x - gap / 2, 0), pt(x + gap / 2, 0), pt(x + gap / 2, width / 2))
      }
      const outline = polygon([pt(-length / 2, -width / 2), pt(length / 2, -width / 2), pt(length / 2, width / 2), ...top.reverse()])
      const part = builder.part({ name: 'A11-comb', role: 'pitch and gap comb', width: length, height: width, thickness: t, contours: [outline] })
      builder.instance(part); builder.warn('This laser-cut comb is a setup gauge, not a certified measuring instrument.')
      return true
    }
    case 'A12': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const opening = nv(config, 'forkDiameter'); const neck = nv(config, 'neckWidth'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      if (neck >= opening || opening + 2 * MIN_WEB > width) throw new Error('A12: fork neck must be narrower than its circular pocket, with edge material remaining')
      const radius = opening / 2; const center = pt(length / 2 - radius - MIN_WEB, 0)
      const angle = Math.asin(neck / opening) * 180 / Math.PI
      const x = center.x + Math.sqrt(radius * radius - neck * neck / 4)
      const outline = [line(pt(-length / 2, -width / 2), pt(length / 2, -width / 2)), line(pt(length / 2, -width / 2), pt(length / 2, -neck / 2)), line(pt(length / 2, -neck / 2), pt(x, -neck / 2)), arc(center, radius, -angle, angle, true), line(pt(x, neck / 2), pt(length / 2, neck / 2)), line(pt(length / 2, neck / 2), pt(length / 2, width / 2)), line(pt(length / 2, width / 2), pt(-length / 2, width / 2)), line(pt(-length / 2, width / 2), pt(-length / 2, -width / 2))]
      const part = builder.part({ name: 'A12-torch-fork', role: 'circular open torch handle fork', width: length, height: width, thickness: t, holes: boltPair(md, mp), contours: [outline] })
      builder.instance(part); addFastenerSet(builder, 'table', 2, md, 'table mounting')
      return true
    }
    case 'A13': {
      const span = nv(config, 'span'); const height = nv(config, 'height'); const seatDepth = nv(config, 'seatDepth'); const seatWidth = nv(config, 'seatWidth'); const quantity = count(config, 'quantity')
      const outline = polygon([pt(-span / 2, -height / 2), pt(-span / 2 + seatWidth, -height / 2), pt(-span / 2 + seatWidth, -height / 2 + seatDepth), pt(span / 2 - seatWidth, -height / 2 + seatDepth), pt(span / 2 - seatWidth, -height / 2), pt(span / 2, -height / 2), pt(span / 2, height / 2), pt(-span / 2, height / 2)])
      const part = builder.part({ name: 'A13-slat', role: 'replaceable plasma slat', width: span, height, thickness: t, count: quantity, contours: [outline] })
      for (let index = 0; index < quantity; index += 1) builder.instance(part, identityTransform(0, index * (t + 20), 0), `A13-slat-${index + 1}`)
      return true
    }
    default: return false
  }
}

const addWeldedItems = (builder: AssemblyBuilder, config: ToolingConfig): boolean => {
  const t = nv(config, 'thickness'); const clearance = typeof config.values.clearance === 'number' ? config.values.clearance : 0
  const weldSize = { width: 30, depth: t }
  switch (config.id) {
    case 'B01': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const height = nv(config, 'height')
      const hd = nv(config, 'holeDiameter'); const hp = nv(config, 'holePitch'); const margin = nv(config, 'gridMargin')
      const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch'); const tw = nv(config, 'tabWidth')
      const rr = nv(config, 'radialRadius'); const rw = nv(config, 'radialWidth'); const rs = nv(config, 'radialStart'); const re = nv(config, 'radialEnd')
      const sideY = (width - t - clearance) / 2 - MIN_WEB
      const endX = -(length - t - clearance) / 2 + MIN_WEB
      const wallHeight = height - t
      const sideLength = length / 2 - endX - t / 2
      const sideX = (length / 2 + endX + t / 2) / 2
      const endWidth = 2 * sideY - t
      const sideXs = [-length / 4, length / 4]
      const endYs = [-width / 4, width / 4]
      const slots = [...[-sideY, sideY].flatMap(y => sideXs.map(x => slotBox(x, y, tw + clearance, t + clearance))), ...endYs.map(y => slotBox(endX, y, t + clearance, tw + clearance))]
      const top = builder.part({ name: 'B01-top', role: 'perforated top shelf', width: length, height: width, thickness: t,
        holes: gridHoles(length, width, hd, hp, margin, 'top'), slots, contours: [rectangle(length, width), ...slots.map(s => rectangle(s.width, s.height, pt(s.x, s.y)))] })
      const side = builder.part({ name: 'B01-side', role: 'tabbed open-bottom side wall', width: sideLength, height, thickness: t, count: 2,
        contours: [topTabbedRectangle(sideLength, wallHeight, t, sideXs.map(x => x - sideX), tw)] })
      const end = builder.part({ name: 'B01-mount-end', role: 'tabbed single table mounting end', width: endWidth, height, thickness: t,
        holes: boltPair(md, mp), contours: [topTabbedRectangle(endWidth, wallHeight, t, endYs, tw), radialSlot(pt(0, 0), rr, rw, rs, re)] })
      const it = builder.instance(top, identityTransform(0, 0, height - t / 2))
      const sides = [-1, 1].map(sign => builder.instance(side, transform({ x: sideX, y: sign * sideY, z: wallHeight / 2 }, { x: 90, y: 0, z: 0 }), `B01-side-${sign < 0 ? 'left' : 'right'}`))
      const ie = builder.instance(end, transform({ x: endX, y: 0, z: wallHeight / 2 }, { x: 90, y: 0, z: 90 }))
      for (const [index, instance] of sides.entries()) {
        const y = index ? sideY : -sideY
        for (const x of sideXs) builder.mate('tab', it, instance, { world: { x, y, z: height - t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: tw, depth: t } }, 'side tab through top slot')
        builder.mate('weld-edge', instance, ie, { world: { x: endX + t / 2, y: y - Math.sign(y) * t / 2, z: wallHeight / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'side edge to mounting end weld')
      }
      for (const y of endYs) builder.mate('tab', it, ie, { world: { x: endX, y, z: height - t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: tw, depth: t } }, 'mount-end tab through top slot')
      addFastenerSet(builder, 'mount', 2, md, 'table mounting')
      builder.warn('Match mounting pitch, diameter and wall access to the actual table; slot travel is not a load rating.')
      return true
    }
    case 'B02': {
      const x = nv(config, 'legX'); const y = nv(config, 'legY'); const arm = nv(config, 'armWidth'); const h = nv(config, 'height'); const d = nv(config, 'mountDiameter'); const pitch = nv(config, 'mountPitch')
      const outline = polygon([pt(-x / 2, -y / 2), pt(x / 2, -y / 2), pt(x / 2, -y / 2 + arm), pt(-x / 2 + arm, -y / 2 + arm), pt(-x / 2 + arm, y / 2), pt(-x / 2, y / 2)])
      const holes = [...gridHoles(x, arm, d, pitch, pitch / 2, 'x-grid').map(hole => ({ ...hole, y: hole.y - (y - arm) / 2 })), ...gridHoles(arm, y - arm, d, pitch, pitch / 2, 'y-grid').map(hole => ({ ...hole, x: hole.x - (x - arm) / 2, y: hole.y + arm / 2 }))]
      const top = builder.part({ name: 'B02-corner-top', role: 'L-shaped perforated top', width: x, height: y, thickness: t, holes, contours: [outline] })
      const wallX = rectangularPart(builder, 'B02-wall-x', 'first mounting wall', x, h, t, { holes: boltPair(d, pitch) }); const wallY = rectangularPart(builder, 'B02-wall-y', 'second mounting wall', y, h, t, { holes: boltPair(d, pitch) })
      const it = builder.instance(top, identityTransform(0, 0, h)); const ix = builder.instance(wallX, transform({ x: 0, y: -y / 2, z: h / 2 }, { x: 90, y: 0, z: 0 })); const iy = builder.instance(wallY, transform({ x: -x / 2, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', it, ix, { world: { x: 0, y: -y / 2, z: h }, axis: { x: 1, y: 0, z: 0 }, size: { width: x, depth: t } }, 'top to X wall')
      builder.mate('weld-edge', it, iy, { world: { x: -x / 2, y: 0, z: h }, axis: { x: 0, y: 1, z: 0 }, size: { width: y, depth: t } }, 'top to Y wall')
      addFastenerSet(builder, 'mount', 4, d, 'two-direction table mounting'); return true
    }
    case 'B03': {
      const span = nv(config, 'span'); const width = nv(config, 'width'); const h = nv(config, 'height'); const ribs = count(config, 'ribCount'); const d = nv(config, 'mountDiameter'); const pitch = nv(config, 'mountPitch')
      const top = rectangularPart(builder, 'B03-top', 'perforated bridge deck', span, width, t, { holes: gridHoles(span, width, d, pitch, pitch / 2) })
      const web = rectangularPart(builder, 'B03-web', 'longitudinal bridge web', span, h, t, { count: 2 })
      const end = rectangularPart(builder, 'B03-end', 'two-ended mounting plate', width, h, t, { count: 2, holes: boltPair(d, pitch) })
      const rib = rectangularPart(builder, 'B03-rib', 'internal transverse diaphragm', width - 2 * t, h - t, t, { count: ribs })
      const it = builder.instance(top, identityTransform(0, 0, h)); const wl = builder.instance(web, transform({ x: 0, y: -width / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), 'B03-web-left'); const wr = builder.instance(web, transform({ x: 0, y: width / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), 'B03-web-right')
      builder.mate('weld-edge', it, wl, { world: { x: 0, y: -width / 2, z: h }, axis: { x: 1, y: 0, z: 0 }, size: { width: span, depth: t } }, 'left deck edge'); builder.mate('weld-edge', it, wr, { world: { x: 0, y: width / 2, z: h }, axis: { x: 1, y: 0, z: 0 }, size: { width: span, depth: t } }, 'right deck edge')
      for (const sx of [-1, 1]) { const ie = builder.instance(end, transform({ x: sx * span / 2, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B03-end-${sx < 0 ? 'left' : 'right'}`); builder.mate('weld-edge', it, ie, { world: { x: sx * span / 2, y: 0, z: h }, axis: { x: 0, y: 1, z: 0 }, size: { width, depth: t } }, 'deck to mounting end') }
      for (let index = 0; index < ribs; index += 1) { const x = (index + 1) * span / (ribs + 1) - span / 2; const ir = builder.instance(rib, transform({ x, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B03-rib-${index + 1}`); builder.mate('weld-edge', it, ir, { world: { x, y: 0, z: h - t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: width - 2 * t, depth: t } }, 'diaphragm to deck') }
      addFastenerSet(builder, 'mount', 4, d, 'bridge end mounting'); builder.warn('Bridge span and load require a separate deflection and support-stability check.'); return true
    }
    case 'B04': {
      const length = nv(config, 'length'); const h = nv(config, 'height'); const baseWidth = nv(config, 'baseWidth'); const gussets = count(config, 'gussetCount'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const xs = Array.from({ length: gussets }, (_, i) => (i - (gussets - 1) / 2) * length / gussets)
      const slots = xs.map(x => slotBox(x, t / 2, t + clearance, 30 + clearance))
      const base = builder.part({ name: 'B04-base', role: 'mounting base with gusset slots', width: length, height: baseWidth, thickness: t, holes: boltPair(md, mp).map(hole => ({ ...hole, y: baseWidth / 2 - md / 2 - MIN_WEB })), slots, contours: [rectangle(length, baseWidth), ...slots.map(s => rectangle(s.width, s.height, pt(s.x, s.y)))] })
      const wall = rectangularPart(builder, 'B04-wall', 'vertical working face', length, h, t, { holes: gridHoles(length, h, md, mp, mp / 2) })
      const w = baseWidth - t
      const gusset = builder.part({ name: 'B04-gusset', role: 'triangular brace with through-base tab', width: w, height: h + t, thickness: t, count: gussets,
        contours: [polygon([pt(-w / 2, -h / 2), pt(-15, -h / 2), pt(-15, -h / 2 - t), pt(15, -h / 2 - t), pt(15, -h / 2), pt(w / 2, -h / 2), pt(-w / 2, h / 2)])] })
      const ib = builder.instance(base); const iw = builder.instance(wall, transform({ x: 0, y: -(baseWidth - t) / 2, z: (h + t) / 2 }, { x: 90, y: 0, z: 0 }))
      builder.mate('weld-edge', ib, iw, { world: { x: 0, y: -(baseWidth - t) / 2, z: t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'working wall to base')
      for (const [index, x] of xs.entries()) {
        const ig = builder.instance(gusset, transform({ x, y: t / 2, z: (h + t) / 2 }, { x: 90, y: 0, z: 90 }), `B04-gusset-${index + 1}`)
        builder.mate('tab', ib, ig, { world: { x, y: t / 2, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: { width: 30, depth: t } }, 'gusset tab through base slot')
        builder.mate('weld-edge', iw, ig, { world: { x, y: -baseWidth / 2 + t, z: (h + t) / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: h, depth: t } }, 'gusset back edge to working wall')
      }
      addFastenerSet(builder, 'mount', 2, md, 'table mounting'); return true
    }
    case 'B05': {
      const ax = nv(config, 'armX'); const ay = nv(config, 'armY'); const bw = nv(config, 'bodyWidth'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const cheekOutline = polygon([pt(-ax / 2, -ay / 2), pt(ax / 2, -ay / 2), pt(ax / 2, -ay / 2 + bw), pt(-ax / 2 + bw, -ay / 2 + bw), pt(-ax / 2 + bw, ay / 2), pt(-ax / 2, ay / 2)])
      const cheek = builder.part({ name: 'B05-cheek', role: 'L-profile box cheek', width: ax, height: ay, thickness: t, count: 2, holes: [-1, 1].map((sign, index) => circleHole(`mount-${index + 1}`, sign * mp / 2, -ay / 2 + bw / 2, md)), contours: [cheekOutline] })
      const tie = rectangularPart(builder, 'B05-tie', 'transverse welded box tie', bw, bw - t, t, { count: 3 })
      const c1 = builder.instance(cheek, identityTransform(0, 0, 0), 'B05-cheek-front'); const c2 = builder.instance(cheek, identityTransform(0, 0, bw), 'B05-cheek-back')
      for (let index = 0; index < 3; index += 1) { const world = { x: -ax / 2 + bw / 2 + index * (ax - bw) / 2, y: -ay / 2 + bw / 2, z: bw / 2 }; const itie = builder.instance(tie, transform(world, { x: 90, y: 0, z: 0 }), `B05-tie-${index + 1}`); builder.mate('weld-edge', c1, itie, { world: { ...world, z: t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'front cheek inner face to tie edge'); builder.mate('weld-edge', c2, itie, { world: { ...world, z: bw - t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'back cheek inner face to tie edge') }
      addFastenerSet(builder, 'mount', 4, md, 'table mounting'); return true
    }
    case 'B06': {
      const sx = nv(config, 'sizeX'); const sy = nv(config, 'sizeY'); const sz = nv(config, 'sizeZ'); const window = nv(config, 'window'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const base = rectangularPart(builder, 'B06-base', 'horizontal locating plane', sx, sy, t, { holes: boltPair(md, mp) })
      const wallX = builder.part({ name: 'B06-wall-x', role: 'vertical X locating plane', width: sx, height: sz, thickness: t, contours: [rectangle(sx, sz), rectangle(window, window)] })
      const wallY = builder.part({ name: 'B06-wall-y', role: 'vertical Y locating plane', width: sy, height: sz, thickness: t, contours: [rectangle(sy, sz), rectangle(window, window)] })
      const ib = builder.instance(base); const ix = builder.instance(wallX, transform({ x: 0, y: -sy / 2, z: sz / 2 }, { x: 90, y: 0, z: 0 })); const iy = builder.instance(wallY, transform({ x: -sx / 2, y: 0, z: sz / 2 }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', ib, ix, { world: { x: 0, y: -sy / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: sx, depth: t } }, 'base to X plane'); builder.mate('weld-edge', ib, iy, { world: { x: -sx / 2, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width: sy, depth: t } }, 'base to Y plane'); builder.mate('weld-edge', ix, iy, { world: { x: -sx / 2, y: -sy / 2, z: sz / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: sz, depth: t } }, 'vertical planes')
      addFastenerSet(builder, 'mount', 2, md, 'table mounting'); return true
    }
    case 'B07': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const h = nv(config, 'height'); const ribs = count(config, 'ribCount'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const face = rectangularPart(builder, 'B07-face', 'opposed perforated working face', length, width, t, { count: 2, holes: gridHoles(length, width, md, mp, mp / 2) })
      const side = rectangularPart(builder, 'B07-side', 'box side wall', length, h, t, { count: 2 }); const end = rectangularPart(builder, 'B07-end', 'box end wall', width, h, t, { count: 2 }); const rib = rectangularPart(builder, 'B07-rib', 'internal diaphragm', width - 2 * t, h - t, t, { count: ribs })
      const bottom = builder.instance(face, identityTransform(0, 0, 0), 'B07-face-bottom'); const top = builder.instance(face, identityTransform(0, 0, h), 'B07-face-top')
      for (const sySign of [-1, 1]) { const is = builder.instance(side, transform({ x: 0, y: sySign * width / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), `B07-side-${sySign}`); builder.mate('weld-edge', bottom, is, { world: { x: 0, y: sySign * width / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'bottom face edge'); builder.mate('weld-edge', top, is, { world: { x: 0, y: sySign * width / 2, z: h }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'top face edge') }
      for (const sxSign of [-1, 1]) { const ie = builder.instance(end, transform({ x: sxSign * length / 2, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B07-end-${sxSign}`); builder.mate('weld-edge', bottom, ie, { world: { x: sxSign * length / 2, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width, depth: t } }, 'end wall to bottom face') }
      for (let index = 0; index < ribs; index += 1) { const x = (index + 1) * length / (ribs + 1) - length / 2; const ir = builder.instance(rib, transform({ x, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B07-rib-${index + 1}`); builder.mate('weld-edge', bottom, ir, { world: { x, y: 0, z: t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: width - 2 * t, depth: t } }, 'diaphragm to bottom face') }
      return true
    }
    case 'B08': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const ah = nv(config, 'axisHeight'); const spacing = nv(config, 'cheekSpacing'); const ip = nv(config, 'insertPitch'); const id = nv(config, 'insertDiameter'); const angle = nv(config, 'veeAngle'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const tube = nv(config, 'profileSize'); const insertThickness = nv(config, 'insertThickness')
      const insertLength = Math.min(width - 2 * MIN_WEB, 140); const insertHeight = 100
      const notchDepth = tube / (2 * Math.tan(angle * Math.PI / 360))
      const boltZ = ah - insertHeight / 2 + notchDepth - tube / (2 * Math.sin(angle * Math.PI / 360))
      const cheekHeight = boltZ + insertHeight / 2 - notchDepth - MIN_WEB - t / 2
      if (cheekHeight < 40 || spacing + t + 2 * insertThickness + 2 * clearance > length) throw new Error('B08: holder height or cheek spacing cannot contain the selected inserts')
      const slots = [-1, 1].map(sign => slotBox(sign * spacing / 2, 0, t + clearance, 30 + clearance))
      const base = builder.part({ name: 'B08-base', role: 'slotted table mounting base', width: length, height: width, thickness: t, holes: boltPair(md, mp), slots, contours: [rectangle(length, width), ...slots.map(s => rectangle(s.width, s.height, pt(s.x, s.y)))] })
      const cheekZ = (cheekHeight + t) / 2
      const cheek = builder.part({ name: 'B08-cheek', role: 'tabbed insert holder below tube contact', width, height: cheekHeight + t, thickness: t, count: 2, holes: boltPair(id, ip).map(h => ({ ...h, y: boltZ - cheekZ })), contours: [topTabbedRectangle(width, cheekHeight, t, [0], 30, true)] })
      const bridge = rectangularPart(builder, 'B08-bridge', 'cheek spacing bridge', spacing - t, 30, t, { count: 2 })
      const insertConfig = createToolingConfig('A10', { length: insertLength, width: insertHeight, thickness: insertThickness, holderPitch: ip, holderDiameter: id, profileSize: tube, veeAngle: angle })
      const insertGeometry = buildToolingAssembly(insertConfig).parts[0]
      const insert = builder.part({ ...insertGeometry, name: 'A10-compatible-insert', count: 2 })
      const ib = builder.instance(base)
      const cheeks = [-1, 1].map(sign => {
        const ic = builder.instance(cheek, transform({ x: sign * spacing / 2, y: 0, z: cheekZ }, { x: 90, y: 0, z: 90 }), `B08-cheek-${sign}`)
        const ii = builder.instance(insert, transform({ x: sign * (spacing / 2 + (t + insertThickness) / 2), y: 0, z: boltZ }, { x: 90, y: 0, z: 90 }), `B08-insert-${sign}`)
        builder.mate('tab', ib, ic, { world: { x: sign * spacing / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: { width: 30, depth: t } }, 'cheek tab through base slot')
        for (const x of [-ip / 2, ip / 2]) builder.axialMate('bolt', ic, ii, pt(x, boltZ - cheekZ), pt(x, 0), id, 'replaceable A10 insert mounting bolt')
        return ic
      })
      for (const sign of [-1, 1]) {
        const y = sign * (width - t) / 2; const z = t / 2 + 15
        const br = builder.instance(bridge, transform({ x: 0, y, z }, { x: 90, y: 0, z: 0 }), `B08-bridge-${sign}`)
        for (const [index, ic] of cheeks.entries()) builder.mate('weld-edge', ic, br, { world: { x: (index ? 1 : -1) * (spacing - t) / 2, y, z }, axis: { x: 0, y: 0, z: 1 }, size: { width: 30, depth: t } }, 'bridge edge to cheek inner face')
      }
      addFastenerSet(builder, 'insert', 4, id, 'A10 insert mounting'); addFastenerSet(builder, 'table', 2, md, 'table mounting')
      return true
    }
    case 'B09': {
      const pl = nv(config, 'platformLength'); const pw = nv(config, 'platformWidth'); const ph = nv(config, 'pivotHeight'); const radius = nv(config, 'slotRadius'); const amin = nv(config, 'angleMin'); const amax = nv(config, 'angleMax'); const angle = nv(config, 'angle')
      if (amin >= amax || angle < amin || angle > amax) throw new Error('B09: platform angle must be inside the locking slot range')
      const maxTilt = Math.max(Math.abs(amin), Math.abs(amax)) * Math.PI / 180
      const lugHeight = 44
      if (ph <= pl / 2 * Math.sin(maxTilt) + lugHeight / 2 + MIN_WEB) throw new Error('B09: increase pivot height to clear the base through the full tilt range')
      const platformWidth = pw - 4 * t - 2 * clearance
      const pivotZ = ph + t / 2
      const radians = angle * Math.PI / 180
      const offset = (lugHeight + t) / 2
      const base = rectangularPart(builder, 'B09-base', 'tilt fixture base', pl, pw, t, { holes: fourHoles(16, pl - 50, pw - 50) })
      const platform = rectangularPart(builder, 'B09-platform', 'tilting work platform', pl, platformWidth, t, { holes: gridHoles(pl, platformWidth, 16, 50, 25) })
      const cheek = builder.part({ name: 'B09-cheek', role: 'stationary pivot and radial lock cheek', width: pl, height: 2 * ph, thickness: t, count: 2, holes: [circleHole('pivot', 0, 0, 16)], contours: [rectangle(pl, 2 * ph), radialSlot(pt(0, 0), radius, 18, amin, amax)] })
      const lug = rectangularPart(builder, 'B09-platform-lug', 'moving pivot and locking lug', pl, lugHeight, t, { count: 2, holes: [circleHole('pivot', 0, 0, 16), circleHole('lock', radius, 0, 18)] })
      const ib = builder.instance(base)
      const ip = builder.instance(platform, transform({ x: -offset * Math.sin(radians), y: 0, z: pivotZ + offset * Math.cos(radians) }, { x: 0, y: -angle, z: 0 }))
      for (const sign of [-1, 1]) {
        const y = sign * (pw - t) / 2
        const movingY = sign * (platformWidth - t) / 2
        const ic = builder.instance(cheek, transform({ x: 0, y, z: pivotZ }, { x: 90, y: 0, z: 0 }), `B09-cheek-${sign}`)
        const il = builder.instance(lug, transform({ x: 0, y: movingY, z: pivotZ }, { x: 90, y: -angle, z: 0 }), `B09-lug-${sign}`)
        builder.mate('weld-edge', ib, ic, { world: { x: 0, y, z: t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: pl, depth: t } }, 'stationary cheek to base')
        builder.mate('weld-edge', ip, il, { world: { x: -lugHeight / 2 * Math.sin(radians), y: movingY, z: pivotZ + lugHeight / 2 * Math.cos(radians) }, axis: { x: Math.cos(radians), y: 0, z: Math.sin(radians) }, size: { width: pl, depth: t } }, 'platform underside to moving lug')
        builder.axialMate('pivot', ic, il, pt(0, 0), pt(0, 0), 16, 'coaxial platform pivot with spacer')
        builder.axialMate('bolt', ic, il, pt(radius * Math.cos(radians), radius * Math.sin(radians)), pt(radius, 0), 16, 'lock bolt through radial slot')
      }
      addFastenerSet(builder, 'pivot', 2, 16, 'platform pivot'); addFastenerSet(builder, 'lock', 2, 16, 'radial lock')
      builder.buy('pivot-spacer', 'Pivot and locking spacers', 4, { boreDiameter: 16, length: t + clearance })
      builder.warn('Nominal motion clears the base; select bolts, locking preload and welds for the actual moment.')
      return true
    }
    case 'B10': {
      const span = nv(config, 'span'); const ch = nv(config, 'clearHeight'); const bd = nv(config, 'beamDepth'); const clamps = count(config, 'clampCount'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const footSlot = slotBox(0, 0, t + clearance, bd / 2 + clearance)
      const foot = builder.part({ name: 'B10-foot', role: 'slotted gantry mounting foot', width: bd * 1.5, height: bd, thickness: t, count: 2, holes: boltPair(md, mp), slots: [footSlot], contours: [rectangle(bd * 1.5, bd), rectangle(footSlot.width, footSlot.height)] })
      const uprightHeight = ch + bd
      const upright = builder.part({ name: 'B10-upright', role: 'gantry upright with foot tab', width: bd, height: uprightHeight + t, thickness: t, count: 2, contours: [topTabbedRectangle(bd, uprightHeight, t, [0], bd / 2, true)] })
      const beamLength = span - t
      const beam = rectangularPart(builder, 'B10-beam', 'box crossbeam side wall', beamLength, bd, t, { count: 2 })
      const cap = rectangularPart(builder, 'B10-beam-cap', 'box crossbeam clamp mounting face', beamLength, bd - 2 * t, t, { count: 2, holes: Array.from({ length: clamps }, (_, i) => circleHole(`clamp-${i + 1}`, (i - (clamps - 1) / 2) * beamLength / Math.max(clamps, 2), 0, 12)) })
      const uprights = [-1, 1].map(sign => {
        const footInstance = builder.instance(foot, identityTransform(sign * span / 2, 0, 0), `B10-foot-${sign}`)
        const instance = builder.instance(upright, transform({ x: sign * span / 2, y: 0, z: (uprightHeight + t) / 2 }, { x: 90, y: 0, z: 90 }), `B10-upright-${sign}`)
        builder.mate('tab', footInstance, instance, { world: { x: sign * span / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: { width: bd / 2, depth: t } }, 'upright tab through mounting foot')
        return instance
      })
      const beamZ = t / 2 + ch + bd / 2
      for (const sign of [-1, 1]) {
        const y = sign * (bd - t) / 2
        const wall = builder.instance(beam, transform({ x: 0, y, z: beamZ }, { x: 90, y: 0, z: 0 }), `B10-beam-${sign}`)
        for (const [index, uprightInstance] of uprights.entries()) builder.mate('weld-edge', uprightInstance, wall, { world: { x: (index ? 1 : -1) * beamLength / 2, y, z: beamZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: bd, depth: t } }, 'box wall end to upright inner face')
      }
      for (const sign of [-1, 1]) {
        const z = beamZ + sign * (bd - t) / 2
        const face = builder.instance(cap, identityTransform(0, 0, z), `B10-cap-${sign}`)
        for (const [index, uprightInstance] of uprights.entries()) builder.mate('weld-edge', uprightInstance, face, { world: { x: (index ? 1 : -1) * beamLength / 2, y: 0, z }, axis: { x: 0, y: 1, z: 0 }, size: { width: bd - 2 * t, depth: t } }, 'box face end to upright inner face')
      }
      builder.buy('screw-clamp', 'Purchased through-bolt screw clamp with retained nut', clamps, { mountingDiameter: 12, mountingGrip: bd })
      addFastenerSet(builder, 'table', 4, md, 'gantry table mounting')
      builder.warn('No clamp-force rating is assigned; check frame bending and table overturning for the selected mechanisms.')
      return true
    }
    case 'B11': {
      const projection = nv(config, 'projection'); const pw = nv(config, 'platformWidth'); const h = nv(config, 'height'); const dp = nv(config, 'devicePitch'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const slotLength = projection * .5
      const slots = [-1, 1].map(sign => slotBox(0, sign * dp / 2, slotLength, 14))
      const platform = builder.part({ name: 'B11-platform', role: 'slotted vise/tool platform', width: projection, height: pw, thickness: t, slots, contours: [rectangle(projection, pw), ...slots.map(s => capsule(s.width, s.height, pt(s.x, s.y)))] })
      const wallHeight = h - t; const gussetLength = projection - t / 2
      const end = rectangularPart(builder, 'B11-mount-end', 'table mounting end', pw, wallHeight, t, { holes: boltPair(md, mp) })
      const gusset = builder.part({ name: 'B11-gusset', role: 'full-length platform support gusset', width: gussetLength, height: wallHeight, thickness: t, count: 2, contours: [polygon([pt(-gussetLength / 2, -wallHeight / 2), pt(gussetLength / 2, wallHeight / 2), pt(-gussetLength / 2, wallHeight / 2)])] })
      const ip = builder.instance(platform, identityTransform(projection / 2, 0, h - t / 2))
      const ie = builder.instance(end, transform({ x: 0, y: 0, z: wallHeight / 2 }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', ip, ie, { world: { x: 0, y: 0, z: wallHeight }, axis: { x: 0, y: 1, z: 0 }, size: { width: pw, depth: t } }, 'platform underside to mounting end')
      for (const sign of [-1, 1]) {
        const y = sign * (pw - t) / 2; const x = t / 2 + gussetLength / 2
        const ig = builder.instance(gusset, transform({ x, y, z: wallHeight / 2 }, { x: 90, y: 0, z: 0 }), `B11-gusset-${sign}`)
        builder.mate('weld-edge', ip, ig, { world: { x, y, z: wallHeight }, axis: { x: 1, y: 0, z: 0 }, size: { width: gussetLength, depth: t } }, 'full gusset upper edge to platform underside')
        builder.mate('weld-edge', ie, ig, { world: { x: t / 2, y, z: wallHeight / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: wallHeight, depth: t } }, 'gusset rear edge to mounting end')
      }
      addFastenerSet(builder, 'table', 2, md, 'console mounting'); builder.buy('bench-tool', 'Vise or bench tool selected by user', 1, { slotSpacing: dp, slotWidth: 14 }); builder.warn('Tool mass, operating moment and handle envelope are not rated by this geometry.'); return true
    }
    case 'B12': {
      const length = nv(config, 'length'); const depth = nv(config, 'depth'); const h = nv(config, 'height'); const stations = count(config, 'stationCount'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const back = rectangularPart(builder, 'B12-back', 'hanging mounting back', length, h, t, { holes: boltPair(md, mp) }); const shelf = rectangularPart(builder, 'B12-shelf', 'tool shelf', length, depth, t)
      const stationPitch = length / stations; const half = length / 2
      const rackPoints = [pt(-half, -depth / 2), pt(half, -depth / 2), pt(half, depth / 2)]
      for (let i = stations - 1; i >= 0; i -= 1) { const x = -half + (i + .5) * stationPitch; rackPoints.push(pt(x + stationPitch * .2, depth / 2), pt(x + stationPitch * .2, 0), pt(x - stationPitch * .2, 0), pt(x - stationPitch * .2, depth / 2)) }
      rackPoints.push(pt(-half, depth / 2))
      const rack = builder.part({ name: 'B12-rack', role: 'profiled tool-station rack', width: length, height: depth, thickness: t, contours: [polygon(rackPoints)] })
      const ib = builder.instance(back, transform({ x: 0, y: 0, z: h / 2 }, { x: 90, y: 0, z: 0 })); const is = builder.instance(shelf, identityTransform(0, depth / 2, 0)); const ir = builder.instance(rack, identityTransform(0, depth / 2, h / 2))
      builder.mate('weld-edge', ib, is, { world: { x: 0, y: 0, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'shelf to back'); builder.mate('weld-edge', ib, ir, { world: { x: 0, y: 0, z: h / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'rack to back'); addFastenerSet(builder, 'table', 2, md, 'organizer mounting'); return true
    }
    case 'B13': {
      const opening = nv(config, 'opening'); const reach = nv(config, 'reach'); const bw = nv(config, 'bodyWidth'); const screw = nv(config, 'screwDiameter')
      const outerW = reach + bw; const outerH = opening + 2 * bw
      const cheekOutline = polygon([pt(-outerW / 2, -outerH / 2), pt(outerW / 2, -outerH / 2), pt(outerW / 2, -outerH / 2 + bw), pt(-outerW / 2 + bw, -outerH / 2 + bw), pt(-outerW / 2 + bw, outerH / 2 - bw), pt(outerW / 2, outerH / 2 - bw), pt(outerW / 2, outerH / 2), pt(-outerW / 2, outerH / 2)])
      const cheek = builder.part({ name: 'B13-cheek', role: 'C-profile force cheek', width: outerW, height: outerH, thickness: t, count: 2, contours: [cheekOutline] }); const bridge = rectangularPart(builder, 'B13-bridge', 'cheek tie bridge', bw, bw - t, t, { count: 3 }); const nutPlate = rectangularPart(builder, 'B13-nut-plate', 'purchased nut mounting plate', bw, bw - t, t, { holes: [circleHole('screw', 0, 0, screw)] })
      const c1 = builder.instance(cheek, identityTransform(0, 0, 0), 'B13-cheek-front'); const c2 = builder.instance(cheek, identityTransform(0, 0, bw), 'B13-cheek-rear'); const np = builder.instance(nutPlate, transform({ x: outerW / 2 - bw / 2, y: outerH / 2 - bw / 2, z: bw / 2 }, { x: 90, y: 0, z: 0 }))
      for (let i = 0; i < 3; i += 1) { const world = { x: -outerW / 2 + bw / 2 + i * (outerW - bw) / 2, y: -outerH / 2 + bw / 2, z: bw / 2 }; const br = builder.instance(bridge, transform(world, { x: 90, y: 0, z: 0 }), `B13-bridge-${i + 1}`); builder.mate('weld-edge', c1, br, { world: { ...world, z: t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'front cheek tie'); builder.mate('weld-edge', c2, br, { world: { ...world, z: bw - t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'rear cheek tie') }
      builder.mate('weld-edge', c1, np, { world: { x: outerW / 2 - bw / 2, y: outerH / 2 - bw / 2, z: t / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: bw, depth: t, diameter: screw } }, 'nut plate edge welded to force cheek')
      builder.mate('weld-edge', c2, np, { world: { x: outerW / 2 - bw / 2, y: outerH / 2 - bw / 2, z: bw - t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: bw, depth: t } }, 'opposite nut plate edge to force cheek')
      builder.buy('screw-assembly', 'Purchased screw with swivel foot and matching nut', 1, { nominalDiameter: screw, requiredTravel: opening }); builder.warn('This clamp body has no assigned force rating; calculate cheeks, ties, welds and thread interface and proof-test the assembly.'); return true
    }
    case 'B14': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const h = nv(config, 'height'); const sc = count(config, 'slatCount'); const st = nv(config, 'slatThickness'); const slatHeight = nv(config, 'slatHeight'); const seat = nv(config, 'seatDepth'); const seatWidth = nv(config, 'seatWidth'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const railCuts = Array.from({ length: sc }, (_, i) => { const x = (i - (sc - 1) / 2) * (length - 2 * t) / Math.max(sc - 1, 1); return rectangle(st + clearance, seat, pt(x, h / 2 - seat / 2)) })
      const rail = builder.part({ name: 'B14-slat-rail', role: 'slotted slat support rail', width: length, height: h, thickness: t, count: 2, slots: railCuts.map((_, i) => slotBox((i - (sc - 1) / 2) * (length - 2 * t) / Math.max(sc - 1, 1), h / 2 - seat / 2, st + clearance, seat)), contours: [rectangle(length, h), ...railCuts] })
      const end = rectangularPart(builder, 'B14-mount-end', 'frame mounting/end wall', width, h, t, { count: 2, holes: boltPair(md, mp) }); const slatHalf = slatHeight / 2; const slat = builder.part({ name: 'A13-compatible-slat', role: 'replaceable A13 slat', width, height: slatHeight, thickness: st, count: sc, contours: [polygon([pt(-width / 2, -slatHalf), pt(-width / 2 + seatWidth, -slatHalf), pt(-width / 2 + seatWidth, -slatHalf + seat), pt(width / 2 - seatWidth, -slatHalf + seat), pt(width / 2 - seatWidth, -slatHalf), pt(width / 2, -slatHalf), pt(width / 2, slatHalf), pt(-width / 2, slatHalf)])] })
      const rl = builder.instance(rail, transform({ x: 0, y: -width / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), 'B14-rail-front'); const rr = builder.instance(rail, transform({ x: 0, y: width / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), 'B14-rail-rear')
      for (const sx of [-1, 1]) { const ie = builder.instance(end, transform({ x: sx * length / 2, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B14-end-${sx}`); builder.mate('weld-edge', rl, ie, { world: { x: sx * length / 2, y: -width / 2, z: h / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'front rail to end'); builder.mate('weld-edge', rr, ie, { world: { x: sx * length / 2, y: width / 2, z: h / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'rear rail to end') }
      for (let i = 0; i < sc; i += 1) { const x = (i - (sc - 1) / 2) * (length - 2 * t) / Math.max(sc - 1, 1); const is = builder.instance(slat, transform({ x, y: 0, z: h - seat + slatHalf }, { x: 90, y: 0, z: 90 }), `B14-slat-${i + 1}`); builder.mate('replaceable', rl, is, { world: { x, y: -width / 2, z: h - seat / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: st + clearance, depth: seat } }, 'front A13 seat'); builder.mate('replaceable', rr, is, { world: { x, y: width / 2, z: h - seat / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: st + clearance, depth: seat } }, 'rear A13 seat') }
      addFastenerSet(builder, 'mount', 4, md, 'plasma module mounting'); builder.buy('fume-control', 'External fume and spark-control system', 1, { interface: 'site-specific' }); builder.warn('The slat module is not a load-bearing extension; fire, slag and fume controls are site-specific.'); return true
    }
    default: return false
  }
}

const addHybridItems = (builder: AssemblyBuilder, config: ToolingConfig): boolean => {
  const t = nv(config, 'thickness'); const clearance = typeof config.values.clearance === 'number' ? config.values.clearance : 0
  switch (config.id) {
    case 'C01': {
      const pin = nv(config, 'pinDiameter'); const grip = nv(config, 'gripLength')
      builder.buy('precision-pin', 'User-selected precision or ball-lock pin', 1, { shankDiameter: pin, gripLength: grip, lowerChamferRequired: 'verify with table and pin specification' })
      if (boolValue(config, 'includeAdapter')) {
        const length = nv(config, 'length'); const width = nv(config, 'width')
        const adapter = rectangularPart(builder, 'C01-adapter', 'optional pin adapter plate', length, width, t, { holes: [circleHole('pin-interface', 0, 0, pin + clearance)] })
        builder.instance(adapter)
      }
      return true
    }
    case 'C02': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch'); const dx = nv(config, 'devicePitchX'); const dy = nv(config, 'devicePitchY'); const dd = nv(config, 'deviceDiameter'); const stroke = nv(config, 'workingStroke')
      const adapter = rectangularPart(builder, 'C02-adapter', 'toggle-clamp transition plate', length, width, t, { holes: [...boltPair(md, mp, 'x', 'table'), ...fourHoles(dd, dx, dy, 'clamp')] })
      builder.instance(adapter); builder.buy('toggle-clamp', 'User-selected quick clamp mechanism', 1, { mountingPitchX: dx, mountingPitchY: dy, boltDiameter: dd, workingStroke: stroke, sweptEnvelope: 'user must supply' }); addFastenerSet(builder, 'table', 2, md, 'table mounting'); addFastenerSet(builder, 'device', 4, dd, 'toggle clamp mounting'); return true
    }
    case 'C03': {
      const stroke = nv(config, 'stroke'); const gs = nv(config, 'guideSpacing'); const gd = nv(config, 'guideDiameter'); const sd = nv(config, 'screwDiameter'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const bush = nv(config, 'bushDiameter'); const nut = nv(config, 'nutDiameter'); const position = nv(config, 'position')
      if (position > stroke || bush <= gd || nut <= sd) throw new Error('C03: position must fit stroke and bush/nut outside diameters must exceed their bores')
      const length = stroke + 140; const width = gs + 80; const axisZ = 50 + t / 2; const carriageX = position - stroke / 2
      const base = rectangularPart(builder, 'C03-base', 'guided stop mounting base', length, width, t, { holes: boltPair(md, mp) })
      const end = rectangularPart(builder, 'C03-end', 'guide and thrust bearing end', width, 100, t, { count: 2, holes: [circleHole('screw', 0, 0, sd + clearance), ...boltPair(gd + clearance, gs)] })
      const carriage = rectangularPart(builder, 'C03-carriage', 'moving stop with bush and nut seats', width, 80, t, { count: 2, holes: [circleHole('nut', 0, 0, nut + clearance), ...boltPair(bush + clearance, gs)] })
      const tie = rectangularPart(builder, 'C03-carriage-tie', 'moving carriage side tie', 40 - t, 80, t, { count: 2 })
      const ib = builder.instance(base)
      const ends = [-1, 1].map(sign => {
        const x = sign * (length - t) / 2
        const instance = builder.instance(end, transform({ x, y: 0, z: axisZ }, { x: 90, y: 0, z: 90 }), `C03-end-${sign}`)
        builder.mate('weld-edge', ib, instance, { world: { x, y: 0, z: t / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width, depth: t } }, 'bearing end to base')
        return instance
      })
      const cheeks = [-1, 1].map(sign => builder.instance(carriage, transform({ x: carriageX + sign * 20, y: 0, z: axisZ }, { x: 90, y: 0, z: 90 }), `C03-carriage-${sign}`))
      for (const moving of cheeks) for (const x of [-gs / 2, gs / 2]) builder.axialMate('linear-guide', ends[0], moving, pt(x, 0), pt(x, 0), gd, 'guide shaft through carriage bush')
      for (const x of [-gs / 2, gs / 2]) builder.axialMate('linear-guide', ends[0], ends[1], pt(x, 0), pt(x, 0), gd, 'shaft supported at both stationary ends')
      for (const sign of [-1, 1]) {
        const y = sign * (width - t) / 2
        const itie = builder.instance(tie, transform({ x: carriageX, y, z: axisZ }, { x: 90, y: 0, z: 0 }), `C03-tie-${sign}`)
        for (const [index, cheek] of cheeks.entries()) builder.mate('weld-edge', cheek, itie, { world: { x: carriageX + (index ? 1 : -1) * (20 - t / 2), y, z: axisZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: 80, depth: t } }, 'carriage cheek to side tie')
      }
      builder.buy('guide-shaft', 'Precision guide shaft with end retainers', 2, { diameter: gd, workingLength: length })
      builder.buy('guide-bush', 'Flanged retained guide bush', 4, { boreDiameter: gd, outsideDiameter: bush, seatDiameter: bush + clearance })
      builder.buy('screw-assembly', 'Screw, retained flanged nut and thrust supports', 1, { nominalDiameter: sd, nutOutsideDiameter: nut, workingStroke: stroke, supportDistance: length - t })
      for (const y of [-gs / 2, gs / 2]) builder.purchasedEnvelope('guide-shaft', { x: -length / 2, y, z: axisZ }, { x: length / 2, y, z: axisZ }, gd)
      builder.purchasedEnvelope('screw-assembly', { x: -length / 2, y: 0, z: axisZ }, { x: length / 2, y: 0, z: axisZ }, sd)
      for (const instance of ends) {
        for (const hole of end.holes.filter(h => h.id !== 'screw')) builder.mountPurchased('guide-shaft', instance, hole.id)
        builder.mountPurchased('screw-assembly', instance, 'screw')
      }
      for (const instance of cheeks) {
        for (const hole of carriage.holes.filter(h => h.id !== 'nut')) builder.mountPurchased('guide-bush', instance, hole.id)
        builder.mountPurchased('screw-assembly', instance, 'nut')
      }
      addFastenerSet(builder, 'table', 2, md, 'table mounting')
      builder.warn('Bush and nut seats require the selected retention system and finish machining; nominal sheet holes are not precision bearing fits.')
      return true
    }
    case 'C04': {
      const length = nv(config, 'baseLength'); const width = nv(config, 'baseWidth'); const spacing = nv(config, 'axisSpacing'); const ah = nv(config, 'axisHeight'); const axle = nv(config, 'axleDiameter'); const roller = nv(config, 'rollerDiameter'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const base = rectangularPart(builder, 'C04-base', 'roller-stand base', length, width, t, { holes: boltPair(md, mp) })
      if (spacing < roller + clearance || ah < roller / 2 + t + MIN_WEB) throw new Error('C04: rollers overlap or intersect the base')
      const cheekHeight = ah + roller / 2 - t / 2
      const cheekZ = (cheekHeight + t) / 2
      const cheek = rectangularPart(builder, 'C04-cheek', 'roller axle cheek', length, cheekHeight, t, { count: 2, holes: boltPair(axle + clearance, spacing).map(h => ({ ...h, y: ah - cheekZ })) })
      const ib = builder.instance(base); const cl = builder.instance(cheek, transform({ x: 0, y: -width / 2, z: cheekZ }, { x: 90, y: 0, z: 0 }), 'C04-cheek-left'); const cr = builder.instance(cheek, transform({ x: 0, y: width / 2, z: cheekZ }, { x: 90, y: 0, z: 0 }), 'C04-cheek-right')
      builder.mate('weld-edge', ib, cl, { world: { x: 0, y: -width / 2, z: t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'left cheek to base'); builder.mate('weld-edge', ib, cr, { world: { x: 0, y: width / 2, z: t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'right cheek to base')
      builder.buy('roller', 'User-selected roller', 2, { outerDiameter: roller, axleDiameter: axle, faceWidth: width - 2 * t - 2 * clearance }); builder.buy('bearing', 'Matched roller bearing', 4, { boreDiameter: axle }); builder.buy('axle', 'Roller axle', 2, { diameter: axle, length: width + 2 * t }); addFastenerSet(builder, 'table', 2, md, 'table mounting'); builder.warn('Provide a welding-current return path that bypasses the roller bearings.'); return true
    }
    case 'C05': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const angle = nv(config, 'veeAngle'); const magnetD = nv(config, 'magnetDiameter'); const magnets = count(config, 'magnetCount')
      const sideHeight = width / (2 * Math.cos(angle * Math.PI / 360)); const side = rectangularPart(builder, 'C05-v-side', 'magnetic V contact side', length, sideHeight, t, { count: 2, holes: Array.from({ length: Math.ceil(magnets / 2) }, (_, i) => circleHole(`magnet-${i + 1}`, (i - (Math.ceil(magnets / 2) - 1) / 2) * length / Math.max(Math.ceil(magnets / 2), 1), 0, magnetD + clearance)) })
      if (magnets % 2) throw new Error('C05: paired V sides require an even magnet count')
      const back = rectangularPart(builder, 'C05-back', 'magnet retention back', length, width, t)
      const halfAngle = angle * Math.PI / 360
      const apexZ = sideHeight / 2 + sideHeight / 2 * Math.sin(halfAngle)
      const backZ = sideHeight / 2 - sideHeight / 2 * Math.sin(halfAngle)
      const il = builder.instance(side, transform({ x: 0, y: -width / 4, z: sideHeight / 2 }, { x: angle / 2, y: 0, z: 0 }), 'C05-side-left'); const ir = builder.instance(side, transform({ x: 0, y: width / 4, z: sideHeight / 2 }, { x: -angle / 2, y: 0, z: 0 }), 'C05-side-right'); const ib = builder.instance(back, identityTransform(0, 0, backZ))
      builder.mate('weld-edge', il, ir, { world: { x: 0, y: 0, z: apexZ }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'V apex'); builder.mate('weld-edge', il, ib, { world: { x: 0, y: -width / 2, z: backZ }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'left side to back'); builder.mate('weld-edge', ir, ib, { world: { x: 0, y: width / 2, z: backZ }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'right side to back')
      builder.buy('magnet', 'User-selected temperature-rated magnet', magnets, { outerDiameter: magnetD, retentionInterface: 'user-specified' }); builder.warn('Holding force and welding-arc interaction are properties of the selected magnets and air gaps, not of this housing.'); return true
    }
    case 'C06': {
      const bl = nv(config, 'baseLength'); const bw = nv(config, 'baseWidth'); const ah = nv(config, 'axisHeight'); const fp = nv(config, 'faceplateDiameter'); const shaft = nv(config, 'shaftDiameter'); const bearing = nv(config, 'bearingOuterDiameter'); const motorPattern = nv(config, 'motorPattern')
      if (bearing <= shaft || ah <= fp / 2 + t / 2 + MIN_WEB) throw new Error('C06: bearing must fit shaft and rotating faceplate must clear the base')
      const headHeight = ah + bearing / 2 + MIN_WEB - t / 2
      const headZ = t / 2 + headHeight / 2
      const bearingY = ah - headZ
      const base = rectangularPart(builder, 'C06-base', 'positioner chassis base', bl, bw, t, { holes: fourHoles(14, bl - 60, bw - 60, 'bench') })
      const head = rectangularPart(builder, 'C06-headstock', 'bearing headstock wall', bw, headHeight, t, { count: 2, holes: [circleHole('bearing-seat', 0, bearingY, bearing)] })
      const faceThickness = Math.max(t, 10)
      const face = builder.part({ name: 'C06-faceplate', role: 'rotating welding faceplate blank', width: fp, height: fp, thickness: faceThickness,
        holes: [circleHole('shaft', 0, 0, shaft + clearance), ...fourHoles(12, fp * .55, fp * .55, 'work')], contours: [[arc(pt(0, 0), fp / 2, 0, 180), arc(pt(0, 0), fp / 2, 180, 360)]] })
      const motorHeight = 2 * ah - t
      const motorPlate = rectangularPart(builder, 'C06-motor-plate', 'coaxial geared-motor adapter', bw * .7, motorHeight, t, { holes: [circleHole('drive-shaft', 0, 0, shaft + clearance), ...fourHoles(10, motorPattern, motorPattern, 'motor')] })
      const ib = builder.instance(base)
      const heads = [-1, 1].map(sign => {
        const instance = builder.instance(head, transform({ x: sign * bl / 4, y: 0, z: headZ }, { x: 90, y: 0, z: 90 }), `C06-headstock-${sign}`)
        builder.mate('weld-edge', ib, instance, { world: { x: sign * bl / 4, y: 0, z: t / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: bw, depth: t } }, 'headstock bottom edge to base')
        return instance
      })
      const iff = builder.instance(face, transform({ x: -bl / 4 - t / 2 - clearance - faceThickness / 2, y: 0, z: ah }, { x: 0, y: 90, z: 0 }))
      const im = builder.instance(motorPlate, transform({ x: (bl - t) / 2, y: 0, z: ah }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', ib, im, { world: { x: (bl - t) / 2, y: 0, z: t / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: bw * .7, depth: t } }, 'motor adapter bottom edge to base')
      builder.axialMate('bearing-seat', heads[0], heads[1], pt(0, bearingY), pt(0, bearingY), shaft, 'two coaxial spindle bearing seats')
      builder.axialMate('bearing-seat', heads[0], iff, pt(0, bearingY), pt(0, 0), shaft, 'faceplate hub on spindle axis')
      builder.axialMate('bearing-seat', heads[1], im, pt(0, bearingY), pt(0, 0), shaft, 'coaxial reduction output coupling')
      builder.buy('shaft', 'Machined shaft with faceplate hub and axial retainers', 1, { diameter: shaft, bearingSpacing: bl / 2, faceplateInterface: shaft + clearance })
      builder.buy('bearing', 'Retained spindle bearing and mounting cartridge', 2, { outerDiameter: bearing, boreDiameter: shaft, housingThickness: t })
      builder.buy('drive', 'Coaxial reduction and flexible shaft coupling', 1, { shaftDiameter: shaft, availableLength: bl / 4 - t })
      builder.buy('motor', 'Flange motor and controller', 1, { mountingPattern: motorPattern, mountingDiameter: 10, outputAxisHeight: ah })
      for (const instance of heads) builder.mountPurchased('bearing', instance, 'bearing-seat')
      builder.mountPurchased('shaft', iff, 'shaft')
      builder.mountPurchased('drive', im, 'drive-shaft')
      for (const hole of motorPlate.holes.filter(h => h.id.startsWith('motor'))) builder.mountPurchased('motor', im, hole.id)
      builder.purchasedEnvelope('shaft', { x: iff.transform.translation.x - faceThickness / 2, y: 0, z: ah }, { x: im.transform.translation.x, y: 0, z: ah }, shaft)
      builder.purchasedEnvelope('drive', { x: bl / 4 + t / 2, y: 0, z: ah }, { x: im.transform.translation.x - t / 2, y: 0, z: ah }, shaft * 1.8)
      builder.warn('Bearing seats require finish machining and axial retention. Select coaxial drive, guarding and an isolated welding-current return; no torque rating is assigned.')
      return true
    }
    case 'C07': {
      const ww = nv(config, 'workingWidth'); const daylight = nv(config, 'daylight'); const depth = nv(config, 'frameDepth'); const jackSeat = nv(config, 'jackSeatDiameter'); const stroke = nv(config, 'stroke'); const pin = nv(config, 'pinDiameter')
      const row = count(config, 'bedRow'); const position = nv(config, 'position')
      if (position > stroke || stroke >= daylight - 2 * t) throw new Error('C07: actuator travel must fit the available daylight')
      const rowPitch = pin + 2 * MIN_WEB
      const bedZ = depth / 2 + row * rowPitch
      const bedHeight = depth / 2
      const toolThickness = Math.max(t, 20)
      const bedTopZ = bedZ + bedHeight / 2 + t / 2
      const lowerTopZ = bedTopZ + t / 2 + toolThickness
      const crownZ = depth / 2 + 4 * rowPitch + bedHeight / 2 + t + toolThickness + daylight + 2 * t
      const sideHeight = crownZ - t / 2
      const insideWidth = ww - 2 * t - 2 * clearance
      const pinYs = [-depth / 4, depth / 4]
      const side = builder.part({ name: 'C07-side-frame', role: 'press side frame with paired bed pin rows', width: depth, height: sideHeight, thickness: t, count: 2,
        holes: Array.from({ length: 5 }, (_, i) => pinYs.map((y, j) => circleHole(`bed-pin-${i}-${j}`, y, depth / 2 + i * rowPitch - sideHeight / 2, pin + clearance))).flat(), contours: [rectangle(depth, sideHeight)] })
      const crown = rectangularPart(builder, 'C07-crown', 'actuator mounting crown', ww + 2 * t, depth, t, { holes: [circleHole('actuator-seat', 0, 0, jackSeat + clearance), ...fourHoles(12, jackSeat + 40, jackSeat + 40, 'actuator')] })
      const bed = rectangularPart(builder, 'C07-bed', 'adjustable bed end cheek', depth, bedHeight, t, { count: 2, holes: pinYs.map((y, i) => circleHole(`bed-pin-${i}`, y, 0, pin + clearance)) })
      const top = rectangularPart(builder, 'C07-bed-top', 'bed cross plate', insideWidth, depth, t, { holes: fourHoles(12, insideWidth / 2, depth / 2, 'tool') })
      const tool = rectangularPart(builder, 'C07-tool-plate', 'bolted lower tooling adapter', insideWidth, depth, toolThickness, { holes: fourHoles(12, insideWidth / 2, depth / 2, 'tool') })
      const ram = rectangularPart(builder, 'C07-ram', 'moving actuator and upper tooling adapter', insideWidth, depth, t, { holes: [circleHole('ram-seat', 0, 0, jackSeat + clearance), ...fourHoles(12, insideWidth / 2, depth / 2, 'upper-tool')] })
      const ic = builder.instance(crown, identityTransform(0, 0, crownZ))
      const itop = builder.instance(top, identityTransform(0, 0, bedTopZ))
      const itool = builder.instance(tool, identityTransform(0, 0, bedTopZ + (t + toolThickness) / 2))
      const ramZ = lowerTopZ + daylight - position + t / 2
      const iram = builder.instance(ram, identityTransform(0, 0, ramZ))
      for (const sign of [-1, 1]) {
        const x = sign * (ww + t) / 2
        const iside = builder.instance(side, transform({ x, y: 0, z: sideHeight / 2 }, { x: 90, y: 0, z: 90 }), `C07-side-${sign}`)
        const ibed = builder.instance(bed, transform({ x: sign * (ww - t - 2 * clearance) / 2, y: 0, z: bedZ }, { x: 90, y: 0, z: 90 }), `C07-bed-${sign}`)
        builder.mate('weld-edge', ic, iside, { world: { x, y: 0, z: crownZ - t / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: depth, depth: t } }, 'side top edge to crown underside')
        for (const y of pinYs) builder.axialMate('pivot', iside, ibed, pt(y, bedZ - sideHeight / 2), pt(y, 0), pin, 'removable bed pin through aligned row')
        builder.mate('weld-edge', itop, ibed, { world: { x: sign * insideWidth / 2, y: 0, z: bedZ + bedHeight / 2 }, axis: { x: 0, y: 1, z: 0 }, size: { width: depth, depth: t } }, 'bed cheek to cross plate edge')
      }
      for (const hole of top.holes) builder.axialMate('bolt', itop, itool, hole, hole, 12, 'removable lower tooling adapter bolt')
      builder.axialMate('linear-guide', ic, iram, pt(0, 0), pt(0, 0), jackSeat, 'guided actuator axis between crown and ram')
      builder.buy('actuator', 'Flange-mounted guided hydraulic actuator', 1, { seatDiameter: jackSeat, mountingPitch: jackSeat + 40, workingStroke: stroke, closedMountDistance: crownZ - ramZ + position, ratedForce: 'requires independent design' })
      builder.buy('return-system', 'Actuator-compatible captive return system', 2, { travel: stroke })
      builder.buy('bed-pin', 'Retained removable bed support pin', 4, { diameter: pin, gripLength: 2 * t + clearance })
      builder.buy('press-tool', 'Matched upper punch and lower die', 1, { mountingPitchX: insideWidth / 2, mountingPitchY: depth / 2, mountingDiameter: 12 })
      builder.mountPurchased('actuator', ic, 'actuator-seat'); builder.mountPurchased('actuator', iram, 'ram-seat')
      for (const instance of builder.instances.filter(i => i.partName === side.name || i.partName === bed.name)) {
        const part = instance.partName === side.name ? side : bed
        for (const hole of part.holes.filter(h => instance.partName === bed.name || h.id.startsWith(`bed-pin-${row}-`))) builder.mountPurchased('bed-pin', instance, hole.id)
      }
      for (const hole of tool.holes) builder.mountPurchased('press-tool', itool, hole.id)
      for (const hole of ram.holes.filter(h => h.id !== 'ram-seat')) builder.mountPurchased('press-tool', iram, hole.id)
      builder.purchasedEnvelope('actuator', { x: 0, y: 0, z: ramZ }, { x: 0, y: 0, z: crownZ }, jackSeat)
      addFastenerSet(builder, 'tool', 8, 12, 'replaceable tool mounting')
      builder.warn('No press force rating is assigned. Frame, crown, bed, pins, actuator retention, guides, tooling and guarding require independent force-path design and proof testing.')
      return true
    }
    default: return false
  }
}

export const buildToolingAssembly = (config: ToolingConfig): ToolingAssembly => {
  validateToolingConfig(config)
  const canonical = createToolingConfig(config.id, config.values)
  const builder = new AssemblyBuilder(canonical)
  const built = addFlatItems(builder, canonical) || addWeldedItems(builder, canonical) || addHybridItems(builder, canonical)
  if (!built) throw new Error(`No geometry recipe for ${config.id}`)
  return builder.finish()
}

export const buildDefaultToolingAssembly = <I extends ToolingId>(id: I, overrides: Readonly<Record<string, ParameterValue>> = {}): ToolingAssembly => buildToolingAssembly(createToolingConfig(id, overrides))
