# Tools: flat welding square

The second Tools item is a **single planar L-shaped plate**, not a bent angle, two welded walls or a perforated box. The owner's Keepler-Stan product image shows a 250 × 250 mm envelope and three round holes: one at the shared elbow and one near each free end. It does not provide a manufacturing drawing.

## Editable dimensions and assumptions

Default dimensions, in millimetres:

- Outside X/Y envelope: **250 × 250** (shown in the reference).
- Arm width: **50** (proposed).
- Stock thickness: **6** (proposed).
- Three holes: **Ø16** (proposed).
- Free-end hole inset: **25** (proposed).

The corner-hole centre is half the arm width from each outside edge. The two remaining centres are at `(length − endOffset, armWidth / 2)` and `(armWidth / 2, width − endOffset)`. Defaults produce 200 mm centre spacing along each arm; custom sizes do not automatically align with the host table grid. Measure that interface before cutting.

Length and width support 150–600 mm, arm width 30–100 mm, thickness 4–12 mm, holes 6–28 mm and free-end inset 15–80 mm. Not every combination is valid: every hole must remain inside material, at least 5 mm from a cut edge, and separated from the other holes. Invalid edits are rejected instead of silently dropping a hole.

## Canonical geometry and shared interface

`src/tools/square.ts` owns the six-line external contour and three circles. The same `FabricationPart` feeds the main generator's shared interactive 2D viewer, shared real Three.js extrusion, estimates, automatic nesting and native DXF. One assembly placement keeps the part in XY, with stock occupying Z = 0…thickness. Quantities affect cutting inventory, not the one-piece assembled preview.

Both Tools items and the table use `GeneratorShell`, numeric/range/checkbox controls, `ProductionEstimate`, `ProjectActions`, `PartsLayout`, `AssemblyViewport` and `SheetNesting`. Only domain parameters, geometry, assembly placement and project formats differ. Units are a display setting; all stored/exported coordinates remain millimetres.

## Project and exports

The square uses `version: 2, tool: "square"`; the extension uses version 3 for its datum-anchored grid. Unknown fields, incorrect tool/size combinations and retired extension version 1 are rejected. Switching products preserves their own settings; a rejected legacy project remains recoverable before replacement.

- **Download ZIP (Parts):** canonical part DXF plus project, assembly and fabrication notes.
- **Parts Strip DXF:** the same one-item arrangement shown in 2D; explicitly not nested.
- **Sheet nesting → Download sheet DXFs:** batch quantities, rigid placements, one DXF per sheet, canonical part DXF and JSON manifests. Stale, incomplete or tampered layouts cannot pass the export validator.

The reference establishes a shape, not metrology. Nominal 90° edges in CAD do not prove a cut part's squareness or flatness. Verify stock/material, hole fit, kerf, heat distortion and working-edge finish independently; no precision grade, strength rating or manufacturer equivalence is claimed.
