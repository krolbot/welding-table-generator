import type { BooleanParameter, EnumParameter, NumberParameter, ParameterDefinition, ParameterValue, ToolingCatalogEntry, ToolingConfig, ToolingId } from './model.js'

const n = (key: string, label: string, defaultValue: number, minimum: number, maximum: number, unit: NumberParameter['unit'] = 'mm', step = 1): NumberParameter => ({
  key, label, type: 'number', unit, minimum, maximum, step, default: defaultValue,
})
const b = (key: string, label: string, defaultValue: boolean): BooleanParameter => ({ key, label, type: 'boolean', unit: 'none', default: defaultValue })
const e = (key: string, label: string, defaultValue: string, options: readonly string[]): EnumParameter => ({ key, label, type: 'enum', unit: 'none', default: defaultValue, options })
const common = (thickness = 6): ParameterDefinition[] => [n('thickness', 'Sheet thickness', thickness, 2, 20), n('clearance', 'Assembly clearance', 0.25, 0.05, 1.5, 'mm', 0.05)]
const mount = (): ParameterDefinition[] => [n('mountDiameter', 'Table mounting diameter', 16, 6, 40), n('mountPitch', 'Table mounting pitch', 50, 25, 200)]
const plate = (length: number, width: number, thickness = 6): ParameterDefinition[] => [n('length', 'Length', length, 40, 2000), n('width', 'Width', width, 30, 1000), ...common(thickness)]
const entry = (id: ToolingId, name: string, route: ToolingCatalogEntry['route'], func: string, parameters: readonly ParameterDefinition[]): ToolingCatalogEntry => ({ id, name, route, function: func, parameters })

