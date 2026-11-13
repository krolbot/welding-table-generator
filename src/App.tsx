import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  defaults,
  mmPerInch,
  maxTabWidth,
  partLabels,
  projectFields,
  projectConfig,
  readPart,
  type RemovedHole,
  presetValues,
  readDisplay,
  type Config,
  type CustomHole,
  type PartName,
} from './model'
import { engravingLines, fabricationError, layoutParts, legCornerPlateSpec, ribAccessHoleSpec, totals, type Hole } from './geometry'
import { downloadFull, downloadZip } from './dxf'
import { TableSheetNesting } from './SheetNesting'
import { Icon } from './Icon'
import { NumberInput } from './NumberInput'
import { AssemblyControls, Checkbox, GeneratorShell, NumberField, ProductionEstimate, ProjectActions, SliderField, VisualizationSettings, type ViewMode } from './GeneratorWorkspace'
import { PartsLayout } from './PartsLayout'
import { copyText, downloadFile } from './projectIO'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
const ToolsWorkspace = lazy(() => import('./tools/ToolsWorkspace').then(module => ({ default: module.ToolsWorkspace })))

type NumericKey = {
  [K in keyof Config]: Config[K] extends number ? K : never
}[keyof Config]
type BooleanKey = {
  [K in keyof Config]: Config[K] extends boolean ? K : never
}[keyof Config]

const numericKeys: NumericKey[] = [
  'holeDiameter', 'pitch', 'margin', 'length', 'width', 'height', 'ribSpacing', 'ribAccessHoleDiameter', 'thickness', 'tabWidth',
  'clearance', 'dogBoneDiameter', 'legBoltDiameter', 'legPatternX', 'legPatternY', 'legCols', 'legRows',
  'legEdgeOffset', 'legBottomOffset', 'legProfileSize', 'legPlateSize',
  'legPlateHoleDiameter', 'legPlateHoleSpacing', 'legLength', 'sheetLength', 'sheetWidth', 'sheetEdgeGap', 'sheetPartGap', 'nestingCopies', 'exploded',
]
const numericBounds: Record<NumericKey, { min: number; max: number }> = {
  holeDiameter: { min: 1, max: 40 },
  pitch: { min: 11, max: 1000 },
  margin: { min: 0, max: 200 * mmPerInch / 2 - 10 },
  length: { min: 500, max: 200 * mmPerInch },
  width: { min: 400, max: 200 * mmPerInch },
  height: { min: 50, max: 20 * mmPerInch },
  ribSpacing: { min: 200, max: 24 * mmPerInch },
  ribAccessHoleDiameter: { min: 1, max: 1000 },
  thickness: { min: 1, max: 40 },
  tabWidth: { min: 0, max: Math.floor((20 * mmPerInch - 1) / 2) - 5 },
  clearance: { min: 0, max: 2.5 },
  dogBoneDiameter: { min: 0.5, max: 5 },
  legBoltDiameter: { min: 1, max: 100 },
  legPatternX: { min: 0, max: 1000 },
  legPatternY: { min: 0, max: 1000 },
  legCols: { min: 1, max: 4 },
  legRows: { min: 1, max: 4 },
  legEdgeOffset: { min: 0, max: 1000 },
  legBottomOffset: { min: 0, max: 1000 },
  legProfileSize: { min: 20, max: 200 },
  legPlateSize: { min: 80, max: 400 },
  legPlateHoleDiameter: { min: 1, max: 40 },
  legPlateHoleSpacing: { min: 20, max: 350 },
  legLength: { min: 100, max: 1500 },
  sheetLength: { min: 0, max: Infinity },
  sheetWidth: { min: 0, max: Infinity },
  sheetEdgeGap: { min: 0, max: 1000 },
  sheetPartGap: { min: 0, max: 1000 },
  nestingCopies: { min: 1, max: 10 },
  exploded: { min: 0, max: 100 },
}
const booleanKeys: BooleanKey[] = [
  'skirtHoles', 'engraving', 'nameMarking', 'ribs', 'ribAccessHoles', 'dogBones', 'legMounts', 'liftingHoles',
  'showDimensions', 'renderHoles', 'highlighting',
]
const inchRanges: Partial<Record<NumericKey, { min: number; max: number; step: number }>> = {
  length: { min: 20, max: 200, step: 1 }, width: { min: 16, max: 200, step: 1 },
  height: { min: 2, max: 20, step: 0.5 }, ribSpacing: { min: 8, max: 24, step: 1 },
}
const partNames = Object.keys(partLabels) as PartName[]
const clampNumeric = (key: NumericKey, value: number) => {
  const bounds = numericBounds[key]
  return Math.max(bounds.min, Math.min(bounds.max, value))
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isPart = (value: unknown): value is PartName => typeof value === 'string' && Object.hasOwn(partLabels, value)
const parseCustomHoles = (value: unknown): CustomHole[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!isRecord(item) || !['string', 'number'].includes(typeof item.id)) return []
    const part = readPart(item.part)
    if (!part) return []
    const x = Number(item.x)
    const y = Number(item.y)
    const d = Number(item.d)
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(d) && d > 0
      ? [{ id: item.id as string | number, part, x, y, d }]
      : []
  })
}

