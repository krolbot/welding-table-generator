# Tools: internal corner bracket

The third Tools item is a three-part, flat-cut and welded internal corner bracket. The owner's two marketplace images show the assembled bracket and its flat kit: one chamfered triangular base, a perpendicular wall with three circular holes, and another perpendicular wall with one long rounded slot. The top and diagonal side remain open. It is not a folded L plate or a closed triangular box.

The dark kit image can initially look like two overlapping triangular sheets. Comparing the assembled view and enlarged kit reveals a single continuous nine-hole base, not a second triangular part. The base's two seating edges have locating notches; matching wall tabs provide assembly location. Their exact sizes are not dimensioned by the reference.

## Reference and proposed geometry

All stored, model and DXF dimensions are millimetres. The reference explicitly prints `210*210*60 мм` and `8 мм`; this model interprets those as outside X/Y footprint, upright height and sheet thickness. There is no factory dimensioned drawing.

Defaults:

- Outside envelope: **210 × 210 × 60**, stock **8**.
- Mounting holes and slot width: **16**, grid pitch **50** — proposed.
- Closed capsule slot overall length: **150** — proposed, with true semicircular ends.
- Elbow chamfer along each seating edge: **45**; short free-end widths: **50** — proposed.
- Two locating tabs per wall: **20** wide; total joint clearance **0.2** — proposed.

The base outline, before its four edge notches, passes through `(cornerCut, 0)`, `(length, 0)`, `(length, tipWidth)`, `(tipWidth, width)`, `(0, width)` and `(0, cornerCut)`. This preserves short ends beside the open diagonal and relieves the shared elbow.

The base has nine required holes on a four-row triangular grid, omitting the elbow position. Grid origin is `((length − 3 × holePitch) / 2, (width − 3 × holePitch) / 2)`; default origin is `(30, 30)`. Rows contain 3, 3, 2 and 1 holes. The perforated wall has three required holes at `length / 2 + [-holePitch, 0, holePitch]`; their height and the slot height are centred in the upright material above the base. These are designed origins, not measured vendor coordinates. A 50 mm pitch alone does not prove alignment with a real table.

Every required hole is retained. Impossible parameter combinations are rejected, not made to fit by silently deleting holes. Holes, slot and external cut edges must retain at least 5 mm of material. Numeric ranges are editor limits, not a guarantee that every cross-combination is manufacturable.

## Assembly interface ledger

Z is up. The base occupies Z = `0…thickness`. The perforated wall occupies Y = `0…thickness`; the slotted wall occupies X = `0…thickness`.

- **Base ↔ perforated wall:** two tabs at X = `cornerCut + (length − cornerCut) × [1/3, 2/3]`. Both use the same stations. Base notch width is `tabWidth + clearance`; notch depth is `thickness + clearance / 2`.
- **Base ↔ slotted wall:** the same construction along Y, using `width`. Wall tabs extend through the base, flush with its bottom; the wall bodies begin at `thickness + clearance / 2`.
- **Wall ↔ wall:** a butt interface, not overlapping stock. The perforated wall starts at X = `thickness + clearance / 2`; the slotted wall runs to Y = 0. The gap to the slotted wall's inside face is `clearance / 2`.

Tabs and notches are locating geometry for tack welding, not a strength-certified locking joint. Fixture the two walls at 90°, tack, measure and select a welding sequence before completing welds. Sample-cut the joint allowance against the actual sheet and process.

## Shared product path

`src/tools/cornerBracket.ts` owns canonical parts and assembly placements. The existing `FabricationPart` consumers render 2D, extrude the actual Three.js meshes, estimate material/mass, nest the batch and write native LINE/ARC/CIRCLE DXFs. `fabricationProfiles.ts` shares the edge-joint construction with the extension; no new renderer, CSS, nesting worker or exporter is introduced.

The project uses `version: 2, tool: "cornerBracket"`. Its complete parameter set is strictly validated on import, save/share recovery and before archive creation. Existing extension and square schemas do not change. Per-tool autosave retains each product's dimensions.

Parts ZIP contains the three canonical DXFs, `project.json`, `assembly.json` with axes/joint dimensions/placements, and fabrication notes. A verified nested ZIP adds each sheet DXF and `layout.json`; all quantities and contours derive from the same project, and stale/incomplete layouts are refused. The flat strip is explicitly a presentation arrangement, not a nested sheet.

This is an editable constructive analogue of the reference, not an exact manufacturer drawing. Steel grade, hole fit, finish, flatness, real squareness, loads, weld size/sequencing/distortion and CAM kerf/lead-ins are not certified by the CAD geometry.
