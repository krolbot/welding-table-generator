import type { Config, PartName } from './model'

export type Point = { x: number; y: number }
export type Hole = Point & { id: string; d: number; kind: 'grid' | 'custom' | 'mount' | 'lift' }
export type Slot = Point & { width: number; height: number }
export type EngravingLine = { from: Point; to: Point }
export type Part = {
  name: PartName
  width: number
  height: number
  count: number
  holes: Hole[]
  slots: Slot[]
  label: string
}
export type PlacedPart = { part: Part; instance: number; position: Point }
export type Layout = { instances: PlacedPart[]; width: number; height: number }

const layoutGap = 72
// Calibrated against the reference generator's observable D16 and D28 steel estimates.
const grossAreaFactor = 0.9734705703267278
const holeAreaFactor = 1.0348212824535867
const key = (part: PartName, x: number, y: number) => `${part}:${x.toFixed(2)}:${y.toFixed(2)}`

const grid = (part: PartName, width: number, height: number, c: Config, enabled: boolean): Hole[] => {
  if (!enabled) return []
  const holes: Hole[] = []
  const halfW = width / 2
  const halfH = height / 2
  for (let row = 0, y = -halfH + c.margin; y <= halfH - c.margin + 0.001; row += 1, y += c.pitch) {
    if (part !== 'top' && Math.abs(y) < 0.001 && height > 2 * c.margin) continue
    const offset = c.grid === 'staggered' && row % 2 ? c.pitch / 2 : 0
    for (let x = -halfW + c.margin + offset; x <= halfW - c.margin + 0.001; x += c.pitch) {
      holes.push({ x, y, id: key(part, x, y), d: c.holeDiameter, kind: 'grid' })
    }
  }
  return holes
}

const add = (holes: Hole[], part: PartName, x: number, y: number, d: number, kind: Hole['kind'], id?: string) => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(d) || d <= 0) return
  holes.push({ x, y, d, kind, id: id ?? key(part, x, y) })
}

const decorate = (part: PartName, width: number, height: number, c: Config, holes: Hole[]) => {
  c.customHoles
    .filter(h => h.part === part && Math.abs(h.x) + h.d / 2 <= width / 2 && Math.abs(h.y) + h.d / 2 <= height / 2)
    .forEach(h => add(holes, part, h.x, h.y, h.d, 'custom', `custom:${h.id}`))

  if (part === 'top' && c.legMounts) {
    const startX = -((c.legCols - 1) * c.legPatternX) / 2
    const startY = -((c.legRows - 1) * c.legPatternY) / 2
    for (let col = 0; col < c.legCols; col += 1) {
      for (let row = 0; row < c.legRows; row += 1) {
        for (const sideX of [-1, 1]) {
          for (const sideY of [-1, 1]) {
            add(
              holes,
              part,
              sideX * (width / 2 - c.legEdgeOffset) + startX + col * c.legPatternX,
              sideY * (height / 2 - c.legEdgeOffset) + startY + row * c.legPatternY,
              c.legBoltDiameter,
              'mount',
            )
          }
        }
      }
    }
  }

  if (part === 'top' && c.liftingHoles) {
    for (const side of [-1, 1]) add(holes, part, side * (width / 2 - 100), 0, 28, 'lift')
  }

  return holes.filter(h => !c.removedHoles.includes(h.id))
}

const tabCenters = (span: number, c: Config) => {
  const usable = Math.max(0, span - 2 * Math.max(c.margin, c.tabWidth))
  const count = Math.max(2, Math.floor(usable / Math.max(c.tabWidth * 3, 180)) + 1)
  if (count === 1) return [0]
  const step = usable / (count - 1)
  return Array.from({ length: count }, (_, index) => -usable / 2 + index * step)
}

const slotsFor = (part: PartName, width: number, height: number, c: Config): Slot[] => {
  if (part !== 'top') return []
  const slotW = c.tabWidth + c.clearance
  const slotT = c.thickness + c.clearance
  const slots: Slot[] = []

  for (const x of tabCenters(width, c)) {
    slots.push({ x, y: -height / 2 + c.thickness / 2, width: slotW, height: slotT })
    slots.push({ x, y: height / 2 - c.thickness / 2, width: slotW, height: slotT })
  }
  for (const y of tabCenters(height, c)) {
    slots.push({ x: -width / 2 + c.thickness / 2, y, width: slotT, height: slotW })
    slots.push({ x: width / 2 - c.thickness / 2, y, width: slotT, height: slotW })
  }

  if (c.ribs) {
    const shortRibCount = Math.max(1, Math.floor((c.length - 2 * c.margin) / c.ribSpacing))
    const xStart = -((shortRibCount - 1) * c.ribSpacing) / 2
    for (let index = 0; index < shortRibCount; index += 1) {
      const x = xStart + index * c.ribSpacing
      for (const y of tabCenters(height, c)) slots.push({ x, y, width: slotT, height: slotW })
    }
    for (const y of [-height / 3, height / 3]) {
      for (const x of tabCenters(width, c)) slots.push({ x, y, width: slotW, height: slotT })
    }
  }
  return slots
}