function normalizeConfig(input: unknown): Config {
  if (!isRecord(input)) return { ...defaults }
  const value: Record<string, unknown> = { ...input }
  for (const [key, field] of Object.entries(projectFields)) {
    if (Object.hasOwn(input, field)) value[key] = input[field]
  }
  if (value.grid === 'grid') value.grid = 'square'
  if (value.grid === 'stagger') value.grid = 'staggered'
  const result: Config = { ...defaults }
  for (const key of numericKeys) {
    const candidate = Number(value[key])
    if (Number.isFinite(candidate)) result[key] = clampNumeric(key, candidate)
  }
  for (const key of booleanKeys) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  if (value.units === 'mm' || value.units === 'inch') result.units = value.units
  if (value.units === 'in') result.units = 'inch'
  if (value.preset === 'D16' || value.preset === 'D28' || value.preset === 'Custom') result.preset = value.preset
  if (value.grid === 'square' || value.grid === 'staggered') result.grid = value.grid
  if (value.skirtHoleLayout === 'canonical' || value.skirtHoleLayout === 'compact') result.skirtHoleLayout = value.skirtHoleLayout
  if (value.engravingMode === 'through' || value.engravingMode === 'between') result.engravingMode = value.engravingMode
  if (value.legMountStyle === 'boltPattern' || value.legMountStyle === 'cornerPlate') result.legMountStyle = value.legMountStyle
  result.nestingCopies = Math.floor(result.nestingCopies)
  if (value.legMountStyle === 'squareSocket') result.legMountStyle = 'cornerPlate'
  result.customHoles = parseCustomHoles(value.customHoles)
  result.removedHoles = Array.isArray(value.removedHoles) ? value.removedHoles.flatMap((item): Array<RemovedHole | string> => {
    if (typeof item === 'string') return [item]
    if (!isRecord(item)) return []
    const part = readPart(item.part)
    if (!part || !['string', 'number'].includes(typeof item.id)) return []
    const x = Number(item.x), y = Number(item.y), r = Number(item.r)
    return [x, y, r].every(Number.isFinite) && r > 0
      ? [{ id: item.id as string | number, part, x, y, r }] : []
  }) : []
  const fixtureEdgeWeb = 5
  result.pitch = Math.max(result.pitch, result.holeDiameter + 2 * fixtureEdgeWeb)
  result.margin = Math.max(result.holeDiameter / 2 + fixtureEdgeWeb, Math.min(result.margin, Math.min(result.length, result.width) / 2 - 2 * fixtureEdgeWeb))
  if (!value.preset) result.preset = Object.entries(presetValues).find(([, values]) =>
    values.holeDiameter === result.holeDiameter && values.pitch === result.pitch && values.margin === result.margin,
  )?.[0] as Config['preset'] ?? 'Custom'
  result.legCols = Math.max(1, Math.round(result.legCols))
  result.legRows = Math.max(1, Math.round(result.legRows))
  result.exploded = Math.max(0, Math.min(100, result.exploded))
  result.tabWidth = Math.min(result.tabWidth, maxTabWidth(result))
  return result
}

const readStorage = (key: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return isRecord(value) ? value : {}
  } catch { return {} }
}

