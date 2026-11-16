import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import { arrangeParts } from '../fabricationLayout'
import type { Config } from '../model'
import type { NestingResult } from '../nesting'
import { downloadFile } from '../projectIO'
import { extensionDimensions } from './extension'
import { compactExtensionDimensions } from './compactExtension'
import { viseModuleDimensions } from './viseModule'
import { cornerBracketDimensions } from './cornerBracket'
import { parseToolProject, projectJson, projectParts, projectAssembly, projectNestingOptions, validProjectLayout, ToolProjectError, type ToolProject } from './project'

const fabricationNotes = (project: ToolProject) => project.tool === 'viseModule'
  ? 'Vise mounting module: 250x250x100 mm reference envelope, five flat plates: slotted top, mounting wall, shallow front wall, two curved sides; open underside. Eight separate radial slots and a separate central round hole. Every outer rounded tip stops 15 mm before the plate boundary along its ray, including to the corners on a square top; lengths are derived, not equal. This is not perpendicular side clearance. Stock and mounting-hole diameter/pitch/origin/pattern inherit from the host table. The full mounting-wall grid is measured down from the working surface; side lower rows are clipped to the curved silhouette. Align the working faces and edge datums; verify the actual retained host holes. Slots, free-end depth, curved profile and locating joints are design assumptions, not factory dimensions. Wall tabs seat flush in top edge notches; side tabs locate in end-wall notches. Confirm vise bolt pattern, fastener clearance/grip, sample joint fit and welding access. Reference pattern: https://umetalli.com/products/vise-mount-01-250x250x100-6-mm (no dimensioned slot drawing).\n'
  : project.tool === 'compactExtension'
  ? 'Compact extension: three flat plates, one central windowed spine, one perforated top and one mounting end. No second side, free-end plate, bottom plate or cross ties. Five rounded spine windows; only the free end tapers. Reference label: 500x100x100 mm, T6, D16, St3, pair of two. One project copy is one extension. Default grid: 20 top holes, four end holes. Pitch, fixed edge origins, precise window profiles, taper and locating joints are editable assumptions, not factory measurements. X away from host table, Y across, Z up; working face Z=height. Seat two spine tabs in top mortises, two root tabs in mounting-end mortises and the end’s upper tabs in top edge notches. Tabs finish flush with the external faces. Slot dimensions include total joint clearance. Confirm hardware passage on both sides of the spine, material grade, sample joint fit, squareness and welding access before fabrication.\n'
  : project.tool === 'cornerBracket'
  ? 'Internal corner bracket: one chamfered triangular base with nine round holes and two perpendicular walls; one wall has three holes and the other one rounded clamp slot. Three flat parts, open top and diagonal side, no bending. The reference states 210x210x60 mm and 8 mm stock; active stock always inherits the host table. Hole diameter/pitch/origins, slot size, profile corner cuts and all locating joints are editable design assumptions, not factory measurements. X/Y lie in the base, perforated wall at Y=0, slotted wall at X=0, Z up. Seat each wall tab in its matching base notch; tabs are flush with the bottom. One wall stops short of the other by half the total joint clearance. Fixture square, tack and verify before welding. The nominal CAD angle is not a measured precision or strength rating.\n'
  : project.tool === 'extension'
  ? 'Wedge extension: seven flat parts with locating tabs and matching notches/mortises. X points away from the host table, the high mounting end is X=0, and the horizontal working top is Z=height.\nGrid: fixed 25 mm top-edge origins and side-row depth from the working surface; 8 mm minimum hole web permits 4–9 mm stock, never an automatic row shift. Confirm fastener grip range for the actual clamped stack. Reference envelope: 500x200x200 mm, T6, D16/50. Free-end height, joint stations/0.2 mm total clearance, slot origins, radii and window dimensions are proposed, not manufacturer measurements. Assemble the two sides, high mounting end, low free end and two cross ties; seat the working top over their tabs before tack welding. Confirm joint fit and welding access on a sample first.\n'
  : 'Flat welding square: one planar L-shaped plate, not a bent or welded angle. The reference shows a 250x250 mm envelope and three holes, but no manufacturing drawing. Active sheet thickness inherits the host table; arm width, hole diameter and end offsets are editable design assumptions. The corner hole is at half the arm width on both axes; end holes are inset from each free end. No bend or weld is required by this model. Confirm hole alignment against your actual table; this model does not guarantee that custom dimensions lie on its grid. The nominal 90 degree contour does not establish the accuracy or flatness of a cut part; finish and measure working edges as needed.\n'

const assertTableStock = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  if (!table || project.size.thickness !== table.thickness) throw new ToolProjectError('stock-mismatch', 'This tool does not match the table stock. Review the inherited thickness before exporting.')
}

export const toolPartsArchive = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  const zip = new JSZip()
  projectParts(project).forEach(part => zip.file(`parts/${part.name}_${part.count}pcs.dxf`, nativeDxfForPart(part)))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('assembly.json', JSON.stringify({ version: 2, tool: project.tool, units: 'mm', axes: project.tool === 'viseModule' || project.tool === 'extension' || project.tool === 'compactExtension' ? 'X away from host table; Y across; Z up' : project.tool === 'cornerBracket' ? 'X/Y in base; perforated wall at Y=0; slotted wall at X=0; Z up' : 'X/Y in the flat plate; Z through thickness', ...(project.tool === 'viseModule' ? { joinery: viseModuleDimensions(project.size) } : project.tool === 'compactExtension' ? { joinery: compactExtensionDimensions(project.size) } : project.tool === 'extension' ? { joinery: extensionDimensions(project.size) } : project.tool === 'cornerBracket' ? { joinery: cornerBracketDimensions(project.size) } : {}), placements: projectAssembly(project) }, null, 2))
  zip.file('README.txt', fabricationNotes(project) + `All parts use the host table stock thickness: ${project.size.thickness} mm. All DXFs use nominal millimetres. Check the actual table and locking hardware, steel grade, loads, weld sequence/distortion where relevant and CAM kerf/lead-ins/cut order before fabrication. No structural rating or physical fit validation is supplied.\n`)
  return zip
}

export const toolArchive = (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  if (!validProjectLayout(project, result, key)) throw new ToolProjectError('invalid-layout', 'Layout is incomplete, stale or invalid for the current project')
  const zip = toolPartsArchive(project, table)
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`sheets/Sheet_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  zip.file('layout.json', JSON.stringify({ version: 1, units: 'mm', projectKey: key, nesting: projectNestingOptions(project), placements: result.placements.map(({ part, instance, sheet, rotation, translation }) => ({ part: part.name, instance, sheet, rotation, translation })), stats: result.stats }, null, 2))
  return zip
}

export const downloadToolArchive = async (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolArchive(project, result, key, table).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Sheets.zip`)
}
export const downloadToolParts = async (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolPartsArchive(project, table).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Parts.zip`)
}
export const toolStripDxf = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  return nativeDxfForNestedSheet(arrangeParts(projectParts(project)).instances.map(({ part, instance, position }) => ({ part, instance, translation: position, rotation: 0, sheet: 0 })))
}
export const downloadToolStrip = (project: ToolProject, table: Pick<Config, 'thickness'>) => downloadFile(toolStripDxf(project, table), `WeldingTable_${project.tool}_Strip.dxf`, 'application/dxf')