export const toolingCatalog = [
  entry('A01', 'Adjustable straight stop', 'cut', 'Straight reference edge with sliding table mount', [...plate(300, 60), ...mount(), n('slotLength', 'Adjustment slot length', 180, 30, 800), n('slotWidth', 'Adjustment slot width', 18, 7, 45)]),
  entry('A02', 'Flat angle stop', 'cut', 'Two working edges at a defined included angle', [...common(), ...mount(), n('armX', 'First arm length', 250, 80, 800), n('armY', 'Second arm length', 200, 80, 800), n('armWidth', 'Arm width', 60, 30, 200), n('angle', 'Included angle', 90, 30, 150, 'deg')]),
  entry('A03', 'Pivoting flat angle stop', 'cut', 'Pivoting arm locked by a radial slot', [...plate(260, 70), n('pivotDiameter', 'Pivot bolt diameter', 12, 6, 30), n('slotRadius', 'Lock slot radius', 80, 30, 250), n('slotWidth', 'Lock slot width', 14, 7, 35), n('angleMin', 'Minimum angle', -45, -120, 0, 'deg'), n('angleMax', 'Maximum angle', 45, 0, 120, 'deg')]),
  entry('A04', 'Eccentric stop', 'cut', 'Offset circular cam producing adjustable contact radius', [...common(10), n('diameter', 'Cam diameter', 100, 50, 250), n('eccentricity', 'Bore eccentricity', 12, 2, 60), n('boreDiameter', 'Bore diameter', 16, 6, 40)]),
  entry('A05', 'Adapter mounting plate', 'cut', 'Plate joining table and device mounting patterns', [...plate(200, 160, 8), ...mount(), n('devicePitchX', 'Device pattern X', 100, 20, 500), n('devicePitchY', 'Device pattern Y', 80, 20, 500), n('deviceDiameter', 'Device bolt diameter', 11, 5, 30)]),
  entry('A06', 'Module joining strap', 'cut', 'Bridge strap accommodating two offset table grids', [...plate(350, 80, 8), ...mount(), n('gridOffset', 'Grid offset', 25, -100, 100), n('rowSpacing', 'Row spacing', 40, 20, 200)]),
  entry('A07', 'Strap screw clamp', 'cut', 'Slotted clamping strap with separate support shim', [...plate(300, 50, 12), n('studDiameter', 'Stud diameter', 16, 8, 30), n('slotLength', 'Stud adjustment length', 120, 30, 240), n('supportHeight', 'Support pack height', 20, 2, 100)]),
  entry('A08', 'Assembly draw strap', 'cut', 'Draws tabbed sheet assemblies together during tack welding', [...plate(260, 50, 8), n('holeSpacing', 'Draw bolt spacing', 180, 40, 220), n('boltDiameter', 'Draw bolt diameter', 12, 6, 24)]),
  entry('A09', 'Open adjustment shims', 'cut', 'U-shims for removable height adjustment', [n('outerWidth', 'Shim width', 50, 20, 150), n('outerLength', 'Shim length', 70, 30, 200), n('slotWidth', 'Open slot width', 18, 6, 50), n('thickness', 'Shim thickness', 1, 0.5, 10, 'mm', 0.5), n('quantity', 'Quantity', 8, 1, 100, 'count')]),
  entry('A10', 'Replaceable support insert', 'cut', 'Replaceable V/radius insert for B08 holder', [...plate(140, 100, 6), n('holderPitch', 'B08 holder bolt pitch', 80, 30, 160), n('holderDiameter', 'Holder bolt diameter', 10, 5, 20), e('profile', 'Contact profile', 'vee', ['vee', 'radius']), n('profileSize', 'Tube/profile size', 60, 20, 200)]),
  entry('A11', 'Pitch and weld-gap gauge', 'cut', 'Removable comb defining repeated pitch and weld gap', [...plate(250, 50, 3), n('toothPitch', 'Tooth pitch', 25, 10, 100), n('gap', 'Weld gap', 2, 0.5, 10, 'mm', 0.5), n('toothCount', 'Tooth count', 8, 2, 30, 'count')]),
  entry('A12', 'Edge torch holder', 'cut', 'Fork plate supporting a torch handle away from the table', [...plate(220, 100, 6), ...mount(), n('forkDiameter', 'Handle opening diameter', 45, 20, 90), n('neckWidth', 'Fork entry width', 28, 10, 70)]),
  entry('A13', 'Replaceable plasma slat', 'cut', 'Consumable slat mating with B14 support slots', [n('span', 'Slat span', 600, 200, 1500), n('height', 'Slat height', 70, 30, 150), n('thickness', 'Slat thickness', 3, 2, 8), n('seatDepth', 'B14 seat depth', 20, 8, 50), n('seatWidth', 'B14 rail seat width', 6.25, 2.1, 22, 'mm', 0.05), n('quantity', 'Slat quantity', 12, 2, 50, 'count')]),

  entry('B01', 'Straight table extension', 'welded', 'Open-bottom extension with top, two sides and one mounting end', [...common(), ...mount(), n('length', 'Extension length', 500, 250, 1200), n('width', 'Extension width', 200, 120, 600), n('height', 'Extension height', 200, 100, 500), n('holeDiameter', 'Grid hole diameter', 16, 8, 40), n('holePitch', 'Grid pitch', 50, 30, 150), n('gridMargin', 'Grid edge margin', 25, 15, 100), n('tabWidth', 'Joint tab width', 30, 15, 80), n('radialRadius', 'Mounting slot radius', 55, 25, 150), n('radialWidth', 'Mounting slot width', 18, 8, 40), n('radialStart', 'Slot start angle', -35, -80, -5, 'deg'), n('radialEnd', 'Slot end angle', 35, 5, 80, 'deg')]),
  entry('B02', 'Corner table extension', 'welded', 'L-shaped perforated extension attached on two table sides', [...common(), ...mount(), n('legX', 'X extension length', 400, 200, 1000), n('legY', 'Y extension length', 400, 200, 1000), n('armWidth', 'Arm width', 180, 100, 400), n('height', 'Side height', 160, 80, 400)]),
  entry('B03', 'Bridge module', 'welded', 'Two-ended perforated bridge with longitudinal webs and ribs', [...common(8), ...mount(), n('span', 'Bridge span', 800, 300, 2000), n('width', 'Bridge width', 250, 120, 600), n('height', 'Web height', 180, 100, 500), n('ribCount', 'Internal rib count', 2, 1, 8, 'count')]),
  entry('B04', 'Gusseted welding square', 'welded', 'Base and vertical working wall braced by tabbed gussets', [...common(8), ...mount(), n('length', 'Working length', 300, 120, 800), n('height', 'Working height', 250, 100, 600), n('baseWidth', 'Base width', 140, 80, 300), n('gussetCount', 'Gusset count', 2, 2, 5, 'count')]),
  entry('B05', 'Box welding square', 'welded', 'Twin angle cheeks tied by transverse walls into a torsion box', [...common(8), ...mount(), n('armX', 'Horizontal arm', 300, 120, 800), n('armY', 'Vertical arm', 300, 120, 800), n('bodyWidth', 'Box width', 100, 50, 250)]),
  entry('B06', 'Three-plane corner fixture', 'welded', 'Three mutually perpendicular locating planes with access windows', [...common(8), ...mount(), n('sizeX', 'X plane size', 250, 100, 700), n('sizeY', 'Y plane size', 250, 100, 700), n('sizeZ', 'Z plane size', 250, 100, 700), n('window', 'Access window', 100, 40, 300)]),
  entry('B07', 'Box riser beam', 'welded', 'Closed four-wall riser with end plates and internal diaphragms', [...common(8), ...mount(), n('length', 'Beam length', 500, 200, 1500), n('width', 'Beam width', 200, 100, 500), n('height', 'Beam height', 200, 100, 500), n('ribCount', 'Diaphragm count', 1, 0, 6, 'count')]),
  entry('B08', 'Sheet V-support', 'welded', 'Base and two cheeks accepting replaceable A10 contact inserts', [...common(8), ...mount(), n('length', 'Base length', 240, 140, 500), n('width', 'Base width', 160, 100, 350), n('axisHeight', 'Tube axis height', 110, 60, 250), n('cheekSpacing', 'Cheek spacing', 120, 50, 300), n('insertPitch', 'A10 bolt pitch', 80, 30, 160), n('insertDiameter', 'A10 bolt diameter', 10, 5, 20), n('veeAngle', 'V included angle', 90, 60, 140, 'deg')]),
  entry('B09', 'Adjustable tilting platform', 'welded', 'Pivot platform locked by paired radial side slots', [...common(8), n('platformLength', 'Platform length', 300, 120, 700), n('platformWidth', 'Platform width', 220, 100, 500), n('pivotHeight', 'Pivot height', 100, 50, 250), n('slotRadius', 'Lock slot radius', 65, 30, 160), n('angleMin', 'Minimum tilt', 0, -45, 30, 'deg'), n('angleMax', 'Maximum tilt', 60, 15, 85, 'deg')]),
  entry('B10', 'Clamping gantry', 'welded', 'Two tabbed uprights and a box crossbeam carrying purchased clamps', [...common(10), ...mount(), n('span', 'Clear span', 600, 250, 1500), n('clearHeight', 'Clear height', 350, 150, 900), n('beamDepth', 'Beam depth', 100, 60, 250), n('clampCount', 'Purchased clamp count', 2, 1, 6, 'count')]),
  entry('B11', 'Vise/tool console', 'welded', 'Slotted tool platform tied to a mounting end by side gussets', [...common(10), ...mount(), n('projection', 'Console projection', 300, 150, 700), n('platformWidth', 'Platform width', 300, 150, 700), n('height', 'Mounting height', 220, 120, 500), n('devicePitch', 'Device slot spacing', 160, 50, 400)]),
  entry('B12', 'Hanging tool organizer', 'welded', 'Hanging back plate, shelf and profiled tool rack', [...common(4), ...mount(), n('length', 'Organizer length', 500, 200, 1200), n('depth', 'Shelf depth', 160, 80, 350), n('height', 'Back height', 220, 100, 500), n('stationCount', 'Tool stations', 6, 2, 16, 'count')]),
  entry('B13', 'Welded screw-clamp body', 'welded', 'Twin C-cheeks tied by bridges and a purchased screw-nut interface', [...common(12), n('opening', 'Clamp opening', 180, 60, 400), n('reach', 'Clamp reach', 140, 50, 300), n('bodyWidth', 'Body width', 70, 40, 160), n('screwDiameter', 'Purchased screw diameter', 20, 10, 40)]),
  entry('B14', 'Plasma slat module', 'welded', 'Open slat frame with replaceable A13 consumable slats', [...common(6), ...mount(), n('length', 'Module length', 700, 300, 1600), n('width', 'Module width', 600, 250, 1400), n('height', 'Frame height', 160, 80, 350), n('slatCount', 'A13 slat count', 12, 3, 40, 'count'), n('slatThickness', 'A13 slat thickness', 3, 2, 8), n('slatHeight', 'A13 slat height', 70, 30, 150), n('seatDepth', 'Slat seat depth', 20, 8, 50), n('seatWidth', 'A13 rail seat width', 6.25, 2.1, 22, 'mm', 0.05)]),

  entry('C01', 'Precision pin / ball-lock adapter', 'hybrid', 'Optional sheet adapter for a user-specified purchased pin', [...plate(100, 80, 8), b('includeAdapter', 'Cut adapter plate', true), n('pinDiameter', 'Purchased pin shank', 16, 6, 40), n('gripLength', 'Purchased pin grip length', 20, 5, 100)]),
  entry('C02', 'Toggle-clamp adapter', 'hybrid', 'Adapter plate for a user-specified purchased quick clamp', [...plate(160, 100, 8), ...mount(), n('devicePitchX', 'Clamp pattern X', 60, 20, 200), n('devicePitchY', 'Clamp pattern Y', 40, 15, 150), n('deviceDiameter', 'Clamp bolt diameter', 8, 5, 20), n('workingStroke', 'Purchased mechanism stroke', 40, 5, 200)]),
  entry('C03', 'Guided screw-stop frame', 'hybrid', 'Sheet frame locating purchased screw, bushes and parallel guides', [...common(10), ...mount(), n('stroke', 'Required stroke', 100, 20, 300), n('guideSpacing', 'Guide spacing', 80, 30, 200), n('guideDiameter', 'Purchased guide diameter', 16, 8, 35), n('screwDiameter', 'Purchased screw diameter', 20, 10, 40)]),
  entry('C04', 'Roller pipe support', 'hybrid', 'Sheet stand locating purchased rollers, bearings and axles', [...common(8), ...mount(), n('baseLength', 'Base length', 300, 150, 600), n('baseWidth', 'Base width', 180, 100, 350), n('axisSpacing', 'Roller axis spacing', 120, 60, 300), n('axisHeight', 'Roller axis height', 100, 50, 250), n('axleDiameter', 'Purchased axle diameter', 16, 8, 30), n('rollerDiameter', 'Purchased roller diameter', 60, 30, 150)]),
  entry('C05', 'Magnetic V-holder housing', 'hybrid', 'V housing and back plate around user-specified purchased magnets', [...common(4), n('length', 'Holder length', 160, 80, 400), n('width', 'Holder width', 80, 40, 200), n('veeAngle', 'V included angle', 90, 60, 140, 'deg'), n('magnetDiameter', 'Purchased magnet diameter', 25, 10, 60), n('magnetCount', 'Magnet quantity', 4, 2, 12, 'count')]),
  entry('C06', 'Welding positioner chassis', 'hybrid', 'Sheet chassis and faceplate around specified shaft, bearings, drive and motor', [...common(8), n('baseLength', 'Base length', 500, 250, 1000), n('baseWidth', 'Base width', 350, 200, 700), n('axisHeight', 'Spindle axis height', 220, 120, 500), n('faceplateDiameter', 'Faceplate diameter', 300, 150, 600), n('shaftDiameter', 'Purchased shaft diameter', 35, 15, 80), n('bearingOuterDiameter', 'Purchased bearing OD', 72, 30, 150), n('motorPattern', 'Motor bolt square', 90, 40, 200)]),
  entry('C07', 'Bench press/brake frame', 'hybrid', 'Twin side frames, bed and tooling interfaces around specified jack and return system', [...common(15), n('workingWidth', 'Working width', 500, 200, 1200), n('daylight', 'Open daylight', 350, 150, 800), n('frameDepth', 'Frame depth', 250, 120, 500), n('jackSeatDiameter', 'Purchased jack seat', 80, 40, 180), n('stroke', 'Purchased actuator stroke', 150, 40, 400), n('pinDiameter', 'Bed pin diameter', 25, 12, 50)]),
] as const satisfies readonly ToolingCatalogEntry[]

