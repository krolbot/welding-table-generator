import type { FabricationPart, EngravingLine } from './geometry'
import type { FabricationLayout } from './fabricationLayout'
import type { Config } from './model'
import type { NestingFinishReason, NestingRun } from './nestingJob'
import type { ToolPlacement, ToolProject } from './tools/project'

export type ApiError = { code: string; message: string; field?: string }
export type FabricationEstimateDto = { kg: number; cut: number; holes: number; fit: boolean; engraving?: number }
export type Vector3Dto = readonly [number, number, number]
export type EulerDto = readonly [number, number, number]

export type TableAssemblyPlateDto = {
  kind: 'plate'
  part: string
  position: Vector3Dto
  rotation: EulerDto
  explode: Vector3Dto
  displayWidth: number
  displayHeight: number
  weightKg: number
}
export type TableAssemblyTubeDto = {
  kind: 'tube'
  parentIndex: number
  size: number
  length: number
}
export type TableAssemblyDto = {
  plates: TableAssemblyPlateDto[]
  tubes: TableAssemblyTubeDto[]
  focus?: { target: Vector3Dto; direction: Vector3Dto; distance: number }
}

export type TablePreviewDto = {
  revision: string
  config: Config
  parts: FabricationPart[]
  layout: FabricationLayout
  summary: FabricationEstimateDto
  assembly: TableAssemblyDto
  cornerPlate: null | { size: number; thickness: number; holeDiameter: number; holeSpacing: number; jumperLength: number; jumperWidth: number; jumperTabWidth: number; legTubeLength: number }
  ribAccess: null | { valid: boolean; maxDiameter: number; web: number }
  engravings: Record<string, EngravingLine[]>
  error: ApiError | null
}

export type ToolPreviewDto = {
  revision: string
  project: ToolProject
  parts: FabricationPart[]
  weights: Record<string, number>
  layout: FabricationLayout
  summary: FabricationEstimateDto
  assembly: ToolPlacement[]
  envelope: { length: number; width: number; height: number }
  admissionError: ApiError | null
}

export type NestingJobStatusDto = {
  id: string
  revision: string
  status: 'running' | 'pausing' | 'paused' | 'done' | 'error'
  run: NestingRun | null
  elapsedMs: number
  finishReason: NestingFinishReason | null
  error: ApiError | null
  engravings: Record<string, EngravingLine[]>
}
