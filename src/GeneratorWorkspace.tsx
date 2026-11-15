import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'
import { NumberInput } from './NumberInput'
import { display, mmPerInch, readDisplay, type Config } from './model'

import { workspaceUrl, type ViewMode } from './viewNavigation'
export type { ViewMode } from './viewNavigation'
export type VisualSettings = Pick<Config, 'exploded' | 'showDimensions' | 'renderHoles' | 'highlighting'>

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
  return <section className="visualization"><h3><Icon name="eye" size={14} />3D Visualization</h3><SliderField label="Exploded View" value={value.exploded} output={`${value.exploded}%`} min={0} max={100} step={1} icon="explode" onValue={exploded => onChange({ exploded })} /><Checkbox label="Show Dimensions" checked={value.showDimensions} onChange={showDimensions => onChange({ showDimensions })} /><Checkbox label="Render holes" checked={value.renderHoles} onChange={renderHoles => onChange({ renderHoles })} /><Checkbox label="Highlight parts" checked={value.highlighting} onChange={highlighting => onChange({ highlighting })} /></section>
}
type Estimate = { kg: number; cut: number; holes: number; engraving?: number; fit: boolean }
export function ProductionEstimate({ summary, units, sheet, onSheetChange, error }: { summary: Estimate; units: Config['units']; sheet: { length: number; width: number }; onSheetChange: (patch: Partial<{ length: number; width: number }>) => void; error?: string | null }) {
  const unitLabel = units === 'mm' ? 'mm' : 'in', factor = units === 'mm' ? 1 : mmPerInch
  const amount = (value: number, conversion: number) => (units === 'mm' ? value : Number(value.toFixed(1)) * conversion).toFixed(1)
  return <section className="production-card"><h3><Icon name="scale" size={16} />Production Estimate</h3>{error ? <p className="socket-error">Estimates unavailable until the fabrication geometry is valid.</p> : <><div className="estimate"><div><span>Estimated Weight</span><strong>{amount(summary.kg, 2.20462)}<small>{units === 'mm' ? 'kg' : 'lb'}</small></strong></div><div><span>Cut Length</span><strong>{amount(summary.cut, 3.28084)}<small>{units === 'mm' ? 'm' : 'ft'}</small></strong></div></div><div className="estimate-extra"><span>Holes: <b>{summary.holes}</b></span>{Boolean(summary.engraving) && <span>Engraving: <b>{amount(summary.engraving!, 3.28084)}{units === 'mm' ? 'm' : 'ft'}</b></span>}</div><div className="sheet-size"><div><span>Sheet size ({unitLabel})</span><div className="sheet-inputs"><NumberInput aria-label="Sheet length" value={String(Number(display(sheet.length, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ length: readDisplay(value, units) })} /><span>×</span><NumberInput aria-label="Sheet width" value={String(Number(display(sheet.width, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ width: readDisplay(value, units) })} /></div></div><p className={summary.fit ? 'fit' : 'no-fit'}>{summary.fit ? 'Each part fits individually; combined sheet layout is not checked.' : 'Some parts do not fit the sheet individually.'}</p></div></>}</section>
}

type FabricationActions = { kind: 'parts'; onZip: () => void; onDxf: () => void } | { kind: 'shared-sheets'; onOpenSheets: () => void }
export function ProjectActions({ onOpen, onSave, onShare, fabrication, disabled = false }: { onOpen: (file: File) => void; onSave: () => void; onShare: () => void; fabrication: FabricationActions; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return <section className="exports"><input ref={input} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onOpen(file) }} /><div><button className="secondary" title="Open Project (.json)" onClick={() => input.current?.click()}><Icon name="folder" size={14} />Open</button><button className="secondary" title="Save Project (.json)" disabled={disabled} onClick={onSave}><Icon name="save" size={14} />Save</button></div><button className="secondary full share" disabled={disabled} onClick={onShare}><Icon name="share" size={14} />Share Link</button>{fabrication.kind === 'parts' ? <><button className="zip" disabled={disabled} onClick={fabrication.onZip}><Icon name="archive" size={18} />Download ZIP (Parts)</button><button className="dxf" disabled={disabled} onClick={fabrication.onDxf}><Icon name="download" size={16} />Parts Strip DXF (not nested)</button></> : <><button className="zip" disabled={disabled} onClick={fabrication.onOpenSheets}><Icon name="layers" size={18} />Open shared sheet cut</button><p>Table and selected tools export together only after the complete sheet layout is verified.</p></>}</section>
}

function GeneratorFooter() {
  const [about, setAbout] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null), previousFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!about) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButton.current?.focus()
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setAbout(false) }
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('keydown', close); previousFocus.current?.focus() }
  }, [about])
  return <><div className="legal-disclosure">{about && <article id="about-panel" className="legal-panel" aria-labelledby="about-title"><header><h3 id="about-title">About & Legal Info</h3><button ref={closeButton} className="icon" aria-label="Close About and Legal Info" onClick={() => setAbout(false)}><Icon name="close" /></button></header><small>VERSION 1.0.0</small><p>This independent clean-room implementation preserves the public generator's workflow. It is not affiliated with or endorsed by the original author.</p><p>Models, layouts and DXF files are informational only. Confirm dimensions, kerf tolerances and structural integrity with a qualified professional before CNC or laser cutting.</p><a href="https://welding-table-generator.com/" target="_blank" rel="noopener noreferrer">Original project ↗</a></article>}<button className="legal-link" aria-expanded={about} aria-controls="about-panel" onClick={() => setAbout(value => !value)}>About & Legal Info<Icon name="chevron" size={14} style={{ transform: about ? 'rotate(180deg)' : undefined }} /></button></div></>
}

