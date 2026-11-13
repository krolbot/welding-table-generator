import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { AssemblyControls, GeneratorShell, NumberField, ProductionEstimate, ProjectActions, VisualizationSettings, type ViewMode, type VisualSettings } from '../GeneratorWorkspace'
import { PartsLayout } from '../PartsLayout'
import { SheetNesting } from '../SheetNesting'
import { arrangeParts, fabricationEstimate } from '../fabricationLayout'
import { display, mmPerInch, readDisplay, type Config } from '../model'
import { copyText, downloadFile } from '../projectIO'
import { extensionDimensions, extensionLimits, type ExtensionConfig } from './extension'
import { squareLimits, type SquareConfig } from './square'
import { cornerBracketDimensions, cornerBracketLimits, type CornerBracketConfig } from './cornerBracket'
import { defaultToolProject, toolDefaults, toolIds, isToolId, downloadToolArchive, downloadToolParts, downloadToolStrip, parseToolProject, readToolProject, projectJson, projectKey, projectModelParts, projectNestingOptions, projectParts, toolLabels, validProjectLayout, type ToolId, type ToolProject } from './project'

const ToolAssembly3d = lazy(() => import('./ToolAssembly3d').then(module => ({ default: module.ToolAssembly3d })))
export type ToolsWorkspaceProps = {
  dark: boolean; onTheme: () => void; onBack: () => void
  units: Config['units']; onUnits: (units: Config['units']) => void
  visual: VisualSettings; onVisual: (changes: Partial<VisualSettings>) => void
}
const storageKey = 'weldingToolsProject'

type ToolDimension = keyof ExtensionConfig | keyof SquareConfig | keyof CornerBracketConfig
const sizeLabels: Record<ToolDimension, string> = {
  length: 'Length', width: 'Width', height: 'Mounting-end height', thickness: 'Metal Thickness',
  armWidth: 'Arm width', holeDiameter: 'Hole Ø', endOffset: 'Hole inset from free ends',
  holePitch: 'Hole pitch', slotLength: 'Clamp slot length', cornerCut: 'Elbow chamfer',
  tipWidth: 'Free-end width', tabWidth: 'Locating tab width', clearance: 'Total joint clearance',
}

