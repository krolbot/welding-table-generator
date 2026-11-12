import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../Icon.js'
import { NumberInput } from '../NumberInput.js'
import { projectConfig, type Config } from '../model.js'
import { svgContourPath, type Point } from '../geometry.js'
import { transformNestingContour, transformNestingPoint, type NestingResult } from '../nesting.js'
import { createToolingConfig, getToolingEntry, toolingCatalog } from './catalog.js'
import type { ParameterValue, SheetMaterial, ToolingAssembly, ToolingRoute } from './model.js'
import { ToolingThree } from './ToolingThree.js'
import { decodeCombinedProject, encodeCombinedProject, makeBasketItem, parseCombinedProject, parseNestingSettings, PROJECT_VERSION, sheetMaterials, type CombinedProject, type ToolingBasketItem } from './project.js'
import { buildProductionModel, downloadProductionArchive, productionNestingKey, validateProductionNesting, type NestingSettings, type ProductionModel } from './production.js'
import type { ToolingNestingResponse } from './nesting.worker.js'

type ToolingView = '2d' | '3d' | 'sheet'
type Props = {
  table: Config
  dark: boolean
  onBack: () => void
  onToggleTheme: () => void
  onLoadTable: (value: unknown) => void
}

const initialProject = (table: Config): { project: CombinedProject; error: string } => {
  const encoded = new URLSearchParams(location.search).get('project')
  if (encoded) {
    try { return { project: decodeCombinedProject(encoded), error: '' } }
    catch (error) { return { project: { version: PROJECT_VERSION, table: projectConfig(table), includeTable: false, tooling: [] }, error: error instanceof Error ? `Share Link rejected: ${error.message}` : 'Share Link rejected' } }
  }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem('weldingToolingProject') ?? 'null')
    return { project: parseCombinedProject(raw), error: '' }
  } catch {
    return { project: { version: PROJECT_VERSION, table: projectConfig(table), includeTable: false, tooling: [] }, error: '' }
  }
}

const assemblyLayout = (assembly: ToolingAssembly) => {
  const gap = 40
  const maxWidth = Math.max(800, ...assembly.parts.map(part => part.width + gap))
  let x = gap, y = gap, row = 0
  const items: Array<{ part: ToolingAssembly['parts'][number]; x: number; y: number }> = []
  for (const part of assembly.parts) {
    if (x + part.width + gap > maxWidth) { x = gap; y += row + gap; row = 0 }
    items.push({ part, x: x + part.width / 2, y: y + part.height / 2 })
    x += part.width + gap
    row = Math.max(row, part.height)
  }
  return { items, width: maxWidth, height: y + row + gap }
}

const downloadJson = (project: CombinedProject) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'WeldingTable_Tooling_Project.json'
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}

const copy = async (value: string) => {
  if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
  await navigator.clipboard.writeText(value)
}

const modelResult = (table: Config, items: ToolingBasketItem[], includeTable: boolean) => {
  try { return { model: buildProductionModel(table, items, includeTable), error: '' } }
  catch (error) { return { model: undefined, error: error instanceof Error ? error.message : 'Could not build the production model' } }
}

