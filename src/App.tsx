import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import {
  defaults,
  display,
  mmPerInch,
  partLabels,
  presetValues,
  readDisplay,
  type Config,
  type CustomHole,
  type PartName,
} from './model'
import { engravingLines, layoutParts, outline, totals, type Hole, type Point } from './geometry'
import { downloadFull, downloadZip } from './dxf'

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
  length: { min: 500, max: 5000 },
  width: { min: 400, max: 5000 },
  height: { min: 50, max: 500 },
  ribSpacing: { min: 200, max: 600 },
  thickness: { min: 1, max: 30 },
  tabWidth: { min: 5, max: 150 },
  clearance: { min: 0, max: 2.5 },
  dogBoneDiameter: { min: 0.5, max: 5 },
  legBoltDiameter: { min: 1, max: 100 },
  legPatternX: { min: 0, max: 1000 },
  legPatternY: { min: 0, max: 1000 },
  legCols: { min: 1, max: 10 },
  legRows: { min: 1, max: 10 },
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
const partNames = Object.keys(partLabels) as PartName[]
const clampNumeric = (key: NumericKey, value: number) => {
  const bounds = numericBounds[key]
  return Math.max(bounds.min, Math.min(bounds.max, value))
}
const visibleHoles = (holes: Hole[]) => {
  const stride = Math.ceil(holes.length / 6000)
  return stride <= 1 ? holes : holes.filter((_, index) => index % stride === 0)
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isPart = (value: unknown): value is PartName => typeof value === 'string' && value in partLabels
const parseCustomHoles = (value: unknown): CustomHole[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !isPart(item.part)) return []
    const x = Number(item.x)
    const y = Number(item.y)
    const d = Number(item.d)
    return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(d) && d > 0
      ? [{ id: item.id, part: item.part, x, y, d }]
      : []
  })
}

function normalizeConfig(value: unknown): Config {
  if (!isRecord(value)) return { ...defaults }
  const result: Config = { ...defaults }
  for (const key of numericKeys) {
    const candidate = Number(value[key])
    if (Number.isFinite(candidate)) result[key] = clampNumeric(key, candidate)
  }
  for (const key of booleanKeys) {
    if (typeof value[key] === 'boolean') result[key] = value[key]
  }
  if (value.units === 'mm' || value.units === 'inch') result.units = value.units
  if (value.preset === 'D16' || value.preset === 'D28' || value.preset === 'Custom') result.preset = value.preset
  if (value.grid === 'square' || value.grid === 'staggered') result.grid = value.grid
  if (value.engravingMode === 'through' || value.engravingMode === 'between') result.engravingMode = value.engravingMode
  result.customHoles = parseCustomHoles(value.customHoles)
  result.removedHoles = Array.isArray(value.removedHoles)
    ? value.removedHoles.filter((item): item is string => typeof item === 'string')
    : []
  result.legCols = Math.max(1, Math.round(result.legCols))
  result.legRows = Math.max(1, Math.round(result.legRows))
  result.exploded = Math.max(0, Math.min(100, result.exploded))
  return result
}

function loadedConfig(): Config {
  const params = new URLSearchParams(location.search)
  const legacy = params.get('state')
  if (legacy) {
    try {
      return normalizeConfig(JSON.parse(legacy))
    } catch {
      return { ...defaults }
    }
  }
  if (!params.size) return { ...defaults }
  const candidate: Record<string, unknown> = {}
  for (const key of numericKeys) {
    const value = params.get(key)
    if (value !== null) candidate[key] = Number(value)
  }
  for (const key of booleanKeys) {
    const value = params.get(key)
    if (value !== null) candidate[key] = value === 'true'
  }
  for (const key of ['units', 'preset', 'grid', 'engravingMode'] as const) {
    const value = params.get(key)
    if (value !== null) candidate[key] = value
  }
  for (const key of ['customHoles', 'removedHoles'] as const) {
    const value = params.get(key)
    if (value === null) continue
    try {
      candidate[key] = JSON.parse(value)
    } catch {
      candidate[key] = []
    }
  }
  return normalizeConfig(candidate)
}

