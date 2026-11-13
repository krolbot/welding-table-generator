import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { contourPoints, svgContourPath, type EngravingLine, type FabricationPart, type Hole, type Point } from './geometry'
import { display, type Config } from './model'
import { Icon } from './Icon'
import type { FabricationLayout } from './fabricationLayout'

type Tool = 'holes' | 'ruler' | null
type Measure = { start: Point; end: Point }
type Props = {
  layout: FabricationLayout; units: Config['units']; label: string; resetToken?: number
  getEngravings?: (part: FabricationPart) => EngravingLine[]
  onRemoveHole?: (hole: Hole, part: FabricationPart) => void
}
export function PartsLayout({ layout, units, label, resetToken = 0, getEngravings, onRemoveHole }: Props) {
  const [tool, setTool] = useState<Tool>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<Point | null>(null)
  const [measure, setMeasure] = useState<Measure | null>(null)
  const [rulerCursor, setRulerCursor] = useState<Point | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<{ distance: number; center: Point; zoom: number; pan: Point } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const measuring = useRef(false)
  const measureOrigin = useRef<Point | null>(null)
  const snapPoints = useMemo(() => layout.instances.flatMap(item => [
    ...item.part.contours.flatMap(contour => contourPoints(contour, 1)),
    ...item.part.holes.flatMap(hole => [hole,
      { x: hole.x - hole.d / 2, y: hole.y }, { x: hole.x + hole.d / 2, y: hole.y },
      { x: hole.x, y: hole.y - hole.d / 2 }, { x: hole.x, y: hole.y + hole.d / 2 },
    ]),
  ].map(point => ({ x: item.position.x - layout.width / 2 + point.x, y: item.position.y - layout.height / 2 + point.y }))), [layout])
  const canvasWidth = layout.width + 300
  const canvasHeight = layout.height + 300
  const rulerScale = Math.max(layout.width, layout.height) * 0.004 / zoom
  const unitLabel = units === 'mm' ? 'mm' : 'in'
  const reset2d = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setMeasure(null)
    setRulerCursor(null)
    pinch.current = null
    pointers.current.clear()
    setDrag(null)
    measuring.current = false
  }
  const drawingPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const matrix = event.currentTarget.getScreenCTM()
    if (!matrix) return { x: 0, y: 0 }
    const screen = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return {
      x: (screen.x - canvasWidth / 2 - pan.x) / zoom,
      y: -(screen.y - canvasHeight / 2 - pan.y) / zoom,
    }
  }
  const rulerPoint = (event: PointerEvent<SVGSVGElement>): Point => {
    const point = drawingPoint(event)
    let nearest = point
    let distance = 20 / (Math.abs(event.currentTarget.getScreenCTM()?.a ?? 1) * zoom)
    for (const candidate of snapPoints) {
      const next = Math.hypot(candidate.x - point.x, candidate.y - point.y)
      if (next < distance) { nearest = candidate; distance = next }
    }
    return nearest
  }
  const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, zoom, pan }
      measuring.current = false
      measureOrigin.current = null
      setDrag(null)
      return
    }
    if (tool === 'ruler') {
      const point = rulerPoint(event)
      setRulerCursor(point)
      if (measuring.current && measure) {
        setMeasure({ ...measure, end: point })
        measuring.current = false
      } else {
        setMeasure({ start: point, end: point })
        measuring.current = true
      }
      measureOrigin.current = { x: event.clientX, y: event.clientY }
    } else setDrag({ x: event.clientX, y: event.clientY })
  }
  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(event.pointerId)
    if (previous) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const active = [...pointers.current.values()]
    if (active.length === 2 && pinch.current) {
      const matrix = event.currentTarget.getScreenCTM()
      if (!matrix) return
      const origin = pinch.current
      const next = Math.max(0.1, Math.min(20, origin.zoom * Math.hypot(active[0].x - active[1].x, active[0].y - active[1].y) / origin.distance))
      const ratio = next / origin.zoom
      const center = new DOMPoint((active[0].x + active[1].x) / 2, (active[0].y + active[1].y) / 2).matrixTransform(matrix.inverse())
      const start = new DOMPoint(origin.center.x, origin.center.y).matrixTransform(matrix.inverse())
      setPan({ x: center.x - canvasWidth / 2 - (start.x - canvasWidth / 2 - origin.pan.x) * ratio, y: center.y - canvasHeight / 2 - (start.y - canvasHeight / 2 - origin.pan.y) * ratio })
      setZoom(next)
      return
    }
    pinch.current = null
    if (tool === 'ruler') {
      const end = rulerPoint(event)
      setRulerCursor(end)
      if (measuring.current) setMeasure(current => current ? { ...current, end } : current)
      return
    }
    const matrix = svgRef.current?.getScreenCTM()
    if (drag && previous && matrix) {
      setPan(current => ({ x: current.x + (event.clientX - previous.x) / matrix.a, y: current.y + (event.clientY - previous.y) / matrix.d }))
    }
  }
  const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (tool === 'ruler' && measureOrigin.current && Math.hypot(event.clientX - measureOrigin.current.x, event.clientY - measureOrigin.current.y) > 4) measuring.current = false
    measureOrigin.current = null
    setDrag(null)
  }

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const wheel = (event: globalThis.WheelEvent) => {
      event.preventDefault()
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const next = Math.max(0.1, Math.min(20, zoom * (1 - event.deltaY * 0.001)))
      const ratio = next / zoom
      setPan(current => ({
        x: point.x - canvasWidth / 2 - (point.x - canvasWidth / 2 - current.x) * ratio,
        y: point.y - canvasHeight / 2 - (point.y - canvasHeight / 2 - current.y) * ratio,
      }))
      setZoom(next)
    }
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => svg.removeEventListener('wheel', wheel)
  }, [zoom, canvasWidth, canvasHeight])
  const measureLength = measure
    ? Math.hypot(measure.end.x - measure.start.x, measure.end.y - measure.start.y)
    : 0
  const displayedLayoutWidth = display(layout.width, units, 0)
  const displayedLayoutHeight = display(layout.height, units, 0)

  useEffect(() => reset2d(), [resetToken])
  return <>
          <div className="drawing-frame" data-tool={tool ?? 'pan'}>
            <div className="drawing-grid" style={{ backgroundSize: `${50 * zoom}px ${50 * zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }} />
            <svg
            ref={svgRef}
            className="layout"
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}

            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onPointerLeave={() => setRulerCursor(null)}
            aria-label={label}
          >

            <g transform={`translate(${canvasWidth / 2 + pan.x} ${canvasHeight / 2 + pan.y}) scale(${zoom})`}>
              {layout.instances.map(item => {
                const engravings = getEngravings?.(item.part) ?? []
                return (
                  <g key={`${item.part.name}:${item.instance}`} transform={`translate(${item.position.x - layout.width / 2} ${layout.height / 2 - item.position.y}) scale(1 -1)`} className="part">
                    <title>{item.part.label} · {item.instance + 1}</title>
                    <path className="contour" d={svgContourPath(item.part.contours[0])} />
                    {engravings.map((mark, index) => <line key={index} className="engrave" x1={mark.from.x} y1={mark.from.y} x2={mark.to.x} y2={mark.to.y} />)}
                    {item.part.contours.slice(1).map((contour, index) => <path className="slot-contour" key={index} d={svgContourPath(contour)} />)}
                    {item.part.holes.map(hole => (
                      <circle
                        key={hole.id}
                        className="hole"
                        onPointerDown={event => {
                          if (tool === 'holes') {
                            event.stopPropagation()
                            onRemoveHole?.(hole, item.part)
                          }
                        }}
                        cx={hole.x}
                        cy={hole.y}
                        r={hole.d / 2}
                      />
                    ))}
                  </g>
                )
              })}
              {measure && (
                <g className="measurement">
                  <line x1={measure.start.x} y1={-measure.start.y} x2={measure.end.x} y2={-measure.end.y} strokeWidth={2.5 * rulerScale} strokeDasharray={`${8 * rulerScale} ${6 * rulerScale}`} />
                  <g transform={`translate(${(measure.start.x + measure.end.x) / 2} ${-(measure.start.y + measure.end.y) / 2})`}>
                    <rect x={-45 * rulerScale} y={-20 * rulerScale} width={90 * rulerScale} height={26 * rulerScale} rx={6 * rulerScale} strokeWidth={1.75 * rulerScale} />
                    <text y={-5 * rulerScale} fontSize={14 * rulerScale}>{display(measureLength, units, 1)} {unitLabel}</text>
                  </g>
                </g>
              )}
              {tool === 'ruler' && rulerCursor && <g className="ruler-cursor" strokeWidth={1.5 * rulerScale}>
                <line x1={rulerCursor.x - 14 * rulerScale} y1={-rulerCursor.y} x2={rulerCursor.x + 14 * rulerScale} y2={-rulerCursor.y} />
                <line x1={rulerCursor.x} y1={-rulerCursor.y - 14 * rulerScale} x2={rulerCursor.x} y2={-rulerCursor.y + 14 * rulerScale} />
              </g>}
            </g>
          </svg>
          </div>
          <div className="drawing-toolbar"><div className="laser-note"><Icon name="info" /><div><strong>File for Laser Cutting</strong><small>On DXF export, reliefs (dog-bones) are created as native <b>DXF ARC</b>, and grid holes as <b>DXF CIRCLE</b>.</small></div></div><div className="canvas-tools">{onRemoveHole && <button aria-label="Holes" className={tool === 'holes' ? 'active holes-tool' : 'holes-tool'} onClick={() => { setTool(current => current === 'holes' ? null : 'holes'); measuring.current = false }}><Icon name="trash" /><span className="tool-label">Holes{tool === 'holes' ? ' (Active)' : ''}</span></button>}<button aria-label="Ruler" className={tool === 'ruler' ? 'active ruler-tool' : 'ruler-tool'} onClick={() => { setTool(current => current === 'ruler' ? null : 'ruler'); setMeasure(null); measuring.current = false }}><Icon name="ruler" /><span className="tool-label">Ruler{tool === 'ruler' ? ' (Active)' : ''}</span></button><button title="Reset Zoom (Center)" onClick={reset2d}><Icon name="maximize" />{displayedLayoutWidth} x {displayedLayoutHeight} {unitLabel}</button></div></div>
        </>
}
