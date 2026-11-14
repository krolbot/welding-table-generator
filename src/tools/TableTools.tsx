import { NumberField } from '../GeneratorWorkspace'
import { Icon } from '../Icon'
import { display, type Config } from '../model'
import { tableCutInventory } from '../tableCutJob'
import { toolLabels, type ToolSelection } from './project'

type Props = { config: Config; onChange: (tools: ToolSelection[]) => void; onChoose: () => void; onNotice: (message: string) => void }
export function TableTools({ config, onChange, onChoose, onNotice }: Props) {
  const units = config.units === 'mm' ? 'mm' : 'in'
  const quantity = (id: string, copies: number) => {
    const selections = config.nestingTools.map(row => row.id === id ? { ...row, project: { ...row.project, copies } } : row)
    try { tableCutInventory({ ...config, nestingTools: selections }); onChange(selections); return true }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Invalid tool quantity'); return false }
  }
  return <section className="table-tools"><h3>Tools in table cut job</h3>
    {config.nestingTools.length ? <><ul>{config.nestingTools.map(({ id, project }, index) => <li key={id}>
      <div className="table-tool-heading"><strong>{toolLabels[project.tool]} #{index + 1}</strong><button aria-label={`Remove ${toolLabels[project.tool]} #${index + 1}`} title="Remove from this cut job" onClick={() => onChange(config.nestingTools.filter(row => row.id !== id))}><Icon name="trash" size={14} /></button></div>
      <p>{display(project.size.length, config.units, 2)} × {display(project.size.width, config.units, 2)}{project.tool !== 'square' ? ` × ${display(project.size.height, config.units, 2)}` : ''} {units} · stock {display(project.size.thickness, config.units, 2)} {units}</p>
      <NumberField label={`Copies of ${toolLabels[project.tool]} #${index + 1}`} value={project.copies} min={1} max={10} step={1} onValue={copies => quantity(id, copies)} />
      {project.size.thickness !== config.thickness && <p className="socket-error" role="alert">Stock differs from the table. Remove this selection or explicitly change the table/tool thickness.</p>}
    </li>)}</ul><p>Saved tool dimensions; compact-extension thickness follows the table. Quantities are for the entire cutting job, not per table. Only complete sets can export; no extra sheets are added for tools. 2D Layout and 3D Assembly show the table; Sheet nesting shows the combined cut.</p></> : <p>Use spare sheet capacity for configured tools. The complete table and every selected tool must fit together.</p>}
    <button className="secondary full" onClick={onChoose}><Icon name="plus" size={14} />Choose a tool</button>
  </section>
}
