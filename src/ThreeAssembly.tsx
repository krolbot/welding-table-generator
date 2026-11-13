import { useCallback } from 'react'
import * as THREE from 'three'
import { AssemblyViewport, type AssemblyPartInfo, type AssemblyPartMesh, type AssemblyRuntime } from './AssemblyViewport'
import { addDimensionLine, dimensionLabel, disposeObject3D, extrudedPartMesh } from './assemblyGeometry'
import { display, type Config } from './model'
import { framePositions, legCornerPlateSpec, makeParts, partWeight, type FabricationPart } from './geometry'
import type { NestingResult } from './nesting'

type Props = { config: Config; resetToken: number; mountFocusToken: number; dark: boolean; nesting?: NestingResult }
type Part = FabricationPart
type PartInfo = AssemblyPartInfo
type PartMesh = AssemblyPartMesh

const partTitles: Record<string, string> = {
  top: 'Main Top Plate', longSkirt: 'Longitudinal Skirt', shortSkirt: 'Transverse Skirt',
  longRib: 'Longitudinal Support Rib', shortRib: 'Transverse Support Rib',
  legCornerPlate: 'Leg Corner Plate',
  legJumper: 'Leg Support Jumper',
  legMountPlate: 'Leg Mounting Plate',
}

const plate = (
  runtime: AssemblyRuntime,
  part: Part,
  config: Config,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  explodeDir: THREE.Vector3,
) => {
  const width = part.width - (part.name === 'shortSkirt' || part.name.endsWith('Rib') ? 2 * config.thickness : 0)
  const height = part.height - (part.name === 'top' || (part.name.endsWith('Skirt') && config.legMounts && config.legMountStyle === 'cornerPlate') || part.name === 'legCornerPlate' || part.name === 'legJumper' || part.name === 'legMountPlate' ? 0 : config.thickness)
  const metricWeight = Number(partWeight(part).toFixed(1))
  const unit = config.units === 'mm' ? 'mm' : 'in'
  const mesh: PartMesh = Object.assign(
    extrudedPartMesh(part, runtime.metal, { renderHoles: runtime.renderHoles, edgeColor: runtime.colors.edge }),
    { userData: {
      part: part.name,
      isPart: true as const,
      name: partTitles[part.name] ?? part.label,
      basePos: position,
      explodeDir,
      currentFactor: runtime.factor,
      dims: `${display(width, config.units, 0)} × ${display(height, config.units, 0)} ${unit}`,
      weight: config.units === 'mm' ? metricWeight : (metricWeight * 2.20462).toFixed(1),
      weightUnit: config.units === 'mm' ? 'kg' : 'lb',
      holesCount: part.holes.length,
    } satisfies PartInfo },
  )
  mesh.position.copy(position).addScaledVector(explodeDir, runtime.factor)
  mesh.rotation.copy(rotation)
  runtime.assembly.add(mesh)
  runtime.meshes.push(mesh)
  return mesh
}

