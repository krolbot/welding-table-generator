import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FabricationPart } from '../geometry'
import { extensionAssembly } from './extension'
import { projectParts, type ToolProject } from './project'

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

export function ExtensionAssembly3d({ project, dark }: { project: ToolProject; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch { return }
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 1, 10000)
    scene.background = new THREE.Color(dark ? 0x111827 : 0xe5e7eb)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2), new THREE.DirectionalLight(0xffffff, 2))
    const light = scene.children.at(-1) as THREE.DirectionalLight; light.position.set(500, 600, 800)
    const group = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: dark ? 0x94a3b8 : 0x64748b, metalness: .7, roughness: .35, side: THREE.DoubleSide })
    const parts = new Map(projectParts(project).map(part => [part.name, part]))
    extensionAssembly(project.size).forEach(placement => {
      const part = parts.get(placement.part)
      if (!part) return
      const geometry = new THREE.ExtrudeGeometry(shapeFor(part), { depth: part.thickness, bevelEnabled: false, curveSegments: 24 })
      geometry.translate(0, 0, -part.thickness / 2)
      const mesh = new THREE.Mesh(geometry, material)
      const matrix = new THREE.Matrix4().set(
        placement.axes[0][0], placement.axes[1][0], placement.axes[2][0], placement.origin[0],
        placement.axes[0][1], placement.axes[1][1], placement.axes[2][1], placement.origin[1],
        placement.axes[0][2], placement.axes[1][2], placement.axes[2][2], placement.origin[2], 0, 0, 0, 1,
      )
      mesh.applyMatrix4(matrix); group.add(mesh)
    })
    scene.add(group); mount.append(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    const extent = Math.max(project.size.length, project.size.width, project.size.height)
    camera.position.set(extent * 1.15, extent * .9, extent * 1.15); controls.target.set(project.size.length / 2, project.size.width / 2, project.size.height / 2); controls.update()
    const resize = () => { renderer.setSize(mount.clientWidth, mount.clientHeight); camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight); camera.updateProjectionMatrix() }
    const observer = new ResizeObserver(resize); observer.observe(mount); resize()
    let frame = 0; const draw = () => { frame = requestAnimationFrame(draw); controls.update(); renderer.render(scene, camera) }; draw()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); group.traverse(item => { if (item instanceof THREE.Mesh) item.geometry.dispose() }); material.dispose(); renderer.dispose(); mount.replaceChildren() }
  }, [project, dark])
  return <div className="tools-three" ref={host} aria-label="Interactive 3D extension assembly" />
}
