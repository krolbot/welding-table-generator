import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react'
import {
  defaults,
  display,
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
import { engravingLines, layoutParts, svgContourPath, totals, type Hole, type Point } from './geometry'
import { downloadFull, downloadZip } from './dxf'
import { Icon, type IconName } from './Icon'
import { NumberInput } from './NumberInput'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))

type View = '2d' | '3d'
type Tool = 'holes' | 'ruler' | null
type Measure = { start: Point; end: Point }
type NumericKey = {
  [K in keyof Config]: Config[K] extends number ? K : never
}[keyof Config]
type BooleanKey = {
  [K in keyof Config]: Config[K] extends boolean ? K : never
}[keyof Config]

const numericKeys: NumericKey[] = [
  'holeDiameter', 'pitch', 'margin', 'length', 'width', 'height', 'ribSpacing', 'thickness', 'tabWidth',
  'clearance', 'dogBoneDiameter', 'legBoltDiameter', 'legPatternX', 'legPatternY', 'legCols', 'legRows',
  'legEdgeOffset', 'legBottomOffset', 'sheetLength', 'sheetWidth', 'exploded',
]
const numericBounds: Record<NumericKey, { min: number; max: number }> = {
  holeDiameter: { min: 1, max: 50 },
  pitch: { min: 5, max: 500 },
  margin: { min: 0, max: 500 },
  length: { min: 500, max: 200 * mmPerInch },
  width: { min: 400, max: 200 * mmPerInch },
  height: { min: 50, max: 20 * mmPerInch },
  ribSpacing: { min: 200, max: 24 * mmPerInch },
  thickness: { min: 1, max: 30 },
  tabWidth: { min: 5, max: Math.floor((20 * mmPerInch - 1) / 2) - 5 },
  clearance: { min: 0, max: 2.5 },
  dogBoneDiameter: { min: 0.5, max: 5 },
  legBoltDiameter: { min: 1, max: 100 },
  legPatternX: { min: 0, max: 1000 },
  legPatternY: { min: 0, max: 1000 },
  legCols: { min: 1, max: 4 },
  legRows: { min: 1, max: 4 },
  legEdgeOffset: { min: 0, max: 1000 },
  legBottomOffset: { min: 0, max: 1000 },
  sheetLength: { min: 500, max: 6000 },
  sheetWidth: { min: 500, max: 3000 },
  exploded: { min: 0, max: 100 },
}
const booleanKeys: BooleanKey[] = [
  'skirtHoles', 'engraving', 'nameMarking', 'ribs', 'dogBones', 'legMounts', 'liftingHoles',
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
  if (value.engravingMode === 'through' || value.engravingMode === 'between') result.engravingMode = value.engravingMode
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

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied) throw new Error('Clipboard unavailable')
}

