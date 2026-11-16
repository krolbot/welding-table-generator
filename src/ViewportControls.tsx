import { Icon } from './Icon'

export function ZoomControls({ onZoom, onFit }: { onZoom: (factor: number) => void; onFit: () => void }) {
  return <div className="zoom-controls" aria-label="Управление масштабом">
    <button onClick={() => onZoom(1 / 1.25)} title="Уменьшить (−)" aria-label="Уменьшить"><Icon name="minus" /></button>
    <button onClick={onFit} title="Вписать чертёж (F)" aria-label="Вписать в область просмотра"><Icon name="maximize" /><span>Вписать</span></button>
    <button onClick={() => onZoom(1.25)} title="Увеличить (+)" aria-label="Увеличить"><Icon name="plus" /></button>
  </div>
}

export function PanControls({ onPan }: { onPan: (x: number, y: number) => void }) {
  return <details className="pan-controls">
    <summary aria-label="Переместить вид" title="Переместить вид"><Icon name="move" /></summary>
    <div aria-label="Управление перемещением вида">
      <button aria-label="Переместить вид влево" onClick={() => onPan(-48, 0)}>←</button>
      <button aria-label="Переместить вид вверх" onClick={() => onPan(0, -48)}>↑</button>
      <button aria-label="Переместить вид вниз" onClick={() => onPan(0, 48)}>↓</button>
      <button aria-label="Переместить вид вправо" onClick={() => onPan(48, 0)}>→</button>
    </div>
  </details>
}
