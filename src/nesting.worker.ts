import { makeParts } from './geometry'
import type { Config } from './model'
import { nestParts } from './nesting'

// DXF coordinates are rounded to 0.001 mm; reserve material for serialization.
self.onmessage = (event: MessageEvent<Config>) => {
  const config = event.data
  const result = nestParts(makeParts(config), {
    sheet: { width: config.sheetLength, height: config.sheetWidth },
    edgeClearance: config.sheetEdgeGap + 0.002,
    partClearance: config.sheetPartGap + 0.002,
    maxSheets: 32,
  })
  self.postMessage(result)
}
