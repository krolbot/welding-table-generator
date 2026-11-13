# Tools: welding-table extension

This workspace designs a **new flat-cut, butt-welded analogue**, not a measured replica or manufacturer drawing of the [CAS Welding extension](https://cas-welding.com/products/udlinitel-stola-500x200x200-mm). The two reference screenshots contain no dimensions. The vendor description gives nominal 500 × 200 × 200 mm, 6 mm steel, Ø16 holes on a 50 mm pitch, and a curved slot; it does **not** establish the shapes, mating positions or weld details in this generator.

## Current construction

- Adjustable nominal length 400–800 mm, width 200–400 mm, height 150–300 mm and plate thickness 4–10 mm; defaults 500 × 200 × 200 mm and 6 mm. All geometry and export coordinates are in mm.
- Seven pieces: one perforated top, two long sides with access openings, one near end with assumed clamp holes, one far end with a curved radial slot, and two cross ribs. Bottom is open. Each plate is a separate flat blank. Assembly places the top flush at the nominal height; side and end blanks occupy non-overlapping thickness bands and meet at butt-weld edges. No bent walls, tabs/slots, fixtures, bolts or weld beads are modeled.
- Hole placement, access-opening size, rib stations, end slot and attachment interface are **design assumptions** derived for this analogue. The fixed Ø16 / 50 mm pattern is inspired by the product description, but its origins and edge distances are not verified against the actual extension or welding table.
- The same part contours and holes feed 2D, 3D and native DXF. Nesting uses the application's contour-aware automatic orientation search. It finds a validated layout within a bounded search budget, not a mathematically proven global optimum. An incomplete or invalid layout blocks the fabrication ZIP.

## Outputs and persistence

The Tools selector currently contains one real design; adding another requires its own geometry, assembly and project identifier. A Tools JSON is `version: 1, tool: "extension"`, separate from table-generator projects. The share link uses the `toolProject` query parameter. The ZIP contains one DXF per unique blank (the count is in the filename), one DXF per nested sheet, `project.json`, `layout.json`, `assembly.json` and `README.txt`. The layout manifest records instance coordinates and angles, while the assembly manifest records local-to-world axes and positions. Only the sheet DXFs represent already nested cutting coordinates; the individual-blank DXFs are local geometry.

## Checks required before fabrication

1. Measure the actual welding table and mating holes; choose a real locking/clamping scheme and prove that it cannot slip or tip under the intended load.
2. Dimension every assumed aperture, slot, edge margin and weld joint. Check the physical fit of parts and ribs with material thickness and weld access; verify strength/stiffness for expected loads.
3. Specify steel grade, flatness tolerances, weld sequence and distortion control. No finite-element/load assessment or physical fit test has been performed.
4. In CAM check kerf, lead-ins, pierce positions, clamping, small-feature cuts, order of operations and heat effects. DXF geometry is nominal and not a ready-to-run machine program.
