import * as THREE from 'three'
import type { Contour, FabricationPart } from './geometry'

/** Fit all eight world-space corners, accounting for portrait/landscape camera aspect. */
export const fitCameraToBounds = (camera: THREE.PerspectiveCamera, target: THREE.Vector3, bounds: THREE.Box3) => {
  if (bounds.isEmpty() || camera.aspect <= 0) return target.clone()
  const direction = camera.position.clone().sub(target)
  if (!direction.lengthSq()) return target.clone()
  direction.normalize()
  const right = camera.up.clone().cross(direction).normalize()
  const up = direction.clone().cross(right).normalize()
  const center = bounds.getCenter(new THREE.Vector3())
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2)
  const horizontal = vertical * camera.aspect
  let distance = camera.near * 2
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(center)
    distance = Math.max(distance, point.dot(direction) + 1.15 * Math.max(Math.abs(point.dot(right)) / horizontal, Math.abs(point.dot(up)) / vertical))
  }
  camera.position.copy(center).addScaledVector(direction, distance)
  camera.far = Math.max(camera.far, distance * 5)
  camera.lookAt(center)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return center
}

export const holeCurveSegments = 24

export type AssemblyColors = { part: number; edge: number; dim: number }

export const assemblyColors = (dark: boolean): AssemblyColors => ({
  part: dark ? 0x64748b : 0x9aa7b8,
  edge: dark ? 0x020617 : 0x1e293b,
  dim: dark ? 0x60a5fa : 0x1d4ed8,
})

export const contourPath = (contour: Contour, path: THREE.Path = new THREE.Path()) => {
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

export const shapeForPart = (part: FabricationPart, renderHoles: boolean) => {
  const shape = new THREE.Shape()
  contourPath(part.contours[0], shape)
  if (renderHoles) for (const hole of part.holes) {
    const path = new THREE.Path()
    path.absarc(hole.x, hole.y, hole.d / 2, 0, Math.PI * 2, true)
    shape.holes.push(path)
  }
  part.contours.slice(1).forEach(contour => shape.holes.push(contourPath(contour)))
  return shape
}

export const edgeGeometryFor = (shape: THREE.Shape, depth: number) => {
  const vertices: number[] = []
  for (const path of [shape, ...shape.holes]) {
    const circle = path.curves.length === 1 && path.curves[0] instanceof THREE.EllipseCurve
    const points = path.getPoints(circle ? holeCurveSegments : 3)
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1]
      const to = points[index]
      if (from.distanceToSquared(to) < 1e-10) continue
      for (const z of [-depth / 2, depth / 2]) vertices.push(from.x, from.y, z, to.x, to.y, z)
    }
    const corners = circle ? path.getPoints(2) : path.curves.map(curve => curve.getPoint(0))
    const unique = new Map(corners.map(point => [`${point.x.toFixed(6)},${point.y.toFixed(6)}`, point]))
    unique.forEach(point => vertices.push(point.x, point.y, -depth / 2, point.x, point.y, depth / 2))
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
}

export const extrudedPartMesh = <Material extends THREE.Material>(
  part: FabricationPart,
  material: Material,
  { renderHoles = true, edgeColor }: { renderHoles?: boolean; edgeColor?: number } = {},
) => {
  const shape = shapeForPart(part, renderHoles)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: part.thickness,
    bevelEnabled: false,
    curveSegments: renderHoles ? holeCurveSegments : 1,
  })
  geometry.translate(0, 0, -part.thickness / 2)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  if (edgeColor !== undefined) {
    mesh.add(new THREE.LineSegments(
      edgeGeometryFor(shape, part.thickness),
      new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 2 }),
    ))
  }
  return mesh
}

export const disposeObject3D = (object: THREE.Object3D) => {
  object.traverse(item => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line) item.geometry.dispose()
    if (item instanceof THREE.Sprite) {
      item.material.map?.dispose()
      item.material.dispose()
    }
    if (item instanceof THREE.Line) {
      const materials = Array.isArray(item.material) ? item.material : [item.material]
      materials.forEach(material => material.dispose())
    }
  })
}

export const addDimensionLine = (
  group: THREE.Group,
  from: THREE.Vector3,
  to: THREE.Vector3,
  normal: THREE.Vector3,
  color: number,
) => {
  const material = new THREE.LineBasicMaterial({ color, depthTest: false })
  group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material))
  ;[from, to].forEach(anchor => group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    anchor.clone().addScaledVector(normal, 20), anchor.clone().addScaledVector(normal, -20),
  ]), material)))
}

export const dimensionLabel = (value: string, position: THREE.Vector3, color: number, width = 300) => {
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
  sprite.scale.set(width, width / 4, 1)
  return sprite
}
