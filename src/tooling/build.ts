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
      const holes = [-1, 1].flatMap(side => [-1, 1].map(row => circleHole(`grid-${side}-${row}`, side * pitch / 2 + offset / 2, row * rows / 2, d)))
      const part = rectangularPart(builder, 'A06-strap', 'offset-grid joining strap', length, width, t, { holes })
      builder.instance(part); addFastenerSet(builder, 'join', 4, d, 'module joining')
      return true
    }
    case 'A07': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const stud = nv(config, 'studDiameter'); const slotLength = nv(config, 'slotLength'); const support = nv(config, 'supportHeight')
      const strap = builder.part({ name: 'A07-strap', role: 'clamping beam', width: length, height: width, thickness: t, slots: [slotBox(0, 0, slotLength, stud + 2)], contours: [rectangle(length, width), capsule(slotLength, stud + 2)] })
      const shim = rectangularPart(builder, 'A07-support', 'stackable fulcrum support', width, width, Math.min(t, support), { count: Math.max(1, Math.ceil(support / t)), holes: [circleHole('support-bolt', 0, 0, stud)] })
      builder.instance(strap); for (let index = 0; index < shim.count; index += 1) builder.instance(shim, identityTransform(length / 2 - width / 2, 0, index * shim.thickness))
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
      if (size > length - 2 * MIN_WEB || size / 2 > width - MIN_WEB) throw new Error(`A10.profileSize: ${size} does not fit ${length} x ${width} insert envelope with ${MIN_WEB} mm web`)
      const notch = profile === 'vee'
        ? polygon([pt(-size / 2, width / 2), pt(0, width / 2 - size / 2), pt(size / 2, width / 2), pt(half, width / 2), pt(half, -width / 2), pt(-half, -width / 2)])
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
      const xRight = length / 2; const throat = xRight - opening
      const outline = polygon([pt(-length / 2, -width / 2), pt(xRight, -width / 2), pt(xRight, -neck / 2), pt(throat, -neck / 2), pt(throat - opening / 2, 0), pt(throat, neck / 2), pt(xRight, neck / 2), pt(xRight, width / 2), pt(-length / 2, width / 2)])
      const part = builder.part({ name: 'A12-torch-fork', role: 'open torch handle fork', width: length, height: width, thickness: t, holes: boltPair(md, mp), contours: [outline] })
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

const tabSlots = (span: number, thickness: number, clearance: number, countValue = 2) => Array.from({ length: countValue }, (_, index) => {
  const x = (index - (countValue - 1) / 2) * Math.min(span / countValue, 120)
  return { box: slotBox(x, 0, 30 + clearance, thickness + clearance), contour: rectangle(30 + clearance, thickness + clearance, pt(x, 0)) }
})