type ShellProps = {
  workspace: 'table' | 'tools'; onWorkspace: (workspace: 'table' | 'tools') => void
  dark: boolean; onTheme: () => void; units: Config['units']; onUnits: (units: Config['units']) => void
  settings: ReactNode; production: ReactNode; actions: ReactNode; view: ViewMode; onView: (view: ViewMode) => void
  children: ReactNode; notice: string; onDismissNotice: () => void; seo?: ReactNode
}
export function GeneratorShell({ workspace, onWorkspace, dark, onTheme, units, onUnits, settings, production, actions, view, onView, children, notice, onDismissNotice, seo }: ShellProps) {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches)
  const wideRef = useRef(wide)
  wideRef.current = wide
  const [panelOpen, setPanelOpen] = useState(wide)
  const [panelTab, setPanelTab] = useState<'design' | 'export'>('design')
  const dialog = useRef<HTMLDialogElement>(null)
  const dismiss = useRef(onDismissNotice)
  dismiss.current = onDismissNotice
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => dismiss.current(), 6000); return () => clearTimeout(timer) } }, [notice])
  useEffect(() => {
    const media = matchMedia('(min-width: 900px)')
    const changed = () => { setWide(media.matches); setPanelOpen(media.matches) }
    media.addEventListener('change', changed)
    changed()
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (wide || !dialog.current) return
    if (panelOpen && !dialog.current.open) dialog.current.showModal()
    if (!panelOpen && dialog.current.open) dialog.current.close()
  }, [panelOpen, wide])
  const panel = <>
    <header className="panel-heading"><h2 id="settings-heading">{workspace === 'tools' ? 'Tool settings' : 'Table settings'}</h2><button className="icon" aria-label="Close settings" onClick={() => setPanelOpen(false)}><Icon name="close" /></button></header>
    <div className="panel-tabs" aria-label="Settings sections"><button aria-pressed={panelTab === 'design'} onClick={() => setPanelTab('design')}>Design</button><button aria-pressed={panelTab === 'export'} onClick={() => setPanelTab('export')}>Project & export</button></div>
    <div className="settings-body" hidden={panelTab !== 'design'}><div className="settings-scroll">{settings}</div></div>
    <div className="settings-body" hidden={panelTab !== 'export'}>{actions}{production}</div>
  </>
  return <main className="app-shell" data-panel={wide && panelOpen ? 'open' : 'closed'}>
    <a className="skip-link" href="#workspace-view">Skip to drawing</a>
    <header className="app-header">
      <div className="brand"><Icon name="frame" size={22} /><h1>Welding Table <span>Generator</span></h1></div>
      <nav className="workspace-navigation" aria-label="Product workspaces">{(['table', 'tools'] as const).map(value => <a key={value} href={workspaceUrl(new URL(location.href), { workspace: value, view }).toString()} aria-current={workspace === value ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onWorkspace(value) }}>{value === 'table' ? 'Table generator' : 'Tools'}</a>)}</nav>
      <div className="header-preferences"><div className="segment" aria-label="Display units">{(['mm', 'inch'] as const).map(unit => <button key={unit} aria-pressed={units === unit} onClick={() => onUnits(unit)}>{unit === 'inch' ? 'in' : 'mm'}</button>)}</div><button className="icon" title={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-label="Toggle color theme" onClick={onTheme}><Icon name={dark ? 'sun' : 'moon'} /></button></div>
    </header>
    {wide ? <aside className="settings" hidden={!panelOpen}>{panel}</aside> : <dialog className="settings settings-drawer" ref={dialog} aria-labelledby="settings-heading" onCancel={() => setPanelOpen(false)} onClose={() => { if (!wideRef.current) setPanelOpen(false) }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) setPanelOpen(false) } }}>{panel}</dialog>}
    <section className="work-area" data-view={view} id="workspace-view" tabIndex={-1}>
      <div className="workspace-bar"><button className="settings-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen(value => !value)}><Icon name="settings" />Settings</button><nav className="view-navigation" aria-label="Drawing views">{([{ id: '2d', label: '2D Parts', icon: 'frame' }, { id: '3d', label: '3D Assembly', icon: 'box' }, { id: 'sheet', label: 'Sheets', icon: 'layers' }] as const).map(mode => <a key={mode.id} href={workspaceUrl(new URL(location.href), { workspace, view: mode.id }).toString()} aria-current={view === mode.id ? 'page' : undefined} onClick={event => { if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onView(mode.id) }}><Icon name={mode.icon} /><span>{mode.label}</span></a>)}</nav></div>
      <div className="workspace-content">{children}</div>
      <footer className="workspace-footer"><span>{workspace === 'tools' ? 'Tools' : 'Table'} / {view === '2d' ? 'Parts drawing' : view === '3d' ? 'Assembly' : 'Sheet nesting'}</span><GeneratorFooter /></footer>
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={onDismissNotice}><Icon name="close" /></button></div>}
    </section>{seo}
  </main>
}