const squareTubeLeg = (runtime: AssemblyRuntime, config: Config, mountingPlate: PartMesh, length: number) => {
  // Plate-local +Z points down. Parenting keeps the welded tube with its plate when exploded.
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(config.legProfileSize, config.legProfileSize, length), runtime.metal)
  mesh.position.z = (config.thickness + length) / 2
  mesh.name = 'Square tube leg'
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
  const unit = config.units === 'mm' ? 'mm' : 'in'
  ;[
    dimensionLabel(`${display(config.length, config.units, 0)} ${unit}`, new THREE.Vector3(0, 0, z + 40), runtime.colors.dim),
    dimensionLabel(`${display(config.width, config.units, 0)} ${unit}`, new THREE.Vector3(x + 40, 0, 0), runtime.colors.dim),
    dimensionLabel(`${display(config.height, config.units, 0)} ${unit}`, new THREE.Vector3(x, -config.height / 2, z).addScaledVector(verticalNormal, 40), runtime.colors.dim),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

const rebuildAssembly = (runtime: AssemblyRuntime, config: Config) => {
  disposeObject3D(runtime.assembly)
  runtime.assembly.clear()
  runtime.meshes = []
  const parts = makeParts(config)
  const find = (name: Part['name']) => parts.find(part => part.name === name)
  runtime.targetFactor = config.exploded / 100
  runtime.assembly.position.y = config.height / 2
  const top = find('top')
  if (top) {
    plate(runtime, top, config, new THREE.Vector3(0, -config.thickness / 2, 0), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, config.width * 0.4, 0))
  }
  const longSkirt = find('longSkirt')
  const skirtY = config.legMounts && config.legMountStyle === 'cornerPlate' ? -config.height / 2 : -config.height / 2 - config.thickness / 2
  if (longSkirt) {
    for (const side of [1, -1]) {
      const rotation = config.liftingHoles && side < 0 ? new THREE.Euler(0, Math.PI, 0) : new THREE.Euler()
      plate(runtime, longSkirt, config, new THREE.Vector3(0, skirtY, side * (config.width / 2 - config.thickness / 2)), rotation, new THREE.Vector3(0, 0, side * config.width * 0.3))
    }
  }
  const shortSkirt = find('shortSkirt')
  if (shortSkirt) {
    for (const side of [1, -1]) {
      plate(runtime, shortSkirt, config, new THREE.Vector3(side * (config.length / 2 - config.thickness / 2), skirtY, 0), new THREE.Euler(0, -Math.PI / 2, 0), new THREE.Vector3(side * config.length * 0.3, 0, 0))
    }
  }
  const cornerPlate = legCornerPlateSpec(config)
  const cornerPlatePart = find('legCornerPlate')
  const jumperPart = find('legJumper')
  const mountPlatePart = find('legMountPlate')
  if (cornerPlate && cornerPlatePart && jumperPart && mountPlatePart) {
    const y = -config.height + cornerPlate.thickness / 2
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const x = xSign * cornerPlate.centerX
        const z = zSign * cornerPlate.centerZ
        const angle = xSign > 0
          ? zSign > 0 ? 0 : -Math.PI / 2
          : zSign > 0 ? Math.PI / 2 : Math.PI
        plate(runtime, cornerPlatePart, config, new THREE.Vector3(x, y, z), new THREE.Euler(Math.PI / 2, 0, angle), new THREE.Vector3(xSign * config.length * 0.15, 0, zSign * config.width * 0.15))
        const inward = new THREE.Vector3(-xSign, 0, -zSign).normalize()
        const jumperOffset = config.legProfileSize / Math.SQRT2 + jumperPart.thickness / 2
        const jumperPosition = new THREE.Vector3(x, -config.height + jumperPart.height / 2, z)
          .addScaledVector(inward, jumperOffset)
        plate(
          runtime,
          jumperPart,
          config,
          jumperPosition,
          new THREE.Euler(0, Math.atan2(inward.x, inward.z), 0),
          new THREE.Vector3(inward.x * config.length * 0.15, -config.height * 2, inward.z * config.width * 0.15),
        )
        const mountingPlate = plate(runtime, mountPlatePart, config,
          new THREE.Vector3(x, -config.height - mountPlatePart.thickness / 2, z),
          new THREE.Euler(Math.PI / 2, 0, angle),
          new THREE.Vector3(xSign * config.length * 0.15, -config.height * 3, zSign * config.width * 0.15))
        squareTubeLeg(runtime, config, mountingPlate, cornerPlate.legTubeLength)
      }
    }
  }
  const positions = framePositions(config)
  const longRib = find('longRib')
  if (longRib) {
    for (const z of [...positions.long].reverse()) {
      plate(runtime, longRib, config, new THREE.Vector3(0, -config.height / 2, z), new THREE.Euler(), new THREE.Vector3(0, -config.height * 2, 0))
    }
  }
  const shortRib = find('shortRib')
  if (shortRib) {
    for (const x of positions.short) {
      plate(runtime, shortRib, config, new THREE.Vector3(x, -config.height / 2, 0), new THREE.Euler(0, -Math.PI / 2, 0), new THREE.Vector3(0, -config.height * 4, 0))
    }
  }
  rebuildDimensions(runtime, config)
}

const rebuildSheets = (runtime: AssemblyRuntime, config: Config, nesting: NestingResult) => {
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
    sheet.placements.forEach(placement => plate(runtime, placement.part, config,
      new THREE.Vector3(sheetX + placement.translation.x - halfX, config.thickness / 2, halfY - placement.translation.y),
      new THREE.Euler(-Math.PI / 2, 0, placement.rotation * Math.PI / 180), new THREE.Vector3()))
  })
}

const resetCamera = (runtime: AssemblyRuntime, config: Config) => {
  const extent = Math.max(config.length, config.width)
  runtime.camera.position.set(extent * 1.2, extent * 0.8, extent * 1.2)
  runtime.controls.target.set(0, 0, 0)
  runtime.controls.update()
}

const focusCornerMount = (runtime: AssemblyRuntime, config: Config) => {
  const spec = legCornerPlateSpec(config)
  if (!spec) return
  const inward = new THREE.Vector3(-1, 0, -1).normalize()
  const target = new THREE.Vector3(
    spec.centerX,
    -config.height / 2 + spec.jumperLength / 2,
    spec.centerZ,
  ).addScaledVector(inward, config.legProfileSize / Math.SQRT2 + spec.thickness / 2)
  const distance = Math.max(spec.size * 2.5, config.legProfileSize * 5, 300)
  runtime.camera.position.copy(target)
    .addScaledVector(inward, distance)
    .add(new THREE.Vector3(0, -Math.max(spec.size * 0.7, 90), 0))
  runtime.controls.target.copy(target)
  runtime.controls.update()
}

export function ThreeAssembly({ config, resetToken, mountFocusToken, dark, nesting }: Props) {
  const build = useCallback((runtime: AssemblyRuntime) => {
    if (nesting) rebuildSheets(runtime, config, nesting)
    else rebuildAssembly(runtime, config)
  }, [config, nesting])
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
  const focus = useCallback((runtime: AssemblyRuntime) => focusCornerMount(runtime, config), [config])
  const theme = useCallback((runtime: AssemblyRuntime) => {
    if (!nesting) rebuildDimensions(runtime, config)
  }, [config, nesting])

  return <AssemblyViewport
    dark={dark}
    resetToken={resetToken}
    build={build}
    resetCamera={reset}
    initialExtent={Math.max(config.length, config.width)}
    ariaLabel={nesting ? 'Interactive 3D sheet layout' : 'Interactive 3D welding table assembly'}
    errorMessage="3D rendering is unavailable in this browser. The 2D layout and exports are still available."
    hostClassName="three-canvas"
    errorClassName="three-loading"
    renderHoles={nesting ? true : config.renderHoles}
    highlighting={config.highlighting}
    cameraKey={nesting}
    focusToken={mountFocusToken}
    focusCamera={focus}
    onThemeChange={theme}
  />
}
