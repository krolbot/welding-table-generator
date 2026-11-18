import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { GeneratorShell, NumberField, ParameterGroup, ProductionEstimate, ProjectActions, VisualizationSettings, type ViewMode, type VisualSettings } from '../GeneratorWorkspace'
import { PartsLayout } from '../PartsLayout'
import { display, mmPerInch, projectConfig, readDisplay, type Config } from '../model'
import { copyText, downloadFile } from '../projectIO'
import { tableProjectQuery } from '../tableProject'
import { Icon } from '../Icon'

import { extensionLimits, type ExtensionConfig } from './extension'
import { squareLimits, type SquareConfig } from './square'
import { compactExtensionLimits, type CompactExtensionConfig } from './compactExtension'
import { viseModuleLimits, viseSlotSetback, type ViseModuleConfig } from './viseModule'
import { cornerBracketLimits, type CornerBracketConfig } from './cornerBracket'
import { defaultToolProject, toolDefaults, toolIds, isToolId, projectJson, projectKey, projectAtTable, resetToolProject, toolLabels, type ToolId, type ToolProject } from './project'
import { downloadFromApi, previewTool } from '../serverApi'
import type { ToolPreviewDto } from '../apiContracts'

const ToolAssembly3d = lazy(() => import('./ToolAssembly3d').then(module => ({ default: module.ToolAssembly3d })))
export type ToolsWorkspaceProps = {
  dark: boolean; onTheme: () => void; onBack: () => void
  view: ViewMode; onView: (view: ViewMode) => void
  notice: string; onDismissNotice: () => void
  units: Config['units']; onUnits: (units: Config['units']) => void
  visual: VisualSettings; onVisual: (changes: Partial<VisualSettings>) => void
  tableConfig: Config; onAddToTable: (project: ToolProject) => void
}
const storageKey = 'weldingToolsProject'

type ToolDimension = keyof ExtensionConfig | keyof SquareConfig | keyof CornerBracketConfig | keyof CompactExtensionConfig | Exclude<keyof ViseModuleConfig, 'grid'>
const sizeLabels: Record<ToolDimension, string> = {
  length: 'Длина', width: 'Ширина', height: 'Высота монтажного торца', thickness: 'Толщина листа · стол',
  armWidth: 'Ширина плеча', holeDiameter: 'Диаметр отверстия Ø', endOffset: 'Отступ отверстия от свободных концов',
  holePitch: 'Шаг отверстий', slotLength: 'Длина паза для струбцины', cornerCut: 'Внутренний угловой вырез',
  tipWidth: 'Ширина свободного конца', tabWidth: 'Ширина установочного шипа', clearance: 'Общий зазор в соединении',
  holeInset: 'Начало сетки от краёв', tipHeight: 'Глубина свободного конца', taperRun: 'Длина скоса свободного конца',
  windowInset: 'Отступ окон от края', windowRadius: 'Радиус углов окон',
  slotWidth: 'Ширина радиального паза', slotInnerRadius: 'Радиус внутреннего конца паза от центра',
}

const sizeLimits = { extension: extensionLimits, compactExtension: compactExtensionLimits, square: squareLimits, cornerBracket: cornerBracketLimits, viseModule: viseModuleLimits }
const toolSummaries: Record<ToolId, string> = {
  extension: 'Сетка D16 / 50 мм · толщина листа от стола',
  compactExtension: 'Три пластины · центральное ребро с окнами · один монтажный торец',
  square: 'Одна плоская Г-образная пластина · три монтажных отверстия · без гибки',
  cornerBracket: 'Три плоские детали · две перпендикулярные стенки · открытая диагональная сторона',
  viseModule: 'Пять пластин · восемь радиальных пазов для тисков · монтажная сетка по столу',
}

