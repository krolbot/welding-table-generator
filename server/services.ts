import { createHash } from 'node:crypto'
import { arrangeParts, fabricationEstimate } from '../src/fabricationLayout'
import { fabricationError, engravingLines, legCornerPlateSpec, makeParts, partWeight, ribAccessHoleSpec, type FabricationPart } from '../src/geometry'
import { projectConfig, type Config } from '../src/model'
import { parseTableProject } from '../src/tableProject'
import { tableAssembly } from '../src/tableAssembly'
import { tableCutInventory } from '../src/tableCutJob'
import { toolPartsArchive, toolStripDxf } from '../src/tools/export'
import { parseToolProject, projectAssembly, projectAtTable, projectEnvelope, projectJson, projectParts, type ToolProject } from '../src/tools/project'
import { fullDxf, dxfForPart } from '../src/dxf'
import JSZip from 'jszip'
import type { ApiError, TablePreviewDto, ToolPreviewDto } from '../src/apiContracts'

export const errorDto = (error: unknown, fallback = 'Не удалось выполнить расчёт'): ApiError => ({
  code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'calculation-failed',
  message: error instanceof Error ? error.message : fallback,
  ...(error && typeof error === 'object' && 'field' in error && typeof error.field === 'string' ? { field: error.field } : {}),
})

export const revisionFor = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export const parseTableInput = (value: unknown): Config => parseTableProject(JSON.stringify(value)).config
export const parseToolInput = (value: unknown, table: Config): ToolProject => projectAtTable(parseToolProject(JSON.stringify(value)), table)

export const tablePreview = (input: unknown): TablePreviewDto => {
  const config = parseTableInput(input)
  const parts = makeParts(config)
  const geometryError = fabricationError(config, parts)
  let cutError: ApiError | null = geometryError ? errorDto(geometryError) : null
  let estimateParts: FabricationPart[] = parts.map(part => ({ ...part, count: part.count * config.nestingCopies }))
  if (!cutError) {
    try { estimateParts = tableCutInventory(config, parts).parts }
    catch (error) { cutError = errorDto(error) }
  }
  return {
    revision: revisionFor(projectConfig(config)), config, parts,
    layout: arrangeParts(parts),
    summary: {
      ...fabricationEstimate(estimateParts, { length: config.sheetLength, width: config.sheetWidth }),
      engraving: parts.reduce((total, part) => total + engravingLines(part, config).reduce((sum, mark) => sum + Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y), 0) * part.count, 0) / 1000 * config.nestingCopies,
    },
    assembly: tableAssembly(config, parts),
    cornerPlate: legCornerPlateSpec(config) ?? null,
    ribAccess: ribAccessHoleSpec(config) ?? null,
    engravings: Object.fromEntries(parts.map(part => [part.name, engravingLines(part, config)])),
    error: cutError,
  }
}

export const toolPreview = (toolInput: unknown, tableInput: unknown): ToolPreviewDto => {
  const table = parseTableInput(tableInput)
  const project = parseToolInput(toolInput, table)
  const parts = projectParts(project, table)
  let admissionError: ApiError | null = null
  try { tableCutInventory({ ...table, nestingTools: [{ id: 'preview', project }] }) }
  catch (error) { admissionError = errorDto(error) }
  return {
    revision: revisionFor({ project: JSON.parse(projectJson(project)), table: projectConfig(table) }),
    project, parts, weights: Object.fromEntries(parts.map(part => [part.name, partWeight(part)])), layout: arrangeParts(parts), summary: fabricationEstimate(parts, project.sheet),
    assembly: projectAssembly(project, table), envelope: projectEnvelope(project, table), admissionError,
  }
}

export const tableDxf = (input: unknown) => {
  const config = parseTableInput(input)
  return { name: `СварочныйСтол_${config.length}x${config.width}.dxf`, bytes: Buffer.from(fullDxf(config)), type: 'application/dxf' }
}

export const tablePartsZip = async (input: unknown) => {
  const config = parseTableInput(input)
  const parts = makeParts(config)
  const error = fabricationError(config, parts)
  if (error) throw error
  const zip = new JSZip()
  parts.forEach((part, index) => zip.file(`${index + 1}_${part.label.replaceAll(' ', '_')}_${part.count}шт.dxf`, dxfForPart(part, config)))
  return { name: `СварочныйСтол_Детали_${config.length}x${config.width}.zip`, bytes: await zip.generateAsync({ type: 'nodebuffer' }), type: 'application/zip' }
}

export const toolDxf = (toolInput: unknown, tableInput: unknown) => {
  const table = parseTableInput(tableInput), project = parseToolInput(toolInput, table)
  return { name: `СварочныйСтол_${project.tool}.dxf`, bytes: Buffer.from(toolStripDxf(project, table)), type: 'application/dxf' }
}

export const toolPartsZip = async (toolInput: unknown, tableInput: unknown) => {
  const table = parseTableInput(tableInput), project = parseToolInput(toolInput, table)
  return { name: `СварочныйСтол_${project.tool}_Детали.zip`, bytes: await toolPartsArchive(project, table).generateAsync({ type: 'nodebuffer' }), type: 'application/zip' }
}
