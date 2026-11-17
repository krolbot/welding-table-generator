import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { svgContourPath, type FabricationPart, type EngravingLine } from './geometry'
import { display, readDisplay, type Config } from './model'
import { downloadNestedZip } from './dxf'
import { nestingKey, type NestingRequest, type NestingResponse } from './nestingSettings'
import type { NestingResult } from './nesting'
import type { NestingFinishReason, NestingJob, NestingRun } from './nestingJob'
import { tableNestingJob, tableLayoutKey, tableCutEngravings, validateTableCut, type TableLayoutSnapshot } from './tableCutJob'
import { NumberField, useWideWorkspace, WorkspaceDialog } from './GeneratorWorkspace'
import { Icon } from './Icon'
import { DrawingViewport } from './DrawingViewport'
import { drawingFeatures } from './drawingInteraction'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
export type SheetSettings = { length: number; width: number; edgeGap: number; partGap: number; copies: number }
type Props = {
  jobKey: string; job: NestingJob; sheetSettings: SheetSettings; units: Config['units']
  onChange: (patch: Partial<SheetSettings>) => void | boolean; onNotice: (message: string) => void
  render3D: (result: NestingResult) => ReactNode
  onExport: (run: Extract<NestingRun, { phase: 'nesting' }>) => Promise<void>
  onRun?: (run: NestingRun) => void
  getEngravings?: (part: FabricationPart) => EngravingLine[]
  isLayoutValid?: (run: Extract<NestingRun, { phase: 'nesting' }>, key: string) => boolean
  batchLabel?: string; maxGap?: number
}