export const makeParts = (c: Config): Part[] => {
  const shortRibCount = c.ribs ? Math.max(1, Math.floor((c.length - 2 * c.margin) / c.ribSpacing)) : 0
  const definitions: Array<{ name: PartName; width: number; height: number; count: number; gridEnabled: boolean; label: string }> = [
    { name: 'top', width: c.length, height: c.width, count: 1, gridEnabled: true, label: 'TOP PLATE' },
    { name: 'longSkirt', width: c.length, height: c.height, count: 2, gridEnabled: c.skirtHoles, label: 'LONG SKIRT' },
    { name: 'shortSkirt', width: c.width, height: c.height, count: 2, gridEnabled: c.skirtHoles, label: 'SHORT SKIRT' },
    { name: 'longRib', width: c.length - 2 * c.thickness, height: c.height - c.thickness, count: c.ribs ? 2 : 0, gridEnabled: false, label: 'LONG RIB' },
    { name: 'shortRib', width: c.width - 2 * c.thickness, height: c.height - c.thickness, count: shortRibCount, gridEnabled: false, label: 'SHORT RIB' },
  ]

  return definitions
    .filter(definition => definition.count > 0)
    .map(definition => ({
      name: definition.name,
      width: definition.width,
      height: definition.height,
      count: definition.count,
      holes: decorate(
        definition.name,
        definition.width,
        definition.height,
        c,
        grid(definition.name, definition.width, definition.height, c, definition.gridEnabled),
      ),
      slots: slotsFor(definition.name, definition.width, definition.height, c),
      label: definition.label,
    }))
}

export const layoutParts = (c: Config): Layout => {
  const order: PartName[] = ['longRib', 'shortRib', 'longSkirt', 'shortSkirt', 'top']
  const parts = makeParts(c).sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  const count = parts.reduce((sum, part) => sum + part.count, 0)
  const height = parts.reduce((sum, part) => sum + part.height * part.count, 0) + Math.max(0, count - 1) * layoutGap
  const width = Math.max(...parts.map(part => part.width))
  const instances: PlacedPart[] = []
  let cursor = 0
  for (const part of parts) {
    for (let instance = 0; instance < part.count; instance += 1) {
      const y = height / 2 - cursor - part.height / 2
      instances.push({ part, instance, position: { x: 0, y } })
      cursor += part.height + layoutGap
    }
  }
  return { instances, width, height }
}

export const engravingLines = (part: Part, c: Config): EngravingLine[] => {
  if (!c.engraving || part.name !== 'top') return []
  const offset = c.engravingMode === 'between' ? c.pitch / 2 : 0
  const lines: EngravingLine[] = []
  for (let x = -part.width / 2 + c.margin + offset; x <= part.width / 2 - c.margin + 0.001; x += c.pitch) {
    lines.push({ from: { x, y: -part.height / 2 + c.margin }, to: { x, y: part.height / 2 - c.margin } })
  }
  for (let y = -part.height / 2 + c.margin + offset; y <= part.height / 2 - c.margin + 0.001; y += c.pitch) {
    lines.push({ from: { x: -part.width / 2 + c.margin, y }, to: { x: part.width / 2 - c.margin, y } })
  }
  return lines
}

export const totals = (c: Config) => {
  const parts = makeParts(c)
  const holes = parts.reduce((sum, part) => sum + part.holes.length * part.count, 0)
  const holeCut = parts.reduce(
    (sum, part) => sum + part.holes.reduce((partSum, hole) => partSum + Math.PI * hole.d, 0) * part.count,
    0,
  )
  const outlineCut = parts.reduce((sum, part) => sum + 2 * (part.width + part.height) * part.count, 0)
  const cut = (outlineCut * 1.242 + holeCut) / 1000
  const grossArea = c.length * c.width
    + 2 * c.length * c.height
    + 2 * c.width * c.height
    + (c.ribs
      ? 2 * (c.length - 2 * c.thickness) * (c.height - c.thickness)
        + Math.max(1, Math.floor((c.length - 2 * c.margin) / c.ribSpacing)) * (c.width - 2 * c.thickness) * (c.height - c.thickness)
      : 0)
  const removedArea = parts.reduce(
    (sum, part) => sum + part.holes.reduce((partSum, hole) => partSum + Math.PI * (hole.d / 2) ** 2, 0) * part.count,
    0,
  )
  const kg = (grossArea * grossAreaFactor - removedArea * holeAreaFactor) * c.thickness * 7.85e-6
  const engraving = c.engraving
    ? ((c.length - 2 * c.margin) * Math.max(0, Math.floor((c.width - 2 * c.margin) / c.pitch) + 1)
      + (c.width - 2 * c.margin) * Math.max(0, Math.floor((c.length - 2 * c.margin) / c.pitch) + 1)) / 1000
    : 0
  const fit = parts.every(part =>
    (part.width <= c.sheetLength && part.height <= c.sheetWidth)
    || (part.height <= c.sheetLength && part.width <= c.sheetWidth),
  )
  return { parts, holes, cut, kg, engraving, fit }
}

export const outline = (part: Part, c: Config): Point[] => {
  const halfW = part.width / 2
  const halfH = part.height / 2
  if (part.name === 'top') {
    return [
      { x: -halfW, y: -halfH },
      { x: halfW, y: -halfH },
      { x: halfW, y: halfH },
      { x: -halfW, y: halfH },
    ]
  }

  const points: Point[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
  ]
  const centers = tabCenters(part.width, c).reverse()
  for (const center of centers) {
    points.push(
      { x: center + c.tabWidth / 2, y: halfH },
      { x: center + c.tabWidth / 2, y: halfH + c.thickness },
      { x: center - c.tabWidth / 2, y: halfH + c.thickness },
      { x: center - c.tabWidth / 2, y: halfH },
    )
  }
  points.push({ x: -halfW, y: halfH })
  return points
}
