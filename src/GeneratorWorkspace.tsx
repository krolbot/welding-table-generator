import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'
import { NumberInput } from './NumberInput'
import { display, mmPerInch, readDisplay, type Config } from './model'
import { workspaceUrl, type ViewMode } from './viewNavigation'

export type { ViewMode } from './viewNavigation'
export type VisualSettings = Pick<Config, 'exploded' | 'showDimensions' | 'renderHoles' | 'highlighting'>

export function ParameterGroup({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="parameter-group" open={defaultOpen}>
    <summary><span>{title}</span><Icon name="chevron" size={14} /></summary>
    <div className="parameter-content">{children}</div>
  </details>
}

export function NumberField({ label, onValue, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { label: string; value: string | number; onValue: (value: number) => void | boolean }) {
  return <label className="field"><span>{label}</span><NumberInput {...props} onValue={onValue} /></label>
}

export function SliderField({ label, value, output, min, max, step, onValue, icon }: { label: string; value: number; output: ReactNode; min: number; max: number; step: number; onValue: (value: number) => void; icon?: IconName }) {
  return <label className="slider-field"><span><span className="slider-label">{icon && <Icon name={icon} size={14} />}{label}</span><output>{output}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onValue(Number(event.target.value))} /></label>
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="checkbox"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{label}</span></label>
}

export function VisualizationSettings({ value, onChange }: { value: VisualSettings; onChange: (value: Partial<VisualSettings>) => void }) {
  return <div className="visualization">
    <SliderField label="Exploded View" value={value.exploded} output={`${value.exploded}%`} min={0} max={100} step={1} onValue={exploded => onChange({ exploded })} />
    <Checkbox label="Show Dimensions" checked={value.showDimensions} onChange={showDimensions => onChange({ showDimensions })} />
    <Checkbox label="Render holes" checked={value.renderHoles} onChange={renderHoles => onChange({ renderHoles })} />
    <Checkbox label="Highlight parts" checked={value.highlighting} onChange={highlighting => onChange({ highlighting })} />
  </div>
}

type Estimate = { kg: number; cut: number; holes: number; engraving?: number; fit: boolean }
export function ProductionEstimate({ summary, units, sheet, onSheetChange, error }: { summary: Estimate; units: Config['units']; sheet: { length: number; width: number }; onSheetChange: (patch: Partial<{ length: number; width: number }>) => void; error?: string | null }) {
  const unitLabel = units === 'mm' ? 'mm' : 'in', factor = units === 'mm' ? 1 : mmPerInch
  const amount = (value: number, conversion: number) => (units === 'mm' ? value : Number(value.toFixed(1)) * conversion).toFixed(1)
  return <section className="production-card">
    <h3>Production estimate</h3>
    {error ? <p className="socket-error">Estimates unavailable until the fabrication geometry is valid.</p> : <>
      <div className="estimate">
        <div><span>Weight</span><strong>{amount(summary.kg, 2.20462)}<small>{units === 'mm' ? 'kg' : 'lb'}</small></strong></div>
        <div><span>Cut length</span><strong>{amount(summary.cut, 3.28084)}<small>{units === 'mm' ? 'm' : 'ft'}</small></strong></div>
      </div>
      <div className="estimate-extra"><span>Holes <b>{summary.holes}</b></span>{Boolean(summary.engraving) && <span>Engraving <b>{amount(summary.engraving!, 3.28084)} {units === 'mm' ? 'm' : 'ft'}</b></span>}</div>
      <div className="sheet-size">
        <span>Stock sheet · {unitLabel}</span>
        <div className="sheet-inputs"><NumberInput aria-label="Sheet length" value={String(Number(display(sheet.length, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ length: readDisplay(value, units) })} /><span>×</span><NumberInput aria-label="Sheet width" value={String(Number(display(sheet.width, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ width: readDisplay(value, units) })} /></div>
        <p className={summary.fit ? 'fit' : 'no-fit'}>{summary.fit ? 'Individual parts fit. Check the complete layout in Sheets.' : 'Some parts do not fit this sheet.'}</p>
      </div>
    </>}
  </section>
}

type FabricationActions = { kind: 'parts'; onZip: () => void; onDxf: () => void } | { kind: 'shared-sheets'; onOpenSheets: () => void }
export function ProjectActions({ onOpen, onSave, onShare, fabrication, disabled = false }: { onOpen: (file: File) => void; onSave: () => void; onShare: () => void; fabrication: FabricationActions; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return <section className="exports">
    <input ref={input} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onOpen(file) }} />
    <div className="project-file-actions">
      <button className="secondary" title="Open Project (.json)" onClick={() => input.current?.click()}><Icon name="folder" />Open</button>
      <button className="secondary" title="Save Project (.json)" disabled={disabled} onClick={onSave}><Icon name="save" />Save</button>
      <button className="secondary" title="Share project link" disabled={disabled} onClick={onShare}><Icon name="share" />Share</button>
    </div>
    {fabrication.kind === 'parts' ? <>
      <button className="zip" disabled={disabled} onClick={fabrication.onZip}><Icon name="archive" size={20} /><span>Download parts<small>Individual DXF files · ZIP archive</small></span><Icon name="download" /></button>
      <button className="dxf secondary" disabled={disabled} onClick={fabrication.onDxf}><Icon name="download" />Parts strip DXF <span className="action-note">Not nested</span></button>
    </> : <>
      <button className="zip" disabled={disabled} onClick={fabrication.onOpenSheets}><Icon name="layers" size={20} /><span>Open shared sheet cut<small>Table and selected tools</small></span></button>
      <p>Export is available in Sheets after the complete layout is verified.</p>
    </>}
    {disabled && <p className="socket-error" role="status">Resolve the project review or geometry error before saving or exporting.</p>}
  </section>
}

function ProjectInfo({ children }: { children?: ReactNode }) {
  return <details className="legal-disclosure">
    <summary>About & Legal Info<Icon name="chevron" size={14} /></summary>
    <div className="legal-content">
      <p>This independent clean-room implementation preserves the public generator's workflow. It is not affiliated with or endorsed by the original author.</p>
      <p>Models, layouts and DXF files are informational only. Confirm dimensions, kerf tolerances and structural integrity with a qualified professional before CNC or laser cutting.</p>
      <a href="https://welding-table-generator.com/" target="_blank" rel="noopener noreferrer">Original project ↗</a>
      {children}
    </div>
  </details>
}

export function WorkspaceDialog({ id, title, open, onClose, className, children }: { id: string; title: string; open: boolean; onClose: () => void; className: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal()
    if (!open && dialog.current?.open) dialog.current.close()
  }, [open])
  return <dialog id={id} className={className} ref={dialog} aria-labelledby={`${id}-title`} onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return
    const r = event.currentTarget.getBoundingClientRect()
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose()
  }}>
    <header className="dialog-heading"><h2 id={`${id}-title`}>{title}</h2><button className="icon" aria-label={`Close ${title}`} onClick={onClose}><Icon name="close" /></button></header>
    <div className="dialog-body">{children}</div>
  </dialog>
}

