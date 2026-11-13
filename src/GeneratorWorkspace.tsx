import { useEffect, useRef, useState, type ReactNode, type InputHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icon'
import { NumberInput } from './NumberInput'
import { display, mmPerInch, readDisplay, type Config } from './model'

export type ViewMode = '2d' | '3d' | 'sheet'
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
  return <section className="visualization"><h3><Icon name="eye" size={14} />3D Visualization</h3><SliderField label="Exploded View" value={value.exploded} output={`${value.exploded}%`} min={0} max={100} step={1} icon="explode" onValue={exploded => onChange({ exploded })} /><Checkbox label="Show Dimensions" checked={value.showDimensions} onChange={showDimensions => onChange({ showDimensions })} /></section>
}
export function AssemblyControls({ value, onChange, onReset, onFocus }: { value: VisualSettings; onChange: (value: Partial<VisualSettings>) => void; onReset: () => void; onFocus?: () => void }) {
  return <div className="three-tools"><header><h3><Icon name="layers" size={16} />Interactive 3D Assembly</h3><div>{onFocus && <button title="Focus the camera on the front-right corner mount" onClick={onFocus}><Icon name="target" size={12} />Mount detail</button>}<button title="Reset camera to the default view" onClick={onReset}><Icon name="maximize" size={12} />Reset view</button></div></header><Checkbox label="Render Holes (affects FPS)" checked={value.renderHoles} onChange={renderHoles => onChange({ renderHoles })} /><Checkbox label="Interactive Part Highlighting" checked={value.highlighting} onChange={highlighting => onChange({ highlighting })} /></div>
}

type Estimate = { kg: number; cut: number; holes: number; engraving?: number; fit: boolean }
export function ProductionEstimate({ summary, units, sheet, onSheetChange, error }: { summary: Estimate; units: Config['units']; sheet: { length: number; width: number }; onSheetChange: (patch: Partial<{ length: number; width: number }>) => void; error?: string | null }) {
  const unitLabel = units === 'mm' ? 'mm' : 'in', factor = units === 'mm' ? 1 : mmPerInch
  const amount = (value: number, conversion: number) => (units === 'mm' ? value : Number(value.toFixed(1)) * conversion).toFixed(1)
  return <section className="production-card"><h3><Icon name="scale" size={16} />Production Estimate</h3>{error ? <p className="socket-error">Estimates unavailable until the fabrication geometry is valid.</p> : <><div className="estimate"><div><span>Estimated Weight</span><strong>{amount(summary.kg, 2.20462)}<small>{units === 'mm' ? 'kg' : 'lb'}</small></strong></div><div><span>Cut Length</span><strong>{amount(summary.cut, 3.28084)}<small>{units === 'mm' ? 'm' : 'ft'}</small></strong></div></div><div className="estimate-extra"><span>Holes: <b>{summary.holes}</b></span>{Boolean(summary.engraving) && <span>Engraving: <b>{amount(summary.engraving!, 3.28084)}{units === 'mm' ? 'm' : 'ft'}</b></span>}</div><div className="sheet-size"><div><span>Sheet size ({unitLabel})</span><div className="sheet-inputs"><NumberInput aria-label="Sheet length" value={String(Number(display(sheet.length, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ length: readDisplay(value, units) })} /><span>×</span><NumberInput aria-label="Sheet width" value={String(Number(display(sheet.width, units, 3)))} min={0} step={50 / factor} onValue={value => onSheetChange({ width: readDisplay(value, units) })} /></div></div><p className={summary.fit ? 'fit' : 'no-fit'}>{summary.fit ? 'Each part fits individually; combined sheet layout is not checked.' : 'Some parts do not fit the sheet individually.'}</p></div></>}</section>
}

export function ProjectActions({ onOpen, onSave, onShare, onZip, onDxf, disabled = false }: { onOpen: (file: File) => void; onSave: () => void; onShare: () => void; onZip: () => void; onDxf: () => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return <section className="exports"><input ref={input} hidden type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onOpen(file) }} /><div><button className="secondary" title="Open Project (.json)" onClick={() => input.current?.click()}><Icon name="folder" size={14} />Open</button><button className="secondary" title="Save Project (.json)" disabled={disabled} onClick={onSave}><Icon name="save" size={14} />Save</button></div><button className="secondary full share" disabled={disabled} onClick={onShare}><Icon name="share" size={14} />Share Link</button><button className="zip" disabled={disabled} onClick={onZip}><Icon name="archive" size={18} />Download ZIP (Parts)</button><button className="dxf" disabled={disabled} onClick={onDxf}><Icon name="download" size={16} />Parts Strip DXF (not nested)</button></section>
}

