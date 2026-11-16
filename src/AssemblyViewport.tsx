import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Icon } from './Icon'
import { PanControls, ZoomControls } from './ViewportControls'
import { assemblyColors, disposeObject3D, fitCameraToBounds, type AssemblyColors } from './assemblyGeometry'

const cameraPresets = ['iso', 'top', 'front', 'right'] as const
type CameraPreset = typeof cameraPresets[number]
const dimensionSpriteHeight = 28

export type AssemblyPartInfo = {
  part: string
  isPart: true
  name: string
  dims: string
  weight?: string | number
  weightUnit?: string
  holesCount: number
  basePos: THREE.Vector3
  explodeDir: THREE.Vector3
  currentFactor: number
}

export type AssemblyPartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> & { userData: AssemblyPartInfo }

export type AssemblyRuntime = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  controls: OrbitControls
  assembly: THREE.Group
  dimensions: THREE.Group
  colors: AssemblyColors
  metal: THREE.MeshStandardMaterial
  highlighted: THREE.MeshStandardMaterial
  meshes: AssemblyPartMesh[]
  renderHoles: boolean
  highlighting: boolean
  factor: number
  targetFactor: number
}

type Props = {
  dark: boolean
  resetToken: number
  build: (runtime: AssemblyRuntime) => void
  resetCamera: (runtime: AssemblyRuntime) => void
  initialExtent: number
  ariaLabel: string
  errorMessage: string
  hostClassName: string
  errorClassName: string
  renderHoles?: boolean
  highlighting?: boolean
  exploded?: number
  cameraKey?: string
  focusCamera?: (runtime: AssemblyRuntime) => void
  onThemeChange?: (runtime: AssemblyRuntime) => void
  up?: readonly [number, number, number]
}

