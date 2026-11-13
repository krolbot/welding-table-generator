import { contourLength, partWeight, type FabricationPart, type Point } from './geometry'
import { nativeContourBounds } from './nestingNative'

export type FabricationLayout = { instances: Array<{ part: FabricationPart; instance: number; position: Point }>; width: number; height: number }

/** Presentation strip only, never a nested sheet. Preserve canonical local coordinates. */
export function arrangeParts(parts: FabricationPart[]): FabricationLayout {
  const bounds = parts.map(part => nativeContourBounds(part.contours[0]))
  const width = Math.max(...bounds.map(box => box.maxX - box.minX))
  const instances: FabricationLayout['instances'] = []
  let cursor = 0
  parts.forEach((part, index) => {
    const box = bounds[index]
    for (let instance = 0; instance < part.count; instance += 1) {
      instances.push({ part, instance, position: { x: -box.minX, y: cursor - box.minY } })
      cursor += box.maxY - box.minY + 80
    }
  })
  return { instances, width, height: Math.max(0, cursor - 80) }
}

export const fabricationEstimate = (parts: FabricationPart[], sheet: { length: number; width: number }) => ({
  kg: parts.reduce((sum, part) => sum + partWeight(part) * part.count, 0),
  cut: parts.reduce((sum, part) => sum + part.count * (part.contours.reduce((length, contour) => length + contourLength(contour), 0) + part.holes.reduce((length, hole) => length + Math.PI * hole.d, 0)), 0) / 1000,
  holes: parts.reduce((sum, part) => sum + part.count * part.holes.length, 0),
  fit: parts.every(part => {
    const box = nativeContourBounds(part.contours[0]), width = box.maxX - box.minX, height = box.maxY - box.minY
    return width <= sheet.length && height <= sheet.width || height <= sheet.length && width <= sheet.width
  }),
})
