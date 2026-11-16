import JSZip from 'jszip'
import { nativeDxfForNestedSheet, nativeDxfForPart } from '../dxf'
import { arrangeParts } from '../fabricationLayout'
import type { Config } from '../model'
import type { NestingResult } from '../nesting'
import { downloadFile } from '../projectIO'
import { extensionDimensions } from './extension'
import { compactExtensionDimensions } from './compactExtension'
import { viseModuleDimensions } from './viseModule'
import { cornerBracketDimensions } from './cornerBracket'
import { parseToolProject, projectJson, projectParts, projectAssembly, projectNestingOptions, validProjectLayout, ToolProjectError, type ToolProject } from './project'

const fabricationNotes = (project: ToolProject) => project.tool === 'viseModule'
  ? 'Модуль крепления тисков: эталонный габарит 250×250×100 мм, пять плоских пластин — верхняя с пазами, монтажная стенка, низкая передняя стенка и две криволинейные боковины; низ открыт. Восемь отдельных радиальных пазов и отдельное центральное круглое отверстие. Каждый внешний скруглённый конец останавливается за 15 мм до границы пластины вдоль своего луча, включая направления к углам квадратной верхней пластины; длины вычисляются и не равны между собой. Это не перпендикулярный отступ от стороны. Толщина металла, диаметр, шаг, начало и схема монтажных отверстий наследуются от стола. Полная сетка монтажной стенки отсчитывается вниз от рабочей поверхности; нижние ряды боковин обрезаются по криволинейному силуэту. Совместите рабочие поверхности и базы от краёв, затем проверьте фактически сохранённые отверстия стола. Пазы, глубина свободного конца, криволинейный профиль и установочные соединения — проектные допущения, а не заводские размеры. Шипы стенок садятся заподлицо в пазы верхних кромок; шипы боковин входят в пазы торцевых стенок. Проверьте схему болтов тисков, зазор и рабочую длину крепежа, посадку пробного соединения и доступ для сварки. Образец: https://umetalli.com/products/vise-mount-01-250x250x100-6-mm (размерного чертежа пазов нет).\n'
  : project.tool === 'compactExtension'
  ? 'Компактное расширение: три плоские пластины — центральное ребро с окнами, перфорированная рабочая поверхность и монтажный торец. Второй боковины, пластины свободного торца, дна и поперечных связей нет. В ребре пять скруглённых окон; сужается только свободный конец. Маркировка образца: 500×100×100 мм, T6, D16, Ст3, комплект из двух. Одна копия проекта — одно расширение. Сетка по умолчанию: 20 отверстий сверху и четыре на торце. Шаг, фиксированные начала от краёв, точные профили окон, скос и установочные соединения — редактируемые допущения, а не заводские размеры. X направлена от стола, Y — поперёк, Z — вверх; рабочая поверхность Z=height. Установите два шипа ребра в пазы верхней пластины, два корневых шипа — в пазы монтажного торца, а верхние шипы торца — в пазы верхней кромки. Шипы заканчиваются заподлицо с наружными поверхностями. Размеры пазов включают общий зазор соединения. Перед изготовлением проверьте проход оснастки с обеих сторон ребра, марку материала, посадку пробного соединения, прямоугольность и доступ для сварки.\n'
  : project.tool === 'cornerBracket'
  ? 'Внутренний угловой кронштейн: одно треугольное основание со срезанными углами и девятью круглыми отверстиями, две перпендикулярные стенки; в одной три отверстия, в другой один скруглённый паз для струбцины. Три плоские детали, верх и диагональная сторона открыты, гибка не требуется. В образце указаны 210×210×60 мм и металл 8 мм; фактическая толщина всегда наследуется от стола. Диаметр, шаг и начала отверстий, размер паза, срезы профиля и все установочные соединения — редактируемые проектные допущения, а не заводские размеры. X/Y лежат в основании, перфорированная стенка расположена при Y=0, стенка с пазом — при X=0, Z направлена вверх. Установите каждый шип стенки в соответствующий паз основания; шипы идут заподлицо с низом. Одна стенка не доходит до другой на половину общего зазора соединения. Зафиксируйте прямой угол, прихватите и проверьте перед сваркой. Номинальный угол CAD не является оценкой точности или прочности.\n'
  : project.tool === 'extension'
  ? 'Клиновое расширение: семь плоских деталей с установочными шипами и соответствующими пазами. X направлена от стола, высокий монтажный торец расположен при X=0, горизонтальная рабочая поверхность — при Z=height.\nСетка: фиксированные начала 25 мм от краёв верхней поверхности и фиксированная глубина бокового ряда от рабочей поверхности; минимальная перемычка между отверстиями 8 мм допускает металл 4–9 мм, ряды автоматически не смещаются. Проверьте рабочую длину крепежа для фактического пакета деталей. Эталонный габарит: 500×200×200 мм, T6, D16/50. Высота свободного конца, положения соединений, общий зазор 0,2 мм, начала пазов, радиусы и размеры окон предложены проектом, а не измерены у производителя. Соберите две боковины, высокий монтажный торец, низкий свободный торец и две поперечные перемычки; перед прихваткой установите рабочую поверхность на их шипы. Сначала проверьте посадку соединений и доступ для сварки на образце.\n'
  : 'Плоский сварочный угольник: одна плоская Г-образная пластина, не гнутый и не сварной уголок. На образце показаны габарит 250×250 мм и три отверстия, но производственного чертежа нет. Толщина листа наследуется от стола; ширина плеча, диаметр отверстий и отступы от концов — редактируемые проектные допущения. Угловое отверстие находится на половине ширины плеча по обеим осям; крайние отверстия отстоят от свободных концов. Эта модель не требует гибки или сварки. Сверьте отверстия со своим столом: модель не гарантирует, что пользовательские размеры попадут в его сетку. Номинальный контур 90° не подтверждает точность или плоскостность вырезанной детали; при необходимости обработайте и измерьте рабочие кромки.\n'

