import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { svgContourPath } from './geometry'
import { display, projectConfig, readDisplay, type Config } from './model'
import type { NestingResult } from './nesting'
import { NumberField, useWideWorkspace, WorkspaceDialog } from './GeneratorWorkspace'
import { Icon } from './Icon'
import { DrawingViewport } from './DrawingViewport'
import { drawingFeatures } from './drawingInteraction'
import { deleteServerNesting, downloadNesting, pauseServerNesting, readNestingJob, resumeServerNesting, startNestingJob } from './serverApi'
import type { NestingJobStatusDto } from './apiContracts'
import { toolLabels } from './tools/project'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
type SheetSettings = { length: number; width: number; edgeGap: number; partGap: number; copies: number }
type Props = { config: Config; dark: boolean; onChange: (patch: Partial<Config>) => void; onNotice: (message: string) => void }

export function TableSheetNesting({ config, dark, onChange, onNotice }: Props) {
  const [job, setJob] = useState<NestingJobStatusDto | null>(null)
  const [startError, setStartError] = useState<{ code: string; message: string } | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [mode, setMode] = useState<'3d' | '2d'>('2d')
  const [retry, setRetry] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const wide = useWideWorkspace()
  const settings: SheetSettings = { length: config.sheetLength, width: config.sheetWidth, edgeGap: config.sheetEdgeGap, partGap: config.sheetPartGap, copies: config.nestingCopies }
  const key = JSON.stringify(projectConfig(config))

  useEffect(() => setInspectorOpen(false), [wide])
  useEffect(() => {
    let active = true
    let id = ''
    let poll = 0
    const controller = new AbortController()
    setJob(null); setStartError(null); setSheetIndex(0)
    const schedule = () => {
      if (!active || !id) return
      poll = window.setTimeout(() => {
        void readNestingJob(id, controller.signal).then(next => {
          if (!active) return
          setJob(next)
          if (next.status === 'running' || next.status === 'pausing') schedule()
        }).catch(error => {
          if (!active || controller.signal.aborted) return
          setStartError({ code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'server-job', message: error instanceof Error ? error.message : 'Не удалось получить серверный расчёт' })
        })
      }, 400)
    }
    const timer = window.setTimeout(() => {
      void startNestingJob(projectConfig(config), controller.signal).then(created => {
        id = created.id
        if (!active) { void deleteServerNesting(id).catch(() => undefined); return }
        setJob(created)
        schedule()
      }).catch(error => {
        if (!active || controller.signal.aborted) return
        setStartError({ code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'server-job', message: error instanceof Error ? error.message : 'Не удалось запустить серверный расчёт' })
      })
    }, 250)
    return () => {
      active = false
      controller.abort()
      clearTimeout(timer); clearTimeout(poll)
      if (id) void deleteServerNesting(id).catch(() => undefined)
    }
  }, [key, retry])

  const run = job?.run
  const result = run?.result
  const selected = Math.max(0, Math.min(sheetIndex, (result?.sheets.length ?? 1) - 1))
  const sheet = result?.sheets[selected]
  const metric = result?.metrics.sheets[selected]
  const features = useMemo(() => sheet?.placements.map(item => drawingFeatures([{ part: item.part, position: item.translation, rotation: item.rotation }])) ?? [], [sheet])
  const focused = useMemo(() => result && sheet ? { ...result, sheets: [sheet], placements: sheet.placements } : undefined, [result, sheet])
  const units = config.units === 'mm' ? 'мм' : 'дюйм'
  const error = startError ?? job?.error
  const complete = !error && run?.phase === 'nesting' && result?.validation.valid && !result.unplaced.length && result.placements.length > 0
  const running = job?.status === 'running' || job?.status === 'pausing'
  const statusLabel = job?.status === 'running' ? 'Оптимизация на сервере' : job?.status === 'pausing' ? 'Завершение прохода' : job?.status === 'paused' ? 'Пауза' : job?.status === 'error' || error ? 'Остановлено' : job?.status === 'done' && complete ? 'Готово' : job?.finishReason === 'time-limit' ? 'Лимит расчёта' : job ? 'Варианты исчерпаны' : 'Подготовка'
  const change = (patch: Partial<Config>) => { setJob(null); onChange(patch) }
  const spacing = (field: 'sheetEdgeGap' | 'sheetPartGap', label: string) => <NumberField label={`${label} (${units})`} value={display(config[field], config.units, 2)} min={0} max={Number(display(1000, config.units, 2))} step={config.units === 'mm' ? 0.5 : 0.01} onValue={value => change({ [field]: Math.max(0, Math.min(1000, readDisplay(value, config.units))) })} />
  const pause = async () => { if (job) try { setJob(await pauseServerNesting(job.id)) } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось приостановить расчёт') } }
  const resume = async () => { if (job) try { setJob(await resumeServerNesting(job.id)) } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось продолжить расчёт') } }
  const removeTool = (id: string) => change({ nestingTools: config.nestingTools.filter(item => item.id !== id) })
  const quantity = (id: string, copies: number) => change({ nestingTools: config.nestingTools.map(item => item.id === id ? { ...item, project: { ...item.project, copies } } : item) })

  const inspector = <>
    <header>{wide && <h3 id="nesting-title">Раскладка на листах</h3>}<span className="nesting-status">{statusLabel}</span></header>
    <p className="nesting-summary" role="status">{error ? 'Серверный расчёт завершился с ошибкой. Экспорт недоступен.' : run?.phase === 'capacity' ? 'Сервер проверяет раскладку только стола. Оснастка ещё не размещена.' : result?.unplaced.length ? `Не размещено деталей: ${result.unplaced.length}. Экспорт недоступен.` : complete && result ? `Деталей: ${result.placements.length} · листов: ${result.sheets.length}` : 'Сервер ищет первую полную проверенную раскладку…'}</p>
    {error && <p role="alert" className="nesting-error" data-error-code={error.code}>{error.message}</p>}
    {config.nestingTools.length > 0 && <section className="nesting-tools"><h4>Инструменты в раскрое</h4><ul>{config.nestingTools.map(({ id, project }, index) => <li key={id}><div><strong>{toolLabels[project.tool]} № {index + 1}</strong><small>{display(project.size.length, config.units, 2)} × {display(project.size.width, config.units, 2)} {units}</small></div><NumberField label="Количество" value={project.copies} min={1} max={10} step={1} onValue={copies => quantity(id, copies)} /><button className="icon" aria-label={`Удалить ${toolLabels[project.tool]} № ${index + 1} из раскроя`} title="Удалить из раскроя" onClick={() => removeTool(id)}><Icon name="trash" size={16} /></button></li>)}</ul></section>}
    <div className="nesting-export-actions">
      <button className="nesting-export" disabled={!complete || !job} onClick={() => job && void downloadNesting(job.id, selected).catch(error => onNotice(error instanceof Error ? error.message : 'Не удалось скачать DXF листа'))}><Icon name="download" size={16} />Скачать DXF листа</button>
      {(result?.sheets.length ?? 0) > 1 && <button className="secondary" disabled={!complete || !job} onClick={() => job && void downloadNesting(job.id).catch(error => onNotice(error instanceof Error ? error.message : 'Не удалось скачать DXF листов'))}>Все DXF · ZIP</button>}
    </div>
    {result && result.sheets.length > 0 && <><label className="field"><span>Предпросмотр листа</span><select value={selected} onChange={event => setSheetIndex(Number(event.target.value))}>{result.sheets.map((item, index) => <option key={item.index} value={index}>Лист {index + 1} · деталей: {item.placements.length}</option>)}</select></label><dl className="nesting-metrics"><div><dt>Покрытие по контуру</dt><dd>{(100 * result.outlineArea / (result.sheets.length * settings.length * settings.width)).toFixed(1)}%</dd></div><div><dt>Нижняя граница по площади</dt><dd>{result.metrics.sheetLowerBound} лист.</dd></div>{metric && <div><dt>Свободная краевая полоса</dt><dd>{display(metric.remnant.width, config.units, 1)} × {display(metric.remnant.height, config.units, 1)} {units}</dd></div>}</dl></>}
    <div className="nesting-search"><div className="nesting-actions">{running ? <button disabled={job?.status === 'pausing'} onClick={() => void pause()}>Приостановить</button> : job?.status === 'paused' ? <button onClick={() => void resume()}>Продолжить улучшение</button> : null}<button onClick={() => setRetry(value => value + 1)}>Перезапустить</button></div><p>Проверено вариантов: {result?.stats.attempts ?? 0} · время расчёта: {((job?.elapsedMs ?? 0) / 1000).toFixed(1)} с.</p></div>
    <details><summary>Зазоры и партия</summary><div className="fields">{spacing('sheetEdgeGap', 'Зазор от края листа')}{spacing('sheetPartGap', 'Зазор между деталями')}</div><NumberField label="Одинаковые столы в партии резки" min={1} max={10} step={1} value={config.nestingCopies} onValue={copies => change({ nestingCopies: Math.max(1, Math.min(10, Math.floor(copies))) })} /><p>Повороты выбираются сервером автоматически. В отверстия другие детали не вкладываются.</p></details>
    <details><summary>Раскладка и резка</summary><p className="nesting-hint">Скачиваемые производственные файлы содержат только DXF. Проект, JSON и пояснительные файлы в архивы оператора не добавляются.</p><p>Поиск выполняется на сервере и завершается по устойчивой сходимости либо лимиту времени. Результат — лучший найденный проверенный вариант, а не доказанный глобальный оптимум.</p></details>
  </>

  return <div className="sheet-workspace"><div className="sheet-canvas">
    {focused ? mode === '3d' ? <Suspense fallback={<div className="three-loading">Загрузка 3D…</div>}><ThreeAssembly config={config} parts={[]} assembly={{ plates: [], tubes: [] }} dark={dark} resetToken={0} nesting={focused as NestingResult} /></Suspense>
      : <DrawingViewport bounds={{ width: settings.length, height: settings.width }} parts={features} geometryKey={`${selected}:${JSON.stringify(features)}`} units={config.units} label={`Раскладка резки на листе ${selected + 1}`}><g><rect className="stock-outline" x={0} y={0} width={settings.length} height={settings.width} /><rect className="stock-margin" x={settings.edgeGap} y={settings.edgeGap} width={Math.max(0, settings.length - 2 * settings.edgeGap)} height={Math.max(0, settings.width - 2 * settings.edgeGap)} />{metric && metric.remnant.width > 0 && metric.remnant.height > 0 && <rect className="stock-remnant" {...metric.remnant} />}{sheet!.placements.map(item => <g key={`${item.part.name}:${item.instance}`} className="nested-part" transform={`translate(${item.translation.x} ${item.translation.y}) rotate(${item.rotation})`}><title>{item.part.label} · {item.instance + 1} · {item.rotation}°</title><path d={item.part.contours.map(svgContourPath).join(' ')} fillRule="evenodd" />{item.part.holes.map(hole => <circle key={hole.id} cx={hole.x} cy={hole.y} r={hole.d / 2} />)}{(job?.engravings[item.part.name] ?? []).map((line, index) => <line key={index} className="nested-engraving" x1={line.from.x} y1={line.from.y} x2={line.to.x} y2={line.to.y} />)}</g>)}</g></DrawingViewport>
      : <div className="three-loading" role="status">{error ? 'Сбой серверного расчёта' : 'Подготовка первой раскладки…'}</div>}
    <div className="sheet-view-tools"><button aria-pressed={mode === '2d'} onClick={() => setMode('2d')}>План резки 2D</button><button aria-pressed={mode === '3d'} onClick={() => setMode('3d')}>3D</button></div>
  </div>{wide ? <section className="sheet-panel" aria-labelledby="nesting-title">{inspector}</section> : <><button className="sheet-mobile-summary" aria-haspopup="dialog" aria-controls="sheet-dialog" onClick={() => setInspectorOpen(true)}><span><strong>{complete && result ? `Деталей: ${result.placements.length} · листов: ${result.sheets.length}` : 'Раскладка на листах'}</strong><small>{statusLabel} · инструменты и экспорт</small></span><Icon name="chevron" /></button><WorkspaceDialog id="sheet-dialog" title="Раскладка на листах" className="sheet-dialog" open={inspectorOpen} onClose={() => setInspectorOpen(false)}><div className="sheet-inspector">{inspector}</div></WorkspaceDialog></>}</div>
}
