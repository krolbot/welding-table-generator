# Tools: welding-table extension

The first Tools product is a **flat-cut, tab-located, welded wedge extension**. Its topology follows the supplied CAD views and the assembled-table reference: horizontal perforated top, deep mounting end, shallow free end, tapered sides with large rounded triangular openings and two narrow internal cross ties. It replaces the earlier rectangular box design.

This is an independently dimensioned analogue, **not a measured replica or a manufacturer drawing**. The [CAS Welding product description](https://cas-welding.com/products/udlinitel-stola-500x200x200-mm) establishes 500 × 200 × 200 mm, 6 mm steel, Ø16 holes on a 50 mm pitch and a curved slot. The reference images establish visible topology, not exact cut dimensions or hardware compatibility.

## Geometry and assembly

All geometry, nesting and DXF coordinates are millimetres. Length is adjustable from 400–800 mm, width 200–400 mm, mounting-end height 150–300 mm and thickness 4–10 mm. Defaults are 500 × 200 × 200 mm, T6.

Seven flat pieces are cut from one thickness:

- One perforated working top, horizontal at `Z = height`.
- Two tapered sides, with a rounded triangular access opening, perforations, top tabs, end notches and two cross-tie mortises.
- One high mounting end with four rounded straight slots, a rounded radial slot, a pivot hole and remaining grid holes.
- One shallow free end with a row of holes.
- Two identical narrow cross ties beneath the top, with locating tabs at the top and both ends. They do not close the interior with full-depth diaphragms.

`X = 0` is the mounting end against the host table; increasing X points outward. Y runs across the extension and Z points upward. The top is coplanar with the host working surface when correctly mounted. The underside stays open; there is no bottom plate or bent sheet.

The canonical part contours feed SVG, the real extruded Three.js meshes and native DXF. Assembly placements are also exported. The viewer uses the main generator's shared perspective-camera/OrbitControls component with an explicit Z-up frame, not a separate visual approximation.

## Proposed dimensions, not measurements

The following are design choices and must be checked before manufacture:

- Free-end height: `max(50, height / 4)` mm.
- Side-window borders: 55 mm at the mounting end, 45 mm below the top underside, 30 mm normal to the inclined lower edge; 6 mm corner radii.
- Cross ties: 30 mm body depth. Their two stations are derived near one-third and two-thirds of the length and snapped between nominal hole columns.
- Top and end locating tabs: 20 mm long. Cross-tie side tabs: 18 mm high. Matching notches/mortises add **0.2 mm total clearance**, or 0.1 mm per side on centred dimensions. This is nominal CAD clearance, not machine kerf compensation.
- The top's default hole grid starts 25 mm from its edges. Side/end row origins retain an 8 mm minimum material web; stock thicker than 9 mm moves the upper row inward. Holes conflicting with a window, slot or outer edge are omitted rather than drawn as islands in a void.
- Mounting-slot origins, travel, radial-slot centre/radius and pivot position are proposed. Ø16 width alone does not establish compatibility with the host table or locking hardware.

For assembly, locate both sides around the high and low ends and the two ties, seat the top over their tabs, verify square/flat alignment, then tack and weld using an independently chosen sequence. First prove the fit and welding access with a material/kerf sample. No bolts, clamps, weld beads or load rating are invented by the generator.

## Cutting, exports and saved projects

The Tools selector contains the extension and a [flat welding square](tools-square.md). Their geometry and saved projects remain separate from the table, while the sidebar, fields, units/theme, estimates, project/export controls, interactive 2D, Three.js viewer and sheet-nesting workspace are the same components the table generator uses. Sheet layout uses one shared worker with progressive results, pause/resume and the application's contour-aware automatic orientation search. It produces a validated result under a search budget, not a proven global optimum. Stale, incomplete or invalid layouts cannot be exported.

Tools JSON now uses `version: 2, tool: "extension"`. Version 1 describes the retired box: it is rejected explicitly, never silently reinterpreted as a wedge. On loading an old saved/shared project, the UI preserves and offers the original JSON, blocks editing/export, and requires an explicit start of the corrected design. That action backs up the original in browser storage before replacement. Importing an incompatible file leaves the current valid project unchanged.

Share links use the `toolProject` query parameter. The ZIP contains:

- One native DXF per unique blank, with quantity in its filename.
- One native DXF per nested sheet.
- `project.json`, `layout.json`, `assembly.json` and `README.txt`.

The assembly manifest records coordinate conventions, proposed joint dimensions and all seven local-to-world placements. Individual-part DXFs are local profiles; only sheet DXFs are nested cutting coordinates. Lines, circular holes and arcs remain native DXF entities.

## Verification and manufacturing limits

Automated checks cover the reference topology, a 96-case size/thickness matrix, contour self-intersections, hole containment/webs, locating-joint centres and clearances, sampled solid interference, actual extruded holes/mortises/windows and native DXF entities. They do not establish a strength rating or exact visual identity with an unmeasured reference.

Before cutting:

1. Measure the host table, mounting holes and real locking/clamping hardware. Prove resistance to slip and overturning under the intended load.
2. Confirm every proposed slot, window and joint dimension, material thickness and physical assembly/weld access.
3. Specify steel grade, flatness, weld sizes, sequence and distortion control; check strength and stiffness independently.
4. Check kerf, lead-ins, piercing, workholding, cut order and heat effects in CAM. Nominal DXFs are not ready-to-run machine programs.
