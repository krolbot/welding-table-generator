import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { GeneratorShell, NumberField, ParameterGroup, ProductionEstimate, ProjectActions, VisualizationSettings, type ViewMode, type VisualSettings } from '../GeneratorWorkspace'
import { PartsLayout } from '../PartsLayout'
import { SheetNesting } from '../SheetNesting'
import { arrangeParts, fabricationEstimate } from '../fabricationLayout'
import { display, mmPerInch, readDisplay, type Config } from '../model'
import { copyText, downloadFile } from '../projectIO'
import { tableProjectQuery } from '../tableProject'
import type { NavigationGuard } from '../viewNavigation'
import { extensionLimits, type ExtensionConfig } from './extension'
import { squareLimits, type SquareConfig } from './square'
import { compactExtensionLimits, type CompactExtensionConfig } from './compactExtension'
import { viseModuleLimits, viseSlotSetback, type ViseModuleConfig } from './viseModule'
import { cornerBracketLimits, type CornerBracketConfig } from './cornerBracket'
import { defaultToolProject, toolDefaults, toolIds, isToolId, parseToolProject, readToolProjectAtTable, projectJson, projectKey, projectModelParts, projectAtTable, projectNestingOptions, toolLabels, validProjectLayout, type ToolId, type ToolProject } from './project'

import { downloadToolArchive, downloadToolParts, downloadToolStrip } from './export'

const ToolAssembly3d = lazy(() => import('./ToolAssembly3d').then(module => ({ default: module.ToolAssembly3d })))
export type ToolsWorkspaceProps = {
  dark: boolean; onTheme: () => void; onBack: () => void
  view: ViewMode; onView: (view: ViewMode) => void; onNavigationGuard: (guard: NavigationGuard) => void
  notice: string; onDismissNotice: () => void
  units: Config['units']; onUnits: (units: Config['units']) => void
  visual: VisualSettings; onVisual: (changes: Partial<VisualSettings>) => void
  tableConfig: Config; tableAdmissionError: (project: ToolProject) => string | undefined; onAddToTable: (project: ToolProject) => void
}
const storageKey = 'weldingToolsProject'

