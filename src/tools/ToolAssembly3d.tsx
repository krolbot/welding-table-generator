import { useCallback } from 'react'
import * as THREE from 'three'
import { AssemblyViewport, type AssemblyPartInfo, type AssemblyPartMesh, type AssemblyRuntime } from '../AssemblyViewport'
import { addDimensionLine, dimensionLabel, disposeObject3D, extrudedPartMesh } from '../assemblyGeometry'
import type { FabricationPart } from '../geometry'
import { display, type Config } from '../model'
import type { ToolPlacement, ToolProject } from './project'

type ToolGroupOptions = { renderHoles?: boolean; edgeColor?: number }
type ToolGroup<Material extends THREE.Material> = THREE.Group & { toolMeshes: Array<THREE.Mesh<THREE.ExtrudeGeometry, Material>> }
type Envelope = { length: number; width: number; height: number }
type Props = {
  project: ToolProject
  parts: FabricationPart[]
  placements: ToolPlacement[]
  envelope: Envelope
  weights: Record<string, number>
  dark: boolean
  units?: Config['units']
  resetToken?: number
  exploded?: number
  showDimensions?: boolean
  renderHoles?: boolean
  highlighting?: boolean
}

export const toolGroup = <Material extends THREE.Material>(
  parts: FabricationPart[],
  placements: ToolPlacement[],
  material: Material,
  { renderHoles = true, edgeColor }: ToolGroupOptions = {},
): ToolGroup<Material> => {
  const group = new THREE.Group() as ToolGroup<Material>
  group.toolMeshes = []
  const byName = new Map(parts.map(part => [part.name, part]))
  for (const placement of placements) {
    const part = byName.get(placement.part)
    if (!part) throw new Error(`В сборке указана неизвестная деталь ${placement.part}`)
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

const partInfo = (part: FabricationPart, weightKg: number, basePos: THREE.Vector3, explodeDir: THREE.Vector3, units: Config['units']): AssemblyPartInfo => ({
  part: part.name, isPart: true, name: part.label,
  dims: `${display(part.width, units, 2)} × ${display(part.height, units, 2)} × ${display(part.thickness, units, 2)} ${units === 'mm' ? 'мм' : 'дюйм'}`,
  weight: (weightKg * (units === 'mm' ? 1 : 2.20462)).toFixed(2), weightUnit: units === 'mm' ? 'кг' : 'фунт',
  holesCount: part.holes.length, basePos, explodeDir, currentFactor: 0,
})

const rebuildDimensions = (runtime: AssemblyRuntime, project: ToolProject, envelope: Envelope, showDimensions: boolean, units: Config['units']) => {
  disposeObject3D(runtime.dimensions)
  runtime.dimensions.clear()
  if (!showDimensions) return
  const { length, width, height } = envelope
  const label = (value: number) => `${Number(display(value, units, 2))} ${units === 'mm' ? 'мм' : 'дюйм'}`
  const offset = Math.max(length, width, height) * 0.08, x = -offset, y = -offset, z = 0
  const verticalNormal = new THREE.Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(0, y, z), new THREE.Vector3(length, y, z), new THREE.Vector3(0, 1, 0), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, width, z), new THREE.Vector3(1, 0, 0), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, height), verticalNormal, runtime.colors.dim)
  const heightAnchor = project.tool === 'compactExtension' ? new THREE.Vector3(x, y, 0).addScaledVector(verticalNormal, Math.max(width, height) * 0.9) : new THREE.Vector3(x, y, height / 2).addScaledVector(verticalNormal, 40)
  ;[
    dimensionLabel(label(length), new THREE.Vector3(length / 2, y - 40, z), runtime.colors),
    dimensionLabel(label(width), new THREE.Vector3(x - 40, width / 2, z), runtime.colors),
    dimensionLabel(label(height), heightAnchor, runtime.colors),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

const rebuildAssembly = (runtime: AssemblyRuntime, project: ToolProject, parts: FabricationPart[], placements: ToolPlacement[], envelope: Envelope, weights: Record<string, number>, exploded: number, showDimensions: boolean, units: Config['units']) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  runtime.meshes = []
  runtime.assembly.position.set(0, 0, 0)
  runtime.targetFactor = Math.max(0, Math.min(100, exploded)) / 100
  const group = toolGroup(parts, placements, runtime.metal, { renderHoles: runtime.renderHoles, edgeColor: runtime.colors.edge })
  const byName = new Map(parts.map(part => [part.name, part]))
  const center = new THREE.Vector3(envelope.length / 2, envelope.width / 2, envelope.height / 2)
  group.toolMeshes.forEach((mesh, index) => {
    const placement = placements[index], part = byName.get(placement.part)
    if (!part) throw new Error(`В сборке указана неизвестная деталь ${placement.part}`)
    const explodeDir = placements.length === 1 ? new THREE.Vector3() : new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).sub(center)
    if (explodeDir.lengthSq()) explodeDir.normalize().multiplyScalar(Math.max(envelope.length, envelope.width, envelope.height) * 0.25)
    runtime.meshes.push(Object.assign(mesh, { userData: partInfo(part, weights[part.name] ?? 0, mesh.position.clone(), explodeDir, units) }) as AssemblyPartMesh)
  })
  runtime.assembly.add(group)
  rebuildDimensions(runtime, project, envelope, showDimensions, units)
}

const resetCamera = (runtime: AssemblyRuntime, project: ToolProject, envelope: Envelope) => {
  const extent = Math.max(envelope.length, envelope.width, envelope.height)
  const target = new THREE.Vector3(envelope.length / 2, envelope.width / 2, envelope.height / 2)
  const direction = project.tool === 'cornerBracket' ? new THREE.Vector3(0.85, 1.1, 1) : new THREE.Vector3(-0.85, -1.1, 0.8)
  runtime.camera.position.copy(target).addScaledVector(direction, extent)
  runtime.controls.target.copy(target)
  runtime.controls.update()
}

export function ToolAssembly3d({ project, parts, placements, envelope, weights, dark, units = 'mm', resetToken = 0, exploded = 0, showDimensions = true, renderHoles = true, highlighting = true }: Props) {
  const build = useCallback((runtime: AssemblyRuntime) => rebuildAssembly(runtime, project, parts, placements, envelope, weights, exploded, showDimensions, units), [project, parts, placements, envelope, weights, exploded, showDimensions, units])
  const reset = useCallback((runtime: AssemblyRuntime) => resetCamera(runtime, project, envelope), [project, envelope])
  const theme = useCallback((runtime: AssemblyRuntime) => rebuildDimensions(runtime, project, envelope, showDimensions, units), [project, envelope, showDimensions, units])
  return <AssemblyViewport dark={dark} resetToken={resetToken} build={build} resetCamera={reset} initialExtent={Math.max(envelope.length, envelope.width, envelope.height)} ariaLabel="Интерактивная 3D-сборка оснастки" errorMessage="В этом браузере недоступно отображение 3D. Профили 2D и DXF остаются доступны." hostClassName="three-canvas" errorClassName="three-loading" renderHoles={renderHoles} highlighting={highlighting} exploded={exploded} cameraKey={project.tool} onThemeChange={theme} up={[0, 0, 1]} />
}
