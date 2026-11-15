import { Icon } from './Icon'

export function ZoomControls({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  return <div className="viewport-group" aria-label="Zoom controls">
    <button onClick={() => onZoom(1 / 1.25)} title="Zoom out (−)" aria-label="Zoom out"><Icon name="minus" /></button>
    <button onClick={onFit} title="Fit drawing (F)" aria-label="Fit view"><Icon name="maximize" /><span>Fit</span></button>
    <button onClick={() => onZoom(1.25)} title="Zoom in (+)" aria-label="Zoom in"><Icon name="plus" /></button>
  </div>
}

export function PanControls({ onPan }: { onPan: (x: number, y: number) => void }) {
  return <div className="pan-controls" aria-label="Move view">
    <button aria-label="Move view left" onClick={() => onPan(-48, 0)}>←</button>
    <button aria-label="Move view up" onClick={() => onPan(0, -48)}>↑</button>
    <button aria-label="Move view down" onClick={() => onPan(0, 48)}>↓</button>
    <button aria-label="Move view right" onClick={() => onPan(48, 0)}>→</button>
  </div>
}
