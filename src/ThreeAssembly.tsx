import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { display, type Config } from './model'
import { framePositions, legCornerPlateSpec, makeParts, partWeight, type Contour, type Part } from './geometry'

type Props = { config: Config; resetToken: number; mountFocusToken: number; dark: boolean }
type PartInfo = { part: Part['name']; isPart: true; name: string; dims: string; weight: string | number; weightUnit: string; holesCount: number; basePos: THREE.Vector3; explodeDir: THREE.Vector3; currentFactor: number }
type PartMesh = THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial> & { userData: PartInfo }
const colorsFor = (dark: boolean) => ({ part: dark ? 0x64748b : 0x9aa7b8, edge: dark ? 0x020617 : 0x1e293b, dim: dark ? 0x60a5fa : 0x1d4ed8 })
const partTitles: Record<Part['name'], string> = {
  top: 'Main Top Plate', longSkirt: 'Longitudinal Skirt', shortSkirt: 'Transverse Skirt',
  longRib: 'Longitudinal Support Rib', shortRib: 'Transverse Support Rib',
  legCornerPlate: 'Leg Corner Plate',
  legJumper: 'Leg Support Jumper',
}
type Runtime = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  assembly: THREE.Group
  dimensions: THREE.Group
  colors: ReturnType<typeof colorsFor>

  metal: THREE.MeshStandardMaterial
  highlighted: THREE.MeshStandardMaterial
  meshes: PartMesh[]
  renderHoles: boolean
  highlighting: boolean
  factor: number
  targetFactor: number
}

const contourPath = (contour: Contour, path: THREE.Path = new THREE.Path()) => {
  for (let index = 0; index < contour.length; index += 1) {
    const segment = contour[index]
    if (segment.type === 'line') {
      if (!index) path.moveTo(segment.from.x, segment.from.y)
      path.lineTo(segment.to.x, segment.to.y)
    } else {
      const start = segment.start * Math.PI / 180
      const end = segment.end * Math.PI / 180
      if (!index) path.moveTo(segment.center.x + segment.radius * Math.cos(start), segment.center.y + segment.radius * Math.sin(start))
      path.absarc(segment.center.x, segment.center.y, segment.radius, start, end, Boolean(segment.clockwise))
    }
  }
  path.closePath()
  return path
}

const shapeFor = (part: Part, holes: boolean) => {
  const shape = new THREE.Shape()
  contourPath(part.contours[0], shape)
  if (holes) for (const hole of part.holes) {
    const path = new THREE.Path()
    path.absarc(hole.x, hole.y, hole.d / 2, 0, Math.PI * 2, true)
    shape.holes.push(path)
  }
  part.contours.slice(1).forEach(contour => shape.holes.push(contourPath(contour)))
  return shape
}

const dispose = (object: THREE.Object3D) => {
  object.traverse(item => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line) item.geometry.dispose()
    if (item instanceof THREE.Sprite) { item.material.map?.dispose(); item.material.dispose() }
    if (item instanceof THREE.Line) {
      const materials = Array.isArray(item.material) ? item.material : [item.material]
      materials.forEach(material => material.dispose())
    }
  })
}

const edgesFor = (shape: THREE.Shape, depth: number) => {
  const vertices: number[] = []
  for (const path of [shape, ...shape.holes]) {
    const circle = path.curves.length === 1 && path.curves[0] instanceof THREE.EllipseCurve
    const points = path.getPoints(circle ? 8 : 3)
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1], to = points[index]
      if (from.distanceToSquared(to) < 1e-10) continue
      for (const z of [-depth / 2, depth / 2]) vertices.push(from.x, from.y, z, to.x, to.y, z)
    }
    const corners = circle ? path.getPoints(2) : path.curves.map(curve => curve.getPoint(0))
    const unique = new Map(corners.map(p => [`${p.x.toFixed(6)},${p.y.toFixed(6)}`, p]))
    unique.forEach(p => vertices.push(p.x, p.y, -depth / 2, p.x, p.y, depth / 2))
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
}

const plate = (
  runtime: Runtime,
  part: Part,
  config: Config,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  explodeDir: THREE.Vector3,
) => {
  const depth = part.thickness
  const shape = shapeFor(part, runtime.renderHoles)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: runtime.renderHoles ? 4 : 1,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  const width = part.width - (part.name === 'shortSkirt' || part.name.endsWith('Rib') ? 2 * config.thickness : 0)
  const height = part.height - (part.name === 'top' || (part.name.endsWith('Skirt') && config.legMounts && config.legMountStyle === 'cornerPlate') || part.name === 'legCornerPlate' || part.name === 'legJumper' ? 0 : config.thickness)
  const metricWeight = Number(partWeight(part, config).toFixed(1))
  const unit = config.units === 'mm' ? 'mm' : 'in'
  const mesh: PartMesh = Object.assign(new THREE.Mesh(geometry, runtime.metal), { userData: {
    part: part.name, isPart: true as const, name: partTitles[part.name], basePos: position, explodeDir, currentFactor: runtime.factor,
    dims: `${display(width, config.units, 0)} × ${display(height, config.units, 0)} ${unit}`,
    weight: config.units === 'mm' ? metricWeight : (metricWeight * 2.20462).toFixed(1),
    weightUnit: config.units === 'mm' ? 'kg' : 'lb', holesCount: part.holes.length,
  } })
  mesh.add(new THREE.LineSegments(edgesFor(shape, depth), new THREE.LineBasicMaterial({ color: runtime.colors.edge, linewidth: 2 })))
  mesh.position.copy(position).addScaledVector(explodeDir, runtime.factor)
  mesh.rotation.copy(rotation)


  runtime.assembly.add(mesh)
  runtime.meshes.push(mesh)
  return mesh
}

