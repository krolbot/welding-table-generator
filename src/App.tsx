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
  projectConfig,
  readPart,
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
import { Checkbox, GeneratorShell, NumberField, ParameterGroup, ProductionEstimate, ProjectActions, SliderField, VisualizationSettings } from './GeneratorWorkspace'
import { PartsLayout } from './PartsLayout'
import { copyText, downloadFile } from './projectIO'
import { useWorkspaceNavigation } from './viewNavigation'
import { tableCutInventory, type TableLayoutSnapshot } from './tableCutJob'
import { compareNesting } from './nesting'
import { fabricationEstimate } from './fabricationLayout'
import { TableTools } from './tools/TableTools'
import { toolSelectionsAtTable, type ToolProject } from './tools/project'
import { clampNumeric, numericBounds, parseTableProject, tableProjectFromQuery, tableProjectQuery, type BooleanKey, type NumericKey, type TableProjectLoad } from './tableProject'

const ThreeAssembly = lazy(() => import('./ThreeAssembly').then(module => ({ default: module.ThreeAssembly })))
const ToolsWorkspace = lazy(() => import('./tools/ToolsWorkspace').then(module => ({ default: module.ToolsWorkspace })))

const inchRanges: Partial<Record<NumericKey, { min: number; max: number; step: number }>> = {
  length: { min: 20, max: 200, step: 1 }, width: { min: 16, max: 200, step: 1 },
  height: { min: 2, max: 20, step: 0.5 }, ribSpacing: { min: 8, max: 24, step: 1 },
}
const partNames = Object.keys(partLabels) as PartName[]
const isPart = (value: unknown): value is PartName => typeof value === 'string' && Object.hasOwn(partLabels, value)
const readStorage = (key: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}

type ProjectReview = (Extract<TableProjectLoad, { kind: 'migration' }> & { original: string }) | { kind: 'rejected'; original: string; message: string }
const preserveView = (next: Config, current: Config): Config => ({ ...next, units: current.units, exploded: current.exploded, showDimensions: current.showDimensions, renderHoles: current.renderHoles, highlighting: current.highlighting })
const loadedTable = (): { config: Config; review: ProjectReview | null } => {
  const ui = readStorage('tableGenUI')
  const config: Config = {
    ...defaults, units: ui.units === 'in' || ui.units === 'inch' ? 'inch' : 'mm',
    exploded: typeof ui.explodeFactor === 'number' && Number.isFinite(ui.explodeFactor) ? clampNumeric('exploded', ui.explodeFactor) : defaults.exploded,
    showDimensions: typeof ui.showDims === 'boolean' ? ui.showDims : defaults.showDimensions,
    renderHoles: typeof ui.renderHoles3D === 'boolean' ? ui.renderHoles3D : defaults.renderHoles,
    highlighting: typeof ui.enableHoverEffect === 'boolean' ? ui.enableHoverEffect : defaults.highlighting,
  }
  let original = ''
  try {
    original = location.href
    const shared = tableProjectFromQuery(new URLSearchParams(location.search))
    original = shared ?? localStorage.getItem('tableGenParams') ?? ''
    if (!original) return { config, review: null }
    const parsed = parseTableProject(original)
    return parsed.kind === 'migration'
      ? { config, review: { ...parsed, original } }
      : { config: preserveView(parsed.config, config), review: null }
  } catch (error) {
    return { config, review: { kind: 'rejected', original, message: error instanceof Error ? error.message : 'Не удалось прочитать сохранённый проект или проект по ссылке. Исходные данные не перезаписаны.' } }
  }
}

