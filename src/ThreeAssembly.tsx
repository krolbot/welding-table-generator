import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { display, type Config } from './model'
import { makeParts } from './geometry'

type Props = { config: Config; resetToken: number; dark: boolean }

export function ThreeAssembly({ config, resetToken, dark }: Props) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = host.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(dark ? '#111827' : '#edf2f7')
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 20000)
    camera.position.set(3200, 2400, 3200)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    mount.append(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, -config.height / 2, 0)
    controls.enableDamping = true
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2d3748, 2.2))
    const light = new THREE.DirectionalLight(0xffffff, 2.5)
    light.position.set(800, 1400, 1000)
    scene.add(light)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshStandardMaterial({ color: dark ? '#1e293b' : '#cbd5e1', roughness: 1 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -config.height - 90
    scene.add(floor)

    const material = new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.7, roughness: 0.4 })
    const highlighted = new THREE.MeshStandardMaterial({ color: '#2563eb', metalness: 0.5, roughness: 0.3 })
    const holeMaterial = new THREE.MeshBasicMaterial({ color: dark ? '#020617' : '#0f172a' })
    const meshes: THREE.Mesh[] = []
    const addBox = (width: number, height: number, depth: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material)
      mesh.position.set(x, y, z)
      mesh.userData.base = material
      scene.add(mesh)
      meshes.push(mesh)
    }
    const addHole = (diameter: number, depth: number, position: THREE.Vector3, rotation: THREE.Euler) => {
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(diameter / 2, diameter / 2, depth + 2, 18), holeMaterial)
      hole.position.copy(position)
      hole.rotation.copy(rotation)
      scene.add(hole)
    }

    const gap = config.exploded / 100 * 240
    addBox(config.length, config.thickness, config.width, 0, 0, 0)
    addBox(config.length, config.height, config.thickness, 0, -config.height / 2 - gap, -config.width / 2 - gap)
    addBox(config.length, config.height, config.thickness, 0, -config.height / 2 - gap, config.width / 2 + gap)
    addBox(config.thickness, config.height, config.width, -config.length / 2 - gap, -config.height / 2, 0)
    addBox(config.thickness, config.height, config.width, config.length / 2 + gap, -config.height / 2, 0)
    if (config.ribs) {
      const count = Math.max(1, Math.floor((config.length - 2 * config.margin) / config.ribSpacing))
      const start = -((count - 1) * config.ribSpacing) / 2
      for (let index = 0; index < count; index += 1) {
        addBox(config.thickness, config.height - config.thickness, config.width - 2 * config.thickness, start + index * config.ribSpacing, -config.height / 2, 0)
      }
    }

    if (config.renderHoles) {
      const parts = makeParts(config)
      const sampled = <T,>(items: T[]) => {
        const stride = Math.ceil(items.length / 3000)
        return stride <= 1 ? items : items.filter((_, index) => index % stride === 0)
      }
      const top = parts.find(part => part.name === 'top')
      sampled(top?.holes ?? []).forEach(hole => addHole(hole.d, config.thickness, new THREE.Vector3(hole.x, 0, hole.y), new THREE.Euler()))

      const longSkirt = parts.find(part => part.name === 'longSkirt')
      for (const side of [-1, 1]) {
        sampled(longSkirt?.holes ?? []).forEach(hole => addHole(
          hole.d,
          config.thickness,
          new THREE.Vector3(hole.x, hole.y - config.height / 2 - gap, side * (config.width / 2 + gap)),
          new THREE.Euler(Math.PI / 2, 0, 0),
        ))
      }

      const shortSkirt = parts.find(part => part.name === 'shortSkirt')
      for (const side of [-1, 1]) {
        sampled(shortSkirt?.holes ?? []).forEach(hole => addHole(
          hole.d,
          config.thickness,
          new THREE.Vector3(side * (config.length / 2 + gap), hole.y - config.height / 2, hole.x),
          new THREE.Euler(0, 0, Math.PI / 2),
        ))
      }
    }

    if (config.showDimensions) {
      const dimensionMaterial = new THREE.LineBasicMaterial({ color: '#2563eb' })
      const dimension = (points: THREE.Vector3[]) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), dimensionMaterial))
      const dimensionLabel = (value: number, position: THREE.Vector3) => {
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 64
        const context = canvas.getContext('2d')
        if (!context) return
        context.font = '600 28px system-ui'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillStyle = '#2563eb'
        context.fillText(`${display(value, config.units, 0)} ${config.units === 'mm' ? 'mm' : 'in'}`, 128, 32)
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }))
        sprite.position.copy(position)
        sprite.scale.set(420, 105, 1)
        scene.add(sprite)
      }
      dimension([new THREE.Vector3(-config.length / 2, 35, -config.width / 2 - 110), new THREE.Vector3(config.length / 2, 35, -config.width / 2 - 110)])
      dimension([new THREE.Vector3(config.length / 2 + 110, 35, -config.width / 2), new THREE.Vector3(config.length / 2 + 110, 35, config.width / 2)])
      dimension([new THREE.Vector3(config.length / 2 + 110, 0, config.width / 2 + 80), new THREE.Vector3(config.length / 2 + 110, -config.height, config.width / 2 + 80)])
      dimensionLabel(config.length, new THREE.Vector3(0, 70, -config.width / 2 - 110))
      dimensionLabel(config.width, new THREE.Vector3(config.length / 2 + 110, 70, 0))
      dimensionLabel(config.height, new THREE.Vector3(config.length / 2 + 110, -config.height / 2, config.width / 2 + 80))
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const move = (event: PointerEvent) => {
      if (!config.highlighting) return
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(meshes)[0]?.object as THREE.Mesh | undefined
      meshes.forEach(mesh => { mesh.material = mesh.userData.base as THREE.Material })
      if (hit) hit.material = highlighted
    }
    renderer.domElement.addEventListener('pointermove', move)

    const resize = () => {
      const width = mount.clientWidth
      const height = mount.clientHeight
      renderer.setSize(width, height)
      camera.aspect = width / height
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
      controls.dispose()
      renderer.dispose()
      scene.clear()
      mount.replaceChildren()
    }
  }, [config, resetToken, dark])

  return <div className="three-canvas" ref={host} aria-label="Interactive 3D welding table assembly" />
}