const serialiseConfig = (config: Config) => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(config)) {
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
  const [dark, setDark] = useState(false)
  const [view, setView] = useState<View>('2d')
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

  const summary = useMemo(() => totals(config), [config])
  const layout = useMemo(() => layoutParts(config), [config])
  const canvasWidth = Math.max(2600, layout.width + 800)
  const canvasHeight = layout.height + 600
  const unitLabel = config.units === 'mm' ? 'mm' : 'in'

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

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
    setConfig(current => ({
      ...current,
      [key]: clampNumeric(key, value),
      ...(key === 'holeDiameter' || key === 'pitch' || key === 'margin' ? { preset: 'Custom' as const } : {}),
    }))
  }
  const numericInput = (
    key: NumericKey,
    label: string,
    min: number,
    max: number,
    step: number,
    precision = 0,
    inch?: { min: number; max: number; step: number },
  ) => {
    const converted = config.units === 'inch' && inch
      ? inch
      : {
          min: min / (config.units === 'mm' ? 1 : mmPerInch),
          max: max / (config.units === 'mm' ? 1 : mmPerInch),
          step: step / (config.units === 'mm' ? 1 : mmPerInch),
        }
    return (
      <label className="field">
        <span>{label}</span>
        <div>
          <input
            type="number"
            value={display(config[key], config.units, precision)}
            min={converted.min}
            max={converted.max}
            step={converted.step}
            onChange={event => setNumeric(key, readDisplay(Number(event.target.value), config.units))}
          />
          <em>{unitLabel}</em>
        </div>
      </label>
    )
  }
  const toggle = (key: BooleanKey, label: string) => (
    <label className="switch">
      <input type="checkbox" checked={config[key]} onChange={event => patch(key, event.target.checked)} />
      <span aria-hidden="true" />
      {label}
    </label>
  )

  const reset2d = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setMeasure(null)
  }
  const removeHole = (hole: Hole) => {
    if (tool !== 'holes' || config.removedHoles.includes(hole.id)) return
    patch('removedHoles', [...config.removedHoles, hole.id])
    setNotice('Hole removed. Restore it from the Removed Holes list.')
  }
  const addHole = () => {
    patch('customHoles', [...config.customHoles, { id: crypto.randomUUID(), part: 'top', x: 0, y: 0, d: 10 }])
  }
  const updateHole = (id: string, key: keyof Omit<CustomHole, 'id'>, value: string) => {
    patch('customHoles', config.customHoles.map(hole => {
      if (hole.id !== id) return hole
      if (key === 'part') return isPart(value) ? { ...hole, part: value } : hole
      const number = Number(value)
      return Number.isFinite(number) ? { ...hole, [key]: readDisplay(number, config.units) } : hole
    }))
  }
  const save = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `WeldingTable_${config.length}x${config.width}.json`
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
        setConfig(normalizeConfig(JSON.parse(String(reader.result))))
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
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'ruler') {
      const start = drawingPoint(event)
      setMeasure({ start, end: start })
    } else {
      setDrag({ x: event.clientX, y: event.clientY })
    }
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const active = [...pointers.current.values()]
    if (active.length === 2) {
      const distance = Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y)
      if (pinchDistance.current && pinchDistance.current > 0) {
        setZoom(current => Math.max(0.2, Math.min(4, current * distance / pinchDistance.current!)))
      }
      pinchDistance.current = distance
      return
    }
    pinchDistance.current = null
    if (tool === 'ruler' && measure) {
      setMeasure(current => current ? { ...current, end: drawingPoint(event) } : current)
      return
    }
    if (drag && previous && svgRef.current) {
      const factorX = canvasWidth / svgRef.current.clientWidth / zoom
      const factorY = canvasHeight / svgRef.current.clientHeight / zoom
      setPan(current => ({
        x: current.x + (event.clientX - previous.x) * factorX,
        y: current.y + (event.clientY - previous.y) * factorY,
      }))
    }
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchDistance.current = null
    setDrag(null)
  }
  const wheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    setZoom(current => Math.max(0.2, Math.min(4, current * (event.deltaY > 0 ? 0.86 : 1.16))))
  }

  const measureLength = measure
    ? Math.hypot(measure.end.x - measure.start.x, measure.end.y - measure.start.y)
    : 0
  const displayedLayoutWidth = display(layout.width, config.units, 0)
  const displayedLayoutHeight = display(layout.height, config.units, 0)

  return (
    <main className="app-shell">
      <aside className="settings">
        <header>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">⌁</span>
            <h1>Welding Table<br />Free Generator</h1>
          </div>
          <button
            className="icon"
            title={`Switch to ${dark ? 'light' : 'dark'} theme`}
            aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
            onClick={() => setDark(value => !value)}
          >
            {dark ? '☀' : '☾'}
          </button>
        </header>
        <div className="settings-scroll">
          <section>
            <h2>Units</h2>
            <div className="segment">
              <button className={config.units === 'mm' ? 'active' : ''} onClick={() => patch('units', 'mm')}>mm</button>
              <button className={config.units === 'inch' ? 'active' : ''} onClick={() => patch('units', 'inch')}>inch</button>
            </div>
          </section>

          <section>
            <h2>Fixture system</h2>
            <div className="preset">
              <button className={config.preset === 'D16' ? 'active' : ''} onClick={() => setPreset('D16')}>D16</button>
              <button className={config.preset === 'D28' ? 'active' : ''} onClick={() => setPreset('D28')}>D28</button>
              <button className={config.preset === 'Custom' ? 'active' : ''} onClick={() => setPreset('Custom')}>Custom</button>
            </div>
            <div className="fields three">
              {numericInput('holeDiameter', 'Hole Ø', 1, 50, 1)}
              {numericInput('pitch', 'Pitch', 5, 500, 5)}
              {numericInput('margin', 'Margin', 0, 500, 5)}
            </div>
            <p className="grid-summary">Grid: Ø{display(config.holeDiameter, config.units, 0)} / {display(config.pitch, config.units, 0)} {unitLabel} pitch / {display(config.margin, config.units, 0)} {unitLabel} from edge</p>
            <h3>Hole pattern</h3>
            <div className="grid-buttons">
              <button className={config.grid === 'square' ? 'active' : ''} onClick={() => patch('grid', 'square')}>Square grid</button>
              <button className={config.grid === 'staggered' ? 'active' : ''} onClick={() => patch('grid', 'staggered')}>Staggered</button>
            </div>
            {toggle('skirtHoles', 'Skirt Holes')}
          </section>

          <section>
            <h2>Grid engraving</h2>
            {toggle('engraving', 'Grid Engraving')}
            <h3>Engraving layout</h3>
            <div className="inline-options">
              <label><input type="radio" checked={config.engravingMode === 'through'} onChange={() => patch('engravingMode', 'through')} /> Through holes</label>
              <label><input type="radio" checked={config.engravingMode === 'between'} onChange={() => patch('engravingMode', 'between')} /> Between (cells)</label>
            </div>
            {toggle('nameMarking', 'Part Name Marking')}
          </section>

          <section>
            <h2>Dimensions ({unitLabel})</h2>
            <div className="fields">
              {numericInput('length', 'Length', 500, 5000, 50, 0, { min: 20, max: 200, step: 1 })}
              {numericInput('width', 'Width', 400, 5000, 50, 0, { min: 16, max: 200, step: 1 })}
              {numericInput('height', 'Table Height', 50, 500, 10, 0, { min: 2, max: 20, step: 0.5 })}
            </div>
          </section>

          <section>
            <h2>Internal frame</h2>
            {toggle('ribs', 'Generate Support Ribs')}
            {config.ribs && (
              <div className="fields">
                {numericInput('ribSpacing', 'Rib Spacing', 200, 600, 50, 0, { min: 8, max: 24, step: 1 })}
              </div>
            )}
          </section>

          <section>
            <h2>Tabs & slots</h2>
            <div className="fields three">
              {numericInput('thickness', 'Metal Thickness', 1, 30, 1)}
              {numericInput('tabWidth', 'Tab Width', 5, 150, 5)}
              {numericInput('clearance', 'Joint Clearance', 0, 2.5, 0.05, 2)}
            </div>
            <p>Joint clearance: Max 2.5 mm</p>
            {toggle('dogBones', 'Dog-bone Reliefs')}
            {config.dogBones && numericInput('dogBoneDiameter', 'Dog-bone Diameter', 0.5, 5, 0.5, 1)}
          </section>

          <section>
            <h2>Construction options</h2>
            {toggle('legMounts', 'Leg Mount Holes')}
            {toggle('liftingHoles', 'Lifting Holes')}
          </section>

          <section>
            <h2>Custom holes</h2>
            <p>X and Y use the centre of the selected part. Each hole is added to every copy.</p>
            {config.customHoles.map(hole => (
              <div className="hole-row" key={hole.id}>
                <select aria-label="Part" value={hole.part} onChange={event => updateHole(hole.id, 'part', event.target.value)}>
                  {partNames.map(name => <option key={name} value={name}>{partLabels[name]}</option>)}
                </select>
                <input aria-label="X" type="number" step="any" value={display(hole.x, config.units, 2)} onChange={event => updateHole(hole.id, 'x', event.target.value)} />
                <input aria-label="Y" type="number" step="any" value={display(hole.y, config.units, 2)} onChange={event => updateHole(hole.id, 'y', event.target.value)} />
                <input aria-label="Diameter" type="number" min={display(0.1, config.units, 2)} step="any" value={display(hole.d, config.units, 2)} onChange={event => updateHole(hole.id, 'd', event.target.value)} />
                <button aria-label={`Remove custom hole from ${partLabels[hole.part]}`} onClick={() => patch('customHoles', config.customHoles.filter(item => item.id !== hole.id))}>×</button>
              </div>
            ))}
            <button className="secondary" onClick={addHole}>+ Add hole</button>
            <p>Use the 2D ruler to check the position before export.</p>
          </section>

          <section>
            <h2>Removed holes</h2>
            {config.removedHoles.length ? (
              <ul className="removed">
                {config.removedHoles.map(id => (
                  <li key={id}>
                    <code>{id}</code>
                    <button onClick={() => patch('removedHoles', config.removedHoles.filter(item => item !== id))}>Restore</button>
                  </li>
                ))}
              </ul>
            ) : <p>No holes removed. Enable the Holes tool and click a hole in the layout.</p>}
          </section>

          <section>
            <h2>3D visualization</h2>
            <label className="field">
              <span>Exploded View</span>
              <div>
                <input type="number" min="0" max="100" step="1" value={config.exploded} onChange={event => patch('exploded', Number(event.target.value))} />
                <em>%</em>
              </div>
            </label>
            {toggle('showDimensions', 'Show Dimensions')}
            {toggle('renderHoles', 'Render Holes (affects FPS)')}
            {toggle('highlighting', 'Interactive Part Highlighting')}
          </section>

          <section>
            <h2>Sheet size</h2>
            <div className="fields">
              {numericInput('sheetLength', 'Sheet length', 500, 6000, 50)}
              {numericInput('sheetWidth', 'Sheet width', 500, 3000, 50)}
            </div>
            <p className={summary.fit ? 'fit' : 'no-fit'}>{summary.fit ? '✓ All parts fit the sheet' : '! Some parts do not fit the sheet'}</p>
          </section>

          <section>
            <h2>Production estimate</h2>
            <div className="estimate">
              <b>{config.units === 'mm' ? summary.kg.toFixed(1) : (summary.kg * 2.20462).toFixed(1)} {config.units === 'mm' ? 'kg' : 'lb'}</b><span>Estimated Weight</span>
              <b>{config.units === 'mm' ? summary.cut.toFixed(1) : (summary.cut * 3.28084).toFixed(1)} {config.units === 'mm' ? 'm' : 'ft'}</b><span>Cut Length</span>
              <b>{summary.holes}</b><span>Holes</span>
              <b>{config.units === 'mm' ? summary.engraving.toFixed(1) : (summary.engraving * 3.28084).toFixed(1)} {config.units === 'mm' ? 'm' : 'ft'}</b><span>Engraving</span>
            </div>
          </section>

          <section className="exports">
            <h2>Project & output</h2>
            <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={open} />
            <button className="secondary" title="Open Project (.json)" onClick={() => fileInput.current?.click()}>Open</button>
            <button className="secondary" title="Save Project (.json)" onClick={save}>Save</button>
            <button className="secondary" onClick={() => void share()}>Share Link</button>
            <button onClick={() => void downloadZip(config)}>Download ZIP (Parts)</button>
            <button onClick={() => downloadFull(config)}>Full Layout DXF</button>
          </section>
        </div>
      </aside>

      <section className="work-area">
        <div className="mode">
          <button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}>2D Layout</button>
          <button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}>3D Assembly</button>
        </div>

        {view === '2d' ? (
          <svg
            ref={svgRef}
            className="layout"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            onWheel={wheel}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            aria-label="Interactive 2D welding table parts layout"
          >
            <defs>
              <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="currentColor" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" className="paper" />
            <g transform={`translate(${canvasWidth / 2 + pan.x} ${canvasHeight / 2 + pan.y}) scale(${zoom})`}>
              {layout.instances.map(item => {
                const contour = outline(item.part, config).map(point => `${point.x},${-point.y}`).join(' ')
                const engravings = engravingLines(item.part, config)
                return (
                  <g key={`${item.part.name}:${item.instance}`} transform={`translate(${item.position.x} ${-item.position.y})`} className="part">
                    <polygon points={contour} />
                    {item.part.slots.map((slot, index) => (
                      <g key={`slot:${index}`}>
                        <rect className="slot" x={slot.x - slot.width / 2} y={-slot.y - slot.height / 2} width={slot.width} height={slot.height} />
                        {config.dogBones && [
                          [slot.x - slot.width / 2, -slot.y - slot.height / 2],
                          [slot.x + slot.width / 2, -slot.y - slot.height / 2],
                          [slot.x + slot.width / 2, -slot.y + slot.height / 2],
                          [slot.x - slot.width / 2, -slot.y + slot.height / 2],
                        ].map(([x, y], corner) => <circle key={corner} className="dogbone" cx={x} cy={y} r={config.dogBoneDiameter / 2} />)}
                      </g>
                    ))}
                    {visibleHoles(item.part.holes).map(hole => (
                      <circle
                        key={hole.id}
                        className="hole"
                        onPointerDown={event => {
                          event.stopPropagation()
                          removeHole(hole)
                        }}
                        cx={hole.x}
                        cy={-hole.y}
                        r={hole.d / 2}
                      />
                    ))}
                    {engravings.map((mark, index) => (
                      <line key={index} className="engrave" x1={mark.from.x} y1={-mark.from.y} x2={mark.to.x} y2={-mark.to.y} />
                    ))}
                    <text x="0" y={-item.part.height / 2 - 22}>{item.part.label} {item.part.count > 1 ? `${item.instance + 1}/${item.part.count}` : ''}</text>
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
        ) : (
          <Suspense fallback={<div className="three-loading">Loading 3D assembly…</div>}>
            <ThreeAssembly config={config} resetToken={reset3d} dark={dark} />
          </Suspense>
        )}

        <div className="canvas-tools">
          <button className={tool === 'holes' ? 'active holes-tool' : 'holes-tool'} onClick={() => setTool(current => current === 'holes' ? null : 'holes')}>◉ Holes</button>
          <button className={tool === 'ruler' ? 'active ruler-tool' : 'ruler-tool'} onClick={() => setTool(current => current === 'ruler' ? null : 'ruler')}>⌖ Ruler</button>
          <button title={view === '2d' ? 'Reset Zoom (Center)' : 'Reset view'} onClick={view === '2d' ? reset2d : () => setReset3d(value => value + 1)}>
            {view === '2d' ? `${displayedLayoutWidth} × ${displayedLayoutHeight} ${unitLabel}` : 'Reset view'}
          </button>
        </div>

        <div className="laser-note">
          <span className="laser-icon" aria-hidden="true">⌁</span>
          <span><strong>File for Laser Cutting</strong><small>Dog-bones export as DXF ARC; grid holes as DXF CIRCLE.</small></span>
        </div>
        <nav className="social" aria-label="Original project links">
          <strong>DIY WELDING PROJECTS</strong>
          <span>
            <a href="https://ballwool.com/shops/DIYWeldingProjects" target="_blank" rel="noopener noreferrer" aria-label="Original project Shop">S</a>
            <a href="https://www.instagram.com/ta6urkin/" target="_blank" rel="noopener noreferrer" aria-label="Original project Instagram">◎</a>
            <a href="https://www.tiktok.com/@ta6urkin" target="_blank" rel="noopener noreferrer" aria-label="Original project TikTok">♪</a>
            <a href="https://www.youtube.com/@ta6urkin" target="_blank" rel="noopener noreferrer" aria-label="Original project YouTube">▶</a>
            <a href="https://www.pinterest.com/ta6urkin/" target="_blank" rel="noopener noreferrer" aria-label="Original project Pinterest">P</a>
            <a href="https://www.reddit.com/user/taburkin/" target="_blank" rel="noopener noreferrer" aria-label="Original project Reddit">r/</a>
          </span>
        </nav>
        <button className="legal-link" onClick={() => setAbout(true)}>About & Legal Info</button>
        {notice && <output className="notice" aria-live="polite" onClick={() => setNotice('')}>{notice}</output>}
      </section>

      {about && (
        <div className="modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAbout(false) }}>
          <article role="dialog" aria-modal="true" aria-labelledby="about-title">
            <button ref={closeButton} className="close" aria-label="Close About and Legal Info" onClick={() => setAbout(false)}>×</button>
            <small>VERSION 1.0.0</small>
            <h2 id="about-title">About this project</h2>
            <p>This is an independent clean-room preservation built from publicly observable behaviour. It is not affiliated with or endorsed by the original project and contains none of its source code or assets.</p>
            <p>Models, layouts and DXF files are informational only. Confirm dimensions, kerf tolerances and structural integrity with a qualified professional before CNC or laser cutting.</p>
            <p className="legal-links">
              <a href="https://welding-table-generator.com/" target="_blank" rel="noopener noreferrer">Original project — welding-table-generator.com ↗</a>
              <a href="https://ballwool.com/shops/DIYWeldingProjects" target="_blank" rel="noopener noreferrer">Original project — Shop ↗</a>
              <a href="https://www.instagram.com/ta6urkin/" target="_blank" rel="noopener noreferrer">Original project — Instagram ↗</a>
              <a href="https://www.tiktok.com/@ta6urkin" target="_blank" rel="noopener noreferrer">Original project — TikTok ↗</a>
              <a href="https://www.youtube.com/@ta6urkin" target="_blank" rel="noopener noreferrer">Original project — YouTube ↗</a>
              <a href="https://www.pinterest.com/ta6urkin/" target="_blank" rel="noopener noreferrer">Original project — Pinterest ↗</a>
              <a href="https://www.reddit.com/user/taburkin/" target="_blank" rel="noopener noreferrer">Original project — Reddit ↗</a>
            </p>
          </article>
        </div>
      )}

      <article className="seo">
        <h2>Plan a fabrication-ready welding table in your browser</h2>
        <p>This independent layout planner helps metalworkers explore perforated fixture plates, skirts, tab-and-slot joints and internal bracing without uploading a job. Choose a D16, D28 or custom hole grid, then inspect the same metric model in 2D and 3D.</p>
        <h3>D16, D28 and custom fixture grids</h3>
        <p>Use a 16 mm grid for compact fixtures, a 28 mm grid for heavier tooling, or enter your own hole diameter, pitch and edge margin. Square and staggered patterns remain metric internally even when dimensions are displayed in inches.</p>
        <h3>Tab-and-slot fabrication</h3>
        <p>Material thickness, tab width and joint clearance drive the generated connection geometry. Optional dog-bone reliefs keep internal slot corners compatible with round cutting tools and are preserved as native arc entities in DXF output.</p>
        <h3>Internal support ribs and construction holes</h3>
        <p>Generate longitudinal and transverse ribs at a chosen spacing, add mounting or lifting holes, and place custom holes by coordinates measured from each part centre. The 2D ruler and removable-hole tool help review the result before export.</p>
        <h3>Export clear CNC references</h3>
        <p>Each downloadable DXF uses separate OUTLINE, ENGRAVE and HOLES layers. Hole circles and dog-bone relief arcs remain native DXF entities. Save the complete metric project as JSON, share it as a URL, or download an archive containing individual parts and the full layout.</p>
        <h3>Verify before fabrication</h3>
        <p>Generated geometry and estimates are informational. Inspect every contour in CAD/CAM software, account for the machine kerf, cut a fit coupon for critical joints, and have a qualified professional verify dimensions and structural suitability before committing material.</p>
      </article>
    </main>
  )
}