export function ToolsWorkspace({ dark, onTheme, onBack, units, onUnits, visual, onVisual }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = new URLSearchParams(location.search).get('toolProject') ?? localStorage.getItem(storageKey)
      const loaded = saved ? readToolProject(saved) : { project: defaultToolProject, kind: 'current', message: '' }
      return { project: loaded.kind === 'current' ? loaded.project : defaultToolProject, notice: loaded.message, rejected: loaded.kind === 'migration' ? saved ?? '' : '', migration: loaded.kind === 'migration' ? loaded.project : null }
    } catch (error) {
      return { project: defaultToolProject, notice: `Saved/shared Tools project was not loaded: ${error instanceof Error ? error.message : 'storage unavailable'}. Its original data has not been deleted.`, rejected: saved ?? '', migration: null }
    }
  })
  const [project, setProject] = useState<ToolProject>(initial.project)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState(initial.notice)
  const [rejected, setRejected] = useState(initial.rejected)
  const [migration, setMigration] = useState<ToolProject | null>(initial.migration)
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
  const cornerDimensions = project.tool === 'cornerBracket' ? cornerBracketDimensions(project.size) : null
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
    if (id === project.tool || rejected) return
    try {
      const saved = localStorage.getItem(`${storageKey}.${id}`)
      const loaded = saved ? readToolProject(saved) : { project: { ...toolDefaults[id], sheet: { ...project.sheet } }, kind: 'current', message: '' }
      const next = loaded.project
      if (next.tool !== id) throw new Error('Saved tool identity does not match the selected product')
      if (loaded.kind === 'migration') { setMigration(next); setRejected(saved ?? ''); setLoadError(loaded.message); return }
      if (apply(next)) setReset(value => value + 1)
    } catch (error) { setLoadError(`Saved tool was not replaced: ${error instanceof Error ? error.message : 'storage unavailable'}`) }
  }
  const applySize = (name: ToolDimension, value: number) => {
    const next = readDisplay(value, units)
    switch (project.tool) {
      case 'extension': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'square': return apply({ ...project, size: { ...project.size, [name]: next } })
      case 'cornerBracket': return apply({ ...project, size: { ...project.size, [name]: next } })
    }
  }
  const sizeField = (name: ToolDimension) => {
    const limits = project.tool === 'extension' ? extensionLimits : project.tool === 'square' ? squareLimits : cornerBracketLimits
    if (!(name in project.size) || !(name in limits)) return null
    const value = project.size[name as keyof typeof project.size]
    const range = limits[name as keyof typeof limits]
    return <NumberField key={`${project.tool}:${name}`} label={name === 'height' && project.tool === 'cornerBracket' ? 'Height' : sizeLabels[name]} disabled={Boolean(rejected)} value={String(Number(display(value, units, 3)))} min={range.min / factor} max={range.max / factor} step={range.step / factor}
      onValue={value => applySize(name, value)} />
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('toolProject', projectJson(project))
    try { await copyText(url.toString()); setMessage('Tools project link copied.') }
    catch { setMessage('Clipboard denied. Use Save to preserve this project.') }
  }
  const startCorrected = () => {
    const next = migration ?? defaultToolProject
    try { localStorage.setItem(`${storageKey}.previous`, rejected); localStorage.setItem(storageKey, projectJson(next)) }
    catch { setLoadError('Could not preserve the previous project in browser storage. Download the original JSON first.'); return }
    const url = new URL(location.href)
    url.searchParams.delete('toolProject'); url.searchParams.set('workspace', 'tools')
    history.replaceState(null, '', url)
    setProject(next); setRejected(''); setMigration(null); setLoadError(''); setReset(value => value + 1)
  }
  const open = async (file: File) => {
    if (rejected) { setMessage('Resolve the pending project review before replacing it.'); return }
    try {
      const original = await file.text(), loaded = readToolProject(original)
      if (loaded.kind === 'migration') { setRejected(original); setMigration(loaded.project); setLoadError(loaded.message); return }
      if (apply(loaded.project)) { setReset(value => value + 1); setMessage('Tools project opened.') }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Project could not be opened') }
  }
  return <GeneratorShell workspace="tools" onWorkspace={value => { if (value === 'table') onBack() }} dark={dark} onTheme={onTheme} units={units} onUnits={onUnits} view={view}
    onView={value => { setView(value); try { localStorage.setItem('weldingToolsView', value) } catch { setMessage('View preference could not be saved.') } }} notice={message} onDismissNotice={() => setMessage('')}
    settings={<>
      {loadError && <section role="alert"><p className="socket-error">{loadError}</p>{rejected && <><button className="secondary full" onClick={() => downloadFile(rejected, 'welding-extension-original.json')}>Download original JSON</button><button className="secondary full" onClick={startCorrected}>{migration ? 'Apply corrected grid' : 'Start new design'}</button></>}</section>}
      <>
        <section className="fixture-card"><h3>Tools</h3><label className="field"><span>Choose a tool</span><select disabled={Boolean(rejected)} aria-label="Select tool" value={project.tool} onChange={event => { const value = event.target.value; if (isToolId(value)) selectTool(value) }}>{toolIds.map(id => <option key={id} value={id}>{toolLabels[id]}</option>)}</select></label><p className="grid-summary">{project.tool === 'extension' ? 'D16 / 50 mm grid · independently dimensioned wedge analogue' : project.tool === 'square' ? 'One flat L-shaped plate · three mounting holes · no bend' : 'Three flat parts · two perpendicular walls · open diagonal side'}</p></section>
        <section><h3>Dimensions ({unitLabel})</h3><div className="fields">{sizeField('length')}{sizeField('width')}{project.tool === 'square' ? sizeField('armWidth') : sizeField('height')}{sizeField('thickness')}</div></section>
        {project.tool === 'square' && <section><h3>Mounting holes ({unitLabel})</h3><div className="fields">{sizeField('holeDiameter')}{sizeField('endOffset')}</div><p>One hole at the elbow and one near each free end. The elbow centre is half the arm width from both outside edges. Check the resulting centre distances against your table.</p></section>}
        {project.tool === 'cornerBracket' && <><section><h3>Mounting holes & slot ({unitLabel})</h3><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('slotLength')}</div><p>Nine base holes in a triangular grid with the elbow position omitted; three holes in one wall, one rounded slot in the other. The slot width equals the hole diameter.</p></section><section><h3>Profile & locating joints ({unitLabel})</h3><div className="fields">{sizeField('cornerCut')}{sizeField('tipWidth')}{sizeField('tabWidth')}{sizeField('clearance')}</div></section></>}
        <section><h3>Design assumptions</h3>{project.tool === 'cornerBracket' && cornerDimensions ? <><p>The assembled and flat-kit references show one chamfered triangular base and two perpendicular walls. Nominal envelope: 210 × 210 × 60 mm, stock: 8 mm. The top and diagonal side are open; no bend is required.</p><p>Hole diameter, pitch and origins, slot size, corner cuts and all joints are proposed, not factory measurements. Base grid origin: {display(cornerDimensions.holeOrigin.x, units, 3)} × {display(cornerDimensions.holeOrigin.y, units, 3)} {unitLabel}. Two tabs on each wall seat in matching base notches, flush underneath. Fixture, tack and check the angle before welding.</p></> : project.tool === 'extension' && dimensions ? <><p>The high slotted end mounts to the table. The perforated top is horizontal; tapered sides, large windows and two narrow cross ties leave the underside open.</p><p>Free-end height: {display(dimensions.tipHeight, units, 3)} {unitLabel}. Cross ties: {display(dimensions.ribDepth, units, 3)} {unitLabel}. Locating tabs: {display(dimensions.tabWidth, units, 3)} {unitLabel}; matching cuts add {display(dimensions.clearance, units, 3)} {unitLabel} total clearance. These joints, windows and mounting slots are proposed dimensions, not a CAS manufacturing drawing.</p></> : <><p>The reference shows a 250 × 250 mm flat square with three round holes. Arm width, stock thickness, hole diameter and offsets are editable assumptions, not measured Keepler-Stan dimensions.</p><p>This is one flat-cut part, not angle iron. Nominal perpendicular edges do not guarantee a precision square: check flatness, finish and measure the working edges after cutting.</p></>}<p>Before fabrication: confirm actual table/hardware fit, steel grade, loads, weld sequence/distortion where relevant and CAM kerf, lead-ins, clamps and cut order.</p></section>
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
