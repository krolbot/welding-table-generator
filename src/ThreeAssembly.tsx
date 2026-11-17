import { useCallback } from 'react'
import * as THREE from 'three'
import { AssemblyViewport, type AssemblyPartInfo, type AssemblyPartMesh, type AssemblyRuntime } from './AssemblyViewport'
import { addDimensionLine, dimensionLabel, disposeObject3D, extrudedPartMesh } from './assemblyGeometry'
import { display, type Config } from './model'
import type { FabricationPart } from './geometry'
import type { NestingResult } from './nesting'
import type { TableAssemblyDto, TableAssemblyPlateDto } from './apiContracts'

type Props = { config: Config; resetToken: number; dark: boolean; parts: FabricationPart[]; assembly: TableAssemblyDto; nesting?: NestingResult }
type Part = FabricationPart
type PartInfo = AssemblyPartInfo
type PartMesh = AssemblyPartMesh

const partTitles: Record<string, string> = {
  top: 'Основная верхняя плита', longSkirt: 'Продольная юбка', shortSkirt: 'Поперечная юбка',
  longRib: 'Продольное опорное ребро', shortRib: 'Поперечное опорное ребро',
  legCornerPlate: 'Угловая пластина ножки',
  legJumper: 'Опорная перемычка ножки',
  legMountPlate: 'Монтажная пластина ножки',
}

const plate = (
  runtime: AssemblyRuntime,
  part: Part,
  config: Config,
  placement: Pick<TableAssemblyPlateDto, 'position' | 'rotation' | 'explode' | 'displayWidth' | 'displayHeight' | 'weightKg'>,
) => {
  const position = new THREE.Vector3(...placement.position)
  const rotation = new THREE.Euler(...placement.rotation)
  const explodeDir = new THREE.Vector3(...placement.explode)
  const unit = config.units === 'mm' ? 'мм' : 'дюйм'
  const mesh: PartMesh = Object.assign(
    extrudedPartMesh(part, runtime.metal, { renderHoles: runtime.renderHoles, edgeColor: runtime.colors.edge }),
    { userData: {
      part: part.name,
      isPart: true as const,
      name: partTitles[part.name] ?? part.label,
      basePos: position,
      explodeDir,
      currentFactor: runtime.factor,
      dims: `${display(placement.displayWidth, config.units, 0)} × ${display(placement.displayHeight, config.units, 0)} ${unit}`,
      weight: config.units === 'mm' ? Number(placement.weightKg.toFixed(1)) : (placement.weightKg * 2.20462).toFixed(1),
      weightUnit: config.units === 'mm' ? 'кг' : 'фунт',
      holesCount: part.holes.length,
    } satisfies PartInfo },
  )
  mesh.position.copy(position).addScaledVector(explodeDir, runtime.factor)
  mesh.rotation.copy(rotation)
  runtime.assembly.add(mesh)
  runtime.meshes.push(mesh)
  return mesh
}

const squareTubeLeg = (runtime: AssemblyRuntime, size: number, thickness: number, mountingPlate: PartMesh, length: number) => {
  // Plate-local +Z points down. Parenting keeps the welded tube with its plate when exploded.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, length), runtime.metal)
  mesh.position.z = (thickness + length) / 2
  mesh.name = 'Ножка из квадратной трубы'
  mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: runtime.colors.edge }),
  ))
  mountingPlate.add(mesh)
}

const rebuildDimensions = (runtime: AssemblyRuntime, config: Config) => {
  disposeObject3D(runtime.dimensions)
  runtime.dimensions.clear()
  if (!config.showDimensions) return
  const offset = Math.max(config.length, config.width) * 0.08
  const x = config.length / 2 + offset
  const z = config.width / 2 + offset
  const verticalNormal = new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(-config.length / 2, 0, z), new THREE.Vector3(config.length / 2, 0, z), new THREE.Vector3(0, 0, 1), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, 0, config.width / 2), new THREE.Vector3(x, 0, -config.width / 2), new THREE.Vector3(1, 0, 0), runtime.colors.dim)
  addDimensionLine(runtime.dimensions, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -config.height, z), verticalNormal, runtime.colors.dim)
  const unit = config.units === 'mm' ? 'мм' : 'дюйм'
  ;[
    dimensionLabel(`${display(config.length, config.units, 0)} ${unit}`, new THREE.Vector3(0, 0, z + 40), runtime.colors),
    dimensionLabel(`${display(config.width, config.units, 0)} ${unit}`, new THREE.Vector3(x + 40, 0, 0), runtime.colors),
    dimensionLabel(`${display(config.height, config.units, 0)} ${unit}`, new THREE.Vector3(x, -config.height / 2, z).addScaledVector(verticalNormal, 40), runtime.colors),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

export const rebuildAssembly = (runtime: AssemblyRuntime, config: Config, parts: FabricationPart[], assembly: TableAssemblyDto) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  runtime.meshes = []
  const byName = new Map(parts.map(part => [part.name, part]))
  runtime.targetFactor = config.exploded / 100
  runtime.assembly.position.y = config.height / 2
  const meshes = assembly.plates.map(placement => {
    const part = byName.get(placement.part)
    if (!part) throw new Error(`Сервер вернул неизвестную деталь сборки: ${placement.part}`)
    return plate(runtime, part, config, placement)
  })
  assembly.tubes.forEach(tube => {
    const parent = meshes[tube.parentIndex]
    if (parent) squareTubeLeg(runtime, tube.size, parts.find(part => part.name === assembly.plates[tube.parentIndex]?.part)?.thickness ?? config.thickness, parent, tube.length)
  })
  rebuildDimensions(runtime, config)
}

