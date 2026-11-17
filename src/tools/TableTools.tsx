import { NumberField, ParameterGroup } from '../GeneratorWorkspace'
import { Icon } from '../Icon'
import { display, type Config } from '../model'

import { toolLabels, type ToolSelection } from './project'

type Props = { config: Config; onChange: (tools: ToolSelection[]) => void; onChoose: () => void }
export function TableTools({ config, onChange, onChoose }: Props) {
  const units = config.units === 'mm' ? 'мм' : 'дюйм'
  const quantity = (id: string, copies: number) => {
    const selections = config.nestingTools.map(row => row.id === id ? { ...row, project: { ...row.project, copies } } : row)
    onChange(selections)
    return true
  }
  return <ParameterGroup title={<>Оснастка в задании на резку стола</>}>
    {config.nestingTools.length ? <><ul>{config.nestingTools.map(({ id, project }, index) => <li key={id}>
      <div className="table-tool-heading"><strong>{toolLabels[project.tool]} № {index + 1}</strong><button aria-label={`Удалить ${toolLabels[project.tool]} № ${index + 1}`} title="Удалить из этого задания на резку" onClick={() => onChange(config.nestingTools.filter(row => row.id !== id))}><Icon name="trash" size={14} /></button></div>
      <p>{display(project.size.length, config.units, 2)} × {display(project.size.width, config.units, 2)}{project.tool !== 'square' ? ` × ${display(project.size.height, config.units, 2)}` : ''} {units} · металл {display(project.size.thickness, config.units, 2)} {units}</p>
      <NumberField label={`Копий: ${toolLabels[project.tool]} № ${index + 1}`} value={project.copies} min={1} max={10} step={1} onValue={copies => quantity(id, copies)} />
      {project.size.thickness !== config.thickness && <p className="socket-error" role="alert">Толщина металла отличается от стола. Удалите эту позицию либо явно измените толщину стола или оснастки.</p>}
    </li>)}</ul><p>Размеры оснастки сохранены; толщина компактного расширения и модуля тисков следует за столом, как и монтажная сетка тисков. Количество относится ко всему заданию на резку, а не к каждому столу. Экспортируются только полные комплекты; дополнительные листы для оснастки не добавляются. В 2D и 3D показан стол, а в разделе «Листы» — совместная раскладка.</p></> : <p>Используйте свободное место на листах для настроенной оснастки. Стол и вся выбранная оснастка должны поместиться вместе.</p>}
    <button className="secondary full" onClick={onChoose}><Icon name="plus" size={14} />Выбрать оснастку</button>
  </ParameterGroup>
}
