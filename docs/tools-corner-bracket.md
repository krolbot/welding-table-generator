# Tools: internal corner bracket

The third Tools item is a three-part, flat-cut and welded analogue of the internal corner bracket. The supplied marketplace reference shows a monolithic 210×210×60 product without welded seams; this generator does not claim to reproduce that bending/manufacturing method. It models one relieved base, a perpendicular wall with three circular holes, and another perpendicular wall with one long rounded slot. The top, diagonal side and 60×60 inner corner remain open.

The dark kit image can initially look like two overlapping triangular sheets. Comparing the assembled view and enlarged kit reveals a single continuous nine-hole base, not a second triangular part. The base's two seating edges have locating notches; matching wall tabs provide assembly location. Their exact sizes are not dimensioned by the reference.

## Reference and proposed geometry

All stored, model and DXF dimensions are millimetres. The latest reference explicitly prints `210×210×60`, 6 mm steel and a monolithic/no-weld construction. The application uses the active table's stock thickness for mixed cutting jobs; this welded analogue therefore does not claim exact manufacturer parity. The owner confirmed the visible inner opening as a through 60×60 cut: the base and both walls begin 60 mm away from their common corner.

Defaults:

- Outside envelope: **210 × 210 × 60**; stock thickness follows the active table (the reference product says **6**).
- Mounting holes and slot width: **16**, grid pitch **50** — proposed.
- Closed capsule slot overall length: **140** — proposed, with true semicircular ends and 5 mm end webs in the 150 mm wall span.
- Through inner-corner cut along both seating edges: **60**; short free-end widths: **50** — cut confirmed by the owner, free-end width proposed.
- Two locating tabs per wall: **20** wide; total joint clearance **0.2** — proposed.

The base outline, before its four edge notches, passes through `(cornerCut, 0)`, `(length, 0)`, `(length, tipWidth)`, `(tipWidth, width)`, `(0, width)` and `(0, cornerCut)`. Both wall outer contours also start at local X = `cornerCut`. With the default `cornerCut = 60`, no base or wall material enters the 60×60 shared-corner region.

The base has nine required holes on a four-row triangular grid, omitting the elbow position. Grid origin is `((length − 3 × holePitch) / 2, (width − 3 × holePitch) / 2)`; default origin is `(30, 30)`. Rows contain 3, 3, 2 and 1 holes. The perforated wall's feature centre is halfway across the remaining span, `cornerCut + (length − cornerCut) / 2`; default wall holes are X = `85, 135, 185`. The slot uses the same centred rule on the other wall. These are designed origins, not measured vendor coordinates. A 50 mm pitch alone does not prove alignment with a real table.

Every required hole is retained. Impossible parameter combinations are rejected, not made to fit by silently deleting holes. Holes, slot and external cut edges must retain at least 5 mm of material. Numeric ranges are editor limits, not a guarantee that every cross-combination is manufacturable.

## Assembly interface ledger

Z is up. The base occupies Z = `0…thickness`. The perforated wall occupies Y = `0…thickness`; the slotted wall occupies X = `0…thickness`.

- **Base ↔ perforated wall:** two tabs at X = `cornerCut + (length − cornerCut) × [1/3, 2/3]`. Both use the same stations. Base notch width is `tabWidth + clearance`; notch depth is `thickness + clearance / 2`.
- **Base ↔ slotted wall:** the same construction along Y, using `width`. Wall tabs extend through the base, flush with its bottom; the wall bodies begin at `thickness + clearance / 2`.
- **Inner corner:** both wall bodies start at `cornerCut`; the base, perforated wall and slotted wall leave the same through 60×60 opening. The walls do not butt together at the shared corner.

Tabs and notches are locating geometry for tack welding, not a strength-certified locking joint. Fixture the two walls at 90°, tack, measure and select a welding sequence before completing welds. Sample-cut the joint allowance against the actual sheet and process.

## Shared product path

`src/tools/cornerBracket.ts` owns canonical parts and assembly placements. The existing `FabricationPart` consumers render 2D, extrude the actual Three.js meshes, estimate material/mass, nest the batch and write native LINE/ARC/CIRCLE DXFs. `fabricationProfiles.ts` shares the edge-joint construction with the extension; no new renderer, CSS, nesting worker or exporter is introduced.

The corrected through-cut geometry uses `version: 4, tool: "cornerBracket"`. Version 3 projects are rejected rather than silently changing their wall contours. The complete current parameter set is strictly validated on import, save/share recovery and before archive creation. Existing extension and square schemas do not change. Per-tool autosave retains each product's dimensions.

The parts ZIP contains only the three canonical DXFs. A verified nested ZIP contains only sheet DXFs; all quantities and contours derive from the same current project, and stale/incomplete layouts are refused. Editable project data remains a separate `.wtool` file. The flat strip is explicitly a presentation arrangement, not a nested sheet.

This is an editable constructive analogue of the reference, not an exact manufacturer drawing. Steel grade, hole fit, finish, flatness, real squareness, loads, weld size/sequencing/distortion and CAM kerf/lead-ins are not certified by the CAD geometry.
