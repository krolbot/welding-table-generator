import type { Contour, Hole, Part, Point, Slot } from '../geometry.js'

export type ToolingId =
  | 'A01' | 'A02' | 'A04' | 'A05' | 'A06' | 'A07' | 'A09' | 'A10' | 'A12'
  | 'B01' | 'B02' | 'B03' | 'B04' | 'B05' | 'B06' | 'B07' | 'B08' | 'B10' | 'B11'
  | 'C01' | 'C02' | 'C03' | 'C04'

export type ToolingRoute = 'cut' | 'welded' | 'hybrid'
export type ParameterValue = number | boolean | string
export type ParameterUnit = 'mm' | 'deg' | 'count' | 'none'

export type NumberParameter = {
  key: string
  label: string
  type: 'number'
  unit: Exclude<ParameterUnit, 'none'>
  minimum: number
  maximum: number
  step: number
  default: number
}
export type BooleanParameter = {
  key: string
  label: string
  type: 'boolean'
  unit: 'none'
  default: boolean
}
export type EnumParameter = {
  key: string
  label: string
  type: 'enum'
  unit: 'none'
  options: readonly string[]
  default: string
}
export type ParameterDefinition = NumberParameter | BooleanParameter | EnumParameter

export type ToolingCatalogEntry = {
  id: ToolingId
  name: string
  route: ToolingRoute
  function: string
  parameters: readonly ParameterDefinition[]
}

export type ToolingConfig<I extends ToolingId = ToolingId> = {
  id: I
  values: Readonly<Record<string, ParameterValue>>
}

export type SheetMaterial = 'S235JR' | 'S355JR' | 'AISI304' | 'AlMg3'
export const materialDensityKgPerMm3: Readonly<Record<SheetMaterial, number>> = {
  S235JR: 7.85e-6,
  S355JR: 7.85e-6,
  AISI304: 7.93e-6,
  AlMg3: 2.66e-6,
}

export type SheetPart = Omit<Part, 'name'> & {
  name: string
  material: SheetMaterial
  densityKgPerMm3: number
  role: string
  process: 'laser-cut'
  interfaces: readonly string[]
}

export type RotationOrder = 'XYZ'
export type AssemblyTransform = {
  units: 'mm'
  translation: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; unit: 'deg'; order: RotationOrder }
}

export type MatingInterface = {
  id: string
  kind: 'tab' | 'slot' | 'bolt' | 'pivot' | 'replaceable' | 'weld-edge' | 'bearing-seat' | 'purchased-mount' | 'linear-guide'
  localOrigin: { x: number; y: number; z: number }
  localAxis: { x: number; y: number; z: number }
  size: { width: number; depth: number; diameter?: number }
  featureEvidence: 'hole' | 'slot' | 'internal-cut' | 'material-face' | 'outer-edge'
}

export type AssemblyInstance = {
  id: string
  partName: string
  transform: AssemblyTransform
  interfaces: MatingInterface[]
}

export type AssemblyJoint = {
  id: string
  kind: MatingInterface['kind']
  first: { instanceId: string; interfaceId: string }
  second: { instanceId: string; interfaceId: string }
  tolerance: number
  description: string
}

export type PurchasedComponent = {
  id: string
  description: string
  quantity: number
  interfaceParameters: Readonly<Record<string, number | string>>
  excludedFromSheetNesting: true
  mounts?: Array<{ instanceId: string; holeId: string }>
  envelopes?: Array<{ start: Point3; end: Point3; diameter: number; representationOnly: true }>
}

export type SheetBomItem = {
  material: SheetMaterial
  thickness: number
  partNames: string[]
  quantity: number
  netMassKg: number
}

export type ToolingAssembly = {
  id: ToolingId
  name: string
  units: 'mm'
  config: ToolingConfig
  parts: SheetPart[]
  instances: AssemblyInstance[]
  sheetBom: SheetBomItem[]
  purchased: PurchasedComponent[]
  joints: AssemblyJoint[]
  warnings: string[]
}

export type GeometryIssue = {
  code: string
  message: string
  path: string
}

export type ValidationResult = {
  valid: boolean
  issues: GeometryIssue[]
}

export type PartInput = {
  name: string
  role: string
  width: number
  height: number
  thickness: number
  count?: number
  material?: SheetMaterial
  holes?: Hole[]
  slots?: Slot[]
  contours: Contour[]
  label?: string
  interfaces?: readonly string[]
}

export type Point3 = { x: number; y: number; z: number }
export type JointAt = {
  world: Point3
  axis: Point3
  size: { width: number; depth: number; diameter?: number }
}

export const point2 = (x: number, y: number): Point => ({ x, y })