export const rebuildSheets = (runtime: AssemblyRuntime, config: Config, nesting: NestingResult) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  disposeObject3D(runtime.dimensions)
  runtime.dimensions.clear()
  runtime.meshes = []
  runtime.factor = 0
  runtime.targetFactor = 0
  runtime.assembly.position.set(0, 0, 0)
  const spacing = config.sheetLength * 1.08
  const origin = (nesting.sheets.length - 1) * spacing / 2
  nesting.sheets.forEach((sheet, index) => {
    const sheetX = index * spacing - origin
    const halfX = config.sheetLength / 2
    const halfY = config.sheetWidth / 2
    const points = [new THREE.Vector3(-halfX, 0, -halfY), new THREE.Vector3(halfX, 0, -halfY), new THREE.Vector3(halfX, 0, halfY), new THREE.Vector3(-halfX, 0, halfY), new THREE.Vector3(-halfX, 0, -halfY)]
    const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: runtime.colors.dim }))
    outline.position.x = sheetX
    runtime.assembly.add(outline)
    sheet.placements.forEach(placement => plate(runtime, placement.part, config, {
      position: [sheetX + placement.translation.x - halfX, config.thickness / 2, halfY - placement.translation.y],
      rotation: [-Math.PI / 2, 0, placement.rotation * Math.PI / 180], explode: [0, 0, 0],
      displayWidth: placement.part.width, displayHeight: placement.part.height, weightKg: 0,
    }))
  })
}

const resetCamera = (runtime: AssemblyRuntime, config: Config) => {
  const extent = Math.max(config.length, config.width)
  runtime.camera.position.set(extent * 1.2, extent * 0.8, extent * 1.2)
  runtime.controls.target.set(0, 0, 0)
  runtime.controls.update()
}

const focusCornerMount = (runtime: AssemblyRuntime, assembly: TableAssemblyDto) => {
  if (!assembly.focus) return
  const target = new THREE.Vector3(...assembly.focus.target)
  const direction = new THREE.Vector3(...assembly.focus.direction).normalize()
  runtime.camera.position.copy(target).addScaledVector(direction, assembly.focus.distance)
  runtime.controls.target.copy(target)
  runtime.controls.update()
}

export function ThreeAssembly({ config, resetToken, dark, parts, assembly, nesting }: Props) {
  const build = useCallback((runtime: AssemblyRuntime) => {
    if (nesting) rebuildSheets(runtime, config, nesting)
    else rebuildAssembly(runtime, config, parts, assembly)
  }, [parts, assembly, nesting, config.showDimensions, config.units])
  const reset = useCallback((runtime: AssemblyRuntime) => {
    if (nesting) {
      const extent = Math.max(config.sheetLength * Math.max(1, nesting.sheets.length) * 1.08, config.sheetWidth)
      runtime.camera.far = Math.max(100000, extent * 6)
      runtime.camera.updateProjectionMatrix()
      runtime.controls.maxDistance = Math.max(18000, extent * 5)
      runtime.camera.position.set(extent * 0.6, extent * 1.1, extent * 0.7)
      runtime.controls.target.set(0, 0, 0)
      runtime.controls.update()
    } else resetCamera(runtime, config)
  }, [config, nesting])
  const focus = useCallback((runtime: AssemblyRuntime) => focusCornerMount(runtime, assembly), [assembly])
  const theme = useCallback((runtime: AssemblyRuntime) => {
    if (!nesting) rebuildDimensions(runtime, config)
  }, [config, nesting])

  return <AssemblyViewport
    dark={dark}
    resetToken={resetToken}
    build={build}
    resetCamera={reset}
    initialExtent={Math.max(config.length, config.width)}
    ariaLabel={nesting ? 'Интерактивная 3D-раскладка на листах' : 'Интерактивная 3D-сборка сварочного стола'}
    errorMessage="3D-рендеринг недоступен в этом браузере. 2D-раскладка и экспорт по-прежнему доступны."
    hostClassName="three-canvas"
    errorClassName="three-loading"
    renderHoles={nesting ? true : config.renderHoles}
    highlighting={config.highlighting}
    exploded={config.exploded}
    cameraKey={nesting ? 'sheet' : 'assembly'}
    focusCamera={!nesting && assembly.focus ? focus : undefined}
    onThemeChange={theme}
  />
}