const socialLinks: Array<{ name: string; icon: IconName; url: string }> = [
  { name: 'Ballwool Store', icon: 'cart', url: 'https://ballwool.com/shops/DIYWeldingProjects' },
  { name: 'Instagram', icon: 'instagram', url: 'https://www.instagram.com/ta6urkin/' },
  { name: 'TikTok', icon: 'tiktok', url: 'https://www.tiktok.com/@ta6urkin' },
  { name: 'YouTube', icon: 'youtube', url: 'https://www.youtube.com/@ta6urkin' },
  { name: 'Pinterest', icon: 'pinterest', url: 'https://www.pinterest.com/ta6urkin/' },
  { name: 'Reddit', icon: 'reddit', url: 'https://www.reddit.com/user/taburkin/' },
]
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
  return <><nav className="social" aria-label="Original project links"><strong>DIY WELDING PROJECTS</strong><div>{socialLinks.map(link => <a key={link.name} title={link.name} aria-label={link.name} href={link.url} target="_blank" rel="noopener noreferrer"><Icon name={link.icon} size={18} /></a>)}</div></nav><div className="legal-disclosure">{about && <article id="about-panel" className="legal-panel" aria-labelledby="about-title"><header><h3 id="about-title">About & Legal Info</h3><button ref={closeButton} className="icon" aria-label="Close About and Legal Info" onClick={() => setAbout(false)}><Icon name="close" /></button></header><small>VERSION 1.0.0</small><p>This independent clean-room implementation preserves the public generator's workflow. It is not affiliated with or endorsed by the original author.</p><p>Models, layouts and DXF files are informational only. Confirm dimensions, kerf tolerances and structural integrity with a qualified professional before CNC or laser cutting.</p><a href="https://welding-table-generator.com/" target="_blank" rel="noopener noreferrer">Original project ↗</a></article>}<button className="legal-link" aria-expanded={about} aria-controls="about-panel" onClick={() => setAbout(value => !value)}>About & Legal Info<Icon name="chevron" size={14} style={{ transform: about ? 'rotate(180deg)' : undefined }} /></button></div></>
}

type ShellProps = {
  workspace: 'table' | 'tools'; onWorkspace: (workspace: 'table' | 'tools') => void
  dark: boolean; onTheme: () => void; units: Config['units']; onUnits: (units: Config['units']) => void
  settings: ReactNode; production: ReactNode; actions: ReactNode; view: ViewMode; onView: (view: ViewMode) => void
  children: ReactNode; notice: string; onDismissNotice: () => void; seo?: ReactNode
}
export function GeneratorShell({ workspace, onWorkspace, dark, onTheme, units, onUnits, settings, production, actions, view, onView, children, notice, onDismissNotice, seo }: ShellProps) {
  const dismiss = useRef(onDismissNotice)
  dismiss.current = onDismissNotice
  useEffect(() => { if (notice) { const timer = window.setTimeout(() => dismiss.current(), 4000); return () => clearTimeout(timer) } }, [notice])
  return <main className="app-shell"><aside className="settings"><header><div className="brand"><Icon name="settings" size={24} /><h2>Welding Table Free Generator</h2></div><button className="icon" title={`Switch to ${dark ? 'light' : 'dark'} theme`} aria-label="Toggle color theme" onClick={onTheme}><Icon name={dark ? 'sun' : 'moon'} /></button></header><nav className="workspace-navigation" aria-label="Product workspaces"><button aria-current={workspace === 'table' ? 'page' : undefined} onClick={() => onWorkspace('table')}>Table generator</button><button aria-current={workspace === 'tools' ? 'page' : undefined} onClick={() => onWorkspace('tools')}>Tools</button></nav><div className="units"><h3>Units</h3><div className="segment">{(['mm', 'inch'] as const).map(unit => <button key={unit} className={units === unit ? 'active' : ''} onClick={() => onUnits(unit)}>{unit}</button>)}</div></div><div className="settings-scroll">{settings}</div>{production}{actions}</aside><section className="work-area" data-view={view}><div className="mode">{([{ id: '2d', label: '2D Layout', icon: 'frame' }, { id: '3d', label: '3D Assembly', icon: 'box' }, { id: 'sheet', label: 'Sheet nesting', icon: 'layers' }] as const).map(mode => <button key={mode.id} className={view === mode.id ? 'active' : ''} onClick={() => onView(mode.id)}><Icon name={mode.icon} />{mode.label}</button>)}</div>{children}<GeneratorFooter />{notice && <output className="notice" aria-live="polite" onClick={onDismissNotice}>{notice}</output>}</section>{seo}</main>
}