export function SheetNesting({ jobKey: key, job, sheetSettings: settings, units: unitSystem, onChange, onNotice, render3D, onExport, onRun, getEngravings, isLayoutValid, batchLabel = 'Одинаковые изделия в партии резки', maxGap = 1000 }: Props) {
  const [snapshot, setSnapshot] = useState<{ key: string; run: NestingRun } | null>(null)
  const [stats, setStats] = useState<{ attempts: number; elapsedMs: number; search: NestingResult['stats'] | null }>({ attempts: 0, elapsedMs: 0, search: null })
  const [status, setStatus] = useState<'running' | 'pausing' | 'paused' | 'done' | 'error'>('running')
  const [finishReason, setFinishReason] = useState<NestingFinishReason | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mode, setMode] = useState<'3d' | '2d'>('3d')
  const [retry, setRetry] = useState(0)
  const wide = useWideWorkspace()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  useEffect(() => setInspectorOpen(false), [wide])
  const control = useRef<{ worker: Worker; running: boolean; busy: boolean; exhausted: boolean } | null>(null)
  const sourceRef = useRef(job)
  sourceRef.current = job
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun

  useEffect(() => {
    let active = true
    setSnapshot(null); setStats({ attempts: 0, elapsedMs: 0, search: null }); setStatus('running'); setError(null); setFinishReason(null)
    // Debounce edits; cleanup cancels old geometry work, including an in-flight pass.
    const timer = window.setTimeout(() => {
      let worker: Worker
      try { worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' }) }
      catch { setError({ code: 'worker-unavailable', message: 'Браузер не может запустить расчёт раскладки.' }); setStatus('error'); return }
      const state = { worker, running: true, busy: true, exhausted: false }
      control.current = state
      worker.onmessage = (event: MessageEvent<NestingResponse>) => {
        const message = event.data
        if (!active || message.key !== key) return
        state.busy = false
        if ('error' in message) { state.running = false; setError(message.error); setStatus('error'); return }
        state.exhausted = message.done
        setStats({ attempts: message.run.result.stats.attempts, elapsedMs: message.elapsedMs, search: message.run.result.stats })
        setSnapshot(previous => previous?.key === key && previous.run.phase === message.run.phase && previous.run.result.stats.improvements === message.run.result.stats.improvements ? previous : { key, run: message.run })
        onRunRef.current?.(message.run)
        if (!message.run.result.validation.valid) { state.running = false; setStatus('error'); return }
        if (message.done) { state.running = false; setFinishReason(message.finishReason ?? 'exhausted'); setStatus('done'); return }
        if (state.running) {
          state.busy = true
          worker.postMessage({ type: 'continue', key } satisfies NestingRequest)
        } else { state.running = false; setStatus('paused') }
      }
      worker.onerror = () => { if (active) { state.running = false; setError({ code: 'worker-failed', message: 'Сбой фонового расчёта. Можно сохранить последний проверенный результат или перезапустить расчёт.' }); setStatus('error') } }
      worker.postMessage({ type: 'start', key, job: sourceRef.current } satisfies NestingRequest)
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
    state.running = true; state.busy = true
    setStatus('running')
    state.worker.postMessage({ type: 'continue', key } satisfies NestingRequest)
  }
  const run = snapshot?.key === key ? snapshot.run : null
  const result = run?.result
  const selected = Math.max(0, Math.min(sheetIndex, (result?.sheets.length ?? 1) - 1))
  const sheet = result?.sheets[selected]
  const metric = result?.metrics.sheets[selected]
  const features = useMemo(() => sheet?.placements.map(item => drawingFeatures([{ part: item.part, position: item.translation, rotation: item.rotation }])) ?? [], [sheet])
  const focused = useMemo(() => result && sheet ? { ...result, sheets: [sheet], placements: sheet.placements } : undefined, [result, sheet])
  const units = unitSystem === 'mm' ? 'мм' : 'дюйм'
  const complete = status !== 'error' && run?.phase === 'nesting' && result && result.validation.valid && !result.unplaced.length && result.placements.length > 0 && (!isLayoutValid || isLayoutValid(run, key))
  const running = status === 'running' || status === 'pausing'
  const spacingField = (field: 'edgeGap' | 'partGap', label: string) => <NumberField label={`${label} (${units})`}
    aria-label={label} value={display(settings[field], unitSystem, 2)} min={0} max={Number(display(maxGap, unitSystem, 2))} step={unitSystem === 'mm' ? 0.5 : 0.01}
    onValue={value => { if (value !== Number(display(settings[field], unitSystem, 2))) return onChange({ [field]: Math.max(0, Math.min(maxGap, readDisplay(value, unitSystem))) }) }} />

  const statusLabel = status === 'running' ? 'Оптимизация' : status === 'pausing' ? 'Завершение прохода' : status === 'paused' ? 'Пауза' : error?.code === 'capacity-unavailable' ? 'Нет полной раскладки стола' : status === 'error' ? 'Остановлено' : complete ? 'Готово' : finishReason === 'time-limit' ? 'Лимит расчёта' : 'Варианты исчерпаны'
  const inspector = <>
      <header>{wide && <h3 id="nesting-title">Раскладка на листах</h3>}<span className="nesting-status">{statusLabel}</span></header>
      <p className="nesting-summary" role="status">{error ? error.code === 'capacity-unavailable' ? 'Полная раскладка стола не найдена. Оснастка не размещена; экспорт недоступен.' : 'Расчёт завершился с ошибкой. Экспорт недоступен.' : run?.phase === 'capacity' ? 'Проверяется вместимость только для стола. Выбранная оснастка ещё не размещена; экспорт недоступен.' : result ? !result.validation.valid ? 'Раскладка не прошла проверку. Экспорт недоступен.' : result.unplaced.length ? `Не размещено деталей: ${result.unplaced.length}. Экспорт недоступен.` : !complete ? 'Эту раскладку нельзя экспортировать. Перезапустите расчёт с текущими параметрами проекта.' : `Деталей: ${result.placements.length} · листов: ${result.sheets.length}` : 'Рассчитывается первая проверенная раскладка…'}</p>
      {error && <p role="alert" className="nesting-error" data-error-code={error.code}>{error.message}</p>}
      {result && !result.validation.valid && <p className="nesting-error">{result.validation.violations[0]?.message}</p>}
      {run?.phase === 'nesting' && run.stock.kind === 'table-offcuts' && <p className="nesting-hint">Вместимость только для стола: {run.stock.baseline.sheets.length} лист. Дополнительные листы для оснастки не добавляются. Детали стола могут быть переставлены. Для экспорта нужно полностью разместить всю выбранную оснастку.</p>}
      {run?.phase === 'nesting' && result && result.unplaced.length > 0 && <div className="nesting-error" role="alert" data-error-code="incomplete-cut-job"><p>Не хватает деталей: {result.unplaced.length}. {status === 'done' ? finishReason === 'time-limit' ? 'Достигнут лимит времени расчёта.' : 'Варианты исчерпаны.' : status === 'paused' ? 'Поиск приостановлен.' : status === 'error' ? 'Расчёт остановлен.' : 'Поиск продолжается.'} При добавлении оснастки лимит листов для стола не увеличивается. Частичное задание нельзя экспортировать.</p><ul>{[...new Set(result.unplaced.map(item => item.part.label))].map(label => <li key={label}>{label}</li>)}</ul></div>}
      <button className="nesting-export" disabled={!complete} onClick={() => { if (run?.phase === 'nesting') void onExport({ ...run, result: { ...run.result, stats: stats.search ?? run.result.stats } }).catch(error => onNotice(error instanceof Error ? error.message : 'Не удалось экспортировать раскладку. Пересчитайте её и повторите попытку.')) }}><Icon name="download" size={16} />Скачать ZIP с листами</button>
      {result && result.sheets.length > 0 && <>
        <label className="field"><span>Предпросмотр листа</span><select value={selected} onChange={event => setSheetIndex(Number(event.target.value))}>{result.sheets.map((s, i) => <option key={s.index} value={i}>Лист {i + 1} · деталей: {s.placements.length}</option>)}</select></label>
        <dl className="nesting-metrics">
          <div><dt>Покрытие по контуру</dt><dd>{(100 * result.outlineArea / (result.sheets.length * settings.length * settings.width)).toFixed(1)}%</dd></div>
          <div><dt>Нижняя граница по площади</dt><dd>{result.metrics.sheetLowerBound} лист.</dd></div>
          {metric && <div><dt>Свободная краевая полоса на листе</dt><dd>{display(metric.remnant.width, unitSystem, 1)} × {display(metric.remnant.height, unitSystem, 1)} {units}</dd></div>}
        </dl>
      </>}
      <div className="nesting-search">
        <div className="nesting-actions">{running ? <button disabled={status === 'pausing'} onClick={pause}>Приостановить</button> : status === 'paused' ? <button onClick={resume}>Продолжить улучшение</button> : null}<button onClick={() => setRetry(value => value + 1)}>Перезапустить</button></div>
        <p>Проверено вариантов: {stats.attempts} · время расчёта: {(stats.elapsedMs / 1000).toFixed(1)} с.</p>
      </div>
      <details><summary>Зазоры и партия</summary>
        <div className="fields">{spacingField('edgeGap', 'Зазор от края листа')}{spacingField('partGap', 'Зазор между деталями')}</div>
        <NumberField label={batchLabel} min={1} max={10} step={1} value={settings.copies} onValue={value => onChange({ copies: Math.max(1, Math.min(10, Math.floor(value))) })} />
        <p>Повороты выбираются автоматически: сначала на 90°, затем с шагом 15° в пределах поиска. Размер партии влияет только на раскладку по листам, но не на собранную модель и геометрию отдельной детали. Допускается не более 256 деталей и 32 листов. В отверстия другие детали не вкладываются.</p>
      </details>
      <details><summary>Раскладка и резка</summary>
        {result && <p className="nesting-hint">Площадь покрытия включает отверстия. Зелёным в 2D показана свободная краевая полоса, а не все пригодные остатки. {complete && result.sheets.length === result.metrics.sheetLowerBound ? 'Число листов достигло нижней границы по площади, но форму остатков ещё можно улучшить.' : 'Нижняя граница не гарантирует, что такого числа листов достаточно.'}</p>}
      <p className="nesting-hint">Экспорт содержит исходные сущности LINE / ARC / CIRCLE, перечень размещений и параметры проекта. Контурный поиск эвристический и не доказывает глобальную оптимальность. Проверьте ширину реза, врезания, зажимы и порядок резки в CAM.</p>
        <p>Поиск автоматически завершается, когда число листов достигло нижней границы и восемь следующих вариантов не улучшили проверенную раскладку, либо после 60 секунд расчёта. Это лучший найденный вариант, а не доказанный глобальный оптимум. Активный поиск можно остановить кнопкой «Приостановить».</p>
      </details>
  </>

  return <div className="sheet-workspace">
    <div className="sheet-canvas">
      {focused ? mode === '3d' ? render3D(focused)
        : <DrawingViewport bounds={{ width: settings.length, height: settings.width }} parts={features} geometryKey={`${selected}:${JSON.stringify(features)}`} units={unitSystem} label={`Раскладка резки на листе ${selected + 1}`}>
          <g>
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
        </DrawingViewport>
        : <div className="three-loading" role="status">{status === 'error' ? 'Сбой расчёта' : result ? 'Детали не размещены' : 'Подготовка первой раскладки…'}</div>}
      <div className="sheet-view-tools">
        <button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D</button>
        <button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>План резки 2D</button>
      </div>
    </div>
    {wide ? <section className="sheet-panel" aria-labelledby="nesting-title">{inspector}</section> : <>
      <button className="sheet-mobile-summary" aria-haspopup="dialog" aria-controls="sheet-dialog" onClick={() => setInspectorOpen(true)}><span><strong>{error ? error.code === 'capacity-unavailable' ? 'Стол не размещён · без экспорта' : 'Сбой расчёта · без экспорта' : run?.phase === 'capacity' ? 'Только стол · оснастка не размещена' : run?.phase === 'nesting' && result?.unplaced.length ? `Не размещено: ${result.unplaced.length} · без экспорта` : complete && result ? `Деталей: ${result.placements.length} · листов: ${result.sheets.length}` : result ? 'Раскладка недоступна · без экспорта' : 'Раскладка на листах'}</strong><small>{statusLabel} · параметры и экспорт</small></span><Icon name="chevron" /></button>
      <WorkspaceDialog id="sheet-dialog" title="Раскладка на листах" className="sheet-dialog" open={inspectorOpen} onClose={() => setInspectorOpen(false)}><div className="sheet-inspector">{inspector}</div></WorkspaceDialog>
    </>}
  </div>
}

type TableProps = { config: Config; dark: boolean; onChange: (patch: Partial<Config>) => void; onNotice: (message: string) => void; baseline?: TableLayoutSnapshot; onBaseline: (snapshot: TableLayoutSnapshot) => void }
export function TableSheetNesting({ config, dark, onChange, onNotice, baseline, onBaseline }: TableProps) {
  const key = nestingKey(config)
  const prepared = useMemo(() => {
    try { return { job: tableNestingJob(config, baseline) } }
    catch (error) { return { error: error instanceof Error ? error : new Error('Некорректное задание на резку') } }
  }, [key, baseline])
  if (!prepared.job) return <div className="three-loading socket-error" role="alert" data-error-code={prepared.error && 'code' in prepared.error ? String(prepared.error.code) : 'invalid-cut-job'}>{prepared.error?.message}</div>
  return <SheetNesting jobKey={key} job={prepared.job} units={config.units}
    sheetSettings={{ length: config.sheetLength, width: config.sheetWidth, edgeGap: config.sheetEdgeGap, partGap: config.sheetPartGap, copies: config.nestingCopies }}
    onChange={changes => onChange({ ...(changes.edgeGap === undefined ? {} : { sheetEdgeGap: changes.edgeGap }), ...(changes.partGap === undefined ? {} : { sheetPartGap: changes.partGap }), ...(changes.copies === undefined ? {} : { nestingCopies: changes.copies }) })}
    onNotice={onNotice} onExport={({ result, stock }) => downloadNestedZip(config, result, stock)} batchLabel="Одинаковые столы в партии резки"
    isLayoutValid={({ result, stock }) => validateTableCut(config, result, stock)}
    onRun={run => {
      const table = run.phase === 'capacity' || run.stock.kind === 'new-sheets' ? run.result : run.stock.baseline
      if (table.validation.valid && !table.unplaced.length) onBaseline({ key: tableLayoutKey(config), result: table })
    }}
    getEngravings={part => tableCutEngravings(part, config)}
    render3D={result => <Suspense fallback={<div className="three-loading">Загрузка 3D…</div>}><ThreeAssembly config={config} dark={dark} resetToken={0} nesting={result} /></Suspense>} />
}
