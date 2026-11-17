import {
  lazy,
  Suspense,
  useEffect,
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
import type { Hole } from './geometry'
import { TableSheetNesting } from './SheetNesting'
import { Icon } from './Icon'
import { NumberInput } from './NumberInput'
import { Checkbox, GeneratorShell, NumberField, ParameterGroup, ProductionEstimate, ProjectActions, SliderField, VisualizationSettings } from './GeneratorWorkspace'
import { PartsLayout } from './PartsLayout'
import { copyText, downloadFile } from './projectIO'
import { useWorkspaceNavigation } from './viewNavigation'
import { TableTools } from './tools/TableTools'
import type { ToolProject } from './tools/project'
import { clampNumeric, numericBounds, parseTableProject, tableProjectFromQuery, tableProjectQuery, type BooleanKey, type NumericKey } from './tableProject'
import { downloadFromApi, previewTable } from './serverApi'
import type { TablePreviewDto } from './apiContracts'

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

const preserveView = (next: Config, current: Config): Config => ({ ...next, units: current.units, exploded: current.exploded, showDimensions: current.showDimensions, renderHoles: current.renderHoles, highlighting: current.highlighting })
const loadedTable = (): { config: Config; error: string } => {
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
    if (!original) return { config, error: '' }
    return { config: preserveView(parseTableProject(original).config, config), error: '' }
  } catch (error) {
    return { config, error: error instanceof Error ? error.message : 'Не удалось прочитать сохранённый проект или проект по ссылке.' }
  }
}

