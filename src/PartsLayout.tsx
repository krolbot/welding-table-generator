import { useMemo } from 'react'
import { svgContourPath, type EngravingLine, type FabricationPart, type Hole } from './geometry'
import type { Config } from './model'
import type { FabricationLayout } from './fabricationLayout'
import { DrawingViewport } from './DrawingViewport'
import { drawingFeatures } from './drawingInteraction'

type Props = {
  layout: FabricationLayout; units: Config['units']; label: string; resetToken?: number
  getEngravings?: (part: FabricationPart) => EngravingLine[]
  onRemoveHole?: (hole: Hole, part: FabricationPart) => void
}
export function PartsLayout({ layout, units, label, resetToken = 0, getEngravings, onRemoveHole }: Props) {
  const features = useMemo(() => drawingFeatures(layout.instances.map(item => ({ ...item, rotation: 0 }))), [layout])
  return <DrawingViewport bounds={layout} features={features} geometryKey={JSON.stringify(features)} label={label} units={units} resetToken={resetToken}
    onPickHole={onRemoveHole ? target => {
      if (!(target instanceof SVGElement)) return
      const instance = layout.instances[Number(target.dataset.instance)], hole = instance?.part.holes[Number(target.dataset.hole)]
      if (instance && hole) onRemoveHole(hole, instance.part)
    } : undefined}>
    {layout.instances.map((item, instance) => <g key={`${item.part.name}:${item.instance}`} transform={`translate(${item.position.x} ${item.position.y})`} className="part">
      <title>{item.part.label} · {item.instance + 1}</title>
      <path className="contour" d={svgContourPath(item.part.contours[0])} />
      {getEngravings?.(item.part).map((mark, index) => <line key={index} className="engrave" x1={mark.from.x} y1={mark.from.y} x2={mark.to.x} y2={mark.to.y} />)}
      {item.part.contours.slice(1).map((contour, index) => <path className="slot-contour" key={index} d={svgContourPath(contour)} />)}
      {item.part.holes.map((hole, index) => <circle key={hole.id} className="hole" data-instance={instance} data-hole={index} cx={hole.x} cy={hole.y} r={hole.d / 2} />)}
    </g>)}
  </DrawingViewport>
}
