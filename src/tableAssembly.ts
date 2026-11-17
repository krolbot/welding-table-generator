import { framePositions, legCornerPlateSpec, partWeight, skirtAssemblyY, type FabricationPart } from './geometry'
import type { Config } from './model'
import type { EulerDto, TableAssemblyDto, TableAssemblyPlateDto, Vector3Dto } from './apiContracts'

const vector = (x: number, y: number, z: number): Vector3Dto => [x, y, z]
const euler = (x = 0, y = 0, z = 0): EulerDto => [x, y, z]

export const tableAssembly = (config: Config, parts: FabricationPart[]): TableAssemblyDto => {
  const plates: TableAssemblyPlateDto[] = []
  const tubes: TableAssemblyDto['tubes'] = []
  const find = (name: string) => parts.find(part => part.name === name)
  const add = (part: FabricationPart, position: Vector3Dto, rotation: EulerDto, explode: Vector3Dto) => {
    const short = part.name === 'shortSkirt' || part.name.endsWith('Rib')
    const trimHeight = part.name !== 'top' && !part.name.endsWith('Skirt') && part.name !== 'legCornerPlate' && part.name !== 'legJumper' && part.name !== 'legMountPlate'
    const row: TableAssemblyPlateDto = {
      kind: 'plate', part: part.name, position, rotation, explode,
      displayWidth: part.width - (short ? 2 * config.thickness : 0),
      displayHeight: part.height - (trimHeight ? config.thickness : 0),
      weightKg: partWeight(part),
    }
    plates.push(row)
    return plates.length - 1
  }

  const top = find('top')
  if (top) add(top, vector(0, -config.thickness / 2, 0), euler(Math.PI / 2), vector(0, config.width * 0.4, 0))
  const skirtY = skirtAssemblyY(config)
  const longSkirt = find('longSkirt')
  if (longSkirt) for (const side of [1, -1]) add(longSkirt, vector(0, skirtY, side * (config.width / 2 - config.thickness / 2)), euler(), vector(0, 0, side * config.width * 0.3))
  const shortSkirt = find('shortSkirt')
  if (shortSkirt) for (const side of [1, -1]) add(shortSkirt, vector(side * (config.length / 2 - config.thickness / 2), skirtY, 0), euler(0, -Math.PI / 2), vector(side * config.length * 0.3, 0, 0))

  const corner = legCornerPlateSpec(config)
  const cornerPart = find('legCornerPlate'), jumper = find('legJumper'), mount = find('legMountPlate')
  if (corner && cornerPart && jumper && mount) for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const x = xSign * corner.centerX, z = zSign * corner.centerZ
    const angle = xSign > 0 ? zSign > 0 ? 0 : -Math.PI / 2 : zSign > 0 ? Math.PI / 2 : Math.PI
    add(cornerPart, vector(x, -config.height + corner.thickness / 2, z), euler(Math.PI / 2, 0, angle), vector(xSign * config.length * 0.15, 0, zSign * config.width * 0.15))
    const inwardX = -xSign / Math.SQRT2, inwardZ = -zSign / Math.SQRT2
    const jumperOffset = config.legProfileSize / Math.SQRT2 + jumper.thickness / 2
    add(jumper, vector(x + inwardX * jumperOffset, -config.height + jumper.height / 2, z + inwardZ * jumperOffset), euler(0, Math.atan2(inwardX, inwardZ), 0), vector(inwardX * config.length * 0.15, -config.height * 2, inwardZ * config.width * 0.15))
    const parentIndex = add(mount, vector(x, -config.height - mount.thickness / 2, z), euler(Math.PI / 2, 0, angle), vector(xSign * config.length * 0.15, -config.height * 3, zSign * config.width * 0.15))
    tubes.push({ kind: 'tube', parentIndex, size: config.legProfileSize, length: corner.legTubeLength })
  }

  const positions = framePositions(config)
  const longRib = find('longRib')
  if (longRib) for (const z of [...positions.long].reverse()) add(longRib, vector(0, -config.height / 2, z), euler(), vector(0, -config.height * 2, 0))
  const shortRib = find('shortRib')
  if (shortRib) for (const x of positions.short) add(shortRib, vector(x, -config.height / 2, 0), euler(0, -Math.PI / 2, 0), vector(0, -config.height * 4, 0))

  if (corner) {
    const inward = -Math.SQRT1_2
    const target = vector(corner.centerX + inward * (config.legProfileSize / Math.SQRT2 + corner.thickness / 2), -config.height / 2 + corner.jumperLength / 2, corner.centerZ + inward * (config.legProfileSize / Math.SQRT2 + corner.thickness / 2))
    return { plates, tubes, focus: { target, direction: vector(inward, -0.35, inward), distance: Math.max(corner.size * 2.5, config.legProfileSize * 5, 300) } }
  }
  return { plates, tubes }
}