export default function App() {
  const [initial] = useState(loadedTable)
  const [notice, setNotice] = useState(initial.error)
  const [config, setConfig] = useState<Config>(initial.config)
  const navigation = useWorkspaceNavigation()
  const { workspace, view, selectWorkspace, selectView: setView } = navigation
  const [dark, setDark] = useState(() => readStorage('tableGenUI').theme === 'dark')
  const [reset2dToken, setReset2dToken] = useState(0)
  const [previewState, setPreviewState] = useState<{ key: string; value: TablePreviewDto } | null>(null)
  const [previewError, setPreviewError] = useState<{ code: string; message: string } | null>(null)
  const previewKey = JSON.stringify(projectConfig(config))
  const preview = previewState?.key === previewKey ? previewState.value : null
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void previewTable(projectConfig(config), controller.signal).then(value => {
        setPreviewState({ key: previewKey, value }); setPreviewError(null)
        if (JSON.stringify(projectConfig(value.config)) !== previewKey) setConfig(current => preserveView(value.config, current))
      }).catch(error => {
        if (controller.signal.aborted) return
        setPreviewError({ code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'server-preview', message: error instanceof Error ? error.message : 'Сервер не рассчитал проект' })
      })
    }, 120)
    return () => { clearTimeout(timer); controller.abort() }
  }, [previewKey])
  const summary = preview?.summary ?? { kg: 0, cut: 0, holes: 0, fit: false, engraving: 0 }
  const layout = preview?.layout
  const cornerPlate = preview?.cornerPlate
  const ribAccess = preview?.ribAccess
  const geometryError = previewError ?? preview?.error
  const unitLabel = config.units === 'mm' ? 'мм' : 'дюйм'

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

  useEffect(() => {
    try {
      localStorage.setItem('tableGenParams', JSON.stringify(projectConfig(config)))
      localStorage.setItem('tableGenUI', JSON.stringify({ viewMode: workspace === 'table' ? view : readStorage('tableGenUI').viewMode ?? '2d', renderHoles3D: config.renderHoles, enableHoverEffect: config.highlighting, explodeFactor: config.exploded, showDims: config.showDimensions, units: config.units === 'inch' ? 'in' : 'mm', theme: dark ? 'dark' : 'light' }))
    } catch { setNotice('Автосохранение в браузере недоступно. Сохраните проект в файл.') }
  }, [config, dark, view, workspace])

  useEffect(() => {
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
  }, [config])

  const applyTableConfig = (next: Config) => {
    setConfig(next)
    return true
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
    return <SliderField label={label} output={draft => percentage ? `${draft}%` : numberLabel(draft * (imperial ? mmPerInch : 1), 2)} icon={percentage ? 'explode' : undefined} min={range.min} max={range.max} step={range.step} value={imperial ? config[key] / mmPerInch : config[key]} onValue={value => setNumeric(key, value * (imperial ? mmPerInch : 1))} />
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
  const save = () => downloadFile(JSON.stringify(projectConfig(config), null, 2), `Проект_сварочного_стола_${config.length}x${config.width}.wtable`)
  const replaceProject = (candidate: Config) => {
    const next = preserveView(candidate, config)
    const url = new URL(location.href)
    const originalTool = url.searchParams.get('toolProject')
    url.search = tableProjectQuery(next).toString()
    if (originalTool) url.searchParams.set('toolProject', originalTool)
    url.searchParams.set('workspace', workspace); url.searchParams.set('view', view)
    history.replaceState(history.state, '', url)
    setConfig(next)
    reset2d()
  }
  const reportError = (error: unknown) => setNotice(error instanceof Error ? error.message : 'Операция завершилась с ошибкой. Файл экспорта не создан.')
  const open = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text())
      replaceProject((await previewTable(raw)).config)
      setNotice('Проект загружен.')
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

  const addToTable = async (project: ToolProject) => {
    try {
      const candidate = { ...config, nestingTools: [...config.nestingTools, { id: crypto.randomUUID(), project }] }
      const accepted = await previewTable(projectConfig(candidate))
      if (accepted.error) throw Object.assign(new Error(accepted.error.message), { code: accepted.error.code })
      setConfig(preserveView(accepted.config, config)); navigation.navigate({ workspace: 'table', view: 'sheet' })
      setNotice('Оснастка выбрана. Экспорт останется недоступным, пока полная общая раскладка не поместится на листы.')
    } catch (error) { reportError(error) }
  }

  if (workspace === 'tools') return <Suspense fallback={<div className="three-loading">Загрузка инструментов…</div>}><ToolsWorkspace view={view} onView={setView} notice={notice} onDismissNotice={() => setNotice('')} tableConfig={config} onAddToTable={project => void addToTable(project)} dark={dark} onTheme={() => setDark(value => !value)} onBack={() => selectWorkspace('table')} units={config.units} onUnits={units => patch('units', units)} visual={config} onVisual={changes => setConfig(current => ({ ...current, ...changes }))} /></Suspense>
  return <GeneratorShell workspace="table" onWorkspace={selectWorkspace} dark={dark} onTheme={() => setDark(value => !value)} units={config.units} onUnits={units => patch('units', units)} view={view} onView={setView} notice={notice} onDismissNotice={() => setNotice('')}
    settings={<>
          <fieldset className="table-settings">
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
          <TableTools config={config} onChange={nestingTools => patch('nestingTools', nestingTools)} onChoose={() => selectWorkspace('tools')} />
          </fieldset>
    </>}
    visualization={<VisualizationSettings value={config} onChange={changes => setConfig(current => ({ ...current, ...changes }))} />}
    production={<fieldset className="table-settings"><ProductionEstimate summary={summary} units={config.units} sheet={{ length: config.sheetLength, width: config.sheetWidth }} error={geometryError?.message} onSheetChange={changes => { if (changes.length !== undefined) setNumeric('sheetLength', changes.length); if (changes.width !== undefined) setNumeric('sheetWidth', changes.width) }} /></fieldset>}
    actions={onClose => <ProjectActions onOpen={file => { onClose(); void open(file) }} onSave={save} onShare={() => { onClose(); void share() }} disabled={Boolean(geometryError)} fabrication={{ kind: 'parts', onZip: () => void downloadFromApi('/api/export/table-parts.zip', { project: projectConfig(config) }).catch(reportError), onDxf: () => void downloadFromApi('/api/export/table.dxf', { project: projectConfig(config) }).catch(reportError), onOpenSheets: () => { onClose(); setView('sheet') } }} />}
    seo={<article className="seo"><div><h1>Бесплатный генератор сварочных столов — DXF-чертежи и 3D CAD</h1><p>Создайте параметрический сварочный стол. Расчёты выполняются на сервере; браузер показывает готовые 2D/3D-данные и производственные файлы.</p><h3>Системы оснастки D16 и D28</h3><p>Выберите D16/50, D28/100 либо задайте диаметр отверстий, шаг и начало сетки вручную. У квадратной и диагональной сеток фиксированные начала координат от краёв и рабочей поверхности столешницы и юбок.</p><h3>Скачать DXF-файлы сварочного стола</h3><p>DXF стола, отдельные DXF деталей и проверенные DXF листов раскроя скачиваются независимо от редактируемого файла проекта. Архивы для оператора содержат только DXF.</p></div></article>}>
    {geometryError ? <div className="three-loading socket-error" role="alert" data-error-code={geometryError.code}>{geometryError.message}</div> : !preview || !layout ? <div className="three-loading" role="status">Расчёт проекта на сервере…</div> : view === '2d' ? <PartsLayout layout={layout} units={config.units} label="Интерактивный 2D-чертёж сварочного стола" resetToken={reset2dToken} getEngravings={part => preview.engravings[part.name] ?? []} onRemoveHole={(hole, part) => removeHole(hole, readPart(part.name))} />
      : view === 'sheet' ? <TableSheetNesting config={config} dark={dark} onChange={changes => setConfig(current => ({ ...current, ...changes }))} onNotice={setNotice} />
      : <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Загрузка 3D…</div>}><ThreeAssembly config={config} parts={preview.parts} assembly={preview.assembly} resetToken={reset2dToken} dark={dark} /></Suspense></div></>}
  </GeneratorShell>
}