function loadedConfig(): Config {
  const ui = readStorage('tableGenUI')
  const preferences = { units: ui.units, exploded: ui.explodeFactor, showDimensions: ui.showDims, renderHoles: ui.renderHoles3D, highlighting: ui.enableHoverEffect }
  const stored = { ...readStorage('tableGenParams'), ...preferences }
  const params = new URLSearchParams(location.search)
  const legacy = params.get('state')
  if (legacy) {
    try {
      return normalizeConfig(JSON.parse(legacy))
    } catch {
      return { ...defaults }
    }
  }
  // Unknown project links do not override the saved table configuration.
  if (params.has('project') || params.has('toolProject') || params.size === 1 && params.has('workspace')) return normalizeConfig(stored)
  if (!params.size) return normalizeConfig(stored)
  const candidate: Record<string, unknown> = {}
  for (const [key, value] of params) {
    if (['customHoles', 'removedHoles'].includes(key)) {
      try { candidate[key] = JSON.parse(value) } catch { candidate[key] = [] }
    } else candidate[key] = value === 'true' ? true : value === 'false' ? false : value
  }
  return normalizeConfig({ ...preferences, ...candidate })
}

const serialiseConfig = (config: Config) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(projectConfig(config))) {
    params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
  }
  return params
}

export default function App() {
  const [workspace, setWorkspace] = useState<'table' | 'tools'>(() => { const params = new URLSearchParams(location.search); return params.has('toolProject') || params.get('workspace') === 'tools' ? 'tools' : 'table' })
  const selectWorkspace = (next: 'table' | 'tools') => {
    const url = new URL(location.href)
    if (next === 'tools') url.searchParams.set('workspace', 'tools')
    else { url.searchParams.delete('workspace'); url.searchParams.delete('toolProject') }
    history.replaceState(null, '', url)
    setWorkspace(next)
  }
  const [config, setConfig] = useState<Config>(loadedConfig)
  const [dark, setDark] = useState(() => readStorage('tableGenUI').theme === 'dark')
  const [view, setView] = useState<ViewMode>(() => { const saved = readStorage('tableGenUI').viewMode; return saved === '3d' || saved === 'sheet' ? saved : '2d' })
  const [notice, setNotice] = useState('')
  const [reset3d, setReset3d] = useState(0)
  const [focusMount3d, setFocusMount3d] = useState(0)
  const [reset2dToken, setReset2dToken] = useState(0)

  const summary = useMemo(() => totals(config), [config])
  const layout = useMemo(() => layoutParts(config), [config])
  const cornerPlate = useMemo(() => legCornerPlateSpec(config), [config])
  const ribAccess = useMemo(() => ribAccessHoleSpec(config), [config])
  const geometryError = useMemo(() => fabricationError(config), [config])
  const unitLabel = config.units === 'mm' ? 'mm' : 'in'

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    try {
      localStorage.setItem('tableGenParams', JSON.stringify(projectConfig(config)))
      localStorage.setItem('tableGenUI', JSON.stringify({ viewMode: view, renderHoles3D: config.renderHoles, enableHoverEffect: config.highlighting, explodeFactor: config.exploded, showDims: config.showDimensions, units: config.units === 'inch' ? 'in' : 'mm', theme: dark ? 'dark' : 'light' }))
    } catch { setNotice('Browser autosave is unavailable. Use Save to keep your project.') }
  }, [config, dark, view])

  const patch = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig(current => ({ ...current, [key]: value }))
  }
  const setPreset = (preset: Config['preset']) => {
    const values = preset === 'Custom' ? {} : presetValues[preset]
    setConfig(current => ({ ...current, ...values, preset }))
    if (preset === 'Custom') setNotice('Enter any hole diameter, pitch and margin in the fields below.')
  }
  const setNumeric = (key: NumericKey, value: number) => {
    if (!Number.isFinite(value)) return
    setConfig(current => {
      const next = { ...current, [key]: clampNumeric(key, value) }
      if (['length', 'width', 'height', 'thickness', 'tabWidth'].includes(key)) next.tabWidth = Math.min(next.tabWidth, maxTabWidth(next))
      if (key === 'legBoltDiameter' || key === 'legPatternX' || key === 'legPatternY') {
        next.legPatternX = Math.max(next.legPatternX, next.legBoltDiameter * 1.5)
        next.legPatternY = Math.max(next.legPatternY, next.legBoltDiameter * 1.5)
      }
      if (key === 'holeDiameter' || key === 'pitch' || key === 'margin') next.preset = 'Custom'
      return normalizeConfig(next)
    })
  }
  const numberLabel = (millimetres: number, precision = 2) => String(Number((millimetres / (config.units === 'mm' ? 1 : mmPerInch)).toFixed(config.units === 'mm' ? 4 : precision)))
  const numericInput = (key: NumericKey, label: string, min: number, max: number, step: number, precision = 0) => {
    const factor = config.units === 'mm' ? 1 : mmPerInch
    const inputStep = config.units === 'mm' ? step : key === 'holeDiameter' ? 0.05 : key === 'thickness' ? 0.01 : key === 'clearance' ? 0.002 : 0.25
    return <NumberField label={label} value={numberLabel(config[key], precision ? precision + 2 : 3)} min={min / factor} max={max / factor} step={inputStep} onValue={value => setNumeric(key, readDisplay(value, config.units))} />
  }
  const slider = (key: NumericKey, label: string, min: number, max: number, step: number, percentage = false) => {
    const imperial = config.units === 'inch' ? inchRanges[key] : undefined
    const range = imperial ?? { min, max, step }
    return <SliderField label={label} output={percentage ? `${config[key]}%` : numberLabel(config[key], 2)} icon={percentage ? 'explode' : undefined} min={range.min} max={range.max} step={range.step} value={imperial ? config[key] / mmPerInch : config[key]} onValue={value => setNumeric(key, value * (imperial ? mmPerInch : 1))} />
  }
  const toggle = (key: BooleanKey, label: string) => <Checkbox label={label} checked={config[key]} onChange={value => patch(key, value)} />
  const reset2d = () => setReset2dToken(value => value + 1)
  const removeHole = (hole: Hole, part?: PartName) => {
    part ??= readPart(hole.id.split(':')[0])
    if (!part) return
    patch('removedHoles', [...config.removedHoles, { id: crypto.randomUUID(), part, x: hole.x, y: hole.y, r: hole.d / 2 }])
    setNotice('Hole removed. Restore it from the Removed Holes list.')
  }
  const addHole = () => {
    patch('customHoles', [...config.customHoles, { id: crypto.randomUUID(), part: 'top', x: 0, y: 0, d: 10 }])
  }
  const updateHole = (id: CustomHole['id'], key: keyof Omit<CustomHole, 'id'>, value: string) => {
    patch('customHoles', config.customHoles.map(hole => {
      if (hole.id !== id) return hole
      if (key === 'part') return isPart(value) ? { ...hole, part: value } : hole
      const number = Number(value)
      return Number.isFinite(number) && (key !== 'd' || number > 0) ? { ...hole, [key]: readDisplay(number, config.units) } : hole
    }))
  }
  const save = () => downloadFile(JSON.stringify(projectConfig(config), null, 2), `WeldingTable_Project_${config.length}x${config.width}.json`)
  const open = async (file: File) => {
    try {
      const value: unknown = JSON.parse(await file.text())
      if (!isRecord(value) || !('length' in value) || !('width' in value)) throw new Error('Invalid project')
      setConfig(current => ({ ...normalizeConfig(value), units: current.units, exploded: current.exploded, showDimensions: current.showDimensions, renderHoles: current.renderHoles, highlighting: current.highlighting }))
      reset2d()
      setNotice('Project loaded.')
    } catch { setNotice('Could not read this project JSON.') }
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = serialiseConfig(config).toString()
    try {
      await copyText(url.toString())
      setNotice('Full metric project link copied to clipboard.')
    } catch {
      setNotice('Clipboard access was denied. Use Save to preserve this project.')
    }
  }

  if (workspace === 'tools') return <Suspense fallback={<div className="three-loading">Loading tools…</div>}><ToolsWorkspace dark={dark} onTheme={() => setDark(value => !value)} onBack={() => selectWorkspace('table')} units={config.units} onUnits={units => patch('units', units)} visual={config} onVisual={changes => setConfig(current => ({ ...current, ...changes }))} /></Suspense>
  return <GeneratorShell workspace="table" onWorkspace={selectWorkspace} dark={dark} onTheme={() => setDark(value => !value)} units={config.units} onUnits={units => patch('units', units)} view={view} onView={setView} notice={notice} onDismissNotice={() => setNotice('')}
    settings={<>
          <section className="fixture-card">
            <h3>Fixture System</h3>
            <div className="preset">{(['D16', 'D28', 'Custom'] as const).map(preset => <button key={preset} className={config.preset === preset ? 'active' : ''} onClick={() => setPreset(preset)}>{preset === 'Custom' && <Icon name="target" size={12} />}{preset}</button>)}</div>
            <div className="fields three">{numericInput('holeDiameter', 'Hole Ø', numericBounds.holeDiameter.min, numericBounds.holeDiameter.max, 1)}{numericInput('pitch', 'Pitch', config.holeDiameter + 10, numericBounds.pitch.max, 5)}{numericInput('margin', 'Margin', config.holeDiameter / 2 + 5, Math.min(config.length, config.width) / 2 - 10, 5)}</div>
            <p className="grid-summary">Grid: Ø{numberLabel(config.holeDiameter, 3)} / {numberLabel(config.pitch, 3)} {unitLabel} pitch / {numberLabel(config.margin, 3)} {unitLabel} from edge</p>
            <div className="hole-pattern"><span>Hole Pattern</span><div className="grid-buttons"><button className={config.grid === 'square' ? 'active' : ''} onClick={() => patch('grid', 'square')}>Square grid</button><button className={config.grid === 'staggered' ? 'active' : ''} onClick={() => patch('grid', 'staggered')}>Staggered</button></div>{config.grid === 'staggered' && <p>Rows are offset by half a pitch. Grid engraving draws rows only — columns no longer line up.</p>}</div>
            <div className="fixture-options">{toggle('skirtHoles', 'Skirt Holes')}
              {config.skirtHoles && <div className="skirt-layout-options"><span>Skirt hole layout</span><div className="grid-buttons"><button className={config.skirtHoleLayout === 'canonical' ? 'active' : ''} onClick={() => patch('skirtHoleLayout', 'canonical')}>Canonical</button><button className={config.skirtHoleLayout === 'compact' ? 'active' : ''} onClick={() => patch('skirtHoleLayout', 'compact')}>Compact edge rows</button></div><p>{config.skirtHoleLayout === 'compact' ? 'Vertical rows are centred with at least half a pitch to the nominal skirt edges, independent of the tabletop margin. D16 / 50 mm gives two rows on a 100 mm skirt.' : 'Vertical rows use the same edge margin as the canonical tabletop grid.'}</p></div>}
              {toggle('engraving', 'Grid Engraving')}
              {config.engraving && <div className="engraving-options"><span>Engraving layout</span><div className="grid-buttons"><button title="Lines run through the hole centres" className={config.engravingMode === 'through' ? 'active' : ''} onClick={() => patch('engravingMode', 'through')}>Through holes</button><button title="Lines run between the holes, forming cells" className={config.engravingMode === 'between' ? 'active' : ''} onClick={() => patch('engravingMode', 'between')}>Between (cells)</button></div></div>}
              {toggle('nameMarking', 'Part Name Marking')}
            </div>
          </section>
          <section><h3>Dimensions ({unitLabel})</h3>
            {slider('length', 'Length (L)', 500, 5000, 50)}
            {slider('width', 'Width (W)', 400, 5000, 50)}
            {slider('height', 'Table Height (H)', 50, 500, 10)}
          </section>
          <section className="internal-frame"><h3><Icon name="frame" size={14} />Internal Frame</h3>{toggle('ribs', 'Generate Support Ribs')}
            {config.ribs && <div className="indented">
              {slider('ribSpacing', `Rib Spacing (${unitLabel})`, 200, 600, 50)}
              {toggle('ribAccessHoles', 'Rib access holes')}
              {config.ribAccessHoles && <>
                <div className="fields">{numericInput('ribAccessHoleDiameter', `Access hole Ø (${unitLabel})`, 1, 1000, 5)}<label className="field"><span>Maximum for this frame</span><output>{numberLabel(ribAccess?.maxDiameter ?? 0, 2)} {unitLabel}</output></label></div>
                <p>One circular opening in every bay of each long and short rib. At least {numberLabel(ribAccess?.web ?? 0, 2)} {unitLabel} of material remains around the opening, clear of the cross-lap slots. This geometric spacing is not a load rating.</p>
              </>}
            </div>}
          </section>
          <section><h3><Icon name="frame" size={14} />Tabs & Slots (Joints)</h3>
            <div className="joint-fields">
              {numericInput('thickness', `Metal Thickness (${unitLabel})`, numericBounds.thickness.min, numericBounds.thickness.max, 1)}
              {numericInput('tabWidth', `Tab Width (${unitLabel})`, numericBounds.tabWidth.min, maxTabWidth(config), 5)}
              <div className="joint-clearance">{numericInput('clearance', `Joint Clearance (${unitLabel})`, 0, 2.5, 0.05, 2)}<p className="clearance-note">Max {numberLabel(2.5, 4)} {unitLabel}</p></div>
              <div className="relief-options">{toggle('dogBones', 'Dog-bone Reliefs')}
                {config.dogBones && <div className="indented relief-control">{slider('dogBoneDiameter', `Diameter (${unitLabel})`, 0.5, 5, 0.5)}</div>}
              </div>
            </div>
          </section>
          <section className="ergonomics"><h3><Icon name="settings" size={14} />Ergonomics (Construction)</h3>
            {toggle('legMounts', 'Leg Mounts')}
            {config.legMounts && <div className="leg-options">
              <div className="grid-buttons leg-style"><button className={config.legMountStyle === 'boltPattern' ? 'active' : ''} onClick={() => patch('legMountStyle', 'boltPattern')}>Bolt pattern</button><button className={config.legMountStyle === 'cornerPlate' ? 'active' : ''} onClick={() => patch('legMountStyle', 'cornerPlate')}>Corner plates</button></div>
              {config.legMountStyle === 'boltPattern' ? <>
                <div className="fields"><label className="field"><span>Bolt size (M)</span><NumberInput value={numberLabel(config.legBoltDiameter, 2)} min={1 / (config.units === 'mm' ? 1 : mmPerInch)} max={100 / (config.units === 'mm' ? 1 : mmPerInch)} step={config.units === 'mm' ? 1 : 0.0625} onValue={value => setNumeric('legBoltDiameter', readDisplay(value, config.units))} /></label><label className="field"><span>Hole Ø (auto)</span><output>{numberLabel(config.legBoltDiameter + 1.5, 3)} {unitLabel}</output></label></div>
                <div className="fields">{numericInput('legPatternX', 'Pattern X', config.legBoltDiameter * 1.5, 1000, 5)}{numericInput('legPatternY', 'Pattern Y', config.legBoltDiameter * 1.5, 1000, 5)}</div>
                <div className="fields">{(['legCols', 'legRows'] as const).map((key, index) => <label className="field" key={key}><span>{index ? 'Rows' : 'Holes per row'}</span><select value={config[key]} onChange={event => setNumeric(key, Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
                <div className="fields">{numericInput('legEdgeOffset', 'From edge', 0, 1000, 5)}{numericInput('legBottomOffset', 'From bottom', 0, 1000, 5)}</div>
                <p>{config.legCols * config.legRows} holes per corner, both ends of every skirt. Minimum spacing for M{config.legBoltDiameter}: {numberLabel(config.legBoltDiameter * 1.5, 2)} {unitLabel}.</p>
              </> : <>
                <div className="fields">{numericInput('legPlateSize', 'Plate size', 80, 400, 5)}<label className="field"><span>Plate & jumper thickness</span><output>{numberLabel(config.thickness, 2)} {unitLabel} — table stock</output></label></div>
                <div className="fields"><label className="field"><span>Jumper length (auto)</span><output>{numberLabel(config.height - config.thickness, 2)} {unitLabel}</output></label><label className="field"><span>Jumper width (auto)</span><output>{numberLabel(config.height * 0.3, 2)} {unitLabel}</output></label></div>
                <div className="fields">{numericInput('legPlateHoleDiameter', 'Mounting hole Ø', 1, 40, 1)}{numericInput('legPlateHoleSpacing', 'Hole pattern', 20, 350, 5)}</div>
                <div className="fields">{numericInput('legProfileSize', 'Square tube', 20, 200, 5)}{numericInput('legLength', 'Leg assembly below frame', 100, 1500, 25)}</div>
                {cornerPlate ? <p>4 fixed corner plates and 4 removable leg mounting plates {numberLabel(cornerPlate.size, 2)} × {numberLabel(cornerPlate.size, 2)} × {numberLabel(cornerPlate.thickness, 2)} {unitLabel}, each with four Ø{numberLabel(cornerPlate.holeDiameter, 2)} holes on a {numberLabel(cornerPlate.holeSpacing, 2)} × {numberLabel(cornerPlate.holeSpacing, 2)} {unitLabel} pattern. Four support jumpers: {numberLabel(cornerPlate.jumperLength, 2)} × {numberLabel(cornerPlate.jumperWidth, 2)} × {numberLabel(cornerPlate.thickness, 2)} {unitLabel}, each with a {numberLabel(cornerPlate.jumperTabWidth, 2)} {unitLabel} partial-width tab.</p> : <p className="socket-error">The corner plate, jumper, tabs, slots or hole pattern do not fit the current table and internal frame. Increase the table or plate size, or reduce the conflicting inputs.</p>}
                <p>The upper corner plate underside and the uninterrupted skirt lower edge share the finished frame-bottom plane. Only the corner seat steps up by one stock thickness. At each skirt joint, a partial tab mechanically locates the plate while the adjacent open edge provides an internal corner for a fillet weld; the physical plate corner remains intact. Each jumper supports the inner free corner and rises to the tabletop underside: length is H − stock thickness and width is 0.3 × H. Plates and jumpers use the selected table stock; H100 / T6 produces the 94 × 30 mm reference blank.</p>
                <p>Each plain lower mounting plate bolts to its corner plate through the matching holes. The tube is welded to the lower plate, not the table. Lower plates have no tabs or slots; bolts are not shown in 3D. Tube cut length is {numberLabel(cornerPlate?.legTubeLength ?? config.legLength - config.thickness, 2)} {unitLabel}; the plate plus tube preserve the specified distance below the frame. Finish the mating faces flush before bolting.</p>
              </>}
            </div>}
            {toggle('liftingHoles', 'Lifting Holes')}
          </section>
          <section><h3><Icon name="target" size={14} />Custom Holes</h3><p>X and Y are measured from the centre of the part — the same origin the exported DXF uses. A hole is added to every copy of the selected part.</p>
            {config.customHoles.map(hole => <div className="hole-row" key={hole.id}>
              <div className="hole-part"><select aria-label="Part" value={hole.part} onChange={event => updateHole(hole.id, 'part', event.target.value)}>{partNames.map(name => <option key={name} value={name}>{partLabels[name]}</option>)}</select><button title="Remove this hole" aria-label="Remove hole" onClick={() => patch('customHoles', config.customHoles.filter(item => item.id !== hole.id))}><Icon name="trash" size={12} /></button></div>
              <div className="fields three">{(['x', 'y', 'd'] as const).map(key => <label className="field" key={key}><span>{key === 'd' ? 'Ø' : key.toUpperCase()}</span><NumberInput aria-label={key === 'd' ? 'Diameter' : key.toUpperCase()} step={(key === 'd' ? 1 : 5) / (config.units === 'mm' ? 1 : mmPerInch)} min={key === 'd' ? 0.1 / (config.units === 'mm' ? 1 : mmPerInch) : undefined} value={numberLabel(hole[key], 3)} onValue={value => updateHole(hole.id, key, String(value))} /></label>)}</div>
            </div>)}
            <button className="secondary full" onClick={addHole}><Icon name="plus" size={14} />Add hole</button>{config.customHoles.length > 0 && <p>Use the ruler in the 2D view to check the position before exporting.</p>}
          </section>
          <section className="removed-holes"><h3><Icon name="trash" size={14} />Removed Holes{config.removedHoles.length > 0 && <small>{config.removedHoles.length}</small>}</h3>
            {config.removedHoles.length ? <><ul className="removed">{config.removedHoles.map((hole, index) => <li key={typeof hole === 'string' ? hole : hole.id}>
              {typeof hole === 'string' ? <code>{hole}</code> : <><span>{partLabels[hole.part]}</span><code>{numberLabel(hole.x, 2)} : {numberLabel(hole.y, 2)}</code></>}
              <button title="Restore this hole" aria-label="Restore hole" onClick={() => patch('removedHoles', config.removedHoles.filter((_, item) => item !== index))}><Icon name="plus" size={12} /></button>
            </li>)}</ul><button className="secondary full" onClick={() => patch('removedHoles', [])}>Restore all</button><p>A removed hole disappears from every copy of that part. Coordinates are relative to the part centre.</p></> : <p>Switch on the Holes tool above the 2D drawing, then click any hole to remove it. Removed holes are listed here and can be restored.</p>}
          </section>
          <VisualizationSettings value={config} onChange={changes => setConfig(current => ({ ...current, ...changes }))} />

    </>}
    production={<ProductionEstimate summary={summary} units={config.units} sheet={{ length: config.sheetLength, width: config.sheetWidth }} error={geometryError} onSheetChange={changes => { if (changes.length !== undefined) setNumeric('sheetLength', changes.length); if (changes.width !== undefined) setNumeric('sheetWidth', changes.width) }} />}
    actions={<ProjectActions onOpen={file => void open(file)} onSave={save} onShare={() => void share()} disabled={Boolean(geometryError)} onZip={() => void downloadZip(config).catch(() => setNotice('Could not create the ZIP archive.'))} onDxf={() => downloadFull(config)} />}
    seo={<article className="seo"><div><h1>Welding Table Free Generator - DIY DXF Plans & 3D CAD</h1><p>Design a parametric welding table in your browser. Explore the 3D assembly, adjust its dimensions and joints, then export individual parts or the full layout as DXF.</p><h3>D16 and D28 Fixture Systems</h3><p>Choose a 16 mm or 28 mm fixture grid, or set a custom hole diameter, pitch and margin. Square and staggered patterns, skirt holes and grid engraving share one metric geometry model.</p><h3>Tab and Slot Construction (Interlocking Design)</h3><p>Set sheet thickness, tab width and joint clearance to plan the interlocking perimeter and support frame. Inspect the generated contours and check the fit before cutting.</p><h3>Dog-Bone Corner Reliefs</h3><p>Optional corner reliefs provide clearance for the tabs. The DXF keeps circular holes and relief arcs as native entities on separate cutting and engraving layers.</p><h3>Internal Support Frame and Ribs</h3><p>Adjust the support rib spacing and inspect the assembled or exploded table. Use the original skirt bolt pattern or generate four horizontal corner plates that interlock with both adjoining skirts and bolt to separate plain plates welded to the removable square-tube legs, and add lifting openings or coordinate-based custom holes to the relevant parts.</p><h3>Download Welding Table DXF Files</h3><p>Download individual part DXFs in a ZIP archive, export a complete layout, save the project as JSON or share its parameters with a link. Always have dimensions, tolerances and structural suitability verified before fabrication.</p></div></article>}>
    {geometryError ? <div className="three-loading socket-error" role="alert">{geometryError}</div> : view === '2d' ? <PartsLayout layout={layout} units={config.units} label="Interactive 2D welding table parts layout" resetToken={reset2dToken} getEngravings={part => { const name = readPart(part.name); return name ? engravingLines({ ...part, name }, config) : [] }} onRemoveHole={(hole, part) => removeHole(hole, readPart(part.name))} />
      : view === 'sheet' ? <TableSheetNesting config={config} dark={dark} onChange={changes => setConfig(current => ({ ...current, ...changes }))} onNotice={setNotice} />
      : <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Loading 3D assembly…</div>}><ThreeAssembly config={config} resetToken={reset3d} mountFocusToken={focusMount3d} dark={dark} /></Suspense></div><AssemblyControls value={config} onChange={changes => setConfig(current => ({ ...current, ...changes }))} onReset={() => setReset3d(value => value + 1)} onFocus={cornerPlate ? () => setFocusMount3d(value => value + 1) : undefined} /></>}
  </GeneratorShell>
}
