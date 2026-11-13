import { useEffect, useRef, useState } from 'react'
import { svgContourPath, type FabricationPart } from '../geometry'
import type { NestingResult } from '../nesting'
import { ExtensionAssembly3d } from './ToolAssembly3d'
import { extensionDimensions, extensionParts } from './extension'
import { defaultToolProject, downloadExtensionArchive, parseToolProject, projectJson, projectKey, validProjectLayout, type ToolProject } from './project'
import './tools.css'

export type ToolsWorkspaceProps = { dark: boolean; onBack: () => void }
const storageKey = 'weldingToolsProject'
const profile = (part: FabricationPart) => [
  ...part.contours.map(svgContourPath),
  ...part.holes.map(hole => `M ${hole.x - hole.d / 2} ${hole.y} a ${hole.d / 2} ${hole.d / 2} 0 1 0 ${hole.d} 0 a ${hole.d / 2} ${hole.d / 2} 0 1 0 -${hole.d} 0 Z`),
].join(' ')
const saveJson = (text: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  queueMicrotask(() => URL.revokeObjectURL(url))
}
function NumberField({ label, value, min, max, set }: { label: string; value: number; min: number; max: number; set: (value: number) => boolean }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label className="field"><span>{label}</span><input aria-label={label} type="number" value={draft} min={min} max={max} step="1"
    onChange={event => setDraft(event.target.value)}
    onBlur={() => { const next = Number(draft); if (!draft.trim() || !Number.isFinite(next) || !set(next)) setDraft(String(value)) }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
}

export function ToolsWorkspace({ dark, onBack }: ToolsWorkspaceProps) {
  const [initial] = useState(() => {
    let saved: string | null = null
    try {
      const shared = new URLSearchParams(location.search).get('toolProject')
      saved = shared ?? localStorage.getItem(storageKey)
      return { project: saved ? parseToolProject(saved) : defaultToolProject, notice: '', rejected: '' }
    } catch (error) {
      return { project: defaultToolProject, notice: `Saved/shared Tools project was not loaded: ${error instanceof Error ? error.message : 'storage unavailable'}. Its original data has not been deleted.`, rejected: saved ?? '' }
    }
  })
  const [project, setProject] = useState<ToolProject>(initial.project)
  const [result, setResult] = useState<NestingResult>()
  const [resultKey, setResultKey] = useState<string>()
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState(initial.notice)
  const [rejected, setRejected] = useState(initial.rejected)
  const [sheet, setSheet] = useState(0)
  const file = useRef<HTMLInputElement>(null)
  const key = projectKey(project)
  const currentResult = resultKey === key ? result : undefined
  const valid = !rejected && validProjectLayout(project, currentResult, resultKey)
  const parts = extensionParts(project.size)
  const dimensions = extensionDimensions(project.size)
  const sheets = currentResult && [...new Set(currentResult.placements.map(placement => placement.sheet))].sort((a, b) => a - b)
    .map(index => ({ index, placements: currentResult.placements.filter(placement => placement.sheet === index) }))
  const selected = sheets?.find(value => value.index === sheet)

  const apply = (candidate: ToolProject) => {
    if (rejected) return false
    try {
      const next = parseToolProject(projectJson(candidate))
      if (projectKey(next) === key) return true
      const url = new URL(location.href)
      if (url.searchParams.has('toolProject')) {
        url.searchParams.set('toolProject', projectJson(next))
        history.replaceState(null, '', url)
      }
      setProject(next)
      setResult(undefined)
      setResultKey(undefined)
      setSheet(0)
      try { localStorage.setItem(storageKey, projectJson(next)) }
      catch { setLoadError('Browser autosave unavailable. Save the project JSON yourself.') }
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid Tools project'); return false }
  }
  useEffect(() => {
    if (rejected) return
    let worker: Worker
    try { worker = new Worker(new URL('./tools.worker.ts', import.meta.url), { type: 'module' }) }
    catch { setMessage('This browser cannot start the sheet calculation.'); return }
    setMessage('Calculating sheet layout…')
    worker.onmessage = ({ data }: MessageEvent<{ type: string; key: string; result?: NestingResult; message?: string }>) => {
      if (data.key !== key) return
      if (data.type === 'result' && data.result) {
        setResult(data.result)
        setResultKey(key)
        setMessage(data.result.unplaced.length ? `${data.result.unplaced.length} part instances did not fit.` : `${data.result.sheets.length} sheet(s), ${data.result.stats.attempts} search passes.`)
      } else setMessage(data.message ?? 'Sheet calculation failed')
    }
    worker.onerror = () => { setResult(undefined); setResultKey(undefined); setMessage('Sheet calculation worker failed.') }
    worker.postMessage({ type: 'nest', key, project })
    return () => worker.terminate()
  }, [key, rejected])
  const size = (name: keyof ToolProject['size'], value: number) => apply({ ...project, size: { ...project.size, [name]: value } })
  const stock = (name: keyof ToolProject['sheet'], value: number) => apply({ ...project, sheet: { ...project.sheet, [name]: value } })
  const share = async () => {
    if (!navigator.clipboard?.writeText) { setMessage('Clipboard unavailable. Use Save JSON instead.'); return }
    const url = new URL(location.href)
    url.search = ''
    url.searchParams.set('toolProject', projectJson(project))
    try { await navigator.clipboard.writeText(url.toString()); setMessage('Tools project link copied.') }
    catch { setMessage('Clipboard denied. Use Save JSON instead.') }
  }
  const startCorrected = () => {
    try {
      localStorage.setItem(`${storageKey}.previous`, rejected)
      localStorage.setItem(storageKey, projectJson(defaultToolProject))
    } catch { setLoadError('Could not preserve the previous project in browser storage. Download the original JSON first.'); return }
    const url = new URL(location.href)
    url.searchParams.delete('toolProject')
    history.replaceState(null, '', url)
    setRejected('')
    setLoadError('')
  }
  const open = async (selectedFile?: File) => {
    if (!selectedFile) return
    try { if (apply(parseToolProject(await selectedFile.text()))) setMessage('Tools project opened.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Project could not be opened') }
    finally { if (file.current) file.current.value = '' }
  }
  return <main className="app-shell tools-workspace" data-theme={dark ? 'dark' : 'light'}>
    <aside className="tools-sidebar">
      <nav className="workspace-navigation" aria-label="Product workspaces"><button type="button" onClick={onBack}>Table generator</button><button type="button" aria-current="page">Tools</button></nav>
      <h1>Tools</h1>
      {loadError && <div className="tools-warning" role="alert"><p>{loadError}</p>{rejected && <div className="tools-actions"><button type="button" onClick={() => saveJson(rejected, 'welding-extension-original.json')}>Download original JSON</button><button type="button" onClick={startCorrected}>Start corrected design</button></div>}</div>}
      <fieldset disabled={Boolean(rejected)}>
      <label className="field"><span>Choose a tool</span><select aria-label="Select tool" value="extension" onChange={() => undefined}><option value="extension">Welding-table extension</option></select></label>
      <p className="tools-warning">Independently designed analogue, not a CAS Welding drawing. Confirm mounting to your actual table before cutting.</p>
      <h2>Extension · mm</h2>
      <div className="fields"><NumberField label="Length" value={project.size.length} min={400} max={800} set={value => size('length', value)} /><NumberField label="Width" value={project.size.width} min={200} max={400} set={value => size('width', value)} /><NumberField label="Height" value={project.size.height} min={150} max={300} set={value => size('height', value)} /><NumberField label="Thickness" value={project.size.thickness} min={4} max={10} set={value => size('thickness', value)} /></div>
      <NumberField label="Copies for cutting" value={project.copies} min={1} max={10} set={value => apply({ ...project, copies: value })} />
      <h2>Sheet · mm</h2>
      <div className="fields"><NumberField label="Sheet length" value={project.sheet.length} min={100} max={6000} set={value => stock('length', value)} /><NumberField label="Sheet width" value={project.sheet.width} min={100} max={6000} set={value => stock('width', value)} /><NumberField label="Edge gap" value={project.sheet.edgeGap} min={0} max={100} set={value => stock('edgeGap', value)} /><NumberField label="Part gap" value={project.sheet.partGap} min={0} max={100} set={value => stock('partGap', value)} /></div>
      <p>Ø16 / 50 mm grid. High end mounts to the table; the top stays horizontal. Tapered sides, large access windows and two narrow cross ties; underside open.</p>
      <details className="tools-assumptions"><summary>Proposed dimensions · check before cutting</summary><p>Free-end height: {dimensions.tipHeight} mm. Cross ties: {dimensions.ribDepth} mm deep. Locating tabs: {dimensions.tabWidth} mm; matching cuts add {dimensions.clearance} mm total clearance. The window contours, mounting-slot positions and radial slot are our design assumptions, not measured CAS geometry. Check against your table and locking hardware.</p></details>
      <div className="tools-actions"><button type="button" onClick={() => saveJson(JSON.stringify(project, null, 2), 'welding-extension-project.json')}>Save JSON</button><button type="button" onClick={() => file.current?.click()}>Open JSON</button><button type="button" onClick={() => void share()}>Share link</button><button type="button" disabled={!valid} onClick={() => { if (currentResult) void downloadExtensionArchive(project, currentResult, key).catch(error => setMessage(error instanceof Error ? error.message : 'Export failed')) }}>Export sheet DXFs (ZIP)</button><input ref={file} type="file" accept="application/json,.json" hidden onChange={event => void open(event.target.files?.[0])} /></div>
      </fieldset>
    </aside>
    <section className="tools-workarea">
      <header><h2>Wedge extension · {project.size.length} × {project.size.width} × {project.size.height} mm / T{project.size.thickness}</h2><p role="status" aria-live="polite">{message}</p></header>
      <p className="tools-risk">Before fabrication: check clamp alignment and actual table-hole spacing, steel grade, welding sequence/distortion, loads and CAM kerf, lead-ins, clamps and cut order.</p>
      <div className="tools-grid">
        <section><h3>Cut parts · 2D</h3><div className="tools-parts">{parts.map(part => <figure key={part.name}><svg viewBox={`-10 -10 ${part.width + 20} ${part.height + 20}`} aria-label={`${part.name} 2D cut profile`}><g transform={`translate(0 ${part.height}) scale(1 -1)`}><path d={profile(part)} fillRule="evenodd" /></g></svg><figcaption>{part.label} × {part.count * project.copies}</figcaption></figure>)}</div></section>
        <section><h3>Assembled · 3D</h3><ExtensionAssembly3d project={project} dark={dark} /><p className="tools-view-note">High slotted end → host table. Working surface horizontal. Drag to orbit; scroll to zoom.</p></section>
      </div>
      <section className="tools-sheet"><h3>Automatic sheet layout</h3>{sheets?.length ? <><label className="field"><span>Sheet</span><select aria-label="Select nested sheet" value={sheet} onChange={event => setSheet(Number(event.target.value))}>{sheets.map(item => <option key={item.index} value={item.index}>Sheet {item.index + 1}</option>)}</select></label>{selected && <svg viewBox={`0 0 ${project.sheet.length} ${project.sheet.width}`} aria-label="Nested sheet layout"><rect width={project.sheet.length} height={project.sheet.width} />{selected.placements.map(placement => <g key={`${placement.part.name}-${placement.instance}`} transform={`translate(${placement.translation.x} ${project.sheet.width - placement.translation.y}) scale(1 -1) rotate(${placement.rotation})`}><path d={profile(placement.part)} fillRule="evenodd" /></g>)}</svg>}</> : <p>{message || 'Calculating sheet layout…'}</p>}</section>
    </section>
  </main>
}

export default ToolsWorkspace