export function ToolsWorkspace({ dark, onTheme, onBack, view, onView, notice, onDismissNotice, units, onUnits, visual, onVisual, tableConfig, onAddToTable }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = new URLSearchParams(location.search).get('toolProject') ?? localStorage.getItem(storageKey)
      const raw = saved ? JSON.parse(saved) as ToolProject : defaultToolProject
      if (!isToolId(raw.tool) || !raw.size || !raw.sheet) throw new Error('Некорректный файл проекта инструмента')
      return { project: projectAtTable(raw, tableConfig), notice: '' }
    } catch (error) {
      return { project: projectAtTable(defaultToolProject, tableConfig), notice: `Проект инструмента не загружен: ${error instanceof Error ? error.message : 'хранилище недоступно'}.` }
    }
  })
  const [storedProject, setProject] = useState<ToolProject>(initial.project)
  const project = useMemo(() => projectAtTable(storedProject, tableConfig), [storedProject, tableConfig.thickness, tableConfig.holeDiameter, tableConfig.pitch, tableConfig.margin, tableConfig.grid])
  const [message, setMessage] = useState(initial.notice)
  const [reset, setReset] = useState(0)
  const key = projectKey(project)
  const [previewState, setPreviewState] = useState<{ key: string; value: ToolPreviewDto } | null>(null)
  const preview = previewState?.key === key ? previewState.value : null
  const [previewError, setPreviewError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void previewTool(JSON.parse(projectJson(project)), projectConfig(tableConfig), controller.signal).then(value => {
        setPreviewState({ key, value }); setPreviewError('')
        if (projectKey(value.project) !== key) setProject(value.project)
      }).catch(error => { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : 'Сервер не рассчитал инструмент') })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [key, tableConfig.thickness, tableConfig.holeDiameter, tableConfig.pitch, tableConfig.margin, tableConfig.grid])
  useEffect(() => {
    if (previewError) return
    try { localStorage.setItem(storageKey, projectJson(project)); localStorage.setItem(`${storageKey}.${project.tool}`, projectJson(project)) }
    catch { setMessage('Автосохранение в браузере недоступно. Сохраните проект в файл.') }
  }, [key, previewError])
  const layout = preview?.layout
  const summary = preview?.summary
  const admissionError = previewError || preview?.admissionError?.message
  const factor = units === 'mm' ? 1 : mmPerInch, unitLabel = units === 'mm' ? 'мм' : 'дюйм'

  const apply = (candidate: ToolProject) => {
    const next = projectAtTable(candidate, tableConfig)
    if (projectKey(next) === key) return true
    const url = new URL(location.href)
    if (url.searchParams.has('toolProject')) { url.searchParams.set('toolProject', projectJson(next)); history.replaceState(history.state, '', url) }
    setProject(next)
    return true
  }
  const selectTool = (id: ToolId) => {
    if (id === project.tool) return
    try {
      const saved = localStorage.getItem(`${storageKey}.${id}`)
      const raw = saved ? JSON.parse(saved) as ToolProject : { ...toolDefaults[id], sheet: { ...project.sheet } }
      const next = projectAtTable(raw, tableConfig)
      if (next.tool !== id) throw new Error('Тип сохранённой оснастки не совпадает с выбранным изделием')
      if (apply(next)) setReset(value => value + 1)
    } catch (error) { setMessage(`Инструмент не загружен: ${error instanceof Error ? error.message : 'хранилище недоступно'}`) }
  }
  const applySize = (name: ToolDimension, value: number) => {
    const next = readDisplay(value, units)
    switch (project.tool) {
      case 'extension': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'compactExtension': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'viseModule': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'square': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'cornerBracket': return apply({ ...project, size: { ...project.size, [name]: next } })
    }
  }
  const resetCurrentTool = () => {
    const next = resetToolProject(project, tableConfig)
    setPreviewState(null)
    setPreviewError('')
    if (apply(next)) {
      setReset(value => value + 1)
      setMessage(`Параметры «${toolLabels[next.tool]}» сброшены. Настройки листа сохранены.`)
    }
  }
  const sizeField = (name: ToolDimension) => {
    const limits = sizeLimits[project.tool]
    if (!(name in project.size) || !(name in limits)) return null
    const value = project.size[name as keyof typeof project.size]
    const range = limits[name as keyof typeof limits]
    const readOnly = name === 'thickness' || project.tool === 'viseModule' && ['holeDiameter', 'holePitch', 'holeInset'].includes(name)
    const label = name === 'height' && project.tool !== 'extension' ? 'Высота' : sizeLabels[name]
    return <NumberField key={`${project.tool}:${name}`} label={label} readOnly={readOnly} value={String(Number(display(value, units, 3)))} min={range.min / factor} max={range.max / factor} step={range.step / factor}
      onValue={value => applySize(name, value)} />
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = tableProjectQuery(tableConfig).toString()
    url.searchParams.set('toolProject', projectJson(project))
    url.searchParams.set('workspace', 'tools'); url.searchParams.set('view', view)
    try { await copyText(url.toString()); setMessage('Ссылка на проект оснастки скопирована.') }
    catch { setMessage('Нет доступа к буферу обмена. Сохраните проект в файл.') }
  }
  const open = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text())
      const accepted = await previewTool(raw, projectConfig(tableConfig))
      if (apply(accepted.project)) { setReset(value => value + 1); setMessage('Проект инструмента открыт.') }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось открыть проект') }
  }
  return <GeneratorShell workspace="tools" onWorkspace={value => { if (value === 'table') onBack() }} dark={dark} onTheme={onTheme} units={units} onUnits={onUnits} view={view}
    onView={onView} notice={message || notice} onDismissNotice={() => { setMessage(''); onDismissNotice() }}
    settings={<>
      <>
        <section className="fixture-card"><h3>Инструмент</h3><label className="field"><span>Выберите изделие</span><select aria-label="Выбрать изделие" value={project.tool} onChange={event => { const value = event.target.value; if (isToolId(value)) selectTool(value) }}>{toolIds.map(id => <option key={id} value={id}>{toolLabels[id]}</option>)}</select></label><p className="grid-summary">{toolSummaries[project.tool]}</p></section>
        <ParameterGroup title={<>Размеры ({unitLabel})</>} defaultOpen><div className="fields">{sizeField('length')}{sizeField('width')}{project.tool === 'square' ? sizeField('armWidth') : sizeField('height')}{sizeField('thickness')}</div><p>Толщина металла задаётся в разделе «Стол» и применяется ко всем инструментам.</p></ParameterGroup>
        {project.tool === 'viseModule' && <><ParameterGroup title={<>Монтажная сетка стола ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Диаметр, шаг, начало от края и схема «{project.size.grid === 'square' ? 'квадратная' : 'диагональная'}» берутся из генератора стола. На монтажной стенке строится полная совпадающая сетка с отсчётом вниз от рабочей поверхности; отверстия не смещаются и не удаляются ради размещения. Нижние боковые ряды ограничены криволинейным профилем.</p></ParameterGroup><ParameterGroup title={<>Пазы тисков и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('slotWidth')}{sizeField('slotInnerRadius')}{sizeField('tipHeight')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Восемь отдельных скруглённых пазов с шагом 45° и центральное круглое отверстие. Каждый внешний скруглённый конец останавливается за {display(viseSlotSetback, units, 3)} {unitLabel} до границы пластины по своему лучу; диагонали квадратной верхней пластины заканчиваются на таком же расстоянии от углов. Длины пазов пересчитываются вместе с размером пластины. Расстояние измеряется вдоль оси каждого паза, а не перпендикулярно стороне.</p></ParameterGroup></>}
        {project.tool === 'square' && <ParameterGroup title={<>Монтажные отверстия ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('endOffset')}</div><p>Одно отверстие у внутреннего угла и по одному у каждого свободного конца. Центр углового отверстия отстоит от обеих наружных кромок на половину ширины плеча. Сверьте полученные межцентровые расстояния со своим столом.</p></ParameterGroup>}
        {project.tool === 'compactExtension' && <><ParameterGroup title={<>Сетка оснастки ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Начала сетки на рабочей поверхности и монтажном торце зафиксированы относительно краёв. Первый торцевой ряд отсчитывается вниз от рабочей поверхности в сборе. Конфликтующие отверстия отклоняются, а не смещаются и не удаляются.</p></ParameterGroup><ParameterGroup title={<>Центральное ребро и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('tipHeight')}{sizeField('taperRun')}{sizeField('windowInset')}{sizeField('windowRadius')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Отступ окон задаёт ширину материала по периметру. Диагональные перемычки между соседними окнами: {display(project.size.windowInset * 2, units, 3)} {unitLabel}. Сохранённые проекты сохраняют выбранный отступ.</p></ParameterGroup></>}
        {project.tool === 'cornerBracket' && <><ParameterGroup title={<>Монтажные отверстия и паз ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('slotLength')}</div><p>Девять отверстий основания образуют треугольную сетку без позиции во внутреннем углу; в одной стенке три отверстия, в другой — один скруглённый паз. Ширина паза равна диаметру отверстия.</p></ParameterGroup><ParameterGroup title={<>Профиль и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('cornerCut')}{sizeField('tipWidth')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Внутренний угловой вырез проходит через основание и обе стенки. При значении 60 мм материал каждой стенки начинается в 60 мм от общего угла.</p></ParameterGroup></>}

      </>
    </>}
    visualization={<VisualizationSettings value={visual} onChange={onVisual} />}
    production={summary && <ProductionEstimate summary={summary} units={units} sheet={project.sheet} onSheetChange={changes => apply({ ...project, sheet: { ...project.sheet, ...changes } })} />}
    actions={onClose => <ProjectActions subject="инструмента" onOpen={file => { onClose(); void open(file) }} onSave={() => downloadFile(JSON.stringify(project, null, 2), `проект-инструмента-${project.tool}.wtool`)} onShare={() => { onClose(); void share() }} disabled={Boolean(previewError)} fabrication={{ kind: 'parts', onZip: () => void downloadFromApi('/api/export/tool-parts.zip', { project, table: projectConfig(tableConfig) }).catch(error => setMessage(error instanceof Error ? error.message : 'Не удалось создать ZIP-архив.')), onDxf: () => void downloadFromApi('/api/export/tool.dxf', { project, table: projectConfig(tableConfig) }).catch(error => setMessage(error instanceof Error ? error.message : 'Не удалось создать DXF.')) }} />}>
    <div className="tool-cut-bar"><div><strong>Добавить в раскрой</strong><small>{toolLabels[project.tool]} · металл {display(tableConfig.thickness, units, 3)} {unitLabel}</small></div><NumberField label="Количество" value={project.copies} min={1} max={10} step={1} onValue={copies => apply({ ...project, copies })} /><button disabled={Boolean(admissionError) || !preview} onClick={() => preview && onAddToTable(preview.project)}><Icon name="plus" size={14} />Добавить</button>{admissionError && <p role="alert" className="socket-error">{admissionError}</p>}</div>
    {previewError ? <div className="three-loading socket-error" role="alert"><div className="tool-recovery"><p>{previewError} Перед изготовлением измените толщину стола или размеры инструмента либо сбросьте этот инструмент.</p><button className="secondary" onClick={resetCurrentTool}>Сбросить параметры инструмента</button></div></div>
      : !preview || !layout ? <div className="three-loading" role="status">Расчёт инструмента на сервере…</div>
      : view === '2d' ? <PartsLayout layout={layout} units={units} label={`Интерактивная 2D-раскладка деталей: ${toolLabels[project.tool]}`} resetToken={reset} />
      : <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Загрузка 3D…</div>}><ToolAssembly3d project={preview.project} parts={preview.parts} placements={preview.assembly} envelope={preview.envelope} weights={preview.weights} dark={dark} units={units} resetToken={reset} {...visual} /></Suspense></div></>}
  </GeneratorShell>
}