const catalogById = new Map<ToolingId, ToolingCatalogEntry>(toolingCatalog.map(item => [item.id, item]))
export const getToolingEntry = <I extends ToolingId>(id: I): ToolingCatalogEntry => {
  const found = catalogById.get(id)
  if (!found) throw new Error(`Unknown tooling id: ${id}`)
  return found
}

export const createToolingConfig = <I extends ToolingId>(id: I, overrides: Readonly<Record<string, ParameterValue>> = {}): ToolingConfig<I> => {
  const item = getToolingEntry(id)
  const known = new Set(item.parameters.map(parameter => parameter.key))
  for (const key of Object.keys(overrides)) if (!known.has(key)) throw new Error(`${id}.${key}: unknown parameter`)
  const values: Record<string, ParameterValue> = {}
  for (const parameter of item.parameters) {
    const value = overrides[parameter.key] ?? parameter.default
    if (parameter.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${id}.${parameter.key}: expected a finite number`)
      if (value < parameter.minimum || value > parameter.maximum) throw new Error(`${id}.${parameter.key}: ${value} is outside ${parameter.minimum}..${parameter.maximum} ${parameter.unit}`)
      if (parameter.unit === 'count' && !Number.isInteger(value)) throw new Error(`${id}.${parameter.key}: expected an integer count`)
    } else if (parameter.type === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${id}.${parameter.key}: expected boolean`)
    } else if (typeof value !== 'string' || !parameter.options.includes(value)) {
      throw new Error(`${id}.${parameter.key}: expected one of ${parameter.options.join(', ')}`)
    }
    values[parameter.key] = value
  }
  return { id, values }
}

export const validateToolingConfig = (config: ToolingConfig): void => {
  createToolingConfig(config.id, config.values)
}

export const TOOLING_IDS: readonly ToolingId[] = toolingCatalog.map(item => item.id)
