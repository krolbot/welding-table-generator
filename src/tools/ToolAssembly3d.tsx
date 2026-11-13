import { useCallback } from 'react'
import * as THREE from 'three'
import { AssemblyViewport, type AssemblyPartInfo, type AssemblyPartMesh, type AssemblyRuntime } from '../AssemblyViewport'
import { addDimensionLine, dimensionLabel, disposeObject3D, extrudedPartMesh } from '../assemblyGeometry'
import { partWeight, type FabricationPart } from '../geometry'
import { display, type Config } from '../model'
import type { NestingResult } from '../nesting'
import { projectAssembly, projectEnvelope, projectParts, type ToolProject } from './project'

type ToolGroupOptions = { renderHoles?: boolean; edgeColor?: number }
type ToolGroup<Material extends THREE.Material> = THREE.Group & { toolMeshes: Array<THREE.Mesh<THREE.ExtrudeGeometry, Material>> }
type Props = {
  project: ToolProject
  dark: boolean
  units?: Config['units']
  resetToken?: number
  exploded?: number
  showDimensions?: boolean
  renderHoles?: boolean
  highlighting?: boolean
  nesting?: NestingResult
}

export const toolGroup = <Material extends THREE.Material>(
  project: ToolProject,
  material: Material,
  { renderHoles = true, edgeColor }: ToolGroupOptions = {},
): ToolGroup<Material> => {
  const group = new THREE.Group() as ToolGroup<Material>
  group.toolMeshes = []
  const parts = new Map(projectParts(project).map(part => [part.name, part]))
  for (const placement of projectAssembly(project)) {
    const part = parts.get(placement.part)
    if (!part) throw new Error(`Assembly references unknown part ${placement.part}`)
    const mesh = extrudedPartMesh(part, material, { renderHoles, edgeColor })
    mesh.name = `${part.name}:${placement.instance}`
    mesh.applyMatrix4(new THREE.Matrix4().set(
      placement.axes[0][0], placement.axes[1][0], placement.axes[2][0], placement.origin[0],
      placement.axes[0][1], placement.axes[1][1], placement.axes[2][1], placement.origin[1],
      placement.axes[0][2], placement.axes[1][2], placement.axes[2][2], placement.origin[2], 0, 0, 0, 1,
    ))
    group.add(mesh)
    group.toolMeshes.push(mesh)
  }
  return group
}

const partInfo = (part: FabricationPart, basePos: THREE.Vector3, explodeDir: THREE.Vector3, units: Config['units']): AssemblyPartInfo => ({
  part: part.name,
  isPart: true,
  name: part.label,
  dims: `${display(part.width, units, 2)} × ${display(part.height, units, 2)} × ${display(part.thickness, units, 2)} ${units === 'mm' ? 'mm' : 'in'}`,
  weight: (partWeight(part) * (units === 'mm' ? 1 : 2.20462)).toFixed(2),
  weightUnit: units === 'mm' ? 'kg' : 'lb',
  holesCount: part.holes.length,
  basePos,
  explodeDir,
  currentFactor: 0,
})

const rebuildDimensions = (runtime: AssemblyRuntime, project: ToolProject, showDimensions: boolean, units: Config['units']) => {
  disposeObject3D(runtime.dimensions)
  runtime.dimensions.clear()
  if (!showDimensions) return
  const { length, width, height } = projectEnvelope(project)
  const label = (value: number) => `${Number(display(value, units, 2))} ${units === 'mm' ? 'mm' : 'in'}`
  const labelSize = Math.max(length, width, height) * 0.22
  const offset = Math.max(length, width, height) * 0.08
  const x = -offset
  const y = -offset
  const z = 0
  const verticalNormal = new THREE.Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(0, y, z), new THREE.Vector3(length, y, z), new THREE.Vector3(0, 1, 0), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, width, z), new THREE.Vector3(1, 0, 0), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, height), verticalNormal, runtime.colors.dim)
  ;[
    dimensionLabel(label(length), new THREE.Vector3(length / 2, y - 40, z), runtime.colors.dim, labelSize),
    dimensionLabel(label(width), new THREE.Vector3(x - 40, width / 2, z), runtime.colors.dim, labelSize),
    dimensionLabel(label(height), new THREE.Vector3(x, y, height / 2).addScaledVector(verticalNormal, 40), runtime.colors.dim, labelSize),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

const rebuildAssembly = (runtime: AssemblyRuntime, project: ToolProject, exploded: number, showDimensions: boolean, units: Config['units']) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  runtime.meshes = []
  runtime.assembly.position.set(0, 0, 0)
  runtime.targetFactor = Math.max(0, Math.min(100, exploded)) / 100
  const group = toolGroup(project, runtime.metal, { renderHoles: runtime.renderHoles, edgeColor: runtime.colors.edge })
  const parts = new Map(projectParts(project).map(part => [part.name, part]))
  const placements = projectAssembly(project)
  const { length, width, height } = projectEnvelope(project)
  const center = new THREE.Vector3(length / 2, width / 2, height / 2)
  group.toolMeshes.forEach((mesh, index) => {
    const placement = placements[index]
    const part = parts.get(placement.part)
    if (!part) throw new Error(`Assembly references unknown part ${placement.part}`)
    const explodeDir = placements.length === 1 ? new THREE.Vector3() : new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).sub(center)
    if (explodeDir.lengthSq()) explodeDir.normalize().multiplyScalar(Math.max(length, width, height) * 0.25)
    const partMesh: AssemblyPartMesh = Object.assign(mesh, { userData: partInfo(part, mesh.position.clone(), explodeDir, units) })
    runtime.meshes.push(partMesh)
  })
  runtime.assembly.add(group)
  rebuildDimensions(runtime, project, showDimensions, units)
}

