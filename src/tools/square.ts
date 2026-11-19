import { type Contour, type FabricationPart, type Hole } from '../geometry'
import { nativePointContourDistance } from '../contourGeometry'

/** Own editable dimensions; only the 250 × 250 envelope and three-hole topology come from the photo. */
export type SquareConfig = { length: number; width: number; armWidth: number; holeDiameter: number; endOffset: number }
export const squareDefaults: SquareConfig = { length: 250, width: 250, armWidth: 50, holeDiameter: 16, endOffset: 25 }
export const squareLimits: Record<keyof SquareConfig, { min: number; max: number; step: number }> = {
  length: { min: 150, max: 600, step: 50 }, width: { min: 150, max: 600, step: 50 },
  armWidth: { min: 30, max: 100, step: 5 },
  holeDiameter: { min: 6, max: 28, step: 1 }, endOffset: { min: 15, max: 80, step: 5 },
}

export function squareParts(config: SquareConfig, thickness: number): FabricationPart<'square'>[] {
  for (const key of Object.keys(squareLimits) as Array<keyof SquareConfig>) {
    const value = config[key], { min, max } = squareLimits[key]
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Параметр угольника ${key} должен быть от ${min} до ${max} мм`)
  }
  if (!Number.isFinite(thickness) || thickness < 4 || thickness > 12) throw new Error('Толщина стола для угольника должна быть от 4 до 12 мм')
  const { length, width, armWidth, holeDiameter, endOffset } = config
  if (armWidth >= Math.min(length, width)) throw new Error('Плечи угольника должны оставлять открытый внутренний угол')
  const vertices = [{ x: 0, y: 0 }, { x: length, y: 0 }, { x: length, y: armWidth }, { x: armWidth, y: armWidth }, { x: armWidth, y: width }, { x: 0, y: width }]
  const contour: Contour = vertices.map((from, index) => ({ type: 'line', from, to: vertices[(index + 1) % vertices.length] }))
  const holes: Hole[] = [
    { x: armWidth / 2, y: armWidth / 2 }, { x: length - endOffset, y: armWidth / 2 }, { x: armWidth / 2, y: width - endOffset },
  ].map((center, index) => ({ ...center, id: `square:${index}`, d: holeDiameter, kind: 'mount' }))
  const web = 5
  for (const [index, hole] of holes.entries()) {
    const inside = hole.x > 0 && hole.y > 0 && hole.x < length && hole.y < width && (hole.x < armWidth || hole.y < armWidth)
    if (!inside || nativePointContourDistance(hole, contour) < hole.d / 2 + web - 1e-7) throw new Error('От отверстий угольника до каждой кромки реза должно оставаться не менее 5 мм металла')
    if (holes.slice(index + 1).some(other => Math.hypot(other.x - hole.x, other.y - hole.y) < hole.d + web)) throw new Error('Монтажные отверстия угольника расположены слишком близко друг к другу')
  }
  return [{ name: 'square', label: 'Плоский сварочный угольник', width: length, height: width, thickness, count: 1, holes, slots: [], contours: [contour] }]
}