type PreferencesProps = { dark: boolean; onTheme: () => void; units: Config['units']; onUnits: (units: Config['units']) => void }
function Preferences({ dark, onTheme, units, onUnits }: PreferencesProps) {
  return <>
    <div className="segment" aria-label="Display units">{(['mm', 'inch'] as const).map(unit => <button key={unit} aria-pressed={units === unit} onClick={() => onUnits(unit)}>{unit === 'inch' ? 'in' : 'mm'}</button>)}</div>
    <button className="icon" title={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-label="Toggle color theme" onClick={onTheme}><Icon name={dark ? 'sun' : 'moon'} /></button>
  </>
}

type ShellProps = PreferencesProps & {
  workspace: 'table' | 'tools'; onWorkspace: (workspace: 'table' | 'tools') => void
  settings: ReactNode; production: ReactNode; actions: (onClose: () => void) => ReactNode; visualization: ReactNode
  view: ViewMode; onView: (view: ViewMode) => void
  children: ReactNode; notice: string; onDismissNotice: () => void; seo?: ReactNode
}
export function useWideWorkspace() {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const media = matchMedia('(min-width: 1024px)')
    const changed = () => setWide(media.matches)
    media.addEventListener('change', changed)
    changed()
    return () => media.removeEventListener('change', changed)
  }, [])
  return wide
}

