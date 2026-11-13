import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { assemblyColors, disposeObject3D, fitCameraToBounds, type AssemblyColors } from './assemblyGeometry'

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
  cameraKey?: unknown
  focusToken?: number
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
  cameraKey,
  focusToken = 0,
  focusCamera,
  onThemeChange,
  up = [0, 1, 0],
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const runtime = useRef<AssemblyRuntime | undefined>(undefined)
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
    controls.minDistance = 250
    controls.maxDistance = 18000
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const light = new THREE.DirectionalLight(0xffffff, 0.8)
    light.position.set(initialExtent, initialExtent, initialExtent / 2)
    const fill = new THREE.DirectionalLight(0xffffff, 0.3)
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
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
      highlighted: new THREE.MeshStandardMaterial({ color: 0x9aa7b8, emissive: 0x2563eb, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
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
      fit(state, true)
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
    fit(state)
  }, [build, renderHoles, highlighting])

  useEffect(() => {
    const state = runtime.current
    if (!state) return
    state.scene.background = new THREE.Color(dark ? 0x0f172a : 0xe2e8f0)
    state.colors = assemblyColors(dark)
    state.metal.color.setHex(state.colors.part)
    state.highlighted.color.setHex(state.colors.part)
    state.assembly.traverse(item => {
      if (item instanceof THREE.LineSegments) item.material.color.setHex(state.colors.edge)
    })
    latest.current.onThemeChange?.(state)
  }, [dark])

  useEffect(() => {
    const state = runtime.current
    if (state) { latest.current.resetCamera(state); fit(state, true) }
  // resetToken is the user-facing reset action; cameraKey identifies a different view mode.
  }, [resetToken, cameraKey])

  useEffect(() => {
    const state = runtime.current
    if (state && focusToken > 0) latest.current.focusCamera?.(state)
  // focusToken represents a deliberate camera action; later model edits preserve the orbit.
  }, [focusToken])

  return error ? <div className={errorClassName} role="alert">{error}</div> : <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    <div className={hostClassName} ref={host} aria-label={ariaLabel} />
    {hover && <div className="part-tooltip" style={{ left: Math.max(8, Math.min(hover.x + 15, (host.current?.clientWidth ?? 280) - 270)), top: Math.max(8, Math.min(hover.y + 15, (host.current?.clientHeight ?? 130) - 125)) }}>
      <strong>{hover.info.name}</strong><dl>
        <dt>Dimensions:</dt><dd>{hover.info.dims}</dd>
        {hover.info.weight !== undefined && <><dt>Weight:</dt><dd>{hover.info.weight} {hover.info.weightUnit}</dd></>}
        <dt>Holes:</dt><dd>{hover.info.holesCount} pcs</dd>
      </dl>
    </div>}
  </div>
}