export function ToolingWorkspace({ table, dark, onBack, onToggleTheme, onLoadTable }: Props) {
  const initial = useMemo(() => initialProject(table), [])
  const [items, setItems] = useState<ToolingBasketItem[]>(initial.project.tooling)
  const [includeTable, setIncludeTable] = useState(initial.project.includeTable)
  const [selected, setSelected] = useState(initial.project.tooling[0]?.instanceId ?? '')
  const [query, setQuery] = useState('')
  const [route, setRoute] = useState<ToolingRoute | 'all'>('all')
  const [view, setView] = useState<ToolingView>('2d')
  const [exploded, setExploded] = useState(0)
  const [reset3d, setReset3d] = useState(0)
  const [notice, setNotice] = useState(initial.error)
  const [settings, setSettings] = useState<NestingSettings>(initial.project.nesting ?? { sheetLength: table.sheetLength, sheetWidth: table.sheetWidth, edgeGap: table.sheetEdgeGap, partGap: table.sheetPartGap, rotations: [0, 90, 180, 270] })
  const [nesting, setNesting] = useState<{ key: string; results: Record<string, NestingResult> }>({ key: '', results: {} })
  const [nestingState, setNestingState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty')
  const [nestingError, setNestingError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const loadInitialTable = useRef(onLoadTable)
  loadInitialTable.current = onLoadTable
  const active = items.find(item => item.instanceId === selected)
  const activeEntry = active ? getToolingEntry(active.config.id) : undefined
  const activeAssembly = useMemo(() => {
    if (!active) return { value: undefined, error: '' }
    try { return { value: buildProductionModel(table, [active], false).lines[0].assembly, error: '' } }
    catch (error) { return { value: undefined, error: error instanceof Error ? error.message : 'Invalid tooling geometry' } }
  }, [active, table])
  const production = useMemo(() => modelResult(table, items, includeTable), [table, items, includeTable])
  const project = useMemo<CombinedProject>(() => ({ version: PROJECT_VERSION, table: projectConfig(table), includeTable, tooling: items, nesting: settings }), [table, includeTable, items, settings])
  const nestingKey = useMemo(() => production.model ? productionNestingKey(production.model, settings) : '', [production.model, settings])
  const nestingValid = Boolean(production.model && nesting.key === nestingKey && validateProductionNesting(production.model, nesting.results, settings))

  useEffect(() => {
    if (initial.error) return
    loadInitialTable.current(initial.project.table)
    const url = new URL(location.href)
    if (url.searchParams.has('project')) {
      url.searchParams.delete('project')
      history.replaceState(null, '', url)
    }
  }, [initial])
  useEffect(() => {
    try { localStorage.setItem('weldingToolingProject', JSON.stringify(project)) }
    catch { setNotice('Autosave is unavailable. Save the project JSON manually.') }
  }, [project])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    const model = production.model
    if (!model || !model.groups.length) { setNesting({ key: '', results: {} }); setNestingState('empty'); return }
    setNestingState('loading')
    setNestingError('')
    setNesting({ key: '', results: {} })
    const worker = new Worker(new URL('./nesting.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ToolingNestingResponse>) => {
      if (event.data.key !== nestingKey) return
      if (event.data.error || !event.data.results) { setNestingState('error'); setNestingError(event.data.error ?? 'Nesting returned no result'); return }
      setNesting({ key: event.data.key, results: event.data.results })
      setNestingState('ready')
    }
    worker.onerror = () => { setNestingState('error'); setNestingError('The nesting worker failed') }
    worker.postMessage({ key: nestingKey, groups: model.groups, settings })
    return () => worker.terminate()
  }, [nestingKey])

  const catalog = toolingCatalog.filter(entry => (route === 'all' || entry.route === route) && `${entry.id} ${entry.name} ${entry.function}`.toLowerCase().includes(query.toLowerCase()))
  const add = (id: (typeof toolingCatalog)[number]['id']) => {
    const item = makeBasketItem(id)
    setItems(current => [...current, item])
    setSelected(item.instanceId)
  }
  const replace = (next: ToolingBasketItem) => setItems(current => current.map(item => item.instanceId === next.instanceId ? next : item))
  const remove = (id: string) => setItems(current => {
    const index = current.findIndex(item => item.instanceId === id)
    const next = current.filter(item => item.instanceId !== id)
    if (selected === id) setSelected(next[Math.min(index, next.length - 1)]?.instanceId ?? '')
    return next
  })
  const duplicate = (item: ToolingBasketItem) => {
    const copy = { ...item, instanceId: crypto.randomUUID(), config: { ...item.config, values: { ...item.config.values } } }
    setItems(current => [...current, copy])
    setSelected(copy.instanceId)
  }
  const setParameter = (key: string, value: ParameterValue) => {
    if (!active) return
    try { replace({ ...active, config: createToolingConfig(active.config.id, { ...active.config.values, [key]: value }) }) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Invalid parameter') }
  }
  const open = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const loaded = parseCombinedProject(JSON.parse(String(reader.result)))
        onLoadTable(loaded.table)
        setItems(loaded.tooling)
        setIncludeTable(loaded.includeTable)
        setSettings(loaded.nesting ?? { sheetLength: table.sheetLength, sheetWidth: table.sheetWidth, edgeGap: table.sheetEdgeGap, partGap: table.sheetPartGap, rotations: [0, 90, 180, 270] })
        setSelected(loaded.tooling[0]?.instanceId ?? '')
        setNotice(loaded.tooling.length ? 'Full project loaded.' : 'Legacy table project loaded; tooling basket is empty.')
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not read this project') }
    }
    reader.onerror = () => setNotice('Could not read this project')
    reader.readAsText(file)
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('project', encodeCombinedProject(project))
    try { await copy(url.toString()); setNotice('Full table and tooling link copied.') }
    catch { setNotice('Clipboard access was denied. Save the project JSON instead.') }
  }
  const updateSetting = (key: keyof Omit<NestingSettings, 'rotations'>, value: number) => {
    try { setSettings(parseNestingSettings({ ...settings, [key]: value })) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Invalid nesting settings') }
  }

  return <main className="app-shell tooling-app">
    <aside className="settings tooling-sidebar">
      <header><div className="brand"><Icon name="settings" size={24} /><h2>Welding Tooling</h2></div><button className="icon" aria-label="Toggle color theme" onClick={onToggleTheme}><Icon name={dark ? 'sun' : 'moon'} /></button></header>
      <div className="workspace-switch"><button onClick={onBack}>Table</button><button className="active">Tooling</button></div>
      <div className="settings-scroll">
        <section className="fixture-card tooling-catalog"><h3>Catalog — 34 items</h3>
          <input aria-label="Search tooling catalog" type="search" placeholder="Search ID, name or function" value={query} onChange={event => setQuery(event.target.value)} />
          <div className="grid-buttons route-filter">{(['all', 'cut', 'welded', 'hybrid'] as const).map(value => <button key={value} className={route === value ? 'active' : ''} onClick={() => setRoute(value)}>{value === 'all' ? 'All' : value}</button>)}</div>
          <div className="catalog-list">{catalog.map(entry => <button key={entry.id} onClick={() => add(entry.id)}><b>{entry.id}</b><span>{entry.name}</span><small>{entry.route}</small></button>)}</div>
          {!catalog.length && <p className="empty-state">No catalog items match this filter.</p>}
        </section>
        <section><h3>Production basket</h3><label className="checkbox"><input type="checkbox" checked={includeTable} onChange={event => setIncludeTable(event.target.checked)} /><span>Include the current welding table (S235JR)</span></label>
          <div className="basket-list">{items.map(item => { const entry = getToolingEntry(item.config.id); return <button key={item.instanceId} className={selected === item.instanceId ? 'active' : ''} onClick={() => setSelected(item.instanceId)}><b>{entry.id}</b><span>{entry.name}</span><small>×{item.quantity} · {item.material}</small></button> })}</div>
          {!items.length && <p className="empty-state">Basket is empty. Add any of the 34 catalog items above.</p>}
        </section>
        {active && activeEntry && <section key={active.instanceId} className="tooling-editor"><h3>{activeEntry.id} · {activeEntry.name}</h3><p>{activeEntry.function}</p>
          <div className="fields"><label className="field"><span>Assembly quantity</span><NumberInput min={1} max={20} step={1} value={String(active.quantity)} onValue={value => Number.isInteger(value) && value >= 1 && value <= 20 && replace({ ...active, quantity: value })} /></label><label className="field"><span>Sheet material</span><select value={active.material} onChange={event => replace({ ...active, material: event.target.value as SheetMaterial })}>{sheetMaterials.map(value => <option key={value}>{value}</option>)}</select></label></div>
          {activeEntry.parameters.map(parameter => parameter.type === 'boolean' ? <label className="checkbox" key={parameter.key}><input type="checkbox" checked={Boolean(active.config.values[parameter.key])} onChange={event => setParameter(parameter.key, event.target.checked)} /><span>{parameter.label}</span></label> : parameter.type === 'enum' ? <label className="field" key={parameter.key}><span>{parameter.label}</span><select value={String(active.config.values[parameter.key])} onChange={event => setParameter(parameter.key, event.target.value)}>{parameter.options.map(value => <option key={value}>{value}</option>)}</select></label> : <label className="field" key={parameter.key}><span>{parameter.label} ({parameter.unit})</span><NumberInput value={String(active.config.values[parameter.key])} min={parameter.minimum} max={parameter.maximum} step={parameter.step} onValue={value => setParameter(parameter.key, value)} /></label>)}
          <div className="editor-actions"><button className="secondary" onClick={() => duplicate(active)}>Copy</button><button className="secondary danger" onClick={() => remove(active.instanceId)}>Delete</button></div>
          {activeAssembly.error && <p className="socket-error" role="alert">{activeAssembly.error}</p>}
        </section>}
        <section><h3>Sheet nesting (mm)</h3><div className="fields"><label className="field"><span>Length</span><NumberInput min={100} value={String(settings.sheetLength)} onValue={value => updateSetting('sheetLength', value)} /></label><label className="field"><span>Width</span><NumberInput min={100} value={String(settings.sheetWidth)} onValue={value => updateSetting('sheetWidth', value)} /></label></div><div className="fields"><label className="field"><span>Edge gap</span><NumberInput min={0} value={String(settings.edgeGap)} onValue={value => updateSetting('edgeGap', value)} /></label><label className="field"><span>Part gap</span><NumberInput min={0} value={String(settings.partGap)} onValue={value => updateSetting('partGap', value)} /></label></div><p>Every material/thickness pair is nested independently. Internal holes remain occupied and cannot contain other parts.</p></section>
      </div>
      <section className="production-card"><h3>Production estimate</h3>{production.model ? <><div className="estimate"><div><span>Sheet mass</span><strong>{production.model.massKg.toFixed(1)}<small>kg</small></strong></div><div><span>Cut length</span><strong>{production.model.cutLengthM.toFixed(1)}<small>m</small></strong></div></div><div className="estimate-extra"><span>Groups: <b>{production.model.groups.length}</b></span><span>Purchased lines: <b>{production.model.purchased.length}</b></span></div></> : <p className="socket-error">{production.error}</p>}</section>
      <section className="exports"><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={open} /><div><button className="secondary" onClick={() => fileInput.current?.click()}><Icon name="folder" size={14} />Open</button><button className="secondary" onClick={() => downloadJson(project)}><Icon name="save" size={14} />Save</button></div><button className="secondary full share" onClick={() => void share()}><Icon name="share" size={14} />Share Link</button><button className="zip" disabled={!nestingValid || !production.model} onClick={() => production.model && void downloadProductionArchive(production.model, nesting.results, settings).catch(error => setNotice(error instanceof Error ? error.message : 'Export failed'))}><Icon name="archive" size={18} />Production ZIP</button></section>
    </aside>
    <section className="work-area tooling-work" data-view={view}>
      <div className="mode"><button className={view === '2d' ? 'active' : ''} onClick={() => setView('2d')}><Icon name="frame" />Parts 2D</button><button className={view === '3d' ? 'active' : ''} onClick={() => setView('3d')}><Icon name="box" />Assembly 3D</button><button className={view === 'sheet' ? 'active' : ''} onClick={() => setView('sheet')}><Icon name="layers" />Common nesting</button></div>
      {!activeAssembly.value && view !== 'sheet' ? <div className="three-loading empty-state">Select or add a tooling assembly.</div> : view === '2d' && activeAssembly.value ? <ToolingParts2d assembly={activeAssembly.value} /> : view === '3d' && activeAssembly.value ? <><div className="drawing-frame"><ToolingThree assembly={activeAssembly.value} exploded={exploded} dark={dark} resetToken={reset3d} /></div><div className="three-tools tooling-three-tools"><header><h3>{activeAssembly.value.id} · {activeAssembly.value.name}</h3><button onClick={() => setReset3d(value => value + 1)}><Icon name="maximize" size={12} />Reset view</button></header><label className="slider-field"><span>Exploded view <output>{exploded}%</output></span><input aria-label="Exploded view" type="range" min={0} max={100} value={exploded} onChange={event => setExploded(Number(event.target.value))} /></label></div></> : <ToolingSheets model={production.model} state={nestingState} error={nestingError} results={nesting.results} settings={settings} />}
      {activeAssembly.value && view !== 'sheet' && <div className="tooling-summary"><b>{activeAssembly.value.id} · {activeAssembly.value.name}</b><span>{activeAssembly.value.parts.length} unique sheet parts · {activeAssembly.value.instances.length} assembly instances · {activeAssembly.value.joints.length} modeled connections</span>{activeAssembly.value.purchased.length > 0 && <details><summary>Purchased components ({activeAssembly.value.purchased.length})</summary><ul>{activeAssembly.value.purchased.map(item => <li key={item.id}><b>{item.quantity}× {item.description}</b><code>{JSON.stringify(item.interfaceParameters)}</code></li>)}</ul></details>}{activeAssembly.value.warnings.map(value => <p key={value}>{value}</p>)}</div>}
      {notice && <output className="notice" aria-live="polite" onClick={() => setNotice('')}>{notice}</output>}
    </section>
  </main>
}

function ToolingParts2d({ assembly }: { assembly: ToolingAssembly }) {
  const layout = assemblyLayout(assembly)
  return <div className="drawing-frame tooling-2d"><svg className="layout" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-label={`${assembly.id} native sheet parts`}><g transform={`translate(0 ${layout.height}) scale(1 -1)`}>{layout.items.map(item => <g className="part" key={item.part.name} transform={`translate(${item.x} ${layout.height - item.y})`}><path className="contour" d={svgContourPath(item.part.contours[0])} />{item.part.contours.slice(1).map((contour, index) => <path className="slot-contour" d={svgContourPath(contour)} key={index} />)}{item.part.holes.map(hole => <circle className="hole" key={hole.id} cx={hole.x} cy={hole.y} r={hole.d / 2} />)}</g>)}</g></svg></div>
}

function ToolingSheets({ model, state, error, results, settings }: { model?: ProductionModel; state: 'empty' | 'loading' | 'ready' | 'error'; error: string; results: Record<string, NestingResult>; settings: NestingSettings }) {
  if (!model?.groups.length) return <div className="three-loading empty-state">Add tooling or include the table to calculate common nesting.</div>
  if (state === 'loading') return <div className="three-loading">Calculating validated contour nesting in a worker…</div>
  if (state === 'error') return <div className="three-loading socket-error" role="alert">{error}</div>
  const totalSheets = model.groups.reduce((sum, group) => sum + (results[group.key]?.sheets.length ?? 0), 0)
  let row = 0
  const sheets = model.groups.flatMap(group => (results[group.key]?.sheets ?? []).map(sheet => ({ group, sheet, row: row++ })))
  const height = Math.max(settings.sheetWidth, totalSheets * (settings.sheetWidth + 80))
  return <div className="drawing-frame tooling-sheets"><svg className="layout" viewBox={`0 0 ${settings.sheetLength + 200} ${height + 100}`} aria-label="Material and thickness grouped sheet nesting"><g transform={`translate(100 50)`}>{sheets.map(({ group, sheet, row: sheetRow }) => { const y = sheetRow * (settings.sheetWidth + 80); return <g key={`${group.key}:${sheet.index}`} transform={`translate(0 ${y})`}><rect className="sheet-outline" width={settings.sheetLength} height={settings.sheetWidth} /><text className="sheet-label" x={0} y={-16}>{group.material} · {group.thickness} mm · sheet {sheet.index + 1}</text>{sheet.placements.map(placement => <g className="part" key={`${placement.part.name}:${placement.instance}`}><path className="contour" d={svgContourPath(transformNestingContour(placement.part.contours[0], placement))} />{placement.part.contours.slice(1).map((contour, index) => <path className="slot-contour" key={index} d={svgContourPath(transformNestingContour(contour, placement))} />)}{placement.part.holes.map(hole => { const center: Point = transformNestingPoint(hole, placement); return <circle className="hole" key={hole.id} cx={center.x} cy={center.y} r={hole.d / 2} /> })}</g>)}</g>})}</g></svg><div className="nesting-status">{state === 'ready' ? `${totalSheets} sheets · ${model.groups.length} material/thickness groups` : 'No result'}</div></div>
}