export function GeneratorShell({ workspace, onWorkspace, dark, onTheme, units, onUnits, settings, production, actions, visualization, view, onView, children, notice, onDismissNotice, seo }: ShellProps) {
  const wide = useWideWorkspace()
  const [parametersVisible, setParametersVisible] = useState(true)
  const [parametersDialog, setParametersDialog] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const docked = wide && view !== 'sheet'
  const dismiss = useRef(onDismissNotice)
  dismiss.current = onDismissNotice
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => dismiss.current(), 6000); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => { setProjectOpen(false); setParametersDialog(false) }, [view, wide])
  const preferences = { dark, onTheme, units, onUnits }
  const parameters = <div className="settings-scroll">{settings}</div>
  return <main className="app-shell" data-panel={docked && parametersVisible ? 'open' : 'closed'}>
    <a className="skip-link" href="#workspace-view">Skip to drawing</a>
    <header className="app-header">
      <div className="brand"><svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" rx="3" />{[7, 14, 21].flatMap(x => [7, 14, 21].map(y => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.5" />))}</svg><h1>Welding Table<span>Generator</span></h1></div>
      <nav className="workspace-navigation" aria-label="Product workspaces">{(['table', 'tools'] as const).map(value => <a key={value} href={workspaceUrl(new URL(location.href), { workspace: value, view }).toString()} aria-current={workspace === value ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onWorkspace(value) }}>{value === 'table' ? 'Table' : 'Tools'}</a>)}</nav>
      <div className="mode-navigation">
        <nav className="view-navigation" aria-label="Drawing views">{([{ id: '2d', label: 'Parts', icon: 'frame' }, { id: '3d', label: 'Assembly', icon: 'box' }, { id: 'sheet', label: 'Sheets', icon: 'layers' }] as const).map(mode => <a key={mode.id} href={workspaceUrl(new URL(location.href), { workspace, view: mode.id }).toString()} aria-label={mode.id === 'sheet' ? 'Sheets' : `${mode.id.toUpperCase()} ${mode.label}`} aria-current={view === mode.id ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onView(mode.id) }}><Icon name={mode.icon} /><span>{mode.label}</span></a>)}</nav>
        <button className="settings-toggle" title="Parameters" aria-controls={docked ? 'settings-panel' : 'parameters-dialog'} aria-expanded={docked ? parametersVisible : parametersDialog} onClick={() => docked ? setParametersVisible(value => !value) : setParametersDialog(true)}><Icon name="settings" /><span>Parameters</span></button>
      </div>
      <div className="header-preferences"><Preferences {...preferences} /></div>
      <button className="project-toggle" aria-haspopup="dialog" aria-controls="project-dialog" onClick={() => setProjectOpen(true)}><Icon name="download" /><span>Project</span></button>
    </header>
    {docked ? <aside id="settings-panel" className="settings" hidden={!parametersVisible} aria-labelledby="settings-heading">
      <header className="panel-heading"><h2 id="settings-heading">Parameters</h2><button className="icon" aria-label="Close parameters" onClick={() => setParametersVisible(false)}><Icon name="close" /></button></header>
      {parameters}
    </aside> : <WorkspaceDialog id="parameters-dialog" title="Parameters" className="settings-drawer" open={parametersDialog} onClose={() => setParametersDialog(false)}>
      <div className="mobile-preferences"><span>Display</span><Preferences {...preferences} /></div>{parameters}
    </WorkspaceDialog>}
    <section className="work-area" data-view={view} id="workspace-view" tabIndex={-1}>
      {view !== '2d' && <details className="display-options"><summary title="3D display options"><Icon name="eye" /><span>Display</span></summary><div>{visualization}</div></details>}
      <div className="workspace-content">{children}</div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={onDismissNotice}><Icon name="close" /></button></div>}
    </section>
    <WorkspaceDialog id="project-dialog" title="Project & export" className="project-dialog" open={projectOpen} onClose={() => setProjectOpen(false)}>
      {actions(() => setProjectOpen(false))}{production}<ProjectInfo>{seo}</ProjectInfo>
    </WorkspaceDialog>
  </main>
}
