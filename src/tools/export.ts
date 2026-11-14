import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import { arrangeParts } from '../fabricationLayout'
import type { NestingResult } from '../nesting'
import { downloadFile } from '../projectIO'
import { extensionDimensions } from './extension'
import { compactExtensionDimensions } from './compactExtension'
import { cornerBracketDimensions } from './cornerBracket'
import { parseToolProject, projectJson, projectParts, projectAssembly, projectModelParts, projectNestingOptions, validProjectLayout, ToolProjectError, type ToolProject } from './project'

const fabricationNotes = (project: ToolProject) => project.tool === 'compactExtension'
  ? 'Compact extension: three flat plates, one central windowed spine, one perforated top and one mounting end. No second side, free-end plate, bottom plate or cross ties. Five rounded spine windows; only the free end tapers. Reference label: 500x100x100 mm, T6, D16, St3, pair of two. One project copy is one extension. Default grid: 20 top holes, four end holes. Pitch, fixed edge origins, precise window profiles, taper and locating joints are editable assumptions, not factory measurements. X away from host table, Y across, Z up; working face Z=height. Seat two spine tabs in top mortises, two root tabs in mounting-end mortises and the end’s upper tabs in top edge notches. Tabs finish flush with the external faces. Slot dimensions include total joint clearance. Confirm hardware passage on both sides of the spine, material grade, sample joint fit, squareness and welding access before fabrication.\n'
  : project.tool === 'cornerBracket'
  ? 'Internal corner bracket: one chamfered triangular base with nine round holes and two perpendicular walls; one wall has three holes and the other one rounded clamp slot. Three flat parts, open top and diagonal side, no bending. The reference states 210x210x60 mm and 8 mm stock; hole diameter/pitch/origins, slot size, profile corner cuts and all locating joints are editable design assumptions, not factory measurements. X/Y lie in the base, perforated wall at Y=0, slotted wall at X=0, Z up. Seat each wall tab in its matching base notch; tabs are flush with the bottom. One wall stops short of the other by half the total joint clearance. Fixture square, tack and verify before welding. The nominal CAD angle is not a measured precision or strength rating.\n'
  : project.tool === 'extension'
  ? 'Wedge extension: seven flat parts with locating tabs and matching notches/mortises. X points away from the host table, the high mounting end is X=0, and the horizontal working top is Z=height.\nGrid: fixed 25 mm top-edge origins and side-row depth from the working surface; 8 mm minimum hole web permits 4–9 mm stock, never an automatic row shift. Confirm fastener grip range for the actual clamped stack. Reference envelope: 500x200x200 mm, T6, D16/50. Free-end height, joint stations/0.2 mm total clearance, slot origins, radii and window dimensions are proposed, not manufacturer measurements. Assemble the two sides, high mounting end, low free end and two cross ties; seat the working top over their tabs before tack welding. Confirm joint fit and welding access on a sample first.\n'
  : 'Flat welding square: one planar L-shaped plate, not a bent or welded angle. The reference shows a 250x250 mm envelope and three holes, but no manufacturing drawing. Arm width, thickness, hole diameter and end offsets are our editable design assumptions. The corner hole is at half the arm width on both axes; end holes are inset from each free end. No bend or weld is required by this model. Confirm hole alignment against your actual table; this model does not guarantee that custom dimensions lie on its grid. The nominal 90 degree contour does not establish the accuracy or flatness of a cut part; finish and measure working edges as needed.\n'

export const toolPartsArchive = (project: ToolProject) => {
  parseToolProject(projectJson(project))
  const zip = new JSZip()
  projectParts(project).forEach(part => zip.file(`parts/${part.name}_${part.count}pcs.dxf`, nativeDxfForPart(part)))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('assembly.json', JSON.stringify({ version: 2, tool: project.tool, units: 'mm', axes: project.tool === 'extension' || project.tool === 'compactExtension' ? 'X away from host table; Y across; Z up' : project.tool === 'cornerBracket' ? 'X/Y in base; perforated wall at Y=0; slotted wall at X=0; Z up' : 'X/Y in the flat plate; Z through thickness', ...(project.tool === 'compactExtension' ? { joinery: compactExtensionDimensions(project.size) } : project.tool === 'extension' ? { joinery: extensionDimensions(project.size) } : project.tool === 'cornerBracket' ? { joinery: cornerBracketDimensions(project.size) } : {}), placements: projectAssembly(project) }, null, 2))
  zip.file('README.txt', fabricationNotes(project) + 'All DXFs use nominal millimetres. Check the actual table and locking hardware, steel grade, loads, weld sequence/distortion where relevant and CAM kerf/lead-ins/cut order before fabrication. No structural rating or physical fit validation is supplied.\n')
  return zip
}

export const toolArchive = (project: ToolProject, result: NestingResult, key: string) => {
  if (!validProjectLayout(project, result, key)) throw new ToolProjectError('invalid-layout', 'Layout is incomplete, stale or invalid for the current project')
  const zip = toolPartsArchive(project)
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`sheets/Sheet_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  zip.file('layout.json', JSON.stringify({ version: 1, units: 'mm', projectKey: key, nesting: projectNestingOptions(project), placements: result.placements.map(({ part, instance, sheet, rotation, translation }) => ({ part: part.name, instance, sheet, rotation, translation })), stats: result.stats }, null, 2))
  return zip
}

export const downloadToolArchive = async (project: ToolProject, result: NestingResult, key: string) => {
  downloadFile(await toolArchive(project, result, key).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Sheets.zip`)
}
export const downloadToolParts = async (project: ToolProject) => {
  downloadFile(await toolPartsArchive(project).generateAsync({ type: 'blob' }), `WeldingTable_${project.tool}_Parts.zip`)
}
export const toolStripDxf = (project: ToolProject) => {
  parseToolProject(projectJson(project))
  return nativeDxfForNestedSheet(arrangeParts(projectModelParts(project)).instances.map(({ part, instance, position }) => ({ part, instance, translation: position, rotation: 0, sheet: 0 })))
}
export const downloadToolStrip = (project: ToolProject) => downloadFile(toolStripDxf(project), `WeldingTable_${project.tool}_Strip.dxf`, 'application/dxf')