const squareTubeLeg = (runtime: Runtime, config: Config, x: number, z: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(config.legProfileSize, config.legLength, config.legProfileSize), runtime.metal)
  mesh.position.set(x, -config.height - config.legLength / 2, z)
  mesh.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color: runtime.colors.edge }),
  ))
  runtime.assembly.add(mesh)
}

const addDimensionLine = (runtime: Runtime, from: THREE.Vector3, to: THREE.Vector3, normal: THREE.Vector3) => {
  const group = runtime.dimensions
  const material = new THREE.LineBasicMaterial({ color: runtime.colors.dim, depthTest: false })
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material))
  ;[from, to].forEach(anchor => group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    anchor.clone().addScaledVector(normal, 20), anchor.clone().addScaledVector(normal, -20),
  ]), material)))
}

const label = (value: string, position: THREE.Vector3, color: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.font = 'bold 64px Inter, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  context.fillText(value, 256, 64)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.position.copy(position)
  sprite.scale.set(300, 75, 1)
  return sprite
}

const rebuildDimensions = (runtime: Runtime, config: Config) => {
  dispose(runtime.dimensions)
  runtime.dimensions.clear()
  if (!config.showDimensions) return
  const offset = Math.max(config.length, config.width) * 0.08
  const x = config.length / 2 + offset
  const z = config.width / 2 + offset
  const verticalNormal = new THREE.Vector3(Math.SQRT1_2, 0, -Math.SQRT1_2)
  addDimensionLine(runtime, new THREE.Vector3(-config.length / 2, 0, z), new THREE.Vector3(config.length / 2, 0, z), new THREE.Vector3(0, 0, 1))
  addDimensionLine(runtime, new THREE.Vector3(x, 0, config.width / 2), new THREE.Vector3(x, 0, -config.width / 2), new THREE.Vector3(1, 0, 0))
  addDimensionLine(runtime, new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -config.height, z), verticalNormal)
  const unit = config.units === 'mm' ? 'mm' : 'in'
  ;[
    label(`${display(config.length, config.units, 0)} ${unit}`, new THREE.Vector3(0, 0, z + 40), runtime.colors.dim),
    label(`${display(config.width, config.units, 0)} ${unit}`, new THREE.Vector3(x + 40, 0, 0), runtime.colors.dim),
    label(`${display(config.height, config.units, 0)} ${unit}`, new THREE.Vector3(x, -config.height / 2, z).addScaledVector(verticalNormal, 40), runtime.colors.dim),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

const rebuildAssembly = (runtime: Runtime, config: Config) => {
  dispose(runtime.assembly)
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
      plate(runtime, longSkirt, config, new THREE.Vector3(0, skirtY, side * (config.width / 2 - config.thickness / 2)), new THREE.Euler(), new THREE.Vector3(0, 0, side * config.width * 0.3))
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
  if (cornerPlate && cornerPlatePart && jumperPart) {
    const y = -config.height + cornerPlate.thickness / 2
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const x = xSign * cornerPlate.centerX
        const z = zSign * cornerPlate.centerZ
        const angle = xSign > 0
          ? zSign > 0 ? 0 : -Math.PI / 2
          : zSign > 0 ? Math.PI / 2 : Math.PI
        plate(runtime, cornerPlatePart, config, new THREE.Vector3(x, y, z), new THREE.Euler(Math.PI / 2, 0, angle), new THREE.Vector3(xSign * config.length * 0.15, 0, zSign * config.width * 0.15))
        const outward = new THREE.Vector3(xSign, 0, zSign).normalize()
        const jumperOffset = config.legProfileSize / Math.SQRT2 + jumperPart.thickness / 2
        const jumperPosition = new THREE.Vector3(x, -config.height + jumperPart.height / 2, z)
          .addScaledVector(outward, jumperOffset)
        plate(
          runtime,
          jumperPart,
          config,
          jumperPosition,
          new THREE.Euler(0, Math.atan2(outward.x, outward.z), 0),
          new THREE.Vector3(outward.x * config.length * 0.15, -config.height * 2, outward.z * config.width * 0.15),
        )
        squareTubeLeg(runtime, config, x, z)
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

const resetCamera = (runtime: Runtime, config: Config) => {
  const extent = Math.max(config.length, config.width)
  runtime.camera.position.set(extent * 1.2, extent * 0.8, extent * 1.2)
  runtime.controls.target.set(0, 0, 0)
  runtime.controls.update()
}

const focusCornerMount = (runtime: Runtime, config: Config) => {
  const spec = legCornerPlateSpec(config)
  if (!spec) return
  const outward = new THREE.Vector3(1, 0, 1).normalize()
  const target = new THREE.Vector3(
    spec.centerX,
    -config.height / 2 + spec.jumperLength / 2,
    spec.centerZ,
  ).addScaledVector(outward, config.legProfileSize / Math.SQRT2 + spec.thickness / 2)
  const distance = Math.max(spec.size * 2.5, config.legProfileSize * 5, 300)
  runtime.camera.position.copy(target)
    .addScaledVector(outward, -distance)
    .add(new THREE.Vector3(0, -Math.max(spec.size * 0.7, 90), 0))
  runtime.controls.target.copy(target)
  runtime.controls.update()
}

export function ThreeAssembly({ config, resetToken, mountFocusToken, dark }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<Runtime | undefined>(undefined)
  const [error, setError] = useState('')
  const [hover, setHover] = useState<{ info: PartInfo; x: number; y: number } | null>(null)

  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setError('3D rendering is unavailable in this browser. The 2D layout and exports are still available.'); return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

    mount.append(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 250
    controls.maxDistance = 18000
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const extent = Math.max(config.length, config.width)
    const light = new THREE.DirectionalLight(0xffffff, 0.8)
    light.position.set(extent, extent, extent / 2)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
    fill.position.set(-extent, 0, -extent)
    scene.add(light, fill)
    const assembly = new THREE.Group()
    const dimensions = new THREE.Group()
    scene.add(assembly, dimensions)
    const state: Runtime = {
      scene, camera, renderer, controls, assembly, dimensions,
      colors: colorsFor(dark),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
      highlighted: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, emissive: 0x2563eb, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
      meshes: [],
      renderHoles: config.renderHoles,
      highlighting: config.highlighting,
      factor: 0,
      targetFactor: 0,
    }
    runtime.current = state
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const move = (event: PointerEvent) => {
      const active = runtime.current
      if (!active || !active.highlighting) return
      const bounds = active.renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1)
      raycaster.setFromCamera(pointer, active.camera)
      const hit = raycaster.intersectObjects(active.meshes, false)[0]?.object
      active.meshes.forEach(mesh => { mesh.material = mesh === hit ? active.highlighted : active.metal })
      const selected = active.meshes.find(mesh => mesh === hit)
      setHover(selected ? { info: selected.userData, x: event.clientX - bounds.left, y: event.clientY - bounds.top } : null)
    }
    const leave = () => {
      state.meshes.forEach(mesh => { mesh.material = state.metal })
      setHover(null)
    }
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerleave', leave)
    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / Math.max(height, 1)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      state.factor += (state.targetFactor - state.factor) * 0.1
      state.meshes.forEach(mesh => {
        mesh.userData.currentFactor = state.factor
        mesh.position.copy(mesh.userData.basePos).addScaledVector(mesh.userData.explodeDir, state.factor)
      })
      controls.update()
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerleave', leave)
      dispose(assembly)
      dispose(dimensions)

      state.metal.dispose()
      state.highlighted.dispose()
      controls.dispose()
      renderer.dispose()
      mount.replaceChildren()
      runtime.current = undefined
    }
  // Three's context and OrbitControls are intentionally stable across configuration edits.
  }, [])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.renderHoles = config.renderHoles
    state.highlighting = config.highlighting
    setHover(null)

    rebuildAssembly(state, config)
  }, [config])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.scene.background = new THREE.Color(dark ? 0x0f172a : 0xe2e8f0)
    state.colors = colorsFor(dark)
    state.metal.color.setHex(state.colors.part)
    state.highlighted.color.setHex(state.colors.part)
    state.assembly.traverse((item: THREE.Object3D) => {
      if (item instanceof THREE.LineSegments) (item.material as THREE.LineBasicMaterial).color.setHex(state.colors.edge)
    })
    rebuildDimensions(state, config)
  }, [dark])

  useEffect(() => {
    const state = runtime.current
    if (state) resetCamera(state, config)
  // resetToken is the user-facing reset action; config edits preserve an orbit in progress.
  }, [resetToken])

  useEffect(() => {
    const state = runtime.current
    if (state && mountFocusToken > 0) focusCornerMount(state, config)
  // mountFocusToken is a deliberate camera action; later edits preserve the chosen detail orbit.
  }, [mountFocusToken])

  return error ? <div className="three-loading" role="alert">{error}</div> : <>
    <div className="three-canvas" ref={host} aria-label="Interactive 3D welding table assembly" />
    {hover && <div className="part-tooltip" style={{ left: Math.max(8, Math.min(hover.x + 15, (host.current?.clientWidth ?? 280) - 270)), top: Math.max(8, Math.min(hover.y + 15, (host.current?.clientHeight ?? 130) - 125)) }}>
      <strong>{hover.info.name}</strong><dl>
        <dt>Dimensions:</dt><dd>{hover.info.dims}</dd>
        <dt>Weight:</dt><dd>{hover.info.weight} {hover.info.weightUnit}</dd>
        <dt>Holes:</dt><dd>{hover.info.holesCount} pcs</dd>
      </dl>
    </div>}
  </>
}