export function AssemblyViewport({
  dark,
  resetToken,
  build,
  resetCamera,
  initialExtent,
  ariaLabel,
  errorMessage,
  hostClassName,
  errorClassName,
  renderHoles = true,
  highlighting = true,
  exploded = 0,
  cameraKey,
  focusCamera,
  onThemeChange,
  up = [0, 1, 0],
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<AssemblyRuntime | undefined>(undefined)
  const built = useRef(false)
  const latest = useRef({ resetCamera, focusCamera, onThemeChange })
  latest.current = { resetCamera, focusCamera, onThemeChange }
  const fittedBounds = useRef<THREE.Box3 | undefined>(undefined)
  const fit = (state: AssemblyRuntime, force = false) => {
    if (!state.meshes.length || !state.camera.position.distanceToSquared(state.controls.target)) return
    const positions = state.meshes.map(mesh => mesh.position.clone())
    state.meshes.forEach(mesh => mesh.position.copy(mesh.userData.basePos).addScaledVector(mesh.userData.explodeDir, state.targetFactor))
    const bounds = new THREE.Box3().setFromObject(state.assembly).expandByObject(state.dimensions)
    // Sprites face the camera, so a world-axis-aligned quad underestimates label bounds.
    state.dimensions.traverse(item => {
      if (!(item instanceof THREE.Sprite)) return
      const position = item.getWorldPosition(new THREE.Vector3())
      const radius = Math.hypot(item.scale.x, item.scale.y) / 2
      bounds.expandByPoint(position.clone().addScalar(radius)).expandByPoint(position.clone().subScalar(radius))
    })
    state.meshes.forEach((mesh, index) => mesh.position.copy(positions[index]))
    state.assembly.updateMatrixWorld(true)
    if (!force && fittedBounds.current?.equals(bounds)) return
    state.controls.target.copy(fitCameraToBounds(state.camera, state.controls.target, bounds))
    state.controls.update()
    fittedBounds.current = bounds
  }
  const [preset, setPreset] = useState<CameraPreset | 'custom'>('iso')
  const moveView = (x: number, y: number) => runtime.current?.controls.pan(x, y)
  const zoomView = (factor: number) => runtime.current?.controls.dollyIn(1 / factor)
  const fitView = () => { const state = runtime.current; if (state) fit(state, true) }
  const orient = (view: CameraPreset) => {
    const state = runtime.current
    if (!state) return
    const damping = state.controls.enableDamping
    state.controls.enableDamping = false
    state.controls.update()
    if (view === 'iso') latest.current.resetCamera(state)
    else {
      const zUp = up[2] === 1
      const direction = view === 'top' ? new THREE.Vector3(...up)
        : view === 'right' ? new THREE.Vector3(1, 0, 0) : zUp ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1)
      state.camera.position.copy(state.controls.target).addScaledVector(direction, Math.max(1, state.camera.position.distanceTo(state.controls.target)))
      state.controls.update()
    }
    fit(state, true)
    state.controls.enableDamping = damping
    setPreset(view)
  }

  const [error, setError] = useState('')
  const [hover, setHover] = useState<{ info: AssemblyPartInfo; x: number; y: number } | null>(null)

  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    camera.up.set(...up)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setError(errorMessage); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    mount.append(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = Math.max(1, initialExtent * 0.02)
    controls.maxDistance = Math.max(18000, initialExtent * 30)
    controls.zoomToCursor = true
    controls.screenSpacePanning = true
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
    controls.touches.ONE = THREE.TOUCH.ROTATE
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
    renderer.domElement.tabIndex = 0
    renderer.domElement.setAttribute('aria-label', ariaLabel)
    const focus = () => { renderer.domElement.focus({ preventScroll: true }); setHover(null) }
    const key = (event: KeyboardEvent) => {
      const value = event.key.toLowerCase()
      if (value === ' ' && !event.repeat) { event.preventDefault(); controls.mouseButtons.LEFT = THREE.MOUSE.PAN }
      else if (value === 'f' || value === 'home') { event.preventDefault(); fit(state, true) }
      else if (value === '+' || value === '=') { event.preventDefault(); controls.dollyIn(1 / 1.25) }
      else if (value === '-') { event.preventDefault(); controls.dollyIn(1.25) }
      else if (value.startsWith('arrow')) {
        event.preventDefault()
        if (event.shiftKey) {
          if (value === 'arrowleft' || value === 'arrowright') controls.rotateLeft(value === 'arrowleft' ? 0.12 : -0.12)
          else controls.rotateUp(value === 'arrowup' ? 0.12 : -0.12)
        } else controls.pan(value === 'arrowleft' ? -48 : value === 'arrowright' ? 48 : 0, value === 'arrowup' ? -48 : value === 'arrowdown' ? 48 : 0)
      }
    }
    const releaseSpace = () => { controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE }
    const keyUp = (event: KeyboardEvent) => { if (event.key === ' ') releaseSpace() }
    renderer.domElement.addEventListener('pointerdown', focus)
    renderer.domElement.addEventListener('keydown', key)
    renderer.domElement.addEventListener('keyup', keyUp)
    renderer.domElement.addEventListener('blur', releaseSpace)
    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const light = new THREE.DirectionalLight(0xffffff, 1.7)
    light.position.set(initialExtent, initialExtent, initialExtent / 2)
    const fill = new THREE.DirectionalLight(0xffffff, 0.6)
    fill.position.set(-initialExtent, 0, -initialExtent)
    scene.add(light, fill)
    const assembly = new THREE.Group()
    const dimensions = new THREE.Group()
    scene.add(assembly, dimensions)
    const state: AssemblyRuntime = {
      scene,
      camera,
      renderer,
      controls,
      assembly,
      dimensions,
      colors: assemblyColors(dark),
      metal: new THREE.MeshStandardMaterial({ color: assemblyColors(dark).part, metalness: 0.25, roughness: 0.65, side: THREE.DoubleSide }),
      highlighted: new THREE.MeshStandardMaterial({ color: assemblyColors(dark).part, emissive: 0x123675, metalness: 0.25, roughness: 0.65, side: THREE.DoubleSide }),
      meshes: [],
      renderHoles,
      highlighting,
      factor: 0,
      targetFactor: 0,
    }
    runtime.current = state
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const move = (event: PointerEvent) => {
      const active = runtime.current
      if (!active || !active.highlighting || event.buttons || event.pointerType === 'touch') { setHover(null); return }
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
    controls.addEventListener('start', leave)
    let orientation = camera.quaternion.clone()
    const changed = () => {
      if (orientation.angleTo(camera.quaternion) > 1e-6) setPreset('custom')
      orientation = camera.quaternion.clone()
    }
    controls.addEventListener('change', changed)
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
      const labelHeight = dimensionSpriteHeight * 2 / (Math.max(1, mount.clientHeight) * camera.projectionMatrix.elements[5])
      dimensions.traverse(item => {
        if (item instanceof THREE.Sprite) item.scale.set(labelHeight * item.scale.x / item.scale.y, labelHeight, 1)
      })
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', focus)
      renderer.domElement.removeEventListener('keydown', key)
      renderer.domElement.removeEventListener('keyup', keyUp)
      renderer.domElement.removeEventListener('blur', releaseSpace)
      controls.removeEventListener('start', leave)
      controls.removeEventListener('change', changed)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerleave', leave)
      disposeObject3D(assembly)
      disposeObject3D(dimensions)
      state.metal.dispose()
      state.highlighted.dispose()
      controls.dispose()
      renderer.dispose()
      mount.replaceChildren()
      runtime.current = undefined
    }
  // Three's context and OrbitControls are intentionally stable across model edits.
  }, [])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.renderHoles = renderHoles
    state.highlighting = highlighting
    setHover(null)
    build(state)
    if (!built.current) { fit(state, true); built.current = true }
  }, [build, renderHoles])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.highlighting = highlighting
    if (!highlighting) state.meshes.forEach(mesh => { mesh.material = state.metal })
    setHover(null)
  }, [highlighting])

  useEffect(() => {
    const state = runtime.current
    if (state) state.targetFactor = Math.max(0, Math.min(100, exploded)) / 100
  }, [exploded])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.colors = assemblyColors(dark)
    state.scene.background = new THREE.Color(state.colors.background)
    state.metal.color.setHex(state.colors.part)
    state.highlighted.color.setHex(state.colors.part)
    state.assembly.traverse(item => {
      if (item instanceof THREE.LineSegments) item.material.color.setHex(state.colors.edge)
    })
    latest.current.onThemeChange?.(state)
  }, [dark])

  useEffect(() => {
    const state = runtime.current
    if (state) { latest.current.resetCamera(state); fit(state, true); setPreset('iso') }
  // resetToken is the user-facing reset action; cameraKey identifies a different view mode.
  }, [resetToken, cameraKey])

  return error ? <div className={errorClassName} role="alert">{error}</div> : <div className="assembly-viewport">
    <div className="viewport-toolbar" aria-label="Навигация в 3D">
      <details className="viewport-help"><summary aria-label="Справка по управлению 3D"><Icon name="info" /></summary><div>Перетаскивайте модель левой кнопкой для вращения. Правая или средняя кнопка мыши либо пробел с перетаскиванием перемещают вид. Колесо меняет масштаб относительно указателя. Два пальца перемещают и масштабируют модель. Стрелки перемещают вид, Shift со стрелками вращает модель, F вписывает модель.</div></details>
    </div>
    <div className="camera-presets" aria-label="Направление камеры">
      <select className="camera-preset-select" aria-label="Направление камеры" value={preset} onChange={event => { const view = cameraPresets.find(value => value === event.target.value); if (view) orient(view) }}><option value="custom" disabled>Пользовательский вид</option>{cameraPresets.map(view => <option key={view} value={view}>{view === 'iso' ? 'Изометрия' : view === 'top' ? 'Сверху' : view === 'front' ? 'Спереди' : 'Справа'}</option>)}</select>
      {cameraPresets.map(view => <button key={view} aria-pressed={preset === view} onClick={() => orient(view)}>{view === 'iso' ? 'ИЗО' : view === 'top' ? 'Сверху' : view === 'front' ? 'Спереди' : 'Справа'}</button>)}{focusCamera && <button className="mount-detail" onClick={() => { if (runtime.current) latest.current.focusCamera?.(runtime.current) }}>Крепление</button>}
    </div>
    <div className="assembly-surface">
    <div className={hostClassName} ref={host} aria-label={ariaLabel} />
    {hover && <div className="part-tooltip" style={{ left: Math.max(8, Math.min(hover.x + 15, (host.current?.clientWidth ?? 280) - 270)), top: Math.max(8, Math.min(hover.y + 15, (host.current?.clientHeight ?? 130) - 125)) }}>
      <strong>{hover.info.name}</strong><dl>
        <dt>Размеры:</dt><dd>{hover.info.dims}</dd>
        {hover.info.weight !== undefined && <><dt>Масса:</dt><dd>{hover.info.weight} {hover.info.weightUnit}</dd></>}
        <dt>Отверстия:</dt><dd>{hover.info.holesCount} шт.</dd>
      </dl>
    </div>}
    </div>
    <div className="viewport-status"><PanControls onPan={moveView} /><span>Левая кнопка — вращение · правая — перемещение · колесо — масштаб</span><ZoomControls onZoom={zoomView} onFit={fitView} /></div>
  </div>
}
