import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { display, type Config } from './model'
import { framePositions, makeParts, type Contour, type Part } from './geometry'

type Props = { config: Config; resetToken: number; dark: boolean }
type Runtime = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  assembly: THREE.Group
  dimensions: THREE.Group

  metal: [THREE.MeshLambertMaterial, THREE.MeshBasicMaterial]
  highlighted: THREE.MeshLambertMaterial
  meshes: THREE.Mesh[]
  renderHoles: boolean
  highlighting: boolean
}

const contourPath = (contour: Contour, reflect: boolean) => {
  const path = new THREE.Path()
  const y = (value: number) => reflect ? -value : value
  for (let index = 0; index < contour.length; index += 1) {
    const segment = contour[index]
    if (segment.type === 'line') {
      if (!index) path.moveTo(segment.from.x, y(segment.from.y))
      path.lineTo(segment.to.x, y(segment.to.y))
    } else {
      const factor = reflect ? -1 : 1
      const start = segment.start * Math.PI / 180 * factor
      const end = segment.end * Math.PI / 180 * factor
      if (!index) path.moveTo(segment.center.x + segment.radius * Math.cos(start), y(segment.center.y) + segment.radius * Math.sin(start))
      path.absarc(segment.center.x, y(segment.center.y), segment.radius, start, end, reflect ? !segment.clockwise : Boolean(segment.clockwise))
    }
  }
  path.closePath()
  return path
}

const shapeFor = (part: Part, config: Config, holes: boolean, reflect = false) => {
  // The reference assembly uses smooth plate bodies; joint contours belong to the fabrication layout.
  const width = part.width - (part.name === 'shortSkirt' || part.name.endsWith('Rib') ? 2 * config.thickness : 0)
  const height = part.height - (part.name === 'top' ? 0 : config.thickness)
  const shape = new THREE.Shape([
    new THREE.Vector2(-width / 2, -height / 2), new THREE.Vector2(width / 2, -height / 2),
    new THREE.Vector2(width / 2, height / 2), new THREE.Vector2(-width / 2, height / 2),
  ])
  if (config.liftingHoles && part.name === 'longSkirt') shape.holes.push(contourPath(part.contours.at(-1)!, reflect))
  if (holes) for (const hole of part.holes) {
    if (Math.abs(hole.x) + hole.d / 2 > width / 2 || Math.abs(hole.y) + hole.d / 2 > height / 2) continue
    const path = new THREE.Path()
    path.absarc(hole.x, reflect ? -hole.y : hole.y, hole.d / 2, 0, Math.PI * 2, true)
    shape.holes.push(path)
  }
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

const plate = (
  runtime: Runtime,
  part: Part,
  config: Config,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  top = false,
) => {
  const depth = config.thickness
  const geometry = new THREE.ExtrudeGeometry(shapeFor(part, config, runtime.renderHoles, top), {
    depth,
    bevelEnabled: false,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, runtime.metal)
  mesh.position.copy(position)
  mesh.rotation.copy(rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true

  runtime.assembly.add(mesh)
  runtime.meshes.push(mesh)
  return mesh
}

const addDimensionLine = (group: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, offset: THREE.Vector3) => {
  const material = new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.9 })
  const start = from.clone().add(offset)
  const end = to.clone().add(offset)
  const direction = end.clone().sub(start).normalize()
  const normal = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(26)
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end])
  group.add(new THREE.Line(geometry, material))
  ;[start, end].forEach(anchor => {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      anchor.clone().sub(normal), anchor.clone().add(normal),
    ]), material))
  })
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, start]), material))
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([to, end]), material))
  return start.clone().add(end).multiplyScalar(0.5)
}

const label = (value: string, position: THREE.Vector3) => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.font = '600 28px system-ui'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#2563eb'
  context.fillText(value, 128, 32)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }))
  sprite.position.copy(position)
  sprite.scale.set(360, 90, 1)
  return sprite
}