type ToolDimension = keyof ExtensionConfig | keyof SquareConfig | keyof CornerBracketConfig | keyof CompactExtensionConfig | Exclude<keyof ViseModuleConfig, 'grid'>
const sizeLabels: Record<ToolDimension, string> = {
  length: 'Длина', width: 'Ширина', height: 'Высота монтажного торца', thickness: 'Толщина листа · стол',
  armWidth: 'Ширина плеча', holeDiameter: 'Диаметр отверстия Ø', endOffset: 'Отступ отверстия от свободных концов',
  holePitch: 'Шаг отверстий', slotLength: 'Длина паза для струбцины', cornerCut: 'Фаска внутреннего угла',
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

export function ToolsWorkspace({ dark, onTheme, onBack, view, onView, onNavigationGuard, notice, onDismissNotice, units, onUnits, visual, onVisual, tableConfig, tableAdmissionError, onAddToTable }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = new URLSearchParams(location.search).get('toolProject') ?? localStorage.getItem(storageKey)
      const loaded = saved ? readToolProjectAtTable(saved, tableConfig) : { project: projectAtTable(defaultToolProject, tableConfig), kind: 'current', message: '' }
      return { project: loaded.kind === 'current' ? loaded.project : defaultToolProject, notice: loaded.message, rejected: loaded.kind === 'migration' ? saved ?? '' : '', migration: loaded.kind === 'migration' ? loaded.project : null }
    } catch (error) {
      return { project: defaultToolProject, notice: `Сохранённый проект оснастки или проект по ссылке не загружен: ${error instanceof Error ? error.message : 'хранилище недоступно'}. Исходные данные не удалены.`, rejected: saved ?? '', migration: null }
    }
  })
  const [storedProject, setProject] = useState<ToolProject>(initial.project)
  const project = projectAtTable(storedProject, tableConfig)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState(initial.notice)
  const [rejected, setRejected] = useState(initial.rejected)
  const [migration, setMigration] = useState<ToolProject | null>(initial.migration)
  const [reset, setReset] = useState(0)
  useEffect(() => {
    onNavigationGuard(rejected ? { workspace: 'tools', message: 'Завершите проверку проекта перед выходом из раздела оснастки.' } : null)
    return () => onNavigationGuard(null)
  }, [rejected, onNavigationGuard])
  useEffect(() => { try { localStorage.setItem('weldingToolsView', view) } catch { setMessage('Не удалось сохранить выбранный вид.') } }, [view])
  const key = projectKey(project)
  const fabrication = useMemo(() => {
    try { return { parts: projectModelParts(project), error: null } }
    catch (error) { return { parts: null, error: error instanceof Error ? error.message : 'Некорректная геометрия оснастки' } }
  }, [key])
  useEffect(() => {
    if (rejected || fabrication.error) return
    try { localStorage.setItem(storageKey, projectJson(project)); localStorage.setItem(`${storageKey}.${project.tool}`, projectJson(project)) }
    catch { setLoadError('Автосохранение в браузере недоступно. Сохраните проект в файл.') }
  }, [key, rejected, fabrication.error])
  const parts = fabrication.parts
  const batchParts = useMemo(() => parts?.map(part => ({ ...part, count: part.count * project.copies })), [parts, project.copies])
  const layout = useMemo(() => batchParts && arrangeParts(batchParts), [batchParts])
  const summary = useMemo(() => batchParts && fabricationEstimate(batchParts, project.sheet), [batchParts, project.sheet])
  const admissionError = rejected ? loadError : fabrication.error ?? tableAdmissionError(project)
  const factor = units === 'mm' ? 1 : mmPerInch, unitLabel = units === 'mm' ? 'мм' : 'дюйм'

  const apply = (candidate: ToolProject) => {
    if (rejected) return false
    try {
      const next = parseToolProject(projectJson(projectAtTable(candidate, tableConfig)))
      if (projectKey(next) === key) return true
      const url = new URL(location.href)
      if (url.searchParams.has('toolProject')) { url.searchParams.set('toolProject', projectJson(next)); history.replaceState(history.state, '', url) }
      setProject(next)
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Некорректный проект оснастки'); return false }
  }
  const selectTool = (id: ToolId) => {
    if (id === project.tool || rejected) return
    try {
      const saved = localStorage.getItem(`${storageKey}.${id}`)
      const loaded = saved ? readToolProjectAtTable(saved, tableConfig) : { project: projectAtTable({ ...toolDefaults[id], sheet: { ...project.sheet } }, tableConfig), kind: 'current', message: '' }
      const next = loaded.project
      if (next.tool !== id) throw new Error('Тип сохранённой оснастки не совпадает с выбранным изделием')
      if (loaded.kind === 'migration') { setMigration(next); setRejected(saved ?? ''); setLoadError(loaded.message); return }
      if (apply(next)) setReset(value => value + 1)
    } catch (error) { setLoadError(`Сохранённая оснастка не заменена: ${error instanceof Error ? error.message : 'хранилище недоступно'}`) }
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
  const sizeField = (name: ToolDimension) => {
    const limits = sizeLimits[project.tool]
    if (!(name in project.size) || !(name in limits)) return null
    const value = project.size[name as keyof typeof project.size]
    const range = limits[name as keyof typeof limits]
    const readOnly = name === 'thickness' || project.tool === 'viseModule' && ['holeDiameter', 'holePitch', 'holeInset'].includes(name)
    const label = name === 'height' && project.tool !== 'extension' ? 'Высота' : sizeLabels[name]
    return <NumberField key={`${project.tool}:${name}`} label={label} readOnly={readOnly} disabled={Boolean(rejected)} value={String(Number(display(value, units, 3)))} min={range.min / factor} max={range.max / factor} step={range.step / factor}
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
  const startCorrected = () => {
    try {
      const next = parseToolProject(projectJson(projectAtTable(migration ?? defaultToolProject, tableConfig)))
      localStorage.setItem(`${storageKey}.previous.${next.tool}`, rejected)
      localStorage.setItem(`${storageKey}.previous`, rejected)
      localStorage.setItem(storageKey, projectJson(next))
      const url = new URL(location.href)
      url.searchParams.delete('toolProject'); url.searchParams.set('workspace', 'tools')
      history.replaceState(history.state, '', url)
      setProject(next); setRejected(''); setMigration(null); setLoadError(''); setReset(value => value + 1)
    } catch (error) { setLoadError(`Не удалось применить исправленную геометрию: ${error instanceof Error ? error.message : 'хранилище недоступно'}. Сначала скачайте исходный JSON.`) }
  }
  const open = async (file: File) => {
    if (rejected) { setMessage('Завершите проверку текущего проекта перед его заменой.'); return }
    try {
      const original = await file.text(), loaded = readToolProjectAtTable(original, tableConfig)
      if (loaded.kind === 'migration') { setRejected(original); setMigration(loaded.project); setLoadError(loaded.message); return }
      if (apply(loaded.project)) { setReset(value => value + 1); setMessage('Проект оснастки открыт.') }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось открыть проект') }
  }
  return <GeneratorShell workspace="tools" onWorkspace={value => { if (value === 'table') onBack() }} dark={dark} onTheme={onTheme} units={units} onUnits={onUnits} view={view}
    onView={onView} notice={message || notice} onDismissNotice={() => { setMessage(''); onDismissNotice() }}
    settings={<>
      {loadError && <section role="alert"><p className="socket-error">{loadError}</p>{rejected && <><button className="secondary full" onClick={() => downloadFile(rejected, 'исходный-проект-оснастки.json')}>Скачать исходный JSON</button><button className="secondary full" onClick={startCorrected}>{migration ? 'Применить исправленную геометрию' : 'Начать новый проект'}</button></>}</section>}
      <>
        <section className="fixture-card"><h3>Оснастка</h3><label className="field"><span>Выберите изделие</span><select disabled={Boolean(rejected)} aria-label="Выбрать изделие" value={project.tool} onChange={event => { const value = event.target.value; if (isToolId(value)) selectTool(value) }}>{toolIds.map(id => <option key={id} value={id}>{toolLabels[id]}</option>)}</select></label><p className="grid-summary">{toolSummaries[project.tool]}</p></section>
        <ParameterGroup title={<>Размеры ({unitLabel})</>} defaultOpen><div className="fields">{sizeField('length')}{sizeField('width')}{project.tool === 'square' ? sizeField('armWidth') : sizeField('height')}{sizeField('thickness')}</div><p>Толщина берётся из проекта стола, в том числе для импортированных проектов. Измените толщину металла в генераторе стола; все соединения и детали для резки будут пересчитаны.</p></ParameterGroup>
        {project.tool === 'viseModule' && <><ParameterGroup title={<>Монтажная сетка стола ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Диаметр, шаг, начало от края и схема «{project.size.grid === 'square' ? 'квадратная' : 'диагональная'}» берутся из генератора стола. На монтажной стенке строится полная совпадающая сетка с отсчётом вниз от рабочей поверхности; отверстия не смещаются и не удаляются ради размещения. Нижние боковые ряды ограничены криволинейным профилем.</p></ParameterGroup><ParameterGroup title={<>Пазы тисков и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('slotWidth')}{sizeField('slotInnerRadius')}{sizeField('tipHeight')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Восемь отдельных скруглённых пазов с шагом 45° и центральное круглое отверстие. Каждый внешний скруглённый конец останавливается за {display(viseSlotSetback, units, 3)} {unitLabel} до границы пластины по своему лучу; диагонали квадратной верхней пластины заканчиваются на таком же расстоянии от углов. Длины пазов пересчитываются вместе с размером пластины. Расстояние измеряется вдоль оси каждого паза, а не перпендикулярно стороне.</p></ParameterGroup></>}
        {project.tool === 'square' && <ParameterGroup title={<>Монтажные отверстия ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('endOffset')}</div><p>Одно отверстие у внутреннего угла и по одному у каждого свободного конца. Центр углового отверстия отстоит от обеих наружных кромок на половину ширины плеча. Сверьте полученные межцентровые расстояния со своим столом.</p></ParameterGroup>}
        {project.tool === 'compactExtension' && <><ParameterGroup title={<>Сетка оснастки ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Начала сетки на рабочей поверхности и монтажном торце зафиксированы относительно краёв. Первый торцевой ряд отсчитывается вниз от рабочей поверхности в сборе. Конфликтующие отверстия отклоняются, а не смещаются и не удаляются.</p></ParameterGroup><ParameterGroup title={<>Центральное ребро и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('tipHeight')}{sizeField('taperRun')}{sizeField('windowInset')}{sizeField('windowRadius')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Отступ окон задаёт ширину материала по периметру. Диагональные перемычки между соседними окнами: {display(project.size.windowInset * 2, units, 3)} {unitLabel}. Сохранённые проекты сохраняют выбранный отступ.</p></ParameterGroup></>}
        {project.tool === 'cornerBracket' && <><ParameterGroup title={<>Монтажные отверстия и паз ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('slotLength')}</div><p>Девять отверстий основания образуют треугольную сетку без позиции во внутреннем углу; в одной стенке три отверстия, в другой — один скруглённый паз. Ширина паза равна диаметру отверстия.</p></ParameterGroup><ParameterGroup title={<>Профиль и установочные соединения ({unitLabel})</>}><div className="fields">{sizeField('cornerCut')}{sizeField('tipWidth')}{sizeField('tabWidth')}{sizeField('clearance')}</div></ParameterGroup></>}
        <ParameterGroup title={<>Добавить на листы стола</>}><p>Вырежьте эту оснастку вместе со столом, не увеличивая число листов, доступных столу. Требуются та же марка стали и толщина {display(tableConfig.thickness, units, 3)} {unitLabel}.</p><NumberField label="Копий оснастки в партии резки" value={project.copies} min={1} max={10} step={1} disabled={Boolean(rejected)} onValue={copies => apply({ ...project, copies })} />{admissionError && <p role="alert" className="socket-error">{admissionError}</p>}<button className="secondary full" disabled={Boolean(admissionError)} onClick={() => onAddToTable(project)}>Добавить в задание на резку стола</button><p>В задание добавляется сохранённая копия параметров оснастки. Последующие изменения размеров здесь не меняют уже выбранную для стола оснастку. Все пять семейств используют толщину металла стола; монтажная сетка тисков также следует столу. Используются размеры листа и зазоры стола; перед экспортом должны поместиться все копии оснастки.</p></ParameterGroup>
      </>
    </>}
    visualization={<VisualizationSettings value={visual} onChange={onVisual} />}
    production={summary && <ProductionEstimate summary={summary} units={units} sheet={project.sheet} error={rejected ? loadError : null} onSheetChange={changes => apply({ ...project, sheet: { ...project.sheet, ...changes } })} />}
    actions={onClose => <ProjectActions onOpen={file => { onClose(); void open(file) }} onSave={() => downloadFile(JSON.stringify(project, null, 2), `проект-оснастки-${project.tool}.json`)} onShare={() => { onClose(); void share() }} disabled={Boolean(rejected || fabrication.error)} fabrication={{ kind: 'parts', onZip: () => void downloadToolParts(project, tableConfig).catch(() => setMessage('Не удалось создать ZIP-архив.')), onDxf: () => downloadToolStrip(project, tableConfig) }} />}>
    {rejected ? <div className="three-loading socket-error" role="alert">Сохраните исходный проект, затем явно запустите исправленный вариант.</div>
      : fabrication.error ? <div className="three-loading socket-error" role="alert">{fabrication.error} Перед изготовлением измените толщину стола или размеры оснастки.</div>
      : view === '2d' ? layout && <PartsLayout layout={layout} units={units} label={`Интерактивная 2D-раскладка деталей: ${toolLabels[project.tool]}`} resetToken={reset} />
      : view === '3d' ? <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Загрузка 3D-сборки…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={reset} {...visual} /></Suspense></div></>
      : batchParts && <SheetNesting jobKey={key} job={{ parts: batchParts, options: projectNestingOptions(project), stock: { kind: 'new-sheets' } }} sheetSettings={{ ...project.sheet, copies: project.copies }} units={units} maxGap={100}
        onChange={({ copies, ...sheet }) => apply({ ...project, sheet: { ...project.sheet, ...sheet }, copies: copies ?? project.copies })} onNotice={setMessage} onExport={({ result }) => downloadToolArchive(project, result, key, tableConfig)} isLayoutValid={({ result }, key) => validProjectLayout(project, result, key)}
        render3D={result => <Suspense fallback={<div className="three-loading">Загрузка 3D…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={0} {...visual} nesting={result} /></Suspense>} />}
  </GeneratorShell>
}
