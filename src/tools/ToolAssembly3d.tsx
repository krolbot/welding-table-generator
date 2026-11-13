import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FabricationPart } from '../geometry'
import { extensionAssembly, extensionParts, type ExtensionConfig } from './extension'
import type { ToolProject } from './project'

const shapeFor = (part: FabricationPart) => {
  const shape = new THREE.Shape()
  const add = (contour: FabricationPart['contours'][number], path: THREE.Path) => {
    contour.forEach((segment, index) => {
      if (segment.type === 'line') { if (!index) path.moveTo(segment.from.x, segment.from.y); path.lineTo(segment.to.x, segment.to.y) }
      else { const start = segment.start * Math.PI / 180; if (!index) path.moveTo(segment.center.x + segment.radius * Math.cos(start), segment.center.y + segment.radius * Math.sin(start)); path.absarc(segment.center.x, segment.center.y, segment.radius, start, segment.end * Math.PI / 180, Boolean(segment.clockwise)) }
    })
    path.closePath()
  }
  add(part.contours[0], shape)
  part.contours.slice(1).forEach(contour => { const hole = new THREE.Path(); add(contour, hole); shape.holes.push(hole) })
  part.holes.forEach(hole => { const path = new THREE.Path(); path.absarc(hole.x, hole.y, hole.d / 2, 0, Math.PI * 2, true); shape.holes.push(path) })
  return shape
}

export const extensionGroup = (config: ExtensionConfig, material: THREE.Material) => {
  const group = new THREE.Group(), parts = new Map(extensionParts(config).map(part => [part.name, part]))
  for (const placement of extensionAssembly(config)) {
    const part = parts.get(placement.part)!
    const geometry = new THREE.ExtrudeGeometry(shapeFor(part), { depth: part.thickness, bevelEnabled: false, curveSegments: 32 })
    geometry.translate(0, 0, -part.thickness / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `${part.name}:${placement.instance}`
    mesh.applyMatrix4(new THREE.Matrix4().set(
      placement.axes[0][0], placement.axes[1][0], placement.axes[2][0], placement.origin[0],
      placement.axes[0][1], placement.axes[1][1], placement.axes[2][1], placement.origin[1],
      placement.axes[0][2], placement.axes[1][2], placement.axes[2][2], placement.origin[2], 0, 0, 0, 1,
    ))
    group.add(mesh)
  }
  return group
}

export function ExtensionAssembly3d({ project, dark }: { project: ToolProject; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const { length, width, height, thickness } = project.size
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setError('WebGL is unavailable. The 2D profiles and DXF remain available.'); return }
    setError('')
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10000)
    camera.up.set(0, 0, 1)
    scene.background = new THREE.Color(dark ? 0x111827 : 0xe5e7eb)
    const ambient = new THREE.HemisphereLight(0xffffff, 0x64748b, 2)
    ambient.position.set(0, 0, 1)
    const light = new THREE.DirectionalLight(0xffffff, 3)
    light.position.set(-500, -600, 800)
    scene.add(ambient, light)
    const material = new THREE.MeshStandardMaterial({ color: dark ? 0x94a3b8 : 0xa3aab2, metalness: .25, roughness: .6, side: THREE.DoubleSide })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: dark ? 0x334155 : 0x555e6b })
    const group = extensionGroup({ length, width, height, thickness }, material)
    for (const item of group.children) if (item instanceof THREE.Mesh) item.add(new THREE.LineSegments(new THREE.EdgesGeometry(item.geometry, 30), edgeMaterial))
    scene.add(group)
    mount.append(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    const extent = Math.max(length, width, height)
    controls.target.set(length / 2, width / 2, height * .6)
    camera.position.copy(controls.target).add(new THREE.Vector3(-extent * .85, -extent * 1.1, extent * .8))
    controls.update()
    const resize = () => {
      const aspect = mount.clientWidth / Math.max(1, mount.clientHeight), half = extent * .62
      camera.left = -half * Math.max(1, aspect)
      camera.right = -camera.left
      camera.top = half / Math.min(1, aspect)
      camera.bottom = -camera.top
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    let frame = 0
    const draw = () => { frame = requestAnimationFrame(draw); controls.update(); renderer.render(scene, camera) }
    draw()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      group.traverse(item => { if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) item.geometry.dispose() })
      material.dispose()
      edgeMaterial.dispose()
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [length, width, height, thickness, dark])
  return <><div className="tools-three" ref={host} aria-label="Interactive 3D extension assembly" />{error && <p role="alert">{error}</p>}</>
}