const rebuildSheets = (runtime: AssemblyRuntime, project: ToolProject, nesting: NestingResult, units: Config['units']) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  disposeObject3D(runtime.dimensions)
  runtime.dimensions.clear()
  runtime.meshes = []
  runtime.factor = 0
  runtime.targetFactor = 0
  runtime.assembly.position.set(0, 0, 0)
  const spacing = project.sheet.length * 1.08
  const origin = (nesting.sheets.length - 1) * spacing / 2
  nesting.sheets.forEach((sheet, index) => {
    const sheetX = index * spacing - origin
    const halfX = project.sheet.length / 2
    const halfY = project.sheet.width / 2
    const points = [
      new THREE.Vector3(-halfX, -halfY, 0), new THREE.Vector3(halfX, -halfY, 0),
      new THREE.Vector3(halfX, halfY, 0), new THREE.Vector3(-halfX, halfY, 0),
      new THREE.Vector3(-halfX, -halfY, 0),
    ]
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: runtime.colors.dim }))
    outline.position.x = sheetX
    runtime.assembly.add(outline)
    sheet.placements.forEach(placement => {
      const mesh = extrudedPartMesh(placement.part, runtime.metal, { renderHoles: true, edgeColor: runtime.colors.edge })
      mesh.name = `${placement.part.name}:${placement.instance}`
      mesh.position.set(sheetX + placement.translation.x - halfX, placement.translation.y - halfY, placement.part.thickness / 2)
      mesh.rotation.z = placement.rotation * Math.PI / 180
      const partMesh: AssemblyPartMesh = Object.assign(mesh, { userData: partInfo(placement.part, mesh.position.clone(), new THREE.Vector3(), units) })
      runtime.assembly.add(partMesh)
      runtime.meshes.push(partMesh)
    })
  })
}

const resetCamera = (runtime: AssemblyRuntime, project: ToolProject) => {
  const { length, width, height } = projectEnvelope(project)
  const extent = Math.max(length, width, height)
  const target = new THREE.Vector3(length / 2, width / 2, height / 2)
  runtime.camera.position.copy(target).add(new THREE.Vector3(-extent * 0.85, -extent * 1.1, extent * 0.8))
  runtime.controls.target.copy(target)
  runtime.controls.update()
}

const resetSheetCamera = (runtime: AssemblyRuntime, project: ToolProject, nesting: NestingResult) => {
  const extent = Math.max(project.sheet.length * Math.max(1, nesting.sheets.length) * 1.08, project.sheet.width)
  runtime.camera.far = Math.max(100000, extent * 6)
  runtime.camera.updateProjectionMatrix()
  runtime.controls.maxDistance = Math.max(18000, extent * 5)
  runtime.camera.position.set(extent * 0.6, -extent * 0.7, extent * 1.1)
  runtime.controls.target.set(0, 0, 0)
  runtime.controls.update()
}

export function ToolAssembly3d({
  project,
  dark,
  units = 'mm',
  resetToken = 0,
  exploded = 0,
  showDimensions = true,
  renderHoles = true,
  highlighting = true,
  nesting,
}: Props) {
  const build = useCallback((runtime: AssemblyRuntime) => {
    if (nesting) rebuildSheets(runtime, project, nesting, units)
    else rebuildAssembly(runtime, project, exploded, showDimensions, units)
  }, [exploded, nesting, project, showDimensions, units])
  const reset = useCallback((runtime: AssemblyRuntime) => {
    if (nesting) resetSheetCamera(runtime, project, nesting)
    else resetCamera(runtime, project)
  }, [nesting, project])
  const theme = useCallback((runtime: AssemblyRuntime) => {
    if (!nesting) rebuildDimensions(runtime, project, showDimensions, units)
  }, [nesting, project, showDimensions, units])
  const envelope = projectEnvelope(project)

  return <AssemblyViewport
    dark={dark}
    resetToken={resetToken}
    build={build}
    resetCamera={reset}
    initialExtent={Math.max(envelope.length, envelope.width, envelope.height)}
    ariaLabel={nesting ? 'Interactive 3D tool sheet layout' : 'Interactive 3D tool assembly'}
    errorMessage="3D rendering is unavailable in this browser. The 2D profiles and DXF remain available."
    hostClassName="three-canvas"
    errorClassName="three-loading"
    renderHoles={nesting ? true : renderHoles}
    highlighting={highlighting}
    cameraKey={nesting ?? project.tool}
    onThemeChange={theme}
    up={[0, 0, 1]}
  />
}
