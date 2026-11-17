import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import { arrangeParts } from '../fabricationLayout'
import type { Config } from '../model'
import type { NestingResult } from '../nesting'
import { downloadFile } from '../projectIO'
import { parseToolProject, projectJson, projectParts, validProjectLayout, ToolProjectError, type ToolProject } from './project'

const assertTableStock = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  if (!table || project.size.thickness !== table.thickness) throw new ToolProjectError('stock-mismatch', 'Оснастка не соответствует толщине металла стола. Перед экспортом проверьте унаследованную толщину.')
}

export const toolPartsArchive = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  const zip = new JSZip()
  projectParts(project).forEach(part => zip.file(`детали/${part.name}_${part.count}шт.dxf`, nativeDxfForPart(part)))
  return zip
}

export const toolArchive = (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  if (!validProjectLayout(project, result, key)) throw new ToolProjectError('invalid-layout', 'Раскладка неполна, устарела или не соответствует текущему проекту')
  const zip = new JSZip()
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`Лист_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  return zip
}

export const downloadToolArchive = async (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolArchive(project, result, key, table).generateAsync({ type: 'blob' }), `СварочныйСтол_${project.tool}_Листы.zip`)
}
export const downloadToolParts = async (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolPartsArchive(project, table).generateAsync({ type: 'blob' }), `СварочныйСтол_${project.tool}_Детали.zip`)
}
export const toolStripDxf = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  return nativeDxfForNestedSheet(arrangeParts(projectParts(project)).instances.map(({ part, instance, position }) => ({ part, instance, translation: position, rotation: 0, sheet: 0 })))
}
export const downloadToolStrip = (project: ToolProject, table: Pick<Config, 'thickness'>) => downloadFile(toolStripDxf(project, table), `СварочныйСтол_${project.tool}_Полоса.dxf`, 'application/dxf')