const rebuildDimensions = (runtime: Runtime, config: Config) => {
  dispose(runtime.dimensions)
  runtime.dimensions.clear()
  if (!config.showDimensions) return
  const y = 26
  const length = addDimensionLine(
    runtime.dimensions,
    new THREE.Vector3(-config.length / 2, y, config.width / 2),
    new THREE.Vector3(config.length / 2, y, config.width / 2),
    new THREE.Vector3(0, 0, 110),
  )
  const width = addDimensionLine(
    runtime.dimensions,
    new THREE.Vector3(config.length / 2, y, -config.width / 2),
    new THREE.Vector3(config.length / 2, y, config.width / 2),
    new THREE.Vector3(110, 0, 0),
  )
  const verticalMaterial = new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.9 })
  const verticalX = config.length / 2 + 110
  const verticalZ = config.width / 2 + 80
  const vertical = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(verticalX, 0, verticalZ), new THREE.Vector3(verticalX, -config.height, verticalZ),
  ])
  runtime.dimensions.add(new THREE.Line(vertical, verticalMaterial))
  const cap = new THREE.Vector3(24, 0, 0)
  ;[0, -config.height].forEach(yValue => runtime.dimensions.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(verticalX, yValue, verticalZ).sub(cap), new THREE.Vector3(verticalX, yValue, verticalZ).add(cap),
    ]), verticalMaterial,
  )))
  const unit = config.units === 'mm' ? 'mm' : 'in'
  ;[
    label(`${display(config.length, config.units, 0)} ${unit}`, length.add(new THREE.Vector3(0, 32, 0))),
    label(`${display(config.width, config.units, 0)} ${unit}`, width.add(new THREE.Vector3(0, 32, 0))),
    label(`${display(config.height, config.units, 0)} ${unit}`, new THREE.Vector3(verticalX + 50, -config.height / 2, verticalZ)),
  ].forEach(sprite => { if (sprite) runtime.dimensions.add(sprite) })
}

const rebuildAssembly = (runtime: Runtime, config: Config) => {
  dispose(runtime.assembly)
  runtime.assembly.clear()
  runtime.meshes = []
  const parts = makeParts(config)
  const find = (name: Part['name']) => parts.find(part => part.name === name)
  const separation = config.exploded / 100 * Math.max(config.length, config.width)

  const top = find('top')
  if (top) {
    plate(runtime, top, config, new THREE.Vector3(0, -config.thickness / 2 + separation * 0.08, 0), new THREE.Euler(-Math.PI / 2, 0, 0), true)
  }
  const longSkirt = find('longSkirt')
  if (longSkirt) {
    for (const side of [-1, 1]) {
      plate(runtime, longSkirt, config, new THREE.Vector3(0, -config.height / 2 - config.thickness / 2, side * (config.width / 2 - config.thickness / 2 + config.width * config.exploded / 100 * 0.12)), new THREE.Euler())
    }
  }
  const shortSkirt = find('shortSkirt')
  if (shortSkirt) {
    for (const side of [-1, 1]) {
      plate(runtime, shortSkirt, config, new THREE.Vector3(side * (config.length / 2 - config.thickness / 2 + config.length * config.exploded / 100 * 0.12), -config.height / 2 - config.thickness / 2, 0), new THREE.Euler(0, Math.PI / 2, 0))
    }
  }
  const positions = framePositions(config)
  const longRib = find('longRib')
  if (longRib) {
    for (const z of positions.long) {
      plate(runtime, longRib, config, new THREE.Vector3(0, -config.height / 2 - separation * 0.08, z), new THREE.Euler())
    }
  }
  const shortRib = find('shortRib')
  if (shortRib) {
    for (const x of positions.short) {
      plate(runtime, shortRib, config, new THREE.Vector3(x, -config.height / 2 - separation * 0.08, 0), new THREE.Euler(0, Math.PI / 2, 0))
    }
  }
  rebuildDimensions(runtime, config)
}

const resetCamera = (runtime: Runtime, config: Config) => {
  const extent = Math.max(config.length, config.width, config.height * 2)
  runtime.camera.position.set(extent * 1.2, extent * 0.75, extent * 1.2)
  runtime.controls.target.set(0, -config.height / 2, 0)
  runtime.controls.update()
}

export function ThreeAssembly({ config, resetToken, dark }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<Runtime | undefined>(undefined)
  const [error, setError] = useState('')

  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 30000)
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
    scene.add(new THREE.AmbientLight(0xffffff, 3))
    const light = new THREE.DirectionalLight(0xffffff, 4)
    light.position.set(2400, 2400, 1200)
    scene.add(light)
    const assembly = new THREE.Group()
    const dimensions = new THREE.Group()
    scene.add(assembly, dimensions)
    const state: Runtime = {
      scene, camera, renderer, controls, assembly, dimensions,
      metal: [new THREE.MeshLambertMaterial({ color: 0x2d3239 }), new THREE.MeshBasicMaterial({ color: 0x1e293b })],
      highlighted: new THREE.MeshLambertMaterial({ color: 0x3b82f6 }),
      meshes: [],
      renderHoles: config.renderHoles,
      highlighting: config.highlighting,
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
    }
    const leave = () => state.meshes.forEach(mesh => { mesh.material = state.metal })
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

      state.metal.forEach(material => material.dispose())
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

    rebuildAssembly(state, config)
  }, [config])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.scene.background = new THREE.Color(dark ? 0x0f172a : 0xe2e8f0)
  }, [dark])

  useEffect(() => {
    const state = runtime.current
    if (state) resetCamera(state, config)
  // resetToken is the user-facing reset action; config edits preserve an orbit in progress.
  }, [resetToken])

  return error ? <div className="three-loading" role="alert">{error}</div> : <div className="three-canvas" ref={host} aria-label="Interactive 3D welding table assembly" />
}
