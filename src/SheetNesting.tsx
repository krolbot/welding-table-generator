import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { svgContourPath, engravingLines, type FabricationPart, type EngravingLine } from './geometry'
import { display, readDisplay, readPart, type Config } from './model'
import { downloadNestedZip } from './dxf'
import { nestingKey, nestingParts, nestingOptions, type NestingRequest, type NestingResponse } from './nestingSettings'
import type { NestingOptions, NestingResult } from './nesting'
import { NumberField } from './GeneratorWorkspace'
import { Icon } from './Icon'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
export type SheetSettings = { length: number; width: number; edgeGap: number; partGap: number; copies: number }
type Props = {
  jobKey: string; sourceParts: FabricationPart[]; options: NestingOptions; sheetSettings: SheetSettings; units: Config['units']
  onChange: (patch: Partial<SheetSettings>) => void | boolean; onNotice: (message: string) => void
  render3D: (result: NestingResult, reset: number) => ReactNode
  onExport: (result: NestingResult) => Promise<void>
  getEngravings?: (part: FabricationPart) => EngravingLine[]
  isLayoutValid?: (result: NestingResult, key: string) => boolean
  batchLabel?: string; maxGap?: number
}

export function SheetNesting({ jobKey: key, sourceParts, options, sheetSettings: settings, units: unitSystem, onChange, onNotice, render3D, onExport, getEngravings, isLayoutValid, batchLabel = 'Identical items in this cutting batch', maxGap = 1000 }: Props) {
  const [snapshot, setSnapshot] = useState<{ key: string; result: NestingResult } | null>(null)
  const [stats, setStats] = useState<{ attempts: number; elapsedMs: number; search: NestingResult['stats'] | null }>({ attempts: 0, elapsedMs: 0, search: null })
  const [status, setStatus] = useState<'running' | 'pausing' | 'paused' | 'done' | 'error'>('running')
  const [error, setError] = useState('')
  const [budget, setBudget] = useState(30)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mode, setMode] = useState<'3d' | '2d'>('3d')
  const [reset, setReset] = useState(0)
  const [retry, setRetry] = useState(0)
  const control = useRef<{ worker: Worker; running: boolean; busy: boolean; limit: number; elapsed: number; exhausted: boolean } | null>(null)
  const sourceRef = useRef({ parts: sourceParts, options })
  sourceRef.current = { parts: sourceParts, options }
  const budgetRef = useRef(budget)
  budgetRef.current = budget

  useEffect(() => {
    let active = true
    setSnapshot(null); setStats({ attempts: 0, elapsedMs: 0, search: null }); setStatus('running'); setError('')
    // Debounce edits; cleanup cancels old geometry work, including an in-flight pass.
    const timer = window.setTimeout(() => {
      let worker: Worker
      try { worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' }) }
      catch { setError('This browser cannot start the sheet calculation.'); setStatus('error'); return }
      const state = { worker, running: true, busy: true, limit: budgetRef.current * 1000, elapsed: 0, exhausted: false }
      control.current = state
      worker.onmessage = (event: MessageEvent<NestingResponse>) => {
        const message = event.data
        if (!active || message.key !== key) return
        state.busy = false
        if ('error' in message) { state.running = false; setError(message.error); setStatus('error'); return }
        state.elapsed = message.elapsedMs
        state.exhausted = message.done
        setStats({ attempts: message.result.stats.attempts, elapsedMs: message.elapsedMs, search: message.result.stats })
        setSnapshot(previous => previous?.key === key && previous.result.stats.improvements === message.result.stats.improvements ? previous : { key, result: message.result })
        if (message.done || !message.result.validation.valid) { state.running = false; setStatus('done'); return }
        if (state.running && message.elapsedMs < state.limit) {
          state.busy = true
          worker.postMessage({ type: 'continue', key } satisfies NestingRequest)
        } else { state.running = false; setStatus('paused') }
      }
      worker.onerror = () => { if (active) { state.running = false; setError('Calculation worker failed. You can keep the last verified result or restart.'); setStatus('error') } }
      worker.postMessage({ type: 'start', key, ...sourceRef.current } satisfies NestingRequest)
    }, 250)
    return () => { active = false; clearTimeout(timer); control.current?.worker.terminate(); control.current = null }
  }, [key, retry])

  const pause = () => {
    const state = control.current
    if (!state) return
    state.running = false
    setStatus(state.busy ? 'pausing' : 'paused')
  }
  const resume = () => {
    const state = control.current
    if (!state || state.exhausted || state.busy) return
    state.running = true; state.busy = true; state.limit = state.elapsed + budget * 1000
    setStatus('running')
    state.worker.postMessage({ type: 'continue', key } satisfies NestingRequest)
  }
  const result = snapshot?.key === key ? snapshot.result : null
  const selected = Math.max(0, Math.min(sheetIndex, (result?.sheets.length ?? 1) - 1))
  const sheet = result?.sheets[selected]
  const metric = result?.metrics.sheets[selected]
  const focused = useMemo(() => result && sheet ? { ...result, sheets: [sheet], placements: sheet.placements } : undefined, [result, sheet])
  const units = unitSystem === 'mm' ? 'mm' : 'in'
  const complete = result && result.validation.valid && !result.unplaced.length && result.placements.length > 0 && (!isLayoutValid || isLayoutValid(result, key))
  const running = status === 'running' || status === 'pausing'
  const spacingField = (field: 'edgeGap' | 'partGap', label: string) => <NumberField label={`${label} (${units})`}
    aria-label={label} value={display(settings[field], unitSystem, 2)} min={0} max={Number(display(maxGap, unitSystem, 2))} step={unitSystem === 'mm' ? 0.5 : 0.01}
    onValue={value => { if (value !== Number(display(settings[field], unitSystem, 2))) return onChange({ [field]: Math.max(0, Math.min(maxGap, readDisplay(value, unitSystem))) }) }} />

  return <div className="sheet-workspace">
    <div className="sheet-canvas">
      {focused ? mode === '3d' ? render3D(focused, reset)
        : <svg className="nested-plan" viewBox={`-30 -30 ${settings.length + 60} ${settings.width + 60}`} role="img" aria-label={`Sheet ${selected + 1} cutting layout`}>
          <g transform={`translate(0 ${settings.width}) scale(1 -1)`}>
            <rect className="stock-outline" x={0} y={0} width={settings.length} height={settings.width} />
            <rect className="stock-margin" x={settings.edgeGap} y={settings.edgeGap} width={Math.max(0, settings.length - 2 * settings.edgeGap)} height={Math.max(0, settings.width - 2 * settings.edgeGap)} />
            {metric && metric.remnant.width > 0 && metric.remnant.height > 0 && <rect className="stock-remnant" {...metric.remnant} />}
            {sheet!.placements.map(p => <g key={`${p.part.name}:${p.instance}`} className="nested-part" transform={`translate(${p.translation.x} ${p.translation.y}) rotate(${p.rotation})`}>
              <title>{p.part.label} · {p.instance + 1} · {p.rotation}°</title>
              <path d={p.part.contours.map(svgContourPath).join(' ')} fillRule="evenodd" />
              {p.part.holes.map(hole => <circle key={hole.id} cx={hole.x} cy={hole.y} r={hole.d / 2} />)}
              {getEngravings?.(p.part).map((line, i) => <line key={i} className="nested-engraving" x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />)}
            </g>)}
          </g>
        </svg>
        : <div className="three-loading" role="status">{status === 'error' ? 'Calculation failed' : result ? 'No parts placed' : 'Preparing a first layout…'}</div>}
      <div className="sheet-view-tools">
        <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D</button>
        <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>2D cut plan</button>
        {mode === '3d' && <button onClick={() => setReset(value => value + 1)} aria-label="Reset sheet camera"><Icon name="maximize" size={14} /></button>}
      </div>
    </div>
    <section className="sheet-panel" aria-labelledby="nesting-title">
      <header><h3 id="nesting-title">Sheet nesting</h3><span className="nesting-status">{status === 'running' ? 'Optimizing' : status === 'pausing' ? 'Finishing pass' : status === 'paused' ? 'Paused' : status === 'error' ? 'Stopped' : 'Finished'}</span></header>
      <p className="nesting-summary" role="status">{result ? !result.validation.valid ? 'Validation failed. Export is disabled.' : result.unplaced.length ? `${result.unplaced.length} parts not placed. Export is disabled.` : `${result.placements.length} parts · ${result.sheets.length} sheet${result.sheets.length === 1 ? '' : 's'}` : 'Calculating the first verified layout…'}</p>
      {error && <p role="alert" className="nesting-error">{error}</p>}
      {result && !result.validation.valid && <p className="nesting-error">{result.validation.violations[0]?.message}</p>}
      {result && result.sheets.length > 0 && <>
        <label className="field"><span>Preview sheet</span><select value={selected} onChange={event => setSheetIndex(Number(event.target.value))}>{result.sheets.map((s, i) => <option key={s.index} value={i}>Sheet {i + 1} · {s.placements.length} parts</option>)}</select></label>
        <dl className="nesting-metrics">
          <div><dt>Blank-outline coverage</dt><dd>{(100 * result.outlineArea / (result.sheets.length * settings.length * settings.width)).toFixed(1)}%</dd></div>
          <div><dt>Area lower bound</dt><dd>{result.metrics.sheetLowerBound} sheet(s)</dd></div>
          {metric && <div><dt>Clear edge strip, this sheet</dt><dd>{display(metric.remnant.width, unitSystem, 1)} × {display(metric.remnant.height, unitSystem, 1)} {units}</dd></div>}
        </dl>
        <p className="nesting-hint">Coverage includes holes. Green in 2D marks an empty edge strip, not all reusable offcuts. {complete && result.sheets.length === result.metrics.sheetLowerBound ? 'Sheet count meets the area lower bound; offcut shape can still improve.' : 'The lower bound is not a promise that this sheet count is feasible.'}</p>
      </>}
      <div className="nesting-search">
        <label className="field"><span>Search budget per run</span><select value={budget} onChange={event => setBudget(Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={180}>3 minutes</option></select></label>
        <div className="nesting-actions">{running ? <button disabled={status === 'pausing'} onClick={pause}>Pause search</button> : <button disabled={status === 'done' || status === 'error'} onClick={resume}>Continue improving</button>}<button onClick={() => setRetry(value => value + 1)}>Restart</button></div>
        <p>{stats.attempts} orders evaluated · {(stats.elapsedMs / 1000).toFixed(1)} s compute time. Pausing or reaching the budget finishes the current pass. Export keeps the best verified layout.</p>
      </div>
      <details><summary>Spacing & batch</summary>
        <div className="fields">{spacingField('edgeGap', 'Sheet edge gap')}{spacingField('partGap', 'Part gap')}</div>
        <NumberField label={batchLabel} min={1} max={10} step={1} value={settings.copies} onValue={value => onChange({ copies: Math.max(1, Math.min(10, Math.floor(value))) })} />
        <p>Rotations are chosen automatically: quarter turns first, then 15° refinements within the search budget. Batch affects sheet nesting only, not the assembled model or individual part geometry. Maximum 256 parts and 32 sheets. Holes are not used for placing other parts.</p>
      </details>
      <button className="nesting-export" disabled={!complete} onClick={() => { if (result) void onExport({ ...result, stats: stats.search ?? result.stats }).catch(() => onNotice('Could not export this layout. Recalculate and try again.')) }}><Icon name="download" size={16} />Download sheet DXFs (ZIP)</button>
      <p className="nesting-hint">Native LINE / ARC / CIRCLE output, placement manifest and project settings. Contour search is heuristic, not a global optimum proof. Confirm kerf, lead-ins, clamps and cutting order in CAM.</p>
    </section>
  </div>
}

type TableProps = { config: Config; dark: boolean; onChange: (patch: Partial<Config>) => void; onNotice: (message: string) => void }
export function TableSheetNesting({ config, dark, onChange, onNotice }: TableProps) {
  const key = nestingKey(config)
  const parts = useMemo(() => nestingParts(config), [key])
  return <SheetNesting jobKey={key} sourceParts={parts} options={nestingOptions(config)} units={config.units}
    sheetSettings={{ length: config.sheetLength, width: config.sheetWidth, edgeGap: config.sheetEdgeGap, partGap: config.sheetPartGap, copies: config.nestingCopies }}
    onChange={changes => onChange({ ...(changes.edgeGap === undefined ? {} : { sheetEdgeGap: changes.edgeGap }), ...(changes.partGap === undefined ? {} : { sheetPartGap: changes.partGap }), ...(changes.copies === undefined ? {} : { nestingCopies: changes.copies }) })}
    onNotice={onNotice} onExport={result => downloadNestedZip(config, result)} batchLabel="Identical tables in this cutting batch"
    getEngravings={part => { const name = readPart(part.name); return name ? engravingLines({ ...part, name }, config) : [] }}
    render3D={(result, reset) => <Suspense fallback={<div className="three-loading">Loading 3D…</div>}><ThreeAssembly config={config} dark={dark} resetToken={reset} mountFocusToken={0} nesting={result} /></Suspense>} />
}
