export type Units = 'mm' | 'inch'
export type Preset = 'D16' | 'D28' | 'Custom'
export type Grid = 'square' | 'staggered'
export type EngravingMode = 'through' | 'between'
export type LegMountStyle = 'boltPattern' | 'cornerPlate'
export type PartName = 'top' | 'longSkirt' | 'shortSkirt' | 'longRib' | 'shortRib' | 'legCornerPlate' | 'legJumper' | 'legMountPlate'
export type CustomHole = { id: string | number; part: PartName; x: number; y: number; d: number }
export type RemovedHole = { id: string | number; part: PartName; x: number; y: number; r: number }

export type Config = {
  units: Units
  preset: Preset
  holeDiameter: number
  pitch: number
  margin: number
  grid: Grid
  skirtHoles: boolean
  engraving: boolean
  engravingMode: EngravingMode
  nameMarking: boolean
  length: number
  width: number
  height: number
  ribs: boolean
  ribSpacing: number
  ribAccessHoles: boolean
  ribAccessHoleDiameter: number
  thickness: number
  tabWidth: number
  clearance: number
  dogBones: boolean
  dogBoneDiameter: number
  legMounts: boolean
  legMountStyle: LegMountStyle
  liftingHoles: boolean
  legBoltDiameter: number
  legPatternX: number
  legPatternY: number
  legCols: number
  legRows: number
  legEdgeOffset: number
  legBottomOffset: number
  legProfileSize: number
  legPlateSize: number
  legPlateHoleDiameter: number
  legPlateHoleSpacing: number
  legLength: number
  customHoles: CustomHole[]
  removedHoles: Array<RemovedHole | string>
  sheetLength: number
  sheetWidth: number
  sheetEdgeGap: number
  sheetPartGap: number
  nestingCopies: number
  exploded: number
  showDimensions: boolean
  renderHoles: boolean
  highlighting: boolean
}

export const defaults: Config = {
  units: 'mm',
  preset: 'D16',
  holeDiameter: 16,
  pitch: 50,
  margin: 25,
  grid: 'square',
  skirtHoles: true,
  engraving: true,
  engravingMode: 'through',
  nameMarking: false,
  length: 2000,
  width: 1000,
  height: 200,
  ribs: true,
  ribSpacing: 400,
  ribAccessHoles: false,
  ribAccessHoleDiameter: 80,
  thickness: 8,
  tabWidth: 50,
  clearance: 0.2,
  dogBones: true,
  dogBoneDiameter: 2,
  legMounts: false,
  legMountStyle: 'boltPattern',
  liftingHoles: false,
  legBoltDiameter: 16,
  legPatternX: 60,
  legPatternY: 60,
  legCols: 2,
  legRows: 2,
  legEdgeOffset: 60,
  legBottomOffset: 40,
  legProfileSize: 60,
  legPlateSize: 150,
  legPlateHoleDiameter: 10,
  legPlateHoleSpacing: 100,
  legLength: 700,
  customHoles: [],
  removedHoles: [],
  sheetLength: 3000,
  sheetWidth: 1500,
  sheetEdgeGap: 10,
  sheetPartGap: 5,
  nestingCopies: 1,
  exploded: 0,
  showDimensions: true,
  renderHoles: true,
  highlighting: true,
}

export const partLabels: Record<PartName, string> = {
  top: 'Top plate',
  longSkirt: 'Long skirt',
  shortSkirt: 'Short skirt',
  longRib: 'Long rib',
  shortRib: 'Short rib',
  legCornerPlate: 'Leg corner plate',
  legJumper: 'Leg support jumper',
  legMountPlate: 'Leg mounting plate',
}

export const mmPerInch = 25.4
export const maxTabWidth = (c: Config) => Math.max(0, Math.floor(Math.min(c.height - c.thickness, c.length, c.width) / 2) - 5)
export const display = (value: number, units: Units, precision = 0) =>
  (units === 'mm' ? value : value / mmPerInch).toFixed(units === 'mm' ? precision : Math.max(2, precision + 2))
export const readDisplay = (value: number, units: Units) => value * (units === 'mm' ? 1 : mmPerInch)
export const presetValues: Record<Exclude<Preset, 'Custom'>, Pick<Config, 'holeDiameter' | 'pitch' | 'margin'>> = {
  D16: { holeDiameter: 16, pitch: 50, margin: 25 },
  D28: { holeDiameter: 28, pitch: 100, margin: 50 },
}

export const projectFields = {
  height: 'skirtHeight', ribs: 'enableRibs', skirtHoles: 'enableSkirtHoles',
  engraving: 'enableEngraving', engravingMode: 'engravePattern', nameMarking: 'enableNameEngraving',
  dogBones: 'enableRelief', dogBoneDiameter: 'reliefDiameter', legMounts: 'enableLegMounts',
  liftingHoles: 'enableLiftingHoles', legEdgeOffset: 'legOffsetEdge', legBottomOffset: 'legOffsetBottom',
  grid: 'holePattern',
} as const
export const projectParts: Record<PartName, string> = {
  top: 'top', longSkirt: 'long', shortSkirt: 'short', longRib: 'long_rib', shortRib: 'short_rib',
  legCornerPlate: 'leg_corner_plate', legJumper: 'leg_jumper', legMountPlate: 'leg_mount_plate',
}
export const readPart = (value: unknown): PartName | undefined =>
  (Object.keys(projectParts) as PartName[]).find(part => part === value || projectParts[part] === value)

export const tableProjectVersion = 2

export function projectConfig(config: Config): Record<string, unknown> {
  const project: Record<string, unknown> = { schemaVersion: tableProjectVersion }
  for (const key of Object.keys(defaults) as (keyof Config)[]) {
    const value = config[key]
    if (['units', 'preset', 'exploded', 'showDimensions', 'renderHoles', 'highlighting'].includes(key)) continue
    const field = projectFields[key as keyof typeof projectFields] ?? key
    if (key === 'grid') project[field] = value === 'square' ? 'grid' : 'stagger'
    else if (key === 'customHoles') project[field] = config.customHoles.map(hole => ({ ...hole, part: projectParts[hole.part] }))
    else if (key === 'removedHoles') project[field] = config.removedHoles.map(hole => typeof hole === 'string' ? hole : { ...hole, part: projectParts[hole.part] })
    else project[field] = value
  }
  return project
}
