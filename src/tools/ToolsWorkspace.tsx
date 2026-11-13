import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AssemblyControls, GeneratorShell, NumberField, ProductionEstimate, ProjectActions, VisualizationSettings, type ViewMode, type VisualSettings } from '../GeneratorWorkspace'
import { PartsLayout } from '../PartsLayout'
import { SheetNesting } from '../SheetNesting'
import { arrangeParts, fabricationEstimate } from '../fabricationLayout'
import { display, mmPerInch, readDisplay, type Config } from '../model'
import { copyText, downloadFile } from '../projectIO'
import { extensionDimensions, type ExtensionConfig } from './extension'
import { squareLimits, type SquareConfig } from './square'
import { defaultToolProject, defaultSquareProject, downloadToolArchive, downloadToolParts, downloadToolStrip, parseToolProject, projectJson, projectKey, projectModelParts, projectNestingOptions, projectParts, toolLabels, validProjectLayout, type ToolId, type ToolProject } from './project'

const ToolAssembly3d = lazy(() => import('./ToolAssembly3d').then(module => ({ default: module.ToolAssembly3d })))
export type ToolsWorkspaceProps = {
  dark: boolean; onTheme: () => void; onBack: () => void
  units: Config['units']; onUnits: (units: Config['units']) => void
  visual: VisualSettings; onVisual: (changes: Partial<VisualSettings>) => void
}
const storageKey = 'weldingToolsProject'
const extensionLimits: Record<keyof ExtensionConfig, { min: number; max: number; step: number }> = {
  length: { min: 400, max: 800, step: 50 }, width: { min: 200, max: 400, step: 50 },
  height: { min: 150, max: 300, step: 50 }, thickness: { min: 4, max: 10, step: 1 },
}
const sizeLabels: Record<keyof ExtensionConfig | keyof SquareConfig, string> = {
  length: 'Length', width: 'Width', height: 'Mounting-end height', thickness: 'Metal Thickness',
  armWidth: 'Arm width', holeDiameter: 'Hole Ø', endOffset: 'Hole inset from free ends',
}

