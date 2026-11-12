import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Contour } from '../geometry.js'
import type { AssemblyTransform, ToolingAssembly } from './model.js'
import { applyDirection } from './primitives.js'

// The canonical contract uses fixed-axis X → Y → Z, not Three's intrinsic XYZ.
export const assemblyRotationMatrix = (placement: AssemblyTransform) => {
  const vector = (x: number, y: number, z: number) => {
    const v = applyDirection({ x, y, z }, placement)
    return new THREE.Vector3(v.x, v.y, v.z)
  }
  return new THREE.Matrix4().makeBasis(vector(1, 0, 0), vector(0, 1, 0), vector(0, 0, 1))
}

const contourPath = (contour: Contour, path: THREE.Path = new THREE.Path()) => {
  contour.forEach((segment, index) => {
    if (segment.type === 'line') {
      if (!index) path.moveTo(segment.from.x, segment.from.y)
      path.lineTo(segment.to.x, segment.to.y)
    } else {
      const start = segment.start * Math.PI / 180
      const end = segment.end * Math.PI / 180
      if (!index) path.moveTo(segment.center.x + segment.radius * Math.cos(start), segment.center.y + segment.radius * Math.sin(start))
      path.absarc(segment.center.x, segment.center.y, segment.radius, start, end, Boolean(segment.clockwise))
    }
  })
  path.closePath()
  return path
}

const shapeFor = (part: ToolingAssembly['parts'][number]) => {
  const shape = contourPath(part.contours[0], new THREE.Shape()) as THREE.Shape
  part.contours.slice(1).forEach(contour => shape.holes.push(contourPath(contour)))
  part.holes.forEach(hole => {
    const path = new THREE.Path()
    path.absarc(hole.x, hole.y, hole.d / 2, 0, Math.PI * 2, true)
    shape.holes.push(path)
  })
  return shape
}

export function ToolingThree({ assembly, exploded, dark, resetToken }: { assembly: ToolingAssembly; exploded: number; dark: boolean; resetToken: number }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const mount = host.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(dark ? 0x111827 : 0xf8fafc)
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    mount.append(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const light = new THREE.DirectionalLight(0xffffff, 0.9)
    light.position.set(500, 800, 600)
    scene.add(light)
    const material = new THREE.MeshStandardMaterial({ color: dark ? 0x64748b : 0x94a3b8, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide })
    const purchasedMaterial = new THREE.MeshStandardMaterial({ color: dark ? 0xeab308 : 0xb45309, metalness: 0.35, roughness: 0.5, transparent: true, opacity: 0.65 })
    const edgeMaterial = new THREE.LineBasicMaterial({ color: dark ? 0x020617 : 0x1e293b })
    const group = new THREE.Group()
    const translations = assembly.instances.map(value => new THREE.Vector3(value.transform.translation.x, value.transform.translation.y, value.transform.translation.z))
    const center = translations.length ? translations.reduce((sum, value) => sum.add(value), new THREE.Vector3()).multiplyScalar(1 / translations.length) : new THREE.Vector3()
    for (const instance of assembly.instances) {
      const part = assembly.parts.find(value => value.name === instance.partName)
      if (!part) continue
      const geometry = new THREE.ExtrudeGeometry(shapeFor(part), { depth: part.thickness, bevelEnabled: false, curveSegments: 32 })
      geometry.translate(0, 0, -part.thickness / 2)
      geometry.computeVertexNormals()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial))
      const base = new THREE.Vector3(instance.transform.translation.x, instance.transform.translation.y, instance.transform.translation.z)
      const direction = base.clone().sub(center)
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1)
      mesh.position.copy(base).addScaledVector(direction.normalize(), exploded * Math.max(part.thickness, 20) / 25)
      mesh.quaternion.setFromRotationMatrix(assemblyRotationMatrix(instance.transform))
      mesh.name = `${assembly.id} ${instance.id}: ${part.role}`
      group.add(mesh)
    }
    for (const component of assembly.purchased) for (const envelope of component.envelopes ?? []) {
      const start = new THREE.Vector3(envelope.start.x, envelope.start.y, envelope.start.z)
      const end = new THREE.Vector3(envelope.end.x, envelope.end.y, envelope.end.z)
      const direction = end.clone().sub(start)
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(envelope.diameter / 2, envelope.diameter / 2, direction.length(), 20), purchasedMaterial)
      mesh.position.copy(start).add(end).multiplyScalar(0.5)
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
      mesh.name = `Purchased representation: ${component.description}`
      group.add(mesh)
    }
    scene.add(group)
    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(new THREE.Vector3())
    const target = box.getCenter(new THREE.Vector3())
    const extent = Math.max(size.x, size.y, size.z, 100)
    camera.position.copy(target).add(new THREE.Vector3(extent * 1.4, extent, extent * 1.4))
    controls.target.copy(target)
    controls.update()
    const resize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight)
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    resize()
    let frame = 0
    const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera) }
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) object.geometry.dispose() })
      material.dispose()
      purchasedMaterial.dispose()
      edgeMaterial.dispose()
      renderer.dispose()
      mount.replaceChildren()
    }
  }, [assembly, exploded, dark, resetToken])
  return <div className="tooling-three" ref={host} aria-label={`${assembly.id} assembled tooling model`} />
}
