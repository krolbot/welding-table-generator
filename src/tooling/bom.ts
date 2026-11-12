import { signedContourArea } from '../geometry.js'
import type { SheetBomItem, SheetPart } from './model.js'

export const estimatePartMassKg = (part: SheetPart): number => {
  const outerArea = Math.abs(signedContourArea(part.contours[0] ?? []))
  const cutArea = part.contours.slice(1).reduce((sum, contour) => sum + Math.abs(signedContourArea(contour)), 0)
  const holeArea = part.holes.reduce((sum, hole) => sum + Math.PI * (hole.d / 2) ** 2, 0)
  const netArea = outerArea - cutArea - holeArea
  if (!Number.isFinite(netArea) || netArea <= 0) throw new Error(`${part.name}: non-positive net sheet area`)
  return netArea * part.thickness * part.densityKgPerMm3
}

export const buildSheetBom = (parts: readonly SheetPart[]): SheetBomItem[] => {
  const groups = new Map<string, SheetBomItem>()
  for (const part of parts) {
    const key = `${part.material}:${part.thickness}`
    const current = groups.get(key) ?? { material: part.material, thickness: part.thickness, partNames: [], quantity: 0, netMassKg: 0 }
    current.partNames.push(part.name)
    current.quantity += part.count
    current.netMassKg += estimatePartMassKg(part) * part.count
    groups.set(key, current)
  }
  return [...groups.values()].map(item => ({ ...item, netMassKg: Number(item.netMassKg.toFixed(6)) }))
}
