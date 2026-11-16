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
  length: 'Length', width: 'Width', height: 'Mounting-end height', thickness: 'Sheet thickness · Table',
  armWidth: 'Arm width', holeDiameter: 'Hole Ø', endOffset: 'Hole inset from free ends',
  holePitch: 'Hole pitch', slotLength: 'Clamp slot length', cornerCut: 'Elbow chamfer',
  tipWidth: 'Free-end width', tabWidth: 'Locating tab width', clearance: 'Total joint clearance',
  holeInset: 'Grid origin from edges', tipHeight: 'Free-end depth', taperRun: 'Free-end taper length',
  windowInset: 'Window border inset', windowRadius: 'Window corner radius',
  slotWidth: 'Radial slot width', slotInnerRadius: 'Slot inner-end radius from centre',
}

const sizeLimits = { extension: extensionLimits, compactExtension: compactExtensionLimits, square: squareLimits, cornerBracket: cornerBracketLimits, viseModule: viseModuleLimits }
const toolSummaries: Record<ToolId, string> = {
  extension: 'D16 / 50 mm grid · table-owned sheet thickness',
  compactExtension: 'Three plates · central windowed spine · one mounting end',
  square: 'One flat L-shaped plate · three mounting holes · no bend',
  cornerBracket: 'Three flat parts · two perpendicular walls · open diagonal side',
  viseModule: 'Five plates · eight radial vise slots · table-matched mounting grid',
}