export default function App() {
  const [config, setConfig] = useState<Config>(loadedConfig)
  const [dark, setDark] = useState(() => readStorage('tableGenUI').theme === 'dark')
  const [view, setView] = useState<View>(() => readStorage('tableGenUI').viewMode === '3d' ? '3d' : '2d')
  const [tool, setTool] = useState<Tool>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [notice, setNotice] = useState('')
  const [about, setAbout] = useState(false)
  const [reset3d, setReset3d] = useState(0)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchDistance = useRef<number | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const measuring = useRef(false)
  const measureOrigin = useRef<Point | null>(null)

  const summary = useMemo(() => totals(config), [config])
  const layout = useMemo(() => layoutParts(config), [config])
  const canvasWidth = layout.width + 300
  const canvasHeight = layout.height + 300
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

  useEffect(() => {
    if (!about) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAbout(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      previousFocus.current?.focus()
    }
  }, [about])

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
      return next
    })
  }
  const numberLabel = (millimetres: number, precision = 2) => String(Number((millimetres / (config.units === 'mm' ? 1 : mmPerInch)).toFixed(config.units === 'mm' ? 4 : precision)))
  // The reference converts one-decimal metric estimates, not the full-precision geometry totals.
  const productionLabel = (value: number, conversion: number) => (config.units === 'mm' ? value : Number(value.toFixed(1)) * conversion).toFixed(1)
  const numericInput = (key: NumericKey, label: string, min: number, max: number, step: number, precision = 0) => {
    const factor = config.units === 'mm' ? 1 : mmPerInch
    const inputStep = config.units === 'mm' ? step : key === 'holeDiameter' ? 0.05 : key === 'thickness' ? 0.01 : key === 'clearance' ? 0.002 : 0.25
    return <label className="field"><span>{label}</span><NumberInput value={numberLabel(config[key], precision ? precision + 2 : 3)} min={min / factor} max={max / factor} step={inputStep} onValue={value => setNumeric(key, readDisplay(value, config.units))} /></label>
  }
  const slider = (key: NumericKey, label: string, min: number, max: number, step: number, percentage = false) => {
    const imperial = config.units === 'inch' ? inchRanges[key] : undefined
    const range = imperial ?? { min, max, step }
    return <label className="slider-field"><span>{label}<output>{percentage ? `${config[key]}%` : numberLabel(config[key], 2)}</output></span><input aria-label={label} type="range" min={range.min} max={range.max} step={range.step} value={imperial ? config[key] / mmPerInch : config[key]} onChange={event => setNumeric(key, Number(event.target.value) * (imperial ? mmPerInch : 1))} /></label>
  }
  const toggle = (key: BooleanKey, label: string) => <label className="checkbox"><input type="checkbox" checked={config[key]} onChange={event => patch(key, event.target.checked)} /><span>{label}</span></label>
  const socialLinks: Array<{ name: string; icon: IconName; url: string }> = [
    { name: 'Ballwool Store', icon: 'cart', url: 'https://ballwool.com/shops/DIYWeldingProjects' },
    { name: 'Instagram', icon: 'instagram', url: 'https://www.instagram.com/ta6urkin/' },
    { name: 'TikTok', icon: 'tiktok', url: 'https://www.tiktok.com/@ta6urkin' },
    { name: 'YouTube', icon: 'youtube', url: 'https://www.youtube.com/@ta6urkin' },
    { name: 'Pinterest', icon: 'pinterest', url: 'https://www.pinterest.com/ta6urkin/' },
    { name: 'Reddit', icon: 'reddit', url: 'https://www.reddit.com/user/taburkin/' },
  ]

  const reset2d = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setMeasure(null)
    measuring.current = false
  }
  const removeHole = (hole: Hole, part?: PartName) => {
    if (tool !== 'holes') return
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
  const save = () => {
    const blob = new Blob([JSON.stringify(projectConfig(config), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `WeldingTable_Project_${config.length}x${config.width}.json`
    anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(url))
  }
  const open = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const value: unknown = JSON.parse(String(reader.result))
        if (!isRecord(value) || !('length' in value) || !('width' in value)) throw new Error('Invalid project')
        setConfig(current => ({ ...normalizeConfig(value), units: current.units, exploded: current.exploded, showDimensions: current.showDimensions, renderHoles: current.renderHoles, highlighting: current.highlighting }))
        reset2d()
        setNotice('Project loaded.')
      } catch {
        setNotice('Could not read this project JSON.')
      }
    }
    reader.onerror = () => setNotice('Could not read this project JSON.')
    reader.readAsText(file)
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

  const drawingPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const screen = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return {
      x: (screen.x - canvasWidth / 2 - pan.x) / zoom,
      y: -(screen.y - canvasHeight / 2 - pan.y) / zoom,
    }
  }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) { measuring.current = false; return }
    if (tool === 'ruler') {
      const point = drawingPoint(event)
      if (measuring.current && measure) {
        setMeasure({ ...measure, end: point })
        measuring.current = false
      } else {
        setMeasure({ start: point, end: point })
        measuring.current = true
      }
      measureOrigin.current = { x: event.clientX, y: event.clientY }
    } else setDrag({ x: event.clientX, y: event.clientY })
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (previous) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const active = [...pointers.current.values()]
    if (active.length === 2) {
      const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y)
      if (pinchDistance.current) setZoom(current => Math.max(0.1, Math.min(20, current * distance / pinchDistance.current!)))
      pinchDistance.current = distance
      return
    }
    pinchDistance.current = null
    if (tool === 'ruler' && measuring.current) {
      const end = drawingPoint(event)
      setMeasure(current => current ? { ...current, end } : current)
      return
    }
    const matrix = svgRef.current?.getScreenCTM()
    if (drag && previous && matrix) {
      setPan(current => ({ x: current.x + (event.clientX - previous.x) / matrix.a, y: current.y + (event.clientY - previous.y) / matrix.d }))
    }
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchDistance.current = null
    if (tool === 'ruler' && measureOrigin.current && Math.hypot(event.clientX - measureOrigin.current.x, event.clientY - measureOrigin.current.y) > 4) measuring.current = false
    measureOrigin.current = null
    setDrag(null)
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || view !== '2d') return
    const wheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const next = Math.max(0.1, Math.min(20, zoom * Math.exp(-event.deltaY * 0.001)))
      const ratio = next / zoom
      setPan(current => ({
        x: point.x - canvasWidth / 2 - (point.x - canvasWidth / 2 - current.x) * ratio,
        y: point.y - canvasHeight / 2 - (point.y - canvasHeight / 2 - current.y) * ratio,
      }))
      setZoom(next)
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [view, zoom, canvasWidth, canvasHeight])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const measureLength = measure
    ? Math.hypot(measure.end.x - measure.start.x, measure.end.y - measure.start.y)
    : 0
  const displayedLayoutWidth = display(layout.width, config.units, 0)
  const displayedLayoutHeight = display(layout.height, config.units, 0)

  return (
    <main className="app-shell">
      <aside className="settings">
        <header>
          <div className="brand"><Icon name="settings" size={24} /><h2>Welding Table Free Generator</h2></div>
          <button className="icon" title={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-label="Toggle color theme" onClick={() => setDark(value => !value)}><Icon name={dark ? 'sun' : 'moon'} /></button>
        </header>
        <div className="units"><h3>Units</h3><div className="segment">{(['mm', 'inch'] as const).map(unit => <button key={unit} className={config.units === unit ? 'active' : ''} onClick={() => patch('units', unit)}>{unit}</button>)}</div></div>
        <div className="settings-scroll">
          <section className="fixture-card">
            <h3>Fixture System</h3>
            <div className="preset">{(['D16', 'D28', 'Custom'] as const).map(preset => <button key={preset} className={config.preset === preset ? 'active' : ''} onClick={() => setPreset(preset)}>{preset === 'Custom' && <Icon name="target" size={14} />}{preset}</button>)}</div>
            <div className="fields three">{numericInput('holeDiameter', 'Hole Ø', 1, 50, 1)}{numericInput('pitch', 'Pitch', 5, 500, 5)}{numericInput('margin', 'Margin', 0, 500, 5)}</div>
            <p className="grid-summary">Grid: Ø{numberLabel(config.holeDiameter, 3)} / {numberLabel(config.pitch, 3)} {unitLabel} pitch / {numberLabel(config.margin, 3)} {unitLabel} from edge</p>
            <div className="hole-pattern"><span>Hole Pattern</span><div className="grid-buttons"><button className={config.grid === 'square' ? 'active' : ''} onClick={() => patch('grid', 'square')}>Square grid</button><button className={config.grid === 'staggered' ? 'active' : ''} onClick={() => patch('grid', 'staggered')}>Staggered</button></div>{config.grid === 'staggered' && <p>Rows are offset by half a pitch. Grid engraving draws rows only — columns no longer line up.</p>}</div>
            <div className="fixture-options">{toggle('skirtHoles', 'Skirt Holes')}{toggle('engraving', 'Grid Engraving')}
              {config.engraving && <div className="engraving-options"><span>Engraving layout</span><div className="grid-buttons"><button title="Lines run through the hole centres" className={config.engravingMode === 'through' ? 'active' : ''} onClick={() => patch('engravingMode', 'through')}>Through holes</button><button title="Lines run between the holes, forming cells" className={config.engravingMode === 'between' ? 'active' : ''} onClick={() => patch('engravingMode', 'between')}>Between (cells)</button></div></div>}
              {toggle('nameMarking', 'Part Name Marking')}
            </div>
          </section>
          <section><h3>Dimensions ({unitLabel})</h3>
            {slider('length', 'Length (L)', 500, 5000, 50)}
            {slider('width', 'Width (W)', 400, 5000, 50)}
            {slider('height', 'Table Height (H)', 50, 500, 10)}
          </section>
          <section><h3><Icon name="frame" size={14} />Internal Frame</h3>{toggle('ribs', 'Generate Support Ribs')}
            {config.ribs && <div className="indented">{slider('ribSpacing', `Rib Spacing (${unitLabel})`, 200, 600, 50)}</div>}
          </section>
          <section><h3><Icon name="frame" size={14} />Tabs & Slots (Joints)</h3>
            <div className="joint-fields">
              {numericInput('thickness', `Metal Thickness (${unitLabel})`, 1, 30, 1)}
              {numericInput('tabWidth', `Tab Width (${unitLabel})`, 5, maxTabWidth(config), 5)}
              <div className="joint-clearance">{numericInput('clearance', `Joint Clearance (${unitLabel})`, 0, 2.5, 0.05, 2)}<p className="clearance-note">Max {numberLabel(2.5, 4)} {unitLabel}</p></div>
              <div className="relief-options">{toggle('dogBones', 'Dog-bone Reliefs')}
                {config.dogBones && <div className="indented relief-control">{slider('dogBoneDiameter', `Diameter (${unitLabel})`, 0.5, 5, 0.5)}</div>}
              </div>
            </div>
          </section>
          <section className="ergonomics"><h3><Icon name="settings" size={14} />Ergonomics (Construction)</h3>
            {toggle('legMounts', 'Leg Mount Holes')}
            {config.legMounts && <div className="leg-options">
              <div className="fields"><label className="field"><span>Bolt size (M)</span><NumberInput value={numberLabel(config.legBoltDiameter, 2)} min={1 / (config.units === 'mm' ? 1 : mmPerInch)} max={100 / (config.units === 'mm' ? 1 : mmPerInch)} step={config.units === 'mm' ? 1 : 0.0625} onValue={value => setNumeric('legBoltDiameter', readDisplay(value, config.units))} /></label><label className="field"><span>Hole Ø (auto)</span><output>{numberLabel(config.legBoltDiameter + 1.5, 3)} {unitLabel}</output></label></div>
              <div className="fields">{numericInput('legPatternX', 'Pattern X', config.legBoltDiameter * 1.5, 1000, 5)}{numericInput('legPatternY', 'Pattern Y', config.legBoltDiameter * 1.5, 1000, 5)}</div>
              <div className="fields">{(['legCols', 'legRows'] as const).map((key, index) => <label className="field" key={key}><span>{index ? 'Rows' : 'Holes per row'}</span><select value={config[key]} onChange={event => setNumeric(key, Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
              <div className="fields">{numericInput('legEdgeOffset', 'From edge', 0, 1000, 5)}{numericInput('legBottomOffset', 'From bottom', 0, 1000, 5)}</div>
              <p>{config.legCols * config.legRows} holes per corner, both ends of every skirt. Minimum spacing for M{config.legBoltDiameter}: {numberLabel(config.legBoltDiameter * 1.5, 2)} {unitLabel}.</p>
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
          <section><h3><Icon name="trash" size={14} />Removed Holes{config.removedHoles.length > 0 && <small>{config.removedHoles.length}</small>}</h3>
            {config.removedHoles.length ? <><ul className="removed">{config.removedHoles.map((hole, index) => <li key={typeof hole === 'string' ? hole : hole.id}>
              {typeof hole === 'string' ? <code>{hole}</code> : <><span>{partLabels[hole.part]}</span><code>{numberLabel(hole.x, 2)} : {numberLabel(hole.y, 2)}</code></>}
              <button title="Restore this hole" aria-label="Restore hole" onClick={() => patch('removedHoles', config.removedHoles.filter((_, item) => item !== index))}><Icon name="plus" size={12} /></button>
            </li>)}</ul><button className="secondary full" onClick={() => patch('removedHoles', [])}>Restore all</button><p>A removed hole disappears from every copy of that part. Coordinates are relative to the part centre.</p></> : <p>Switch on the Holes tool above the 2D drawing, then click any hole to remove it. Removed holes are listed here and can be restored.</p>}
          </section>
          <section><h3><Icon name="box" size={14} />3D Visualization</h3>{slider('exploded', 'Exploded View', 0, 100, 1, true)}{toggle('showDimensions', 'Show Dimensions')}</section>
        </div>
        <section className="production-card"><h3><Icon name="frame" size={16} />Production Estimate</h3>
          <div className="estimate"><div><span>Estimated Weight</span><strong>{productionLabel(summary.kg, 2.20462)}<small>{config.units === 'mm' ? 'kg' : 'lb'}</small></strong></div><div><span>Cut Length</span><strong>{productionLabel(summary.cut, 3.28084)}<small>{config.units === 'mm' ? 'm' : 'ft'}</small></strong></div></div>
          <div className="estimate-extra"><span>Holes: {summary.holes}</span>{summary.engraving > 0 && <span>Engraving: {productionLabel(summary.engraving, 3.28084)}{config.units === 'mm' ? 'm' : 'ft'}</span>}</div>
          <div className="sheet-size"><span>Sheet size ({unitLabel})</span><div><NumberInput aria-label="Sheet length" value={numberLabel(config.sheetLength, 3)} min={1} step={50 / (config.units === 'mm' ? 1 : mmPerInch)} onValue={value => setNumeric('sheetLength', readDisplay(value, config.units))} /><span>×</span><NumberInput aria-label="Sheet width" value={numberLabel(config.sheetWidth, 3)} min={1} step={50 / (config.units === 'mm' ? 1 : mmPerInch)} onValue={value => setNumeric('sheetWidth', readDisplay(value, config.units))} /></div><p className={summary.fit ? 'fit' : 'no-fit'}>{summary.fit ? '✓ All parts fit the sheet' : '⚠ Some parts do not fit the sheet'}</p></div>
        </section>
        <section className="exports"><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={open} /><div><button className="secondary" title="Open Project (.json)" onClick={() => fileInput.current?.click()}>Open</button><button className="secondary" title="Save Project (.json)" onClick={save}>Save</button></div><button className="secondary full" onClick={() => void share()}>Share Link</button><button className="zip" onClick={() => void downloadZip(config).catch(() => setNotice('Could not create the ZIP archive.'))}>Download ZIP (Parts)</button><button className="dxf" onClick={() => downloadFull(config)}>Full Layout DXF</button></section>
      </aside>
      <section className="work-area" data-view={view}>
        <div className="mode"><button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}><Icon name="frame" />2D Layout</button><button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><Icon name="box" />3D Assembly</button></div>
        {view === '2d' ? <>
          <div className="drawing-frame" data-tool={tool ?? 'pan'}>
            <div className="drawing-grid" style={{ backgroundSize: `${50 * zoom}px ${50 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }} />
            <svg
            ref={svgRef}
            className="layout"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}

            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            aria-label="Interactive 2D welding table parts layout"
          >

            <g transform={`translate(${canvasWidth / 2 + pan.x} ${canvasHeight / 2 + pan.y}) scale(${zoom})`}>
              {layout.instances.map(item => {
                const engravings = engravingLines(item.part, config)
                return (
                  <g key={`${item.part.name}:${item.instance}`} transform={`translate(${item.position.x - layout.width / 2} ${layout.height / 2 - item.position.y}) scale(1 -1)`} className="part">
                    <path className="contour" d={svgContourPath(item.part.contours[0])} />
                    {engravings.map((mark, index) => <line key={index} className="engrave" x1={mark.from.x} y1={mark.from.y} x2={mark.to.x} y2={mark.to.y} />)}
                    {item.part.contours.slice(1).map((contour, index) => <path className="slot-contour" key={index} d={svgContourPath(contour)} />)}
                    {item.part.holes.map(hole => (
                      <circle
                        key={hole.id}
                        className="hole"
                        onPointerDown={event => {
                          if (tool === 'holes') {
                            event.stopPropagation()
                            removeHole(hole, item.part.name)
                          }
                        }}
                        cx={hole.x}
                        cy={hole.y}
                        r={hole.d / 2}
                      />
                    ))}
                  </g>
                )
              })}
              {measure && (
                <g className="measurement">
                  <line x1={measure.start.x} y1={-measure.start.y} x2={measure.end.x} y2={-measure.end.y} />
                  <circle cx={measure.start.x} cy={-measure.start.y} r="10" />
                  <circle cx={measure.end.x} cy={-measure.end.y} r="10" />
                  <text x={(measure.start.x + measure.end.x) / 2 + 20} y={-(measure.start.y + measure.end.y) / 2 - 20}>
                    {display(measureLength, config.units, 1)} {unitLabel}
                  </text>
                </g>
              )}
            </g>
          </svg>
          </div>
          <div className="drawing-toolbar"><div className="laser-note"><Icon name="info" /><div><strong>File for Laser Cutting</strong><small>On DXF export, reliefs (dog-bones) are created as native <b>DXF ARC</b>, and grid holes as <b>DXF CIRCLE</b>.</small></div></div><div className="canvas-tools"><button aria-label="Holes" className={tool === 'holes' ? 'active holes-tool' : 'holes-tool'} onClick={() => { setTool(current => current === 'holes' ? null : 'holes'); measuring.current = false }}><Icon name="trash" /><span className="tool-label">Holes</span></button><button aria-label="Ruler" className={tool === 'ruler' ? 'active ruler-tool' : 'ruler-tool'} onClick={() => { setTool(current => current === 'ruler' ? null : 'ruler'); setMeasure(null); measuring.current = false }}><Icon name="ruler" /><span className="tool-label">Ruler</span></button><button title="Reset Zoom (Center)" onClick={reset2d}><Icon name="maximize" />{displayedLayoutWidth} x {displayedLayoutHeight} {unitLabel}</button></div></div>
        </> : <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Loading 3D assembly…</div>}><ThreeAssembly config={config} resetToken={reset3d} dark={dark} /></Suspense></div><div className="three-tools"><header><h3><Icon name="layers" size={16} />Interactive 3D Assembly</h3><button title="Reset camera to the default view" onClick={() => setReset3d(value => value + 1)}><Icon name="maximize" size={12} />Reset view</button></header>{toggle('renderHoles', 'Render Holes (affects FPS)')}{toggle('highlighting', 'Interactive Part Highlighting')}</div></>}
        <nav className="social" aria-label="Original project links"><strong>DIY WELDING PROJECTS</strong><div>{socialLinks.map(link => <a key={link.name} title={link.name} aria-label={link.name} href={link.url} target="_blank" rel="noopener noreferrer"><Icon name={link.icon} size={18} /></a>)}</div></nav>
        <div className="legal-disclosure">{about && <article id="about-panel" className="legal-panel" aria-labelledby="about-title"><header><h3 id="about-title">About & Legal Info</h3><button ref={closeButton} className="icon" aria-label="Close About and Legal Info" onClick={() => setAbout(false)}><Icon name="close" /></button></header><small>VERSION 1.0.0</small><p>This independent clean-room implementation preserves the public generator's workflow. It is not affiliated with or endorsed by the original author.</p><p>Models, layouts and DXF files are informational only. Confirm dimensions, kerf tolerances and structural integrity with a qualified professional before CNC or laser cutting.</p><a href="https://welding-table-generator.com/" target="_blank" rel="noopener noreferrer">Original project ↗</a></article>}<button className="legal-link" aria-expanded={about} aria-controls="about-panel" onClick={() => setAbout(value => !value)}>About & Legal Info<Icon name="chevron" size={14} style={{ transform: about ? 'rotate(180deg)' : undefined }} /></button></div>
        {notice && <output className="notice" aria-live="polite" onClick={() => setNotice('')}>{notice}</output>}
      </section>
      <article className="seo"><div><h1>Welding Table Free Generator - DIY DXF Plans & 3D CAD</h1><p>Design a parametric welding table in your browser. Explore the 3D assembly, adjust its dimensions and joints, then export individual parts or the full layout as DXF.</p><h3>D16 and D28 Fixture Systems</h3><p>Choose a 16 mm or 28 mm fixture grid, or set a custom hole diameter, pitch and margin. Square and staggered patterns, skirt holes and grid engraving share one metric geometry model.</p><h3>Tab and Slot Construction (Interlocking Design)</h3><p>Set sheet thickness, tab width and joint clearance to plan the interlocking perimeter and support frame. Inspect the generated contours and check the fit before cutting.</p><h3>Dog-Bone Corner Reliefs</h3><p>Optional corner reliefs provide clearance for the tabs. The DXF keeps circular holes and relief arcs as native entities on separate cutting and engraving layers.</p><h3>Internal Support Frame and Ribs</h3><p>Adjust the support rib spacing and inspect the assembled or exploded table. Add leg mounting patterns, lifting openings or coordinate-based custom holes to the relevant parts.</p><h3>Download Welding Table DXF Files</h3><p>Download individual part DXFs in a ZIP archive, export a complete layout, save the project as JSON or share its parameters with a link. Always have dimensions, tolerances and structural suitability verified before fabrication.</p></div></article>
    </main>
  )
}
