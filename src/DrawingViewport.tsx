import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Icon } from './Icon'
import { display, type Config } from './model'
import type { Point } from './geometry'
import { drawingPoint, fitDrawing, measurementValues, resizeDrawing, screenPoint, snapDrawingPoint, zoomDrawing, type DrawingBounds, type DrawingCamera, type DrawingFeatures, type Measurement, type SnapPoint } from './drawingInteraction'
import { PanControls, ZoomControls } from './ViewportControls'

type DrawingTool = 'pan' | 'measure' | 'holes'
type Draft = { kind: 'new'; start: SnapPoint; end: SnapPoint } | { kind: 'edit'; id: string; endpoint: 'start' | 'end'; start: SnapPoint; end: SnapPoint }
type Pointer = { start: Point; last: Point; intent: 'pan' | 'pick'; moved: boolean; target: EventTarget | null }
type Props = {
  bounds: DrawingBounds; features: DrawingFeatures; geometryKey: string; label: string; units: Config['units']
  children: ReactNode; resetToken?: number; onPickHole?: (target: EventTarget | null) => void
}
const snapLabels = { free: 'Free point', vertex: 'Endpoint', midpoint: 'Midpoint', centre: 'Centre', edge: 'On edge' }

export function DrawingViewport({ bounds, features, geometryKey, label, units, children, resetToken = 0, onPickHole }: Props) {
  const area = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState<DrawingBounds>({ width: 1, height: 1 })
  const [camera, setCamera] = useState<DrawingCamera>({ scale: 1, x: 0, y: 0 })
  const cameraRef = useRef(camera), sizeRef = useRef(size), boundsRef = useRef(bounds)
  cameraRef.current = camera; sizeRef.current = size; boundsRef.current = bounds
  const framing = useRef(bounds)
  const [focusedPart, setFocusedPart] = useState('all')
  const [tool, setTool] = useState<DrawingTool>('pan'), [snap, setSnap] = useState(true)
  const [measurements, setMeasurements] = useState<Measurement[]>([]), [draft, setDraft] = useState<Draft | null>(null)
  const [cursor, setCursor] = useState<SnapPoint | null>(null), [selected, setSelected] = useState<string | null>(null)
  const pointers = useRef(new Map<number, Pointer>()), space = useRef(false)
  const pinch = useRef<{ distance: number; center: Point; camera: DrawingCamera } | null>(null)
  const format = (value: number) => display(value, units, units === 'mm' ? 2 : 4)
  const unit = units === 'mm' ? 'mm' : 'in'
  const commitCamera = (value: DrawingCamera) => { cameraRef.current = value; setCamera(value) }
  const fit = () => { setFocusedPart('all'); framing.current = boundsRef.current; commitCamera(fitDrawing(framing.current, sizeRef.current)) }
  const pan = (x: number, y: number) => commitCamera({ ...cameraRef.current, x: cameraRef.current.x + x, y: cameraRef.current.y + y })
  const zoom = (factor: number, anchor = { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }) => {
    const base = fitDrawing(boundsRef.current, sizeRef.current).scale
    commitCamera(zoomDrawing(cameraRef.current, anchor, cameraRef.current.scale * factor, { min: base / 10, max: base * 100 }))
  }
  useEffect(() => {
    const host = area.current
    if (!host) return
    const resize = new ResizeObserver(() => {
      const next = { width: host.clientWidth, height: host.clientHeight }
      if (next.width < 1 || next.height < 1) return
      const previous = sizeRef.current
      sizeRef.current = next; setSize(next)
      commitCamera(previous.width === 1 ? fitDrawing(framing.current, next) : resizeDrawing(cameraRef.current, previous, next, framing.current))
    })
    resize.observe(host)
    return () => resize.disconnect()
  }, [])
  useEffect(() => {
    fit(); setMeasurements([]); setDraft(null); setCursor(null); setSelected(null)
    pointers.current.clear(); pinch.current = null
  }, [geometryKey, resetToken])
  useEffect(() => {
    const element = svg.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])
  const local = (event: PointerEvent<SVGSVGElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const pick = (point: Point, precision: 'snap' | 'free'): SnapPoint => {
    const world = drawingPoint(point, cameraRef.current)
    return snap && precision === 'snap' ? snapDrawingPoint(world, features, 10 / cameraRef.current.scale) : { ...world, kind: 'free', label: '' }
  }
  const updateEnd = (point: SnapPoint) => setDraft(current => !current ? current : current.kind === 'edit' ? { ...current, [current.endpoint]: point } : { ...current, end: point })
  const finishPoint = (point: SnapPoint) => {
    if (!draft) { setDraft({ kind: 'new', start: point, end: point }); return }
    const next = draft.kind === 'edit' ? { ...draft, [draft.endpoint]: point } : { ...draft, end: point }
    if (measurementValues(next).length < 1e-7) return
    if (next.kind === 'edit') {
      setMeasurements(current => current.map(item => item.id === next.id ? { id: item.id, start: next.start, end: next.end } : item))
      setSelected(next.id)
    } else {
      const item = { id: crypto.randomUUID(), start: next.start, end: next.end }
      setMeasurements(current => [...current, item]); setSelected(item.id)
    }
    setDraft(null)
  }
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (![0, 1, 2].includes(event.button)) return
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true })
    const point = local(event)
    pointers.current.set(event.pointerId, { start: point, last: point, intent: event.button !== 0 || space.current || tool === 'pan' ? 'pan' : 'pick', moved: false, target: event.target })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      for (const pointer of pointers.current.values()) pointer.moved = true
      pinch.current = { distance: Math.max(1, Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y)), center: { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 }, camera: cameraRef.current }
      setCursor(null)
    }
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const point = local(event), pointer = pointers.current.get(event.pointerId)
    const previous = pointer?.last
    if (pointer) { pointer.last = point; pointer.moved ||= Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > 5 }
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()], start = pinch.current
      const center = { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 }
      const base = fitDrawing(boundsRef.current, sizeRef.current).scale
      const next = zoomDrawing(start.camera, start.center, start.camera.scale * Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y) / start.distance, { min: base / 10, max: base * 100 })
      commitCamera({ ...next, x: next.x + center.x - start.center.x, y: next.y + center.y - start.center.y })
      return
    }
    if (pointer?.intent === 'pan' && previous) { pan(point.x - previous.x, point.y - previous.y); return }
    if (tool === 'measure') {
      const next = pick(point, event.altKey ? 'free' : 'snap')
      setCursor(next); updateEnd(next)
    }
  }
  const release = (event: PointerEvent<SVGSVGElement>) => {
    const pointer = pointers.current.get(event.pointerId)
    pointers.current.delete(event.pointerId); pinch.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!pointer || pointer.moved || pointer.intent !== 'pick' || event.type === 'pointercancel') return
    if (tool === 'measure') finishPoint(pick(local(event), event.altKey ? 'free' : 'snap'))
    if (tool === 'holes') onPickHole?.(pointer.target)
  }
  const chooseTool = (next: DrawingTool) => { setTool(next); setDraft(null); setCursor(null) }
  const remove = (id: string) => { setMeasurements(current => current.filter(item => item.id !== id)); if (draft?.kind === 'edit' && draft.id === id) setDraft(null); if (selected === id) setSelected(null) }
  const edit = (item: Measurement, endpoint: 'start' | 'end') => { setTool('measure'); setSelected(item.id); setDraft({ ...item, kind: 'edit', endpoint }) }
  const active = draft ?? measurements.find(item => item.id === selected) ?? measurements.at(-1)
  const values = active && measurementValues(active)

  return <div className="drawing-frame drawing-viewport" data-tool={tool} onKeyDown={event => {
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,button,summary')) return
    const key = event.key.toLowerCase()
    if (key === ' ') { event.preventDefault(); space.current = true }
    else if (key === 'f' || key === 'home') { event.preventDefault(); fit() }
    else if (key === '+' || key === '=') { event.preventDefault(); zoom(1.25) }
    else if (key === '-') { event.preventDefault(); zoom(1 / 1.25) }
    else if (key === 'm') chooseTool('measure')
    else if (key === 'h') chooseTool('pan')
    else if (key === 'escape') { event.preventDefault(); if (draft) setDraft(null); else chooseTool('pan') }
    else if ((key === 'delete' || key === 'backspace') && selected) { event.preventDefault(); remove(selected) }
    else if (key.startsWith('arrow')) { event.preventDefault(); pan(key === 'arrowleft' ? -48 : key === 'arrowright' ? 48 : 0, key === 'arrowup' ? -48 : key === 'arrowdown' ? 48 : 0) }
  }} onKeyUp={event => { if (event.key === ' ') space.current = false }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { space.current = false; pointers.current.clear(); pinch.current = null } }}>
    <div className="viewport-toolbar" aria-label="Drawing tools">
      <div className="viewport-group">
        <button aria-pressed={tool === 'pan'} onClick={() => chooseTool('pan')} title="Pan (H)"><Icon name="hand" />Pan</button>
        <button aria-pressed={tool === 'measure'} onClick={() => chooseTool('measure')} title="Measure two points (M)"><Icon name="ruler" />Measure</button>
        {onPickHole && <button aria-pressed={tool === 'holes'} onClick={() => chooseTool('holes')} title="Remove a hole"><Icon name="trash" /><span>Holes</span></button>}
      </div>
      <ZoomControls onZoom={zoom} onFit={fit} />
      <select className="part-focus" aria-label="Focus part" value={focusedPart} onChange={event => {
        const value = event.target.value; setFocusedPart(value)
        const target = value === 'all' ? bounds : features.targets[Number(value)]?.bounds
        if (target) { framing.current = target; commitCamera(fitDrawing(target, sizeRef.current)) }
      }}><option value="all">All parts</option>{features.targets.map((target, index) => <option key={index} value={index}>{index + 1}. {target.label}</option>)}</select>
      <details className="viewport-help"><summary aria-label="Drawing controls help"><Icon name="info" /></summary><div>Drag to pan. Scroll or pinch to zoom at the pointer. In Measure, choose two points; hold Space or the middle/right mouse button to pan. Alt bypasses snapping. F fits the view; arrows pan; Esc cancels the current point.</div></details>
    </div>
    <div className="drawing-surface" ref={area}>
      <svg ref={svg} className="layout" viewBox={`0 0 ${size.width} ${size.height}`} aria-label={label} role="application" tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={release} onPointerCancel={release}
        onLostPointerCapture={event => { pointers.current.delete(event.pointerId); pinch.current = null }}
        onPointerLeave={() => { if (!pointers.current.size) setCursor(null) }} onContextMenu={event => event.preventDefault()}>
        <g data-drawing-transform transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale} ${-camera.scale})`}>{children}</g>
        <g className="dimension-overlay">
          {measurements.filter(item => draft?.kind !== 'edit' || item.id !== draft.id).map((item, index) => {
            const start = screenPoint(item.start, camera), end = screenPoint(item.end, camera)
            return <g key={item.id} data-measurement={item.id} data-selected={selected === item.id}>
              <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
              <circle cx={start.x} cy={start.y} r={4} /><circle cx={end.x} cy={end.y} r={4} />
              <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 12}>{index + 1} · {format(measurementValues(item).length)} {unit}</text>
            </g>
          })}
          {draft && (() => {
            const a = screenPoint(draft.start, camera), b = screenPoint(draft.end, camera)
            return <g className="dimension-draft"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} /><circle cx={a.x} cy={a.y} r={5} /><circle cx={b.x} cy={b.y} r={5} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 12}>{format(measurementValues(draft).length)} {unit}</text></g>
          })()}
          {cursor && tool === 'measure' && (() => { const p = screenPoint(cursor, camera); return <g className="snap-marker" data-snap={cursor.kind}><rect x={p.x - 6} y={p.y - 6} width={12} height={12} /><path d={`M${p.x - 12},${p.y}h24M${p.x},${p.y - 12}v24`} /></g> })()}
        </g>
      </svg>
      <PanControls onPan={pan} />
    </div>
    {(tool === 'measure' || measurements.length > 0) && <aside className="measure-panel" aria-label="Measurements">
        <header><strong>Measurements{measurements.length > 0 ? ` · ${measurements.length}` : ''}</strong><button aria-label="Clear measurements" disabled={!measurements.length && !draft} onClick={() => { setMeasurements([]); setDraft(null); setSelected(null) }}><Icon name="trash" /></button></header>
        {tool === 'measure' && <><label className="snap-toggle"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} />Snap to geometry</label><p role="status">{draft?.kind === 'edit' ? `Choose new point ${draft.endpoint === 'start' ? 'A' : 'B'}` : draft ? 'Choose point B' : 'Choose point A'}{cursor ? ` · ${snapLabels[cursor.kind]}` : ''}</p></>}
        {values && <div className="measure-result"><output aria-label="Measured distance">{format(values.length)} <small>{unit}</small></output><span>ΔX {format(values.dx)} · ΔY {format(values.dy)} {unit} · {values.angle.toFixed(1)}°</span></div>}
        {measurements.length > 0 && <ol>{measurements.map((item, index) => <li key={item.id} data-selected={selected === item.id}>
          <button onClick={() => setSelected(item.id)} aria-label={`Select measurement ${index + 1}`}>{index + 1}. {format(measurementValues(item).length)} {unit}</button>
          <button onClick={() => edit(item, 'start')} aria-label={`Edit measurement ${index + 1} start`}>A</button><button onClick={() => edit(item, 'end')} aria-label={`Edit measurement ${index + 1} end`}>B</button>
          <button onClick={() => remove(item.id)} aria-label={`Delete measurement ${index + 1}`}><Icon name="close" size={14} /></button>
        </li>)}</ol>}
        {draft && <button className="measure-cancel" onClick={() => setDraft(null)}>Cancel point</button>}
      </aside>}
    <div className="viewport-status"><span>{tool === 'holes' ? 'Click a hole to remove it' : tool === 'measure' ? 'Two points · Space + drag to pan' : 'Drag to pan · Scroll / pinch to zoom'}</span><span>{format(bounds.width)} × {format(bounds.height)} {unit}</span></div>
  </div>
}
