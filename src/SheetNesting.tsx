import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { svgContourPath, engravingLines } from './geometry'
import { display, readDisplay, type Config } from './model'
import { downloadNestedZip } from './dxf'
import { nestingKey, nestingParts, type NestingRequest, type NestingResponse } from './nestingSettings'
import type { NestingResult } from './nesting'
import { NumberInput } from './NumberInput'
import { Icon } from './Icon'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
type Props = { config: Config; dark: boolean; onChange: (patch: Partial<Config>) => void; onNotice: (message: string) => void }

export function SheetNesting({ config, dark, onChange, onNotice }: Props) {
  const key = nestingKey(config)
  const sourceParts = useMemo(() => nestingParts(config), [key])
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
  const configRef = useRef(config)
  configRef.current = config
  const budgetRef = useRef(budget)
  budgetRef.current = budget

  useEffect(() => {
    let active = true
    setSnapshot(null); setStats({ attempts: 0, elapsedMs: 0, search: null }); setStatus('running'); setError('')
    // Debounce a sequence of numeric edits. Cleanup terminates old geometry work, including an in-flight pass.
    const timer = window.setTimeout(() => {
      const worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' })
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
        // Do not rebuild hundreds of 3D meshes for progress-only messages.
        setSnapshot(previous => previous?.key === key && previous.result.stats.improvements === message.result.stats.improvements
          ? previous : { key, result: message.result })
        if (message.done || !message.result.validation.valid) { state.running = false; setStatus('done'); return }
        if (state.running && message.elapsedMs < state.limit) {
          state.busy = true
          worker.postMessage({ type: 'continue', key } satisfies NestingRequest)
        } else { state.running = false; setStatus('paused') }
      }
      worker.onerror = () => { if (active) { state.running = false; setError('Calculation worker failed. You can keep the last verified result or restart.'); setStatus('error') } }
      worker.postMessage({ type: 'start', key, config: configRef.current } satisfies NestingRequest)
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
  const units = config.units === 'mm' ? 'mm' : 'in'
  const complete = result && result.validation.valid && !result.unplaced.length && result.placements.length > 0
  const running = status === 'running' || status === 'pausing'
  const spacingField = (field: 'sheetEdgeGap' | 'sheetPartGap', label: string) => <label className="field"><span>{label} ({units})</span><NumberInput
    aria-label={label} value={display(config[field], config.units, 2)} min={0} max={Number(display(1000, config.units, 2))} step={config.units === 'mm' ? 0.5 : 0.01}
    onValue={value => { if (value !== Number(display(config[field], config.units, 2))) onChange({ [field]: Math.max(0, Math.min(1000, readDisplay(value, config.units))) }) }} /></label>

  return <div className="sheet-workspace">
    <div className="sheet-canvas">
      {focused ? mode === '3d' ? <Suspense fallback={<div className="three-loading">Loading 3D…</div>}><ThreeAssembly config={config} dark={dark} resetToken={reset} mountFocusToken={0} nesting={focused} /></Suspense>
        : <svg className="nested-plan" viewBox={`-30 -30 ${config.sheetLength + 60} ${config.sheetWidth + 60}`} role="img" aria-label={`Sheet ${selected + 1} cutting layout`}>
          <g transform={`translate(0 ${config.sheetWidth}) scale(1 -1)`}>
            <rect className="stock-outline" x={0} y={0} width={config.sheetLength} height={config.sheetWidth} />
            <rect className="stock-margin" x={config.sheetEdgeGap} y={config.sheetEdgeGap} width={Math.max(0, config.sheetLength - 2 * config.sheetEdgeGap)} height={Math.max(0, config.sheetWidth - 2 * config.sheetEdgeGap)} />
            {metric && metric.remnant.width > 0 && metric.remnant.height > 0 && <rect className="stock-remnant" {...metric.remnant} />}
            {sheet!.placements.map(p => <g key={`${p.part.name}:${p.instance}`} className="nested-part" transform={`translate(${p.translation.x} ${p.translation.y}) rotate(${p.rotation})`}>
              <title>{p.part.label} · {p.instance + 1} · {p.rotation}°</title>
              <path d={p.part.contours.map(svgContourPath).join(' ')} fillRule="evenodd" />
              {p.part.holes.map(hole => <circle key={hole.id} cx={hole.x} cy={hole.y} r={hole.d / 2} />)}
              {engravings(sourceParts.find(part => part.name === p.part.name), config)}
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
          <div><dt>Blank-outline coverage</dt><dd>{(100 * result.outlineArea / (result.sheets.length * config.sheetLength * config.sheetWidth)).toFixed(1)}%</dd></div>
          <div><dt>Area lower bound</dt><dd>{result.metrics.sheetLowerBound} sheet(s)</dd></div>
          {metric && <div><dt>Clear edge strip, this sheet</dt><dd>{display(metric.remnant.width, config.units, 1)} × {display(metric.remnant.height, config.units, 1)} {units}</dd></div>}
        </dl>
        <p className="nesting-hint">Coverage includes holes. Green in 2D marks an empty edge strip, not all reusable offcuts. {complete && result.sheets.length === result.metrics.sheetLowerBound ? 'Sheet count meets the area lower bound; offcut shape can still improve.' : 'The lower bound is not a promise that this sheet count is feasible.'}</p>
      </>}
      <div className="nesting-search">
        <label className="field"><span>Search budget per run</span><select value={budget} onChange={event => setBudget(Number(event.target.value))}><option value={30}>30 seconds</option><option value={60}>1 minute</option><option value={180}>3 minutes</option></select></label>
        <div className="nesting-actions">{running ? <button disabled={status === 'pausing'} onClick={pause}>Pause search</button> : <button disabled={status === 'done' || status === 'error'} onClick={resume}>Continue improving</button>}<button onClick={() => setRetry(value => value + 1)}>Restart</button></div>
        <p>{stats.attempts} orders evaluated · {(stats.elapsedMs / 1000).toFixed(1)} s compute time. Pausing or reaching the budget finishes the current pass. Export keeps the best verified layout.</p>
      </div>
      <details><summary>Spacing & batch</summary>
        <div className="fields">{spacingField('sheetEdgeGap', 'Sheet edge gap')}{spacingField('sheetPartGap', 'Part gap')}</div>
        <label className="field"><span>Identical tables in this cutting batch</span><NumberInput min={1} max={10} step={1} value={config.nestingCopies} onValue={value => onChange({ nestingCopies: Math.max(1, Math.min(10, Math.floor(value))) })} /></label>
        <p>Rotations are chosen automatically: quarter turns first, then 15° refinements within the search budget. Batch affects sheet nesting only, not the assembled table or individual-part export. Maximum 256 parts and 32 sheets. Holes are not used for placing other parts.</p>
      </details>
      <button className="nesting-export" disabled={!complete} onClick={() => { if (result) void downloadNestedZip(config, { ...result, stats: stats.search ?? result.stats }).catch(() => onNotice('Could not export this layout. Recalculate and try again.')) }}><Icon name="download" size={16} />Download sheet DXFs (ZIP)</button>
      <p className="nesting-hint">Native LINE / ARC / CIRCLE output, placement manifest and project settings. Contour search is heuristic, not a global optimum proof. Confirm kerf, lead-ins, clamps and cutting order in CAM.</p>
    </section>
  </div>
}

const engravings = (part: Parameters<typeof engravingLines>[0] | undefined, config: Config) => part ? engravingLines(part, config).map((line, i) => <line key={i} className="nested-engraving" x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />) : null