export function ToolsWorkspace({ dark, onTheme, onBack, view, onView, onNavigationGuard, notice, onDismissNotice, units, onUnits, visual, onVisual, tableConfig, tableAdmissionError, onAddToTable }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      saved = new URLSearchParams(location.search).get('toolProject') ?? localStorage.getItem(storageKey)
      const loaded = saved ? readToolProjectAtTable(saved, tableConfig) : { project: projectAtTable(defaultToolProject, tableConfig), kind: 'current', message: '' }
      return { project: loaded.kind === 'current' ? loaded.project : defaultToolProject, notice: loaded.message, rejected: loaded.kind === 'migration' ? saved ?? '' : '', migration: loaded.kind === 'migration' ? loaded.project : null }
    } catch (error) {
      return { project: defaultToolProject, notice: `Saved/shared Tools project was not loaded: ${error instanceof Error ? error.message : 'storage unavailable'}. Its original data has not been deleted.`, rejected: saved ?? '', migration: null }
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
    onNavigationGuard(rejected ? { workspace: 'tools', message: 'Resolve the pending project review before leaving Tools.' } : null)
    return () => onNavigationGuard(null)
  }, [rejected, onNavigationGuard])
  useEffect(() => { try { localStorage.setItem('weldingToolsView', view) } catch { setMessage('View preference could not be saved.') } }, [view])
  const key = projectKey(project)
  const fabrication = useMemo(() => {
    try { return { parts: projectModelParts(project), error: null } }
    catch (error) { return { parts: null, error: error instanceof Error ? error.message : 'Invalid tool geometry' } }
  }, [key])
  useEffect(() => {
    if (rejected || fabrication.error) return
    try { localStorage.setItem(storageKey, projectJson(project)); localStorage.setItem(`${storageKey}.${project.tool}`, projectJson(project)) }
    catch { setLoadError('Browser autosave unavailable. Use Save to keep your project.') }
  }, [key, rejected, fabrication.error])
  const parts = fabrication.parts
  const batchParts = useMemo(() => parts?.map(part => ({ ...part, count: part.count * project.copies })), [parts, project.copies])
  const layout = useMemo(() => batchParts && arrangeParts(batchParts), [batchParts])
  const summary = useMemo(() => batchParts && fabricationEstimate(batchParts, project.sheet), [batchParts, project.sheet])
  const admissionError = rejected ? loadError : fabrication.error ?? tableAdmissionError(project)
  const factor = units === 'mm' ? 1 : mmPerInch, unitLabel = units === 'mm' ? 'mm' : 'in'

  const apply = (candidate: ToolProject) => {
    if (rejected) return false
    try {
      const next = parseToolProject(projectJson(projectAtTable(candidate, tableConfig)))
      if (projectKey(next) === key) return true
      const url = new URL(location.href)
      if (url.searchParams.has('toolProject')) { url.searchParams.set('toolProject', projectJson(next)); history.replaceState(history.state, '', url) }
      setProject(next)
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid Tools project'); return false }
  }
  const selectTool = (id: ToolId) => {
    if (id === project.tool || rejected) return
    try {
      const saved = localStorage.getItem(`${storageKey}.${id}`)
      const loaded = saved ? readToolProjectAtTable(saved, tableConfig) : { project: projectAtTable({ ...toolDefaults[id], sheet: { ...project.sheet } }, tableConfig), kind: 'current', message: '' }
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
    const label = name === 'height' && project.tool !== 'extension' ? 'Height' : sizeLabels[name]
    return <NumberField key={`${project.tool}:${name}`} label={label} readOnly={readOnly} disabled={Boolean(rejected)} value={String(Number(display(value, units, 3)))} min={range.min / factor} max={range.max / factor} step={range.step / factor}
      onValue={value => applySize(name, value)} />
  }
  const share = async () => {
    const url = new URL(location.href)
    url.search = tableProjectQuery(tableConfig).toString()
    url.searchParams.set('toolProject', projectJson(project))
    url.searchParams.set('workspace', 'tools'); url.searchParams.set('view', view)
    try { await copyText(url.toString()); setMessage('Tools project link copied.') }
    catch { setMessage('Clipboard denied. Use Save to preserve this project.') }
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
    } catch (error) { setLoadError(`Could not apply corrected geometry: ${error instanceof Error ? error.message : 'storage unavailable'}. Download the original JSON first.`) }
  }
  const open = async (file: File) => {
    if (rejected) { setMessage('Resolve the pending project review before replacing it.'); return }
    try {
      const original = await file.text(), loaded = readToolProjectAtTable(original, tableConfig)
      if (loaded.kind === 'migration') { setRejected(original); setMigration(loaded.project); setLoadError(loaded.message); return }
      if (apply(loaded.project)) { setReset(value => value + 1); setMessage('Tools project opened.') }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Project could not be opened') }
  }
  return <GeneratorShell workspace="tools" onWorkspace={value => { if (value === 'table') onBack() }} dark={dark} onTheme={onTheme} units={units} onUnits={onUnits} view={view}
    onView={onView} notice={message || notice} onDismissNotice={() => { setMessage(''); onDismissNotice() }}
    settings={<>
      {loadError && <section role="alert"><p className="socket-error">{loadError}</p>{rejected && <><button className="secondary full" onClick={() => downloadFile(rejected, 'welding-tool-original.json')}>Download original JSON</button><button className="secondary full" onClick={startCorrected}>{migration ? 'Apply corrected geometry' : 'Start new design'}</button></>}</section>}
      <>
        <section className="fixture-card"><h3>Tools</h3><label className="field"><span>Choose a tool</span><select disabled={Boolean(rejected)} aria-label="Select tool" value={project.tool} onChange={event => { const value = event.target.value; if (isToolId(value)) selectTool(value) }}>{toolIds.map(id => <option key={id} value={id}>{toolLabels[id]}</option>)}</select></label><p className="grid-summary">{toolSummaries[project.tool]}</p></section>
        <ParameterGroup title={<>Dimensions ({unitLabel})</>} defaultOpen><div className="fields">{sizeField('length')}{sizeField('width')}{project.tool === 'square' ? sizeField('armWidth') : sizeField('height')}{sizeField('thickness')}</div><p>Thickness follows the table, including imported projects. Change Metal Thickness in Table generator; all joints and cut parts are recalculated.</p></ParameterGroup>
        {project.tool === 'viseModule' && <><ParameterGroup title={<>Table mounting grid ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Diameter, pitch, edge origin and {project.size.grid} pattern follow Table generator. The mounting wall contains the complete matching grid, measured down from the working face; holes are never shifted or omitted to fit. Lower side rows are limited by the curved profile.</p></ParameterGroup><ParameterGroup title={<>Vise slots & locating joints ({unitLabel})</>}><div className="fields">{sizeField('slotWidth')}{sizeField('slotInnerRadius')}{sizeField('tipHeight')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Eight separate rounded slots at 45° intervals, plus a central round hole. Every outer rounded tip stops {display(viseSlotSetback, units, 3)} {unitLabel} before the plate boundary along its ray; square-top diagonals end that distance from the corners. Slot lengths recalculate with the plate size. Measured along each slot axis, not perpendicular to the side.</p></ParameterGroup></>}
        {project.tool === 'square' && <ParameterGroup title={<>Mounting holes ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('endOffset')}</div><p>One hole at the elbow and one near each free end. The elbow centre is half the arm width from both outside edges. Check the resulting centre distances against your table.</p></ParameterGroup>}
        {project.tool === 'compactExtension' && <><ParameterGroup title={<>Tooling grid ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('holeInset')}</div><p>Fixed edge origins on the working top and mounting end. The first end row is measured down from the assembled working face. Conflicting holes are rejected, not shifted or removed.</p></ParameterGroup><ParameterGroup title={<>Spine & locating joints ({unitLabel})</>}><div className="fields">{sizeField('tipHeight')}{sizeField('taperRun')}{sizeField('windowInset')}{sizeField('windowRadius')}{sizeField('tabWidth')}{sizeField('clearance')}</div><p>Window border inset sets the perimeter web. Diagonal webs between adjacent windows: {display(project.size.windowInset * 2, units, 3)} {unitLabel}. Saved projects keep their chosen inset.</p></ParameterGroup></>}
        {project.tool === 'cornerBracket' && <><ParameterGroup title={<>Mounting holes & slot ({unitLabel})</>}><div className="fields">{sizeField('holeDiameter')}{sizeField('holePitch')}{sizeField('slotLength')}</div><p>Nine base holes in a triangular grid with the elbow position omitted; three holes in one wall, one rounded slot in the other. The slot width equals the hole diameter.</p></ParameterGroup><ParameterGroup title={<>Profile & locating joints ({unitLabel})</>}><div className="fields">{sizeField('cornerCut')}{sizeField('tipWidth')}{sizeField('tabWidth')}{sizeField('clearance')}</div></ParameterGroup></>}
        <ParameterGroup title={<>Add to table sheets</>}><p>Cut this configured tool together with the table, using only the table’s existing sheet capacity. Same steel grade and {display(tableConfig.thickness, units, 3)} {unitLabel} thickness required.</p><NumberField label="Tool copies in the cutting batch" value={project.copies} min={1} max={10} step={1} disabled={Boolean(rejected)} onValue={copies => apply({ ...project, copies })} />{admissionError && <p role="alert" className="socket-error">{admissionError}</p>}<button className="secondary full" disabled={Boolean(admissionError)} onClick={() => onAddToTable(project)}>Add to table cut job</button><p>This adds a saved copy of the tool settings. Later dimension edits here do not change tools already selected for the table. All five tool families use the table’s thickness; the vise mounting grid follows the table too. The table’s sheet size and clearances apply; all tool copies must fit before export.</p></ParameterGroup>
      </>
    </>}
    visualization={<VisualizationSettings value={visual} onChange={onVisual} />}
    production={summary && <ProductionEstimate summary={summary} units={units} sheet={project.sheet} error={rejected ? loadError : null} onSheetChange={changes => apply({ ...project, sheet: { ...project.sheet, ...changes } })} />}
    actions={onClose => <ProjectActions onOpen={file => { onClose(); void open(file) }} onSave={() => downloadFile(JSON.stringify(project, null, 2), `welding-${project.tool}-project.json`)} onShare={() => { onClose(); void share() }} disabled={Boolean(rejected || fabrication.error)} fabrication={{ kind: 'parts', onZip: () => void downloadToolParts(project, tableConfig).catch(() => setMessage('Could not create the ZIP archive.')), onDxf: () => downloadToolStrip(project, tableConfig) }} />}>
    {rejected ? <div className="three-loading socket-error" role="alert">Preserve the original project, then explicitly start the corrected design.</div>
      : fabrication.error ? <div className="three-loading socket-error" role="alert">{fabrication.error} Change the table thickness or the tool dimensions before fabrication.</div>
      : view === '2d' ? layout && <PartsLayout layout={layout} units={units} label={`Interactive 2D ${toolLabels[project.tool]} parts layout`} resetToken={reset} />
      : view === '3d' ? <><div className="drawing-frame"><Suspense fallback={<div className="three-loading">Loading 3D assembly…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={reset} {...visual} /></Suspense></div></>
      : batchParts && <SheetNesting jobKey={key} job={{ parts: batchParts, options: projectNestingOptions(project), stock: { kind: 'new-sheets' } }} sheetSettings={{ ...project.sheet, copies: project.copies }} units={units} maxGap={100}
        onChange={({ copies, ...sheet }) => apply({ ...project, sheet: { ...project.sheet, ...sheet }, copies: copies ?? project.copies })} onNotice={setMessage} onExport={({ result }) => downloadToolArchive(project, result, key, tableConfig)} isLayoutValid={({ result }, key) => validProjectLayout(project, result, key)}
        render3D={result => <Suspense fallback={<div className="three-loading">Loading 3D…</div>}><ToolAssembly3d project={project} dark={dark} units={units} resetToken={0} {...visual} nesting={result} /></Suspense>} />}
  </GeneratorShell>
}