const assertTableStock = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  if (!table || project.size.thickness !== table.thickness) throw new ToolProjectError('stock-mismatch', 'Оснастка не соответствует толщине металла стола. Перед экспортом проверьте унаследованную толщину.')
}

export const toolPartsArchive = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  const zip = new JSZip()
  projectParts(project).forEach(part => zip.file(`детали/${part.name}_${part.count}шт.dxf`, nativeDxfForPart(part)))
  zip.file('project.json', JSON.stringify(project, null, 2))
  zip.file('сборка.json', JSON.stringify({ version: 2, tool: project.tool, units: 'mm', axes: project.tool === 'viseModule' || project.tool === 'extension' || project.tool === 'compactExtension' ? 'X от стола; Y поперёк; Z вверх' : project.tool === 'cornerBracket' ? 'X/Y в основании; перфорированная стенка при Y=0; стенка с пазом при X=0; Z вверх' : 'X/Y в плоскости пластины; Z по толщине', ...(project.tool === 'viseModule' ? { joinery: viseModuleDimensions(project.size) } : project.tool === 'compactExtension' ? { joinery: compactExtensionDimensions(project.size) } : project.tool === 'extension' ? { joinery: extensionDimensions(project.size) } : project.tool === 'cornerBracket' ? { joinery: cornerBracketDimensions(project.size) } : {}), placements: projectAssembly(project) }, null, 2))
  zip.file('ПРОЧТИ_МЕНЯ.txt', fabricationNotes(project) + `Все детали используют толщину металла стола: ${project.size.thickness} мм. Во всех DXF используются номинальные миллиметры. Перед изготовлением проверьте фактический стол и запирающую оснастку, марку стали, нагрузки, последовательность и деформации при сварке, а также компенсацию реза, заходы и порядок резки в CAM. Расчёт прочности и проверка физической совместимости не выполнялись.\n`)
  return zip
}

export const toolArchive = (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  if (!validProjectLayout(project, result, key)) throw new ToolProjectError('invalid-layout', 'Раскладка неполна, устарела или не соответствует текущему проекту')
  const zip = toolPartsArchive(project, table)
  for (const index of [...new Set(result.placements.map(placement => placement.sheet))].sort((a, b) => a - b))
    zip.file(`листы/Лист_${index + 1}.dxf`, nativeDxfForNestedSheet(result.placements.filter(placement => placement.sheet === index)))
  zip.file('layout.json', JSON.stringify({ version: 1, units: 'mm', projectKey: key, nesting: projectNestingOptions(project), placements: result.placements.map(({ part, instance, sheet, rotation, translation }) => ({ part: part.name, instance, sheet, rotation, translation })), stats: result.stats }, null, 2))
  return zip
}

export const downloadToolArchive = async (project: ToolProject, result: NestingResult, key: string, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolArchive(project, result, key, table).generateAsync({ type: 'blob' }), `СварочныйСтол_${project.tool}_Листы.zip`)
}
export const downloadToolParts = async (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  downloadFile(await toolPartsArchive(project, table).generateAsync({ type: 'blob' }), `СварочныйСтол_${project.tool}_Детали.zip`)
}
export const toolStripDxf = (project: ToolProject, table: Pick<Config, 'thickness'>) => {
  parseToolProject(projectJson(project))
  assertTableStock(project, table)
  return nativeDxfForNestedSheet(arrangeParts(projectParts(project)).instances.map(({ part, instance, position }) => ({ part, instance, translation: position, rotation: 0, sheet: 0 })))
}
export const downloadToolStrip = (project: ToolProject, table: Pick<Config, 'thickness'>) => downloadFile(toolStripDxf(project, table), `СварочныйСтол_${project.tool}_Полоса.dxf`, 'application/dxf')