export default function App() {
  const [notice, setNotice] = useState('')
  const [initial] = useState(loadedTable)
  const [config, setConfig] = useState<Config>(initial.config)
  const [review, setReview] = useState<ProjectReview | null>(initial.review)
  const navigation = useWorkspaceNavigation(setNotice, review ? { workspace: 'table', message: 'Завершите проверку проекта стола перед переходом к оснастке.' } : null)
  const { workspace, view, selectWorkspace, selectView: setView } = navigation
  const [dark, setDark] = useState(() => readStorage('tableGenUI').theme === 'dark')
  const [tableLayout, setTableLayout] = useState<TableLayoutSnapshot>()
  const [reset2dToken, setReset2dToken] = useState(0)

  const cutJob = useMemo(() => {
    try { return { inventory: tableCutInventory(config) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'Некорректное задание на резку' } }
  }, [config])
  const summary = useMemo(() => ({
    ...fabricationEstimate(cutJob.inventory?.parts ?? [], { length: config.sheetLength, width: config.sheetWidth }),
    engraving: cutJob.inventory ? totals(config).engraving * config.nestingCopies : 0,
  }), [config, cutJob])
  const layout = useMemo(() => layoutParts(config), [config])
  const cornerPlate = useMemo(() => legCornerPlateSpec(config), [config])
  const ribAccess = useMemo(() => ribAccessHoleSpec(config), [config])
  const geometryError = useMemo(() => fabricationError(config), [config])
  const unitLabel = config.units === 'mm' ? 'мм' : 'дюйм'

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    try {
      if (!review) localStorage.setItem('tableGenParams', JSON.stringify(projectConfig(config)))
      localStorage.setItem('tableGenUI', JSON.stringify({ viewMode: workspace === 'table' ? view : readStorage('tableGenUI').viewMode ?? '2d', renderHoles3D: config.renderHoles, enableHoverEffect: config.highlighting, explodeFactor: config.exploded, showDims: config.showDimensions, units: config.units === 'inch' ? 'in' : 'mm', theme: dark ? 'dark' : 'light' }))
    } catch { setNotice('Автосохранение в браузере недоступно. Сохраните проект в файл.') }
  }, [config, dark, view, workspace, review])

  useEffect(() => {
    if (review) return
    const url = new URL(location.href)
    if (!['state', 'length', 'schemaVersion'].some(key => url.searchParams.has(key))) return
    const selectedWorkspace = url.searchParams.get('workspace')
    const selectedView = url.searchParams.get('view')
    const originalTool = url.searchParams.get('toolProject')
    url.search = tableProjectQuery(config).toString()
    if (originalTool !== null) url.searchParams.set('toolProject', originalTool)
    if (selectedWorkspace) url.searchParams.set('workspace', selectedWorkspace)
    if (selectedView) url.searchParams.set('view', selectedView)
    history.replaceState(history.state, '', url)
  }, [config, review])

  const applyTableConfig = (next: Config) => {
    try {
      next.nestingTools = toolSelectionsAtTable(next.nestingTools, next)
      setConfig(next)
      return true
    } catch (error) {
      setNotice(`Параметры стола не изменены: ${error instanceof Error ? error.message : 'Некорректная геометрия выбранной оснастки'}`)
      return false
    }
  }
  const patch = <K extends keyof Config>(key: K, value: Config[K]) => applyTableConfig({ ...config, [key]: value })
  const setPreset = (preset: Config['preset']) => {
    const values = preset === 'Custom' ? {} : presetValues[preset]
    if (applyTableConfig({ ...config, ...values, preset }) && preset === 'Custom') setNotice('Укажите диаметр отверстий, шаг и начало сетки в полях ниже.')
  }
  const setNumeric = (key: NumericKey, value: number) => {
    if (!Number.isFinite(value)) return false
    const next = { ...config, [key]: clampNumeric(key, value) }
    if (['length', 'width', 'height', 'thickness', 'tabWidth'].includes(key) && maxTabWidth(next) < numericBounds.tabWidth.min) {
      setNotice('Высота стола и толщина металла не оставляют места для установочных шипов. Увеличьте высоту или уменьшите толщину.')
      return false
    }
    if (['length', 'width', 'height', 'thickness', 'tabWidth'].includes(key)) next.tabWidth = Math.min(next.tabWidth, maxTabWidth(next))
    if (key === 'legBoltDiameter' || key === 'legPatternX' || key === 'legPatternY') {
      next.legPatternX = Math.max(next.legPatternX, next.legBoltDiameter * 1.5)
      next.legPatternY = Math.max(next.legPatternY, next.legBoltDiameter * 1.5)
    }
    if (key === 'holeDiameter' || key === 'pitch' || key === 'margin') next.preset = 'Custom'
    return applyTableConfig(next)
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
    setNotice('Отверстие удалено. Его можно восстановить в списке удалённых отверстий.')
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
  const save = () => downloadFile(JSON.stringify(projectConfig(config), null, 2), `Проект_сварочного_стола_${config.length}x${config.width}.json`)
  const replaceProject = (candidate: Config) => {
    const next = preserveView(candidate, config)
    const url = new URL(location.href)
    const originalTool = url.searchParams.get('toolProject')
    url.search = tableProjectQuery(next).toString()
    if (originalTool) url.searchParams.set('toolProject', originalTool)
    url.searchParams.set('workspace', workspace); url.searchParams.set('view', view)
    history.replaceState(history.state, '', url)
    setConfig(next)
    setReview(null)
    reset2d()
  }
  const migrationPreset = review?.kind === 'migration' && review.change === 'table-grid' ? (['D16', 'D28'] as const).find(name => review.config.holeDiameter === presetValues[name].holeDiameter && review.config.pitch === presetValues[name].pitch && review.config.margin !== presetValues[name].margin) : undefined
  const acceptReview = (candidate: Config) => {
    if (!review) return
    try { localStorage.setItem('tableGenParams.previous', review.original) }
    catch { setNotice('Не удалось создать резервную копию исходного проекта. Проект не заменён. Скачайте исходные данные и освободите место в хранилище браузера.'); return }
    replaceProject(candidate)
    setNotice('Исходные данные сохранены. Перед изготовлением проверьте исправленную геометрию.')
  }
  const reportError = (error: unknown) => setNotice(error instanceof Error ? error.message : 'Операция завершилась с ошибкой. Файл экспорта не создан.')
  const open = async (file: File) => {
    if (review) { setNotice('Завершите проверку текущего проекта перед его заменой другим файлом.'); return }
    let original = ''
    try {
      original = await file.text()
      const parsed = parseTableProject(original)
      if (parsed.kind === 'migration') setReview({ ...parsed, original })
      else { replaceProject(parsed.config); setNotice('Проект загружен.') }
    } catch (error) { reportError(error) }
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = tableProjectQuery(config).toString()
    url.searchParams.set('workspace', 'table'); url.searchParams.set('view', view)
    try {
      await copyText(url.toString())
      setNotice('Ссылка на проект с исходными метрическими параметрами скопирована.')
    } catch {
      setNotice('Нет доступа к буферу обмена. Сохраните проект в файл.')
    }
  }

  const withSelectedTool = (project: ToolProject) => {
    if (review) throw new Error('Завершите проверку проекта стола перед добавлением оснастки.')
    const next = { ...config, nestingTools: toolSelectionsAtTable([...config.nestingTools, { id: crypto.randomUUID(), project }], config) }
    tableCutInventory(next)
    return next
  }
  const toolAdmissionError = (project: ToolProject) => {
    try { withSelectedTool(project); return undefined }
    catch (error) { return error instanceof Error ? error.message : 'Оснастку нельзя добавить в это задание на резку стола' }
  }
  const addToTable = (project: ToolProject) => {
    try {
      setConfig(withSelectedTool(project)); navigation.navigate({ workspace: 'table', view: 'sheet' })
      setNotice('Оснастка выбрана. Экспорт останется недоступным, пока полная общая раскладка не поместится на листы.')
    } catch (error) { reportError(error) }
  }
  const rememberTableLayout = (snapshot: TableLayoutSnapshot) => setTableLayout(current => current?.key === snapshot.key && compareNesting(current.result, snapshot.result) <= 0 ? current : snapshot)

  if (workspace === 'tools') return <Suspense fallback={<div className="three-loading">Загрузка оснастки…</div>}><ToolsWorkspace view={view} onView={setView} onNavigationGuard={navigation.setGuard} notice={notice} onDismissNotice={() => setNotice('')} tableConfig={config} tableAdmissionError={toolAdmissionError} onAddToTable={addToTable} dark={dark} onTheme={() => setDark(value => !value)} onBack={() => selectWorkspace('table')} units={config.units} onUnits={units => patch('units', units)} visual={config} onVisual={changes => setConfig(current => ({ ...current, ...changes }))} /></Suspense>
  return <GeneratorShell workspace="table" onWorkspace={selectWorkspace} dark={dark} onTheme={() => setDark(value => !value)} units={config.units} onUnits={units => patch('units', units)} view={view} onView={setView} notice={notice} onDismissNotice={() => setNotice('')}
    settings={<>
          {review && <section role="alert" className="project-review"><h3>Требуется проверка проекта</h3><p className="socket-error">{review.message}</p><button className="secondary full" onClick={() => downloadFile(review.original, 'исходный-проект-сварочного-стола.txt', 'text/plain')}>Скачать исходные данные</button>{review.kind === 'migration' && migrationPreset && <button className="secondary full" onClick={() => acceptReview({ ...review.config, ...presetValues[migrationPreset], preset: migrationPreset })}>Применить начало сетки {migrationPreset} ({presetValues[migrationPreset].margin} мм)</button>}<button className="secondary full" onClick={() => acceptReview(review.kind === 'migration' ? review.config : defaults)}>{review.kind === 'migration' ? review.change === 'table-grid' ? `Сохранить прежнее начало сетки (${review.config.margin} мм)` : 'Применить исправленную геометрию оснастки' : 'Создать новый проект стола'}</button></section>}
          <fieldset className="table-settings" disabled={Boolean(review)}>
          <ParameterGroup title={<>Размеры ({unitLabel})</>} defaultOpen>
            {slider('length', 'Длина (L)', 500, 5000, 50)}
            {slider('width', 'Ширина (W)', 400, 5000, 50)}
            {slider('height', 'Высота стола (H)', 50, 500, 10)}
          </ParameterGroup>
          <ParameterGroup title={<>Система оснастки</>} defaultOpen>

            <div className="preset">{(['D16', 'D28', 'Custom'] as const).map(preset => <button key={preset} className={config.preset === preset ? 'active' : ''} onClick={() => setPreset(preset)}>{preset === 'Custom' && <Icon name="target" size={12} />}{preset === 'Custom' ? 'Своя' : preset}</button>)}</div>
            <div className="fields three">{numericInput('holeDiameter', 'Диаметр отверстия Ø', numericBounds.holeDiameter.min, numericBounds.holeDiameter.max, 1)}{numericInput('pitch', 'Шаг', config.holeDiameter + 10, numericBounds.pitch.max, 5)}{numericInput('margin', 'Начало сетки', config.holeDiameter / 2 + 5, Math.min(config.length, config.width) / 2 - 10, 5)}</div>
            <details className="field-help"><summary>Начало сетки и совместимость</summary>
            <p className="grid-summary">Ø{numberLabel(config.holeDiameter, 3)} / шаг {numberLabel(config.pitch, 3)} {unitLabel}. Начало: {numberLabel(config.margin, 3)} {unitLabel} от граней −X / −Z верхней плиты; ряды на юбках начинаются на {numberLabel(config.margin, 3)} {unitLabel} ниже рабочей поверхности.</p>
            <p>Начало сетки не смещается при изменении размеров. Остаток остаётся у дальних краёв. Вырезы соединений и ручные изменения отверстий могут прерывать сетку. Отображение в дюймах не включает систему оснастки 5/8″.</p>
            </details>
            <div className="hole-pattern"><span>Схема отверстий</span><div className="grid-buttons"><button className={config.grid === 'square' ? 'active' : ''} onClick={() => patch('grid', 'square')}>Квадратная сетка</button><button className={config.grid === 'staggered' ? 'active' : ''} onClick={() => patch('grid', 'staggered')}>Диагональная сетка</button></div>{config.grid === 'staggered' && <p>К квадратной сетке добавляются отверстия в центрах ячеек: ряды с половинным шагом и чередующимся смещением столбцов на полшага, одинаковые на столешнице и юбках.</p>}</div>
            <div className="fixture-options">{toggle('skirtHoles', 'Отверстия в юбках')}

              {toggle('engraving', 'Гравировка сетки')}
              {config.engraving && <div className="engraving-options"><span>Схема гравировки</span><div className="grid-buttons"><button title="Линии проходят через центры отверстий" className={config.engravingMode === 'through' ? 'active' : ''} onClick={() => patch('engravingMode', 'through')}>По центрам отверстий</button><button title="Линии проходят между отверстиями и образуют ячейки" className={config.engravingMode === 'between' ? 'active' : ''} onClick={() => patch('engravingMode', 'between')}>Между отверстиями</button></div></div>}
              {toggle('nameMarking', 'Маркировка деталей')}
            </div>
          </ParameterGroup>
          <ParameterGroup title={<>Внутренняя рама</>}>{toggle('ribs', 'Создать опорные рёбра')}
            {config.ribs && <div className="indented">
              {slider('ribSpacing', `Шаг рёбер (${unitLabel})`, 200, 600, 50)}
              {toggle('ribAccessHoles', 'Отверстия доступа в рёбрах')}
              {config.ribAccessHoles && <>
                <div className="fields">{numericInput('ribAccessHoleDiameter', `Диаметр отверстия доступа Ø (${unitLabel})`, 1, 1000, 5)}<label className="field"><span>Максимум для этой рамы</span><output>{numberLabel(ribAccess?.maxDiameter ?? 0, 2)} {unitLabel}</output></label></div>
                <p>По одному круглому отверстию в каждом пролёте продольных и поперечных рёбер. Вокруг отверстия остаётся не менее {numberLabel(ribAccess?.web ?? 0, 2)} {unitLabel} материала вне пазов перекрёстных соединений. Этот геометрический зазор не определяет допустимую нагрузку.</p>
              </>}
            </div>}
          </ParameterGroup>
          <ParameterGroup title={<>Шипы и пазы</>}>
            <div className="joint-fields">
              {numericInput('thickness', `Толщина металла (${unitLabel})`, numericBounds.thickness.min, numericBounds.thickness.max, 1)}
              {numericInput('tabWidth', `Ширина шипа (${unitLabel})`, numericBounds.tabWidth.min, maxTabWidth(config), 5)}
              <div className="joint-clearance">{numericInput('clearance', `Зазор в соединении (${unitLabel})`, 0, 2.5, 0.05, 2)}<p className="clearance-note">Макс. {numberLabel(2.5, 4)} {unitLabel}</p></div>
              <div className="relief-options">{toggle('dogBones', 'Угловые разгрузки')}
                {config.dogBones && <div className="indented relief-control">{slider('dogBoneDiameter', `Диаметр (${unitLabel})`, 0.5, 5, 0.5)}</div>}
              </div>
            </div>
          </ParameterGroup>
          <ParameterGroup title={<>Конструкция ножек</>}>
            {toggle('legMounts', 'Крепления ножек')}
            {config.legMounts && <div className="leg-options">
              <div className="grid-buttons leg-style"><button className={config.legMountStyle === 'boltPattern' ? 'active' : ''} onClick={() => patch('legMountStyle', 'boltPattern')}>Схема болтов</button><button className={config.legMountStyle === 'cornerPlate' ? 'active' : ''} onClick={() => patch('legMountStyle', 'cornerPlate')}>Угловые пластины</button></div>
              {config.legMountStyle === 'boltPattern' ? <>
                <div className="fields"><label className="field"><span>Размер болта (M)</span><NumberInput value={numberLabel(config.legBoltDiameter, 2)} min={1 / (config.units === 'mm' ? 1 : mmPerInch)} max={100 / (config.units === 'mm' ? 1 : mmPerInch)} step={config.units === 'mm' ? 1 : 0.0625} onValue={value => setNumeric('legBoltDiameter', readDisplay(value, config.units))} /></label><label className="field"><span>Диаметр отверстия Ø (авто)</span><output>{numberLabel(config.legBoltDiameter + 1.5, 3)} {unitLabel}</output></label></div>
                <div className="fields">{numericInput('legPatternX', 'Шаг по X', config.legBoltDiameter * 1.5, 1000, 5)}{numericInput('legPatternY', 'Шаг по Y', config.legBoltDiameter * 1.5, 1000, 5)}</div>
                <div className="fields">{(['legCols', 'legRows'] as const).map((key, index) => <label className="field" key={key}><span>{index ? 'Ряды' : 'Отверстий в ряду'}</span><select value={config[key]} onChange={event => setNumeric(key, Number(event.target.value))}>{[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
                <div className="fields">{numericInput('legEdgeOffset', 'От края', 0, 1000, 5)}{numericInput('legBottomOffset', 'От низа', 0, 1000, 5)}</div>
                <p>Отверстий на угол: {config.legCols * config.legRows}, на обоих концах каждой юбки. Минимальный шаг для M{config.legBoltDiameter}: {numberLabel(config.legBoltDiameter * 1.5, 2)} {unitLabel}.</p>
              </> : <>
                <div className="fields">{numericInput('legPlateSize', 'Размер пластины', 80, 400, 5)}<label className="field"><span>Толщина пластин и перемычек</span><output>{numberLabel(config.thickness, 2)} {unitLabel} — металл стола</output></label></div>
                <div className="fields"><label className="field"><span>Длина перемычки (авто)</span><output>{numberLabel(config.height - config.thickness, 2)} {unitLabel}</output></label><label className="field"><span>Ширина перемычки (авто)</span><output>{numberLabel(config.height * 0.3, 2)} {unitLabel}</output></label></div>
                <div className="fields">{numericInput('legPlateHoleDiameter', 'Монтажное отверстие Ø', 1, 40, 1)}{numericInput('legPlateHoleSpacing', 'Шаг отверстий', 20, 350, 5)}</div>
                <div className="fields">{numericInput('legProfileSize', 'Квадратная труба', 20, 200, 5)}{numericInput('legLength', 'Длина ножки ниже рамы', 100, 1500, 25)}</div>
                {cornerPlate ? <p>4 неподвижные угловые пластины и 4 съёмные монтажные пластины ножек {numberLabel(cornerPlate.size, 2)} × {numberLabel(cornerPlate.size, 2)} × {numberLabel(cornerPlate.thickness, 2)} {unitLabel}; в каждой по четыре отверстия Ø{numberLabel(cornerPlate.holeDiameter, 2)} с шагом {numberLabel(cornerPlate.holeSpacing, 2)} × {numberLabel(cornerPlate.holeSpacing, 2)} {unitLabel}. Четыре опорные перемычки {numberLabel(cornerPlate.jumperLength, 2)} × {numberLabel(cornerPlate.jumperWidth, 2)} × {numberLabel(cornerPlate.thickness, 2)} {unitLabel}, каждая с шипом неполной ширины {numberLabel(cornerPlate.jumperTabWidth, 2)} {unitLabel}.</p> : <p className="socket-error">Угловая пластина, перемычка, шипы, пазы или схема отверстий не помещаются в текущий стол и внутреннюю раму. Увеличьте стол или пластину либо уменьшите конфликтующие размеры.</p>}
                <p>Нижняя сторона верхней угловой пластины и непрерывная нижняя кромка юбки лежат в одной плоскости низа рамы. Только посадочное место в углу поднято на толщину металла. В каждом соединении с юбкой шип неполной ширины фиксирует пластину, а соседняя открытая кромка образует внутренний угол под угловой сварной шов; физический угол пластины остаётся целым. Каждая перемычка поддерживает свободный внутренний угол и поднимается до нижней стороны столешницы: длина равна H минус толщина металла, ширина — 0,3 × H. Пластины и перемычки вырезаются из выбранного металла стола; H100 / T6 даёт эталонную заготовку 94 × 30 мм.</p>
                <p>Каждая простая нижняя монтажная пластина крепится болтами к угловой пластине через совпадающие отверстия. Труба приваривается к нижней пластине, а не к столу. На нижних пластинах нет шипов и пазов; болты в 3D не показаны. Длина заготовки трубы: {numberLabel(cornerPlate?.legTubeLength ?? config.legLength - config.thickness, 2)} {unitLabel}; пластина и труба сохраняют заданное расстояние ниже рамы. Перед затяжкой болтов обработайте сопрягаемые поверхности заподлицо.</p>
              </>}
            </div>}
            {toggle('liftingHoles', 'Отверстия для подъёма')}
          </ParameterGroup>
          <ParameterGroup title={<>Пользовательские отверстия</>}><p>X и Y отсчитываются от центра детали — это же начало координат используется в экспортируемом DXF. Отверстие добавляется в каждую копию выбранной детали.</p>
            {config.customHoles.map(hole => <div className="hole-row" key={hole.id}>
              <div className="hole-part"><select aria-label="Деталь" value={hole.part} onChange={event => updateHole(hole.id, 'part', event.target.value)}>{partNames.map(name => <option key={name} value={name}>{partLabels[name]}</option>)}</select><button title="Удалить это отверстие" aria-label="Удалить отверстие" onClick={() => patch('customHoles', config.customHoles.filter(item => item.id !== hole.id))}><Icon name="trash" size={12} /></button></div>
              <div className="fields three">{(['x', 'y', 'd'] as const).map(key => <label className="field" key={key}><span>{key === 'd' ? 'Ø' : key.toUpperCase()}</span><NumberInput aria-label={key === 'd' ? 'Диаметр' : key.toUpperCase()} step={(key === 'd' ? 1 : 5) / (config.units === 'mm' ? 1 : mmPerInch)} min={key === 'd' ? 0.1 / (config.units === 'mm' ? 1 : mmPerInch) : undefined} value={numberLabel(hole[key], 3)} onValue={value => updateHole(hole.id, key, String(value))} /></label>)}</div>
            </div>)}
            <button className="secondary full" onClick={addHole}><Icon name="plus" size={14} />Добавить отверстие</button>{config.customHoles.length > 0 && <p>Проверьте положение отверстий инструментом «Измерить» в 2D.</p>}
          </ParameterGroup>
          <ParameterGroup title={<>Удалённые отверстия{config.removedHoles.length > 0 && <small>{config.removedHoles.length}</small>}</>}>
            {config.removedHoles.length ? <><ul className="removed">{config.removedHoles.map((hole, index) => <li key={typeof hole === 'string' ? hole : hole.id}>
              {typeof hole === 'string' ? <code>{hole}</code> : <><span>{partLabels[hole.part]}</span><code>{numberLabel(hole.x, 2)} : {numberLabel(hole.y, 2)}</code></>}
              <button title="Восстановить это отверстие" aria-label="Восстановить отверстие" onClick={() => patch('removedHoles', config.removedHoles.filter((_, item) => item !== index))}><Icon name="plus" size={12} /></button>
            </li>)}</ul><button className="secondary full" onClick={() => patch('removedHoles', [])}>Восстановить все</button><p>Удалённое отверстие исчезает из каждой копии этой детали. Координаты отсчитываются от центра детали.</p></> : <p>В разделе «Детали» выберите «Удалить отверстия» и нажмите на отверстие. Удалённые отверстия появятся здесь, откуда их можно восстановить.</p>}
          </ParameterGroup>
          <TableTools config={config} onChange={nestingTools => patch('nestingTools', nestingTools)} onChoose={() => selectWorkspace('tools')} onNotice={setNotice} />
          </fieldset>
    </>}
    visualization={<VisualizationSettings value={config} onChange={changes => setConfig(current => ({ ...current, ...changes }))} />}
    production={<fieldset className="table-settings" disabled={Boolean(review)}><ProductionEstimate summary={summary} units={config.units} sheet={{ length: config.sheetLength, width: config.sheetWidth }} error={review ? review.message : geometryError?.message ?? cutJob?.error} onSheetChange={changes => { if (changes.length !== undefined) setNumeric('sheetLength', changes.length); if (changes.width !== undefined) setNumeric('sheetWidth', changes.width) }} /></fieldset>}
    actions={onClose => <ProjectActions onOpen={file => { onClose(); void open(file) }} onSave={save} onShare={() => { onClose(); void share() }} disabled={Boolean(review || geometryError)} fabrication={config.nestingTools.length ? { kind: 'shared-sheets', onOpenSheets: () => { onClose(); setView('sheet') } } : { kind: 'parts', onZip: () => void downloadZip(config).catch(reportError), onDxf: () => { try { downloadFull(config) } catch (error) { reportError(error) } } }} />}
    seo={<article className="seo"><div><h1>Бесплатный генератор сварочных столов — DXF-чертежи и 3D CAD</h1><p>Создайте параметрический сварочный стол в браузере. Изучите 3D-сборку, настройте размеры и соединения, затем экспортируйте отдельные детали или полную раскладку в DXF.</p><h3>Системы оснастки D16 и D28</h3><p>Выберите D16/50, D28/100 либо задайте диаметр отверстий, шаг и начало сетки вручную. У квадратной и диагональной сеток фиксированные начала координат от краёв и рабочей поверхности столешницы и юбок. Одна только геометрия сетки не подтверждает совместимость оснастки.</p><h3>Конструкция на шипах и пазах</h3><p>Задайте толщину листа, ширину шипов и зазор в соединениях, чтобы построить взаимно фиксирующиеся детали периметра и опорной рамы. Перед резкой проверьте построенные контуры и посадку соединений.</p><h3>Угловые разгрузки</h3><p>Дополнительные угловые разгрузки обеспечивают место для шипов. В DXF круглые отверстия и дуги разгрузок остаются исходными сущностями на отдельных слоях резки и гравировки.</p><h3>Внутренняя опорная рама и рёбра</h3><p>Настройте шаг опорных рёбер и изучите собранный либо разнесённый стол. Можно использовать исходную схему болтов на юбках или создать четыре горизонтальные угловые пластины, которые соединяются с обеими соседними юбками и крепятся болтами к отдельным простым пластинам на съёмных ножках из квадратной трубы. В нужные детали также можно добавить отверстия для подъёма и пользовательские отверстия по координатам.</p><h3>Скачать DXF-файлы сварочного стола</h3><p>Скачайте DXF отдельных деталей в ZIP-архиве, экспортируйте полную раскладку, сохраните проект как JSON или поделитесь ссылкой с его параметрами. Перед изготовлением обязательно проверьте размеры, допуски и пригодность конструкции.</p></div></article>}>
    {review ? <div className="three-loading socket-error" role="alert">Сохраните исходный проект, затем проверьте исправленную геометрию в разделе «Параметры».</div>
      : geometryError ? <div className="three-loading socket-error" role="alert" data-error-code={geometryError.code}>{geometryError.message}</div> : view === '2d' ? <PartsLayout layout={layout} units={config.units} label="Интерактивная 2D-раскладка деталей сварочного стола" resetToken={reset2dToken} getEngravings={part => { const name = readPart(part.name); return name ? engravingLines({ ...part, name }, config) : [] }} onRemoveHole={(hole, part) => removeHole(hole, readPart(part.name))} />
      : view === 'sheet' ? <TableSheetNesting config={config} dark={dark} baseline={tableLayout} onBaseline={rememberTableLayout} onChange={changes => setConfig(current => ({ ...current, ...changes }))} onNotice={setNotice} />
      : <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Загрузка 3D-сборки…</div>}><ThreeAssembly config={config} resetToken={reset2dToken} dark={dark} /></Suspense></div></>}
  </GeneratorShell>
}