export function ToolsWorkspace({ dark, onTheme, onBack, units, onUnits, visual, onVisual }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = new URLSearchParams(location.search).get('toolProject') ?? localStorage.getItem(storageKey)
      return { project: saved ? parseToolProject(saved) : defaultToolProject, notice: '', rejected: '' }
    } catch (error) {
      return { project: defaultToolProject, notice: `Saved/shared Tools project was not loaded: ${error instanceof Error ? error.message : 'storage unavailable'}. Its original data has not been deleted.`, rejected: saved ?? '' }
    }
  })
  const [project, setProject] = useState<ToolProject>(initial.project)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState(initial.notice)
  const [rejected, setRejected] = useState(initial.rejected)
  const [reset, setReset] = useState(0)
  const [view, setView] = useState<ViewMode>(() => {
    try { const saved = localStorage.getItem('weldingToolsView'); return saved === '3d' || saved === 'sheet' ? saved : '2d' } catch { return '2d' }
  })
  const key = projectKey(project)
  useEffect(() => {
    if (rejected) return
    try { localStorage.setItem(storageKey, projectJson(project)); localStorage.setItem(`${storageKey}.${project.tool}`, projectJson(project)) }
    catch { setLoadError('Browser autosave unavailable. Use Save to keep your project.') }
  }, [key, rejected])
  const parts = useMemo(() => projectModelParts(project), [key])
  const batchParts = useMemo(() => projectParts(project), [key])
  const layout = useMemo(() => arrangeParts(parts), [parts])
  const summary = useMemo(() => fabricationEstimate(parts, project.sheet), [parts, project.sheet])
  const dimensions = project.tool === 'extension' ? extensionDimensions(project.size) : null
  const factor = units === 'mm' ? 1 : mmPerInch, unitLabel = units === 'mm' ? 'mm' : 'in'

  const apply = (candidate: ToolProject) => {
    if (rejected) return false
    try {
      const next = parseToolProject(projectJson(candidate))
      if (projectKey(next) === key) return true
      const url = new URL(location.href)
      if (url.searchParams.has('toolProject')) { url.searchParams.set('toolProject', projectJson(next)); history.replaceState(null, '', url) }
      setProject(next)
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid Tools project'); return false }
  }
  const selectTool = (id: ToolId) => {
    if (id === project.tool) return
    try {
      const saved = localStorage.getItem(`${storageKey}.${id}`)
      const next = saved ? parseToolProject(saved) : { ...(id === 'extension' ? defaultToolProject : defaultSquareProject), sheet: { ...project.sheet } }
      if (next.tool !== id) throw new Error('Saved tool identity does not match the selected product')
      if (apply(next)) setReset(value => value + 1)
    } catch (error) { setLoadError(`Saved tool was not replaced: ${error instanceof Error ? error.message : 'storage unavailable'}`) }
  }
  const sizeField = (name: keyof ExtensionConfig | keyof SquareConfig) => {
    const limits = project.tool === 'extension' ? extensionLimits : squareLimits
    if (!(name in project.size) || !(name in limits)) return null
    const value = project.size[name as keyof typeof project.size]
    const range = limits[name as keyof typeof limits]
    return <NumberField key={`${project.tool}:${name}`} label={sizeLabels[name]} disabled={Boolean(rejected)} value={String(Number(display(value, units, 3)))} min={range.min / factor} max={range.max / factor} step={range.step / factor}
      onValue={value => project.tool === 'extension'
        ? apply({ ...project, size: { ...project.size, [name]: readDisplay(value, units) } })
        : apply({ ...project, size: { ...project.size, [name]: readDisplay(value, units) } })} />
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('toolProject', projectJson(project))
    try { await copyText(url.toString()); setMessage('Tools project link copied.') }
    catch { setMessage('Clipboard denied. Use Save to preserve this project.') }
  }
  const startCorrected = () => {
    try { localStorage.setItem(`${storageKey}.previous`, rejected); localStorage.setItem(storageKey, projectJson(defaultToolProject)) }
    catch { setLoadError('Could not preserve the previous project in browser storage. Download the original JSON first.'); return }
    const url = new URL(location.href)
    url.searchParams.delete('toolProject'); url.searchParams.set('workspace', 'tools')
    history.replaceState(null, '', url)
    setProject(defaultToolProject); setRejected(''); setLoadError('')
  }
  const open = async (file: File) => {
    try { if (apply(parseToolProject(await file.text()))) { setReset(value => value + 1); setMessage('Tools project opened.') } }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Project could not be opened') }
  }
  return <GeneratorShell workspace="tools" onWorkspace={value => { if (value === 'table') onBack() }} dark={dark} onTheme={onTheme} units={units} onUnits={onUnits} view={view}
    onView={value => { setView(value); try { localStorage.setItem('weldingToolsView', value) } catch { setMessage('View preference could not be saved.') } }} notice={message} onDismissNotice={() => setMessage('')}
    settings={<>
      {loadError && <section role="alert"><p className="socket-error">{loadError}</p>{rejected && <><button className="secondary full" onClick={() => downloadFile(rejected, 'welding-extension-original.json')}>Download original JSON</button><button className="secondary full" onClick={startCorrected}>Start corrected design</button></>}</section>}
      <>
        <section className="fixture-card"><h3>Tools</h3><label className="field"><span>Choose a tool</span><select disabled={Boolean(rejected)} aria-label="Select tool" value={project.tool} onChange={event => { const value = event.target.value; if (value === 'extension' || value === 'square') selectTool(value) }}><option value="extension">{toolLabels.extension}</option><option value="square">{toolLabels.square}</option></select></label><p className="grid-summary">{project.tool === 'extension' ? 'D16 / 50 mm grid · independently dimensioned wedge analogue' : 'One flat L-shaped plate · three mounting holes · no bend'}</p></section>
        <section><h3>Dimensions ({unitLabel})</h3><div className="fields">{sizeField('length')}{sizeField('width')}{project.tool === 'extension' ? sizeField('height') : sizeField('armWidth')}{sizeField('thickness')}</div></section>
        {project.tool === 'square' && <section><h3>Mounting holes ({unitLabel})</h3><div className="fields">{sizeField('holeDiameter')}{sizeField('endOffset')}</div><p>One hole at the elbow and one near each free end. The elbow centre is half the arm width from both outside edges. Check the resulting centre distances against your table.</p></section>}
        <section><h3>Design assumptions</h3>{project.tool === 'extension' && dimensions ? <><p>The high slotted end mounts to the table. The perforated top is horizontal; tapered sides, large windows and two narrow cross ties leave the underside open.</p><p>Free-end height: {display(dimensions.tipHeight, units, 3)} {unitLabel}. Cross ties: {display(dimensions.ribDepth, units, 3)} {unitLabel}. Locating tabs: {display(dimensions.tabWidth, units, 3)} {unitLabel}; matching cuts add {display(dimensions.clearance, units, 3)} {unitLabel} total clearance. These joints, windows and mounting slots are proposed dimensions, not a CAS manufacturing drawing.</p></> : <><p>The reference shows a 250 × 250 mm flat square with three round holes. Arm width, stock thickness, hole diameter and offsets are editable assumptions, not measured Keepler-Stan dimensions.</p><p>This is one flat-cut part, not angle iron. Nominal perpendicular edges do not guarantee a precision square: check flatness, finish and measure the working edges after cutting.</p></>}<p>Before fabrication: confirm actual table/hardware fit, steel grade, loads, weld sequence/distortion where relevant and CAM kerf, lead-ins, clamps and cut order.</p></section>
        <VisualizationSettings value={visual} onChange={onVisual} />
      </>
    </>}
    production={<ProductionEstimate summary={summary} units={units} sheet={project.sheet} error={rejected ? loadError : null} onSheetChange={changes => apply({ ...project, sheet: { ...project.sheet, ...changes } })} />}
    actions={<ProjectActions onOpen={file => void open(file)} onSave={() => downloadFile(JSON.stringify(project, null, 2), `welding-${project.tool}-project.json`)} onShare={() => void share()} disabled={Boolean(rejected)} onZip={() => void downloadToolParts(project).catch(() => setMessage('Could not create the ZIP archive.'))} onDxf={() => downloadToolStrip(project)} />}>
    {rejected ? <div className="three-loading socket-error" role="alert">Preserve the original project, then explicitly start the corrected design.</div>
      : view === '2d' ? <PartsLayout layout={layout} units={units} label={`Interactive 2D ${toolLabels[project.tool]} parts layout`} resetToken={reset} />
      : view === '3d' ? <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Loading 3D assembly…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={reset} {...visual} /></Suspense></div><AssemblyControls value={visual} onChange={onVisual} onReset={() => setReset(value => value + 1)} /></>
      : <SheetNesting jobKey={key} sourceParts={batchParts} options={projectNestingOptions(project)} sheetSettings={{ ...project.sheet, copies: project.copies }} units={units} maxGap={100}
        onChange={({ copies, ...sheet }) => apply({ ...project, sheet: { ...project.sheet, ...sheet }, copies: copies ?? project.copies })} onNotice={setMessage} onExport={result => downloadToolArchive(project, result, key)} isLayoutValid={(result, key) => validProjectLayout(project, result, key)}
        render3D={(result, reset) => <Suspense fallback={<div className="three-loading">Loading 3D…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={reset} {...visual} nesting={result} /></Suspense>} />}
  </GeneratorShell>
}