const addWeldedItems = (builder: AssemblyBuilder, config: ToolingConfig): boolean => {
  const t = nv(config, 'thickness'); const clearance = nv(config, 'clearance')
  const weldSize = { width: 30, depth: t }
  switch (config.id) {
    case 'B01': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const height = nv(config, 'height')
      const hd = nv(config, 'holeDiameter'); const hp = nv(config, 'holePitch'); const margin = nv(config, 'gridMargin')
      const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch'); const tabWidth = nv(config, 'tabWidth')
      const rr = nv(config, 'radialRadius'); const rw = nv(config, 'radialWidth'); const rs = nv(config, 'radialStart'); const re = nv(config, 'radialEnd')
      const sideSlotY = (width - t - clearance) / 2
      const endSlotX = -(length - t - clearance) / 2
      const sideSlots = [-sideSlotY, sideSlotY].flatMap(y => [-length / 4, length / 4].map(x => rectangle(tabWidth + clearance, t + clearance, pt(x, y))))
      const endSlots = [-width / 4, width / 4].map(y => rectangle(t + clearance, tabWidth + clearance, pt(endSlotX, y)))
      const top = builder.part({ name: 'B01-top', role: 'perforated top shelf', width: length, height: width, thickness: t,
        holes: gridHoles(length, width, hd, hp, margin, 'top'), slots: [...sideSlots.map((_, i) => slotBox(i % 2 ? length / 4 : -length / 4, i < 2 ? -sideSlotY : sideSlotY, tabWidth + clearance, t + clearance)), ...endSlots.map((_, i) => slotBox(endSlotX, i ? width / 4 : -width / 4, t + clearance, tabWidth + clearance))], contours: [rectangle(length, width), ...sideSlots, ...endSlots] })
      const sideOutline = polygon([pt(-length / 2, -height / 2), pt(length / 2, -height / 2), pt(length / 2, height / 2), pt(length / 4 + tabWidth / 2, height / 2), pt(length / 4 + tabWidth / 2, height / 2 + t), pt(length / 4 - tabWidth / 2, height / 2 + t), pt(length / 4 - tabWidth / 2, height / 2), pt(-length / 4 + tabWidth / 2, height / 2), pt(-length / 4 + tabWidth / 2, height / 2 + t), pt(-length / 4 - tabWidth / 2, height / 2 + t), pt(-length / 4 - tabWidth / 2, height / 2), pt(-length / 2, height / 2)])
      const side = builder.part({ name: 'B01-side', role: 'open-bottom side wall', width: length, height: height + t, thickness: t, count: 2, contours: [sideOutline] })
      const end = builder.part({ name: 'B01-mount-end', role: 'single table mounting end', width, height, thickness: t,
        holes: boltPair(md, mp), contours: [rectangle(width, height), radialSlot(pt(0, 0), rr, rw, rs, re)] })
      const it = builder.instance(top, identityTransform(0, 0, height)); const isl = builder.instance(side, transform({ x: 0, y: -width / 2, z: height / 2 }, { x: 90, y: 0, z: 0 }), 'B01-side-left'); const isr = builder.instance(side, transform({ x: 0, y: width / 2, z: height / 2 }, { x: 90, y: 0, z: 0 }), 'B01-side-right'); const ie = builder.instance(end, transform({ x: -length / 2, y: 0, z: height / 2 }, { x: 90, y: 0, z: 90 }))
      for (const x of [-length / 4, length / 4]) {
        builder.mate('tab', it, isl, { world: { x, y: -width / 2, z: height }, axis: { x: 0, y: 1, z: 0 }, size: { width: tabWidth, depth: t } }, 'side tab through top slot')
        builder.mate('tab', it, isr, { world: { x, y: width / 2, z: height }, axis: { x: 0, y: 1, z: 0 }, size: { width: tabWidth, depth: t } }, 'side tab through top slot')
      }
      for (const y of [-width / 4, width / 4]) builder.mate('tab', it, ie, { world: { x: -length / 2, y, z: height }, axis: { x: 1, y: 0, z: 0 }, size: { width: tabWidth, depth: t } }, 'mount-end tab through top slot')
      builder.mate('weld-edge', isl, ie, { world: { x: -length / 2, y: -width / 2, z: height / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'left side to mounting end weld')
      builder.mate('weld-edge', isr, ie, { world: { x: -length / 2, y: width / 2, z: height / 2 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'right side to mounting end weld')
      addFastenerSet(builder, 'mount', 2, md, 'table mounting')
      builder.warn('Mount compatibility is only established when mountDiameter/mountPitch, table wall access and rib clearance match the actual table.')
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
      const slots = tabSlots(length, t, clearance, gussets)
      const base = builder.part({ name: 'B04-base', role: 'mounting base', width: length, height: baseWidth, thickness: t, holes: boltPair(md, mp), slots: slots.map(s => s.box), contours: [rectangle(length, baseWidth), ...slots.map(s => s.contour)] })
      const wall = rectangularPart(builder, 'B04-wall', 'vertical working face', length, h, t, { holes: gridHoles(length, h, md, mp, mp / 2) })
      const gussetOutline = polygon([pt(-baseWidth / 2, -h / 2), pt(baseWidth / 2, -h / 2), pt(-baseWidth / 2, h / 2)])
      const gusset = builder.part({ name: 'B04-gusset', role: 'triangular brace with locating tab', width: baseWidth, height: h, thickness: t, count: gussets, contours: [gussetOutline] })
      const ib = builder.instance(base); const iw = builder.instance(wall, transform({ x: 0, y: -baseWidth / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }))
      builder.mate('weld-edge', ib, iw, { world: { x: 0, y: -baseWidth / 2, z: t / 2 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'working wall to base')
      for (let index = 0; index < gussets; index += 1) { const x = (index - (gussets - 1) / 2) * Math.min(length / gussets, 120); const ig = builder.instance(gusset, transform({ x, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }), `B04-gusset-${index + 1}`); builder.mate('slot', ib, ig, { world: { x, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'gusset tab into base slot'); builder.mate('weld-edge', iw, ig, { world: { x, y: -baseWidth / 2, z: h / 2 }, axis: { x: 0, y: 0, z: 1 }, size: { width: h, depth: t } }, 'gusset to working wall') }
      addFastenerSet(builder, 'mount', 2, md, 'table mounting'); return true
    }
    case 'B05': {
      const ax = nv(config, 'armX'); const ay = nv(config, 'armY'); const bw = nv(config, 'bodyWidth'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const cheekOutline = polygon([pt(-ax / 2, -ay / 2), pt(ax / 2, -ay / 2), pt(ax / 2, -ay / 2 + bw), pt(-ax / 2 + bw, -ay / 2 + bw), pt(-ax / 2 + bw, ay / 2), pt(-ax / 2, ay / 2)])
      const cheek = builder.part({ name: 'B05-cheek', role: 'L-profile box cheek', width: ax, height: ay, thickness: t, count: 2, holes: [-1, 1].map((sign, index) => circleHole(`mount-${index + 1}`, sign * mp / 2, -ay / 2 + bw / 2, md)), contours: [cheekOutline] })
      const tie = rectangularPart(builder, 'B05-tie', 'transverse box tie', bw, bw, t, { count: 3 })
      const c1 = builder.instance(cheek, identityTransform(0, 0, 0), 'B05-cheek-front'); const c2 = builder.instance(cheek, identityTransform(0, 0, bw), 'B05-cheek-back')
      for (let index = 0; index < 3; index += 1) { const world = { x: -ax / 2 + bw / 2 + index * (ax - bw) / 2, y: -ay / 2 + bw / 2, z: bw / 2 }; const itie = builder.instance(tie, transform(world, { x: 90, y: 0, z: 0 }), `B05-tie-${index + 1}`); builder.mate('tab', c1, itie, { world: { ...world, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'front cheek tab'); builder.mate('tab', c2, itie, { world: { ...world, z: bw }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'back cheek tab') }
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
      const base = rectangularPart(builder, 'B08-base', 'table mounting base', length, width, t, { holes: boltPair(md, mp) })
      const cheekHeight = ah + width / (2 * Math.tan(angle * Math.PI / 360)); const cheek = rectangularPart(builder, 'B08-cheek', 'insert holder cheek', width, cheekHeight, t, { count: 2, holes: boltPair(id, ip) })
      const bridge = rectangularPart(builder, 'B08-bridge', 'cheek spacing bridge', spacing, 50, t, { count: 2 })
      const ib = builder.instance(base); const c1 = builder.instance(cheek, transform({ x: -spacing / 2, y: 0, z: cheekHeight / 2 }, { x: 90, y: 0, z: 90 }), 'B08-cheek-left'); const c2 = builder.instance(cheek, transform({ x: spacing / 2, y: 0, z: cheekHeight / 2 }, { x: 90, y: 0, z: 90 }), 'B08-cheek-right')
      builder.mate('slot', ib, c1, { world: { x: -spacing / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'left cheek base tab'); builder.mate('slot', ib, c2, { world: { x: spacing / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'right cheek base tab')
      for (const y of [-width / 4, width / 4]) { const br = builder.instance(bridge, transform({ x: 0, y, z: cheekHeight / 3 }, { x: 90, y: 0, z: 0 }), `B08-bridge-${y < 0 ? 'front' : 'rear'}`); builder.mate('tab', c1, br, { world: { x: -spacing / 2, y, z: cheekHeight / 3 }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'bridge to left cheek'); builder.mate('tab', c2, br, { world: { x: spacing / 2, y, z: cheekHeight / 3 }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'bridge to right cheek') }
      builder.buy('A10-insert-set', 'Replaceable A10 insert set', 2, { holderPitch: ip, holderDiameter: id, requiredInterface: 'A10' }); addFastenerSet(builder, 'insert', 4, id, 'A10 insert mounting'); addFastenerSet(builder, 'table', 2, md, 'table mounting')
      return true
    }
    case 'B09': {
      const pl = nv(config, 'platformLength'); const pw = nv(config, 'platformWidth'); const ph = nv(config, 'pivotHeight'); const radius = nv(config, 'slotRadius'); const amin = nv(config, 'angleMin'); const amax = nv(config, 'angleMax')
      const base = rectangularPart(builder, 'B09-base', 'tilt fixture base', pl, pw, t)
      const platform = rectangularPart(builder, 'B09-platform', 'tilting work platform', pl, pw, t, { holes: gridHoles(pl, pw, 16, 50, 25) })
      const cheek = builder.part({ name: 'B09-cheek', role: 'pivot and radial-lock side cheek', width: pl, height: ph * 2, thickness: t, count: 2, holes: [circleHole('pivot', 0, 0, 16)], contours: [rectangle(pl, ph * 2), radialSlot(pt(0, 0), radius, 18, amin, amax)] })
      const ib = builder.instance(base); const ipf = builder.instance(platform, identityTransform(0, 0, ph)); const cl = builder.instance(cheek, transform({ x: 0, y: -pw / 2, z: ph }, { x: 90, y: 0, z: 0 }), 'B09-cheek-left'); const cr = builder.instance(cheek, transform({ x: 0, y: pw / 2, z: ph }, { x: 90, y: 0, z: 0 }), 'B09-cheek-right')
      builder.mate('pivot', ipf, cl, { world: { x: 0, y: -pw / 2, z: ph }, axis: { x: 0, y: 1, z: 0 }, size: { width: 16, depth: t, diameter: 16 } }, 'left platform pivot'); builder.mate('pivot', ipf, cr, { world: { x: 0, y: pw / 2, z: ph }, axis: { x: 0, y: 1, z: 0 }, size: { width: 16, depth: t, diameter: 16 } }, 'right platform pivot'); builder.mate('weld-edge', ib, cl, { world: { x: 0, y: -pw / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: pl, depth: t } }, 'left cheek to base'); builder.mate('weld-edge', ib, cr, { world: { x: 0, y: pw / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: pl, depth: t } }, 'right cheek to base')
      addFastenerSet(builder, 'pivot', 2, 16, 'platform pivot'); addFastenerSet(builder, 'lock', 2, 16, 'radial lock'); builder.warn('Locking moment and full swept-volume clearance require physical verification.'); return true
    }
    case 'B10': {
      const span = nv(config, 'span'); const ch = nv(config, 'clearHeight'); const bd = nv(config, 'beamDepth'); const clamps = count(config, 'clampCount'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const foot = rectangularPart(builder, 'B10-foot', 'gantry mounting foot', bd * 1.5, bd, t, { count: 2, holes: boltPair(md, mp) })
      const upright = rectangularPart(builder, 'B10-upright', 'gantry upright', ch, bd, t, { count: 2 }); const beam = rectangularPart(builder, 'B10-beam', 'clamp carrying crossbeam', span, bd, t, { count: 2, holes: Array.from({ length: clamps }, (_, i) => circleHole(`clamp-${i + 1}`, (i - (clamps - 1) / 2) * span / Math.max(clamps, 2), 0, 12)) })
      const fl = builder.instance(foot, identityTransform(-span / 2, 0, 0), 'B10-foot-left'); const fr = builder.instance(foot, identityTransform(span / 2, 0, 0), 'B10-foot-right'); const ul = builder.instance(upright, transform({ x: -span / 2, y: 0, z: ch / 2 }, { x: 0, y: -90, z: 0 }), 'B10-upright-left'); const ur = builder.instance(upright, transform({ x: span / 2, y: 0, z: ch / 2 }, { x: 0, y: -90, z: 0 }), 'B10-upright-right')
      const bf = builder.instance(beam, transform({ x: 0, y: -bd / 2, z: ch }, { x: 90, y: 0, z: 0 }), 'B10-beam-front'); const br = builder.instance(beam, transform({ x: 0, y: bd / 2, z: ch }, { x: 90, y: 0, z: 0 }), 'B10-beam-rear')
      builder.mate('tab', fl, ul, { world: { x: -span / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'left upright foot'); builder.mate('tab', fr, ur, { world: { x: span / 2, y: 0, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'right upright foot'); builder.mate('tab', ul, bf, { world: { x: -span / 2, y: -bd / 2, z: ch }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'left upright to front beam'); builder.mate('tab', ul, br, { world: { x: -span / 2, y: bd / 2, z: ch }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'left upright to rear beam'); builder.mate('tab', ur, bf, { world: { x: span / 2, y: -bd / 2, z: ch }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'right upright to front beam'); builder.mate('tab', ur, br, { world: { x: span / 2, y: bd / 2, z: ch }, axis: { x: 1, y: 0, z: 0 }, size: weldSize }, 'right upright to rear beam')
      builder.buy('toggle-clamp', 'Purchased clamping mechanism', clamps, { mountingDiameter: 12 }); addFastenerSet(builder, 'table', 4, md, 'gantry table mounting'); builder.warn('No clamp-force rating is assigned; check frame bending and table overturning for the selected mechanisms.'); return true
    }
    case 'B11': {
      const projection = nv(config, 'projection'); const pw = nv(config, 'platformWidth'); const h = nv(config, 'height'); const dp = nv(config, 'devicePitch'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const deviceSlotLength = Math.min(projection * 0.5, pw - dp - 2 * MIN_WEB)
      const slots = [-1, 1].map(sign => capsule(deviceSlotLength, 14, pt(0, sign * dp / 2), 90))
      const platform = builder.part({ name: 'B11-platform', role: 'slotted vise/tool platform', width: projection, height: pw, thickness: t, slots: slots.map((_, i) => slotBox(0, i ? dp / 2 : -dp / 2, 14, deviceSlotLength)), contours: [rectangle(projection, pw), ...slots] })
      const end = rectangularPart(builder, 'B11-mount-end', 'table mounting end', pw, h, t, { holes: boltPair(md, mp) }); const gusset = builder.part({ name: 'B11-gusset', role: 'cantilever side gusset', width: projection, height: h, thickness: t, count: 2, contours: [polygon([pt(-projection / 2, -h / 2), pt(projection / 2, -h / 2), pt(-projection / 2, h / 2)])] })
      const ip = builder.instance(platform, identityTransform(projection / 2, 0, h)); const ie = builder.instance(end, transform({ x: 0, y: 0, z: h / 2 }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', ip, ie, { world: { x: 0, y: 0, z: h }, axis: { x: 0, y: 1, z: 0 }, size: { width: pw, depth: t } }, 'platform to mounting end')
      for (const sy of [-1, 1]) { const ig = builder.instance(gusset, transform({ x: projection / 2, y: sy * pw / 2, z: h / 2 }, { x: 90, y: 0, z: 0 }), `B11-gusset-${sy}`); builder.mate('weld-edge', ip, ig, { world: { x: 0, y: sy * pw / 2, z: h }, axis: { x: 1, y: 0, z: 0 }, size: { width: projection, depth: t } }, 'platform side gusset') }
      addFastenerSet(builder, 'table', 2, md, 'console mounting'); builder.buy('bench-tool', 'Vise or bench tool selected by user', 1, { slotSpacing: dp }); builder.warn('Tool mass, operating moment and handle envelope are not rated by this geometry.'); return true
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
      const cheek = builder.part({ name: 'B13-cheek', role: 'C-profile force cheek', width: outerW, height: outerH, thickness: t, count: 2, contours: [cheekOutline] }); const bridge = rectangularPart(builder, 'B13-bridge', 'cheek tie bridge', bw, bw, t, { count: 3 }); const nutPlate = rectangularPart(builder, 'B13-nut-plate', 'purchased nut mounting plate', bw * 2, bw, t, { holes: [circleHole('screw', 0, 0, screw)] })
      const c1 = builder.instance(cheek, identityTransform(0, 0, 0), 'B13-cheek-front'); const c2 = builder.instance(cheek, identityTransform(0, 0, bw), 'B13-cheek-rear'); const np = builder.instance(nutPlate, transform({ x: outerW / 2 - bw / 2, y: outerH / 2 - bw / 2, z: bw / 2 }, { x: 90, y: 0, z: 0 }))
      for (let i = 0; i < 3; i += 1) { const world = { x: -outerW / 2 + bw / 2 + i * (outerW - bw) / 2, y: -outerH / 2 + bw / 2, z: bw / 2 }; const br = builder.instance(bridge, transform(world, { x: 90, y: 0, z: 0 }), `B13-bridge-${i + 1}`); builder.mate('tab', c1, br, { world: { ...world, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'front cheek tie'); builder.mate('tab', c2, br, { world: { ...world, z: bw }, axis: { x: 0, y: 0, z: 1 }, size: weldSize }, 'rear cheek tie') }
      builder.mate('purchased-mount', c1, np, { world: { x: outerW / 2 - bw / 2, y: outerH / 2 - bw / 2, z: 0 }, axis: { x: 0, y: 0, z: 1 }, size: { width: bw, depth: t, diameter: screw } }, 'nut plate location')
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
  const t = nv(config, 'thickness'); const clearance = nv(config, 'clearance')
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
      const length = stroke + 140; const width = gs + 80
      const base = rectangularPart(builder, 'C03-base', 'guided stop mounting base', length, width, t, { holes: boltPair(md, mp) })
      const end = rectangularPart(builder, 'C03-end', 'guide and screw bearing end', width, 100, t, { count: 2, holes: [circleHole('screw', 0, 0, sd + clearance), ...boltPair(gd + clearance, gs)] })
      const ib = builder.instance(base); const front = builder.instance(end, transform({ x: -length / 2, y: 0, z: 50 }, { x: 90, y: 0, z: 90 }), 'C03-end-front'); const rear = builder.instance(end, transform({ x: length / 2, y: 0, z: 50 }, { x: 90, y: 0, z: 90 }), 'C03-end-rear')
      builder.mate('weld-edge', ib, front, { world: { x: -length / 2, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width, depth: t } }, 'front end to base'); builder.mate('weld-edge', ib, rear, { world: { x: length / 2, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width, depth: t } }, 'rear end to base')
      builder.buy('guide-shaft', 'Precision guide shaft', 2, { diameter: gd, workingLength: stroke + 100 }); builder.buy('guide-bush', 'Matched guide bush', 4, { boreDiameter: gd }); builder.buy('screw-assembly', 'Screw, nut and thrust support', 1, { nominalDiameter: sd, workingStroke: stroke }); addFastenerSet(builder, 'table', 2, md, 'table mounting'); builder.warn('Backlash, guide alignment and repeatability depend on the selected purchased interfaces and assembly machining.'); return true
    }
    case 'C04': {
      const length = nv(config, 'baseLength'); const width = nv(config, 'baseWidth'); const spacing = nv(config, 'axisSpacing'); const ah = nv(config, 'axisHeight'); const axle = nv(config, 'axleDiameter'); const roller = nv(config, 'rollerDiameter'); const md = nv(config, 'mountDiameter'); const mp = nv(config, 'mountPitch')
      const base = rectangularPart(builder, 'C04-base', 'roller-stand base', length, width, t, { holes: boltPair(md, mp) })
      const cheek = rectangularPart(builder, 'C04-cheek', 'roller axle cheek', length, ah + roller / 2, t, { count: 2, holes: boltPair(axle + clearance, spacing) })
      const ib = builder.instance(base); const cl = builder.instance(cheek, transform({ x: 0, y: -width / 2, z: (ah + roller / 2) / 2 }, { x: 90, y: 0, z: 0 }), 'C04-cheek-left'); const cr = builder.instance(cheek, transform({ x: 0, y: width / 2, z: (ah + roller / 2) / 2 }, { x: 90, y: 0, z: 0 }), 'C04-cheek-right')
      builder.mate('weld-edge', ib, cl, { world: { x: 0, y: -width / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'left cheek to base'); builder.mate('weld-edge', ib, cr, { world: { x: 0, y: width / 2, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: length, depth: t } }, 'right cheek to base')
      builder.buy('roller', 'User-selected roller', 2, { outerDiameter: roller, axleDiameter: axle, faceWidth: width }); builder.buy('bearing', 'Matched roller bearing', 4, { boreDiameter: axle }); builder.buy('axle', 'Roller axle', 2, { diameter: axle, length: width + 2 * t }); addFastenerSet(builder, 'table', 2, md, 'table mounting'); builder.warn('Provide a welding-current return path that bypasses the roller bearings.'); return true
    }
    case 'C05': {
      const length = nv(config, 'length'); const width = nv(config, 'width'); const angle = nv(config, 'veeAngle'); const magnetD = nv(config, 'magnetDiameter'); const magnets = count(config, 'magnetCount')
      const sideHeight = width / (2 * Math.sin(angle * Math.PI / 360)); const side = rectangularPart(builder, 'C05-v-side', 'magnetic V contact side', length, sideHeight, t, { count: 2, holes: Array.from({ length: Math.ceil(magnets / 2) }, (_, i) => circleHole(`magnet-${i + 1}`, (i - (Math.ceil(magnets / 2) - 1) / 2) * length / Math.max(Math.ceil(magnets / 2), 1), 0, magnetD + clearance)) })
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
      const base = rectangularPart(builder, 'C06-base', 'positioner chassis base', bl, bw, t, { holes: fourHoles(14, bl - 60, bw - 60, 'bench') })
      const head = rectangularPart(builder, 'C06-headstock', 'bearing headstock wall', bw, ah * 1.4, t, { count: 2, holes: [circleHole('bearing-seat', 0, ah * .2, bearing)] })
      const faceOutline = [{ type: 'arc' as const, center: pt(0, 0), radius: fp / 2, start: 0, end: 180 }, { type: 'arc' as const, center: pt(0, 0), radius: fp / 2, start: 180, end: 360 }]
      const faceThickness = Math.max(t, 10)
      const face = builder.part({ name: 'C06-faceplate', role: 'rotating welding faceplate blank', width: fp, height: fp, thickness: faceThickness, holes: [circleHole('shaft', 0, 0, shaft + clearance), ...fourHoles(12, fp * .55, fp * .55, 'work')], contours: [faceOutline] })
      const motorPlate = rectangularPart(builder, 'C06-motor-plate', 'drive motor adapter', bw * .7, bw * .7, t, { holes: fourHoles(10, motorPattern, motorPattern, 'motor') })
      const bearingContactX = -bl / 4 - t / 2
      const ib = builder.instance(base); const h1 = builder.instance(head, transform({ x: -bl / 4, y: 0, z: ah * .7 }, { x: 90, y: 0, z: 90 }), 'C06-headstock-front'); const h2 = builder.instance(head, transform({ x: bl / 4, y: 0, z: ah * .7 }, { x: 90, y: 0, z: 90 }), 'C06-headstock-rear'); const iff = builder.instance(face, transform({ x: bearingContactX - faceThickness / 2, y: 0, z: ah }, { x: 0, y: 90, z: 0 })); const im = builder.instance(motorPlate, transform({ x: bl / 2 - t, y: 0, z: bw * .35 }, { x: 90, y: 0, z: 90 }))
      builder.mate('weld-edge', ib, h1, { world: { x: -bl / 4, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width: bw, depth: t } }, 'front headstock to base'); builder.mate('weld-edge', ib, h2, { world: { x: bl / 4, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 }, size: { width: bw, depth: t } }, 'rear headstock to base'); builder.mate('bearing-seat', h1, iff, { world: { x: bearingContactX, y: 0, z: ah }, axis: { x: 1, y: 0, z: 0 }, size: { width: bearing, depth: t, diameter: bearing } }, 'faceplate shaft/bearing axis'); builder.mate('purchased-mount', ib, im, { world: { x: bl / 2 - t, y: 0, z: 0 }, axis: { x: 1, y: 0, z: 0 }, size: { width: motorPattern, depth: t } }, 'motor adapter support')
      builder.buy('shaft', 'Machined positioner shaft', 1, { diameter: shaft, faceplateInterface: 'user-specified' }); builder.buy('bearing', 'Matched spindle bearing', 2, { outerDiameter: bearing, boreDiameter: shaft }); builder.buy('drive', 'Gear/belt reduction selected for duty', 1, { shaftDiameter: shaft }); builder.buy('motor', 'Motor and controller', 1, { mountingPattern: motorPattern }); builder.warn('Torque, speed, stability, guarding and a welding-current path isolated from bearings require a separate machine design and test.'); return true
    }
    case 'C07': {
      const ww = nv(config, 'workingWidth'); const daylight = nv(config, 'daylight'); const depth = nv(config, 'frameDepth'); const jackSeat = nv(config, 'jackSeatDiameter'); const stroke = nv(config, 'stroke'); const pin = nv(config, 'pinDiameter')
      const sideHeight = daylight + stroke + 2 * depth
      const side = builder.part({ name: 'C07-side-frame', role: 'press side frame plate', width: depth, height: sideHeight, thickness: t, count: 2, holes: Array.from({ length: 5 }, (_, i) => circleHole(`bed-pin-${i + 1}`, 0, -daylight / 2 + i * daylight / 4, pin + clearance)), contours: [rectangle(depth, sideHeight)] })
      const crown = rectangularPart(builder, 'C07-crown', 'press crown tie', ww + 2 * t, depth, t, { count: 2, holes: [circleHole('jack-seat', 0, 0, jackSeat)] }); const bed = rectangularPart(builder, 'C07-bed', 'adjustable press bed cheek', ww, depth / 2, t, { count: 2, holes: boltPair(pin + clearance, ww - 2 * pin) }); const toolThickness = Math.max(t, 20); const tool = rectangularPart(builder, 'C07-tool-plate', 'replaceable press/brake tool plate', ww, depth / 2, toolThickness)
      const sl = builder.instance(side, transform({ x: -ww / 2 - t / 2, y: 0, z: sideHeight / 2 }, { x: 90, y: 0, z: 90 }), 'C07-side-left'); const sr = builder.instance(side, transform({ x: ww / 2 + t / 2, y: 0, z: sideHeight / 2 }, { x: 90, y: 0, z: 90 }), 'C07-side-right'); const cf = builder.instance(crown, identityTransform(0, -depth / 2, sideHeight)); const cr = builder.instance(crown, identityTransform(0, depth / 2, sideHeight)); const b1 = builder.instance(bed, identityTransform(0, -depth / 4, depth), 'C07-bed-front'); const b2 = builder.instance(bed, identityTransform(0, depth / 4, depth), 'C07-bed-rear'); const toolContactZ = depth + t / 2; const tp = builder.instance(tool, identityTransform(0, 0, toolContactZ + toolThickness / 2))
      builder.mate('tab', sl, cf, { world: { x: -ww / 2, y: -depth / 2, z: sideHeight }, axis: { x: 1, y: 0, z: 0 }, size: { width: depth, depth: t } }, 'left front crown joint'); builder.mate('tab', sl, cr, { world: { x: -ww / 2, y: depth / 2, z: sideHeight }, axis: { x: 1, y: 0, z: 0 }, size: { width: depth, depth: t } }, 'left rear crown joint'); builder.mate('tab', sr, cf, { world: { x: ww / 2, y: -depth / 2, z: sideHeight }, axis: { x: 1, y: 0, z: 0 }, size: { width: depth, depth: t } }, 'right front crown joint'); builder.mate('tab', sr, cr, { world: { x: ww / 2, y: depth / 2, z: sideHeight }, axis: { x: 1, y: 0, z: 0 }, size: { width: depth, depth: t } }, 'right rear crown joint');
      for (const bedInstance of [b1, b2]) { const y = bedInstance === b1 ? -depth / 4 : depth / 4; builder.mate('pivot', sl, bedInstance, { world: { x: -ww / 2, y, z: depth }, axis: { x: 1, y: 0, z: 0 }, size: { width: pin, depth: t, diameter: pin } }, 'left removable bed pin'); builder.mate('pivot', sr, bedInstance, { world: { x: ww / 2, y, z: depth }, axis: { x: 1, y: 0, z: 0 }, size: { width: pin, depth: t, diameter: pin } }, 'right removable bed pin') }
      builder.mate('replaceable', b1, tp, { world: { x: 0, y: -depth / 4, z: toolContactZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: ww, depth: t } }, 'replaceable lower tool support'); builder.mate('replaceable', b2, tp, { world: { x: 0, y: depth / 4, z: toolContactZ }, axis: { x: 0, y: 0, z: 1 }, size: { width: ww, depth: t } }, 'replaceable lower tool support')
      builder.buy('actuator', 'User-selected jack or actuator', 1, { seatDiameter: jackSeat, workingStroke: stroke, ratedForce: 'must be selected and verified separately' }); builder.buy('return-system', 'Purchased return springs or cylinders', 2, { travel: stroke }); builder.buy('bed-pin', 'Heat-treated removable bed pin', 2, { diameter: pin, supportedSpan: ww + 2 * t }); builder.warn('No press force rating is assigned. Frame, pins, welds, tool, stability and guarding require a separate force-path calculation and proof test.'); return true
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
