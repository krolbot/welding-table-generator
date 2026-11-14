# Sheet nesting

The sheet planner packs complete sets of welding-table parts and selected Tools in the browser. It uses the same nominal contours as the assembly and DXF exporters. Tool selection does **not** change table geometry, holes or weld joints. Table-only projects retain strip and individual-part exports; mixed jobs export only their verified complete sheet plan.

## Using it

1. Set **Sheet size** in the sidebar and open **Sheet nesting**.
2. The first verified layout appears while the worker continues improving it. Select the sheet to inspect and switch between **3D** and **2D cut plan**. The green rectangle in 2D is a clear edge strip, with the requested part gap excluded; it is not a cut line or a complete inventory of usable offcuts.
3. In **Spacing & batch**, set the edge and inter-part gaps and number of identical tables to cut together. These settings are saved in project JSON and share links. Batch quantity changes only sheet nesting; rotation is automatic.
4. Choose a search budget. **Pause search** finishes the current pass; **Continue improving** resumes the same search and contact cache. **Restart**, changing fabrication settings, or leaving this view terminates that worker. A longer budget does not guarantee a better result. The displayed time is worker compute time, not wall-clock time spent paused or rendering.
5. **Download sheet DXFs (ZIP)** exports the best verified result available at that moment, even while the search continues. Missing parts, invalid geometry, stale settings, duplicates and clearance violations prevent export.

The search automatically starts with 0°/90°/180°/270°, then explores every 15° orientation after up to 48 passes. If a part cannot fit the sheet at a quarter turn, it tries all orientations immediately. Current projects contain no rotation policy; unsupported obsolete fields are rejected rather than applied as a hidden alternate mode. No mirroring is performed. Limits: 256 part instances, 32 sheets, 24 orientations and 4,096 search passes. A numeric edit is debounced; changing theme or mm/in display does not restart the calculation.

## Tools on table sheets

1. Open **Tools**, choose and configure an existing product, and set **Tool copies in the cutting batch**. **Add to table cut job** saves those exact settings and opens the table's **Sheet nesting** view. Several tools, including separately configured copies of the same family, can be selected.
2. **Tools in table cut job** lists saved selections. Change quantities or remove a selection there. Editing the separate Tools workspace does not silently change a saved selection; remove and add it again to replace its geometry. Tool quantities apply to the whole cutting job, not to every table copy.
3. All current products use steel; every selected part must match the table's exact thickness. Compact extensions inherit that thickness and regenerate their locating joints when it changes; an unsafe combination rejects the change. Their other dimensions and quantities remain snapshots. Other tools retain independent thickness and explicit mismatch rejection. There is no extra stock group. The generator does not choose/verify a steel grade: use one appropriate grade for the physical sheet. The table's sheet dimensions and edge/part gaps override each tool's standalone sheet settings.
4. The most recent verified table-only layout is reused while it matches the current fabrication parameters. If no such layout exists, the same nesting engine first evaluates 48 table-only orders. This **capacity** phase is not exportable. The full table + Tools inventory is then repacked, with the sheet count capped at that table-only layout's count. Table positions may change, but tools cannot cause another sheet to be added. The baseline is transient; reload or changed table geometry computes a fresh one.
5. Export is all-or-nothing for the complete selected job. A partial tool may be visible during search, but no archive can be exported until all table parts and every copy of every selected tool are present. Incomplete search results identify the missing parts. Continue the search, reduce quantities, remove selections, or explicitly change the table's sheet settings. A failed heuristic search is **not** proof that a feasible layout cannot exist.
6. Save/share/import and browser autosave preserve tool IDs, parameters and quantities in table project **schema 3**. Schema 2 files still import without changing their fixed grid, with no selected tools. Malformed selections and legacy tool grids are rejected rather than silently omitted or migrated. The retired catalog remains unsupported.

The table's **2D Layout** and **3D Assembly** still show the table; **Sheet nesting** shows the combined cut in 2D and 3D. With selected tools, table-only ZIP/strip actions are replaced by **Open shared sheet cut** so an apparently successful export cannot silently omit the tools. The estimate includes the full selected cut-job inventory and table batch count; it is not a sheet-fit guarantee.

Mixed exports retain native LINE/ARC/CIRCLE entities; table engraving does not leak onto a tool also named `top`. Manifest **schema 2** contains `selectedTools`, a per-part `sources` map, per-placement source/copy identity, stock, and the verified table-only layout and sheet-count limit under `capacity`. Export revalidates exact canonical geometry, unique instances, consistent sheet arrays, stock capacity and analytic clearance. It does not merely trust the worker's validity flag.

## Geometry and search

- **Contact regions:** `clipper2-ts` computes pairwise Minkowski contact paths in explicitly scaled integer coordinates, **1 unit = 0.001 mm**. The floating convenience wrappers are not used.
- **Solid containment:** a raw closed-path Minkowski boundary sweep has a hole when one solid is completely inside another. The forbidden region includes `A − B[0]` and `A[0] − B` as well as the sweep before union/offset. Treating every NFP hole as free material would be unsafe.
- **Feasible translations:** intersect the rectangular sheet's inset placement region with the complement of the translated forbidden regions. Vertices include contacts between contours, other forbidden regions and sheet edges. Bounding-box-only candidates are retained as cheap initial seeds, not the only possible placements.
- **Search:** up to 48 quarter-turn passes secure a fast baseline; a fresh search then tries all 15° orientations in its first twelve orders. Costly contact-region passes keep quarter turns and test one finer orientation for one part family per pass while exploring seed orders and mutations of elite placement order **and per-instance orientation**. If a part cannot fit the sheet in any quarter-turn orientation, the fine search starts immediately. The objective is lexicographic: valid result, fewer unplaced parts, fewer sheets, larger total clear edge strips, smaller occupied bounding area. The incumbent never worsens under that objective.
- **Bounded work:** contact paths share rotation-covariant caches, capped at 250,000 vertices. Large source pairs are progressively simplified for candidate generation and their offsets enlarged; the temporary pair product is limited to 16,384 vertices. This may miss a tight fit. Coarse candidates are never a safety oracle: acceptance uses original fine outlines, and final validation independently checks native curves. `coarsenedPairs` is recorded in the manifest.
- **Validation:** original `LINE` / circular `ARC` boundaries provide analytic edge extrema and line–line, line–arc and arc–arc distances. A separately regenerated fine polygon supplies topology and containment checks. Numeric floating-point predicates are not a formal exact-arithmetic proof. Every selected incumbent is revalidated, and export regenerates canonical parts and validates again.
- **Serialization:** DXF entities retain native lines, arcs and circles, rotated and translated from canonical coordinates. Coordinates, radii and angles have three decimal places. The worker reserves an additional 0.002 mm at edges and between parts for serialization.

The contact search is heuristic and uses a finite set of orientations. It is not globally optimal, and it does not place parts inside internal cutouts, share cutting lines, compensate kerf, choose lead-ins, order cuts or model clamps and thermal distortion. Those remain CAM responsibilities. No manufacturing cost reduction is inferred solely from an area percentage.

## Metrics

**Blank-outline coverage** is computed by analytic curve-area integration, without subtracting holes or slots. It represents sheet area reserved by external silhouettes, not retained metal mass.

**Area lower bound** is the ceiling of the total outside-silhouette area divided by usable sheet area after edge reserves. It ignores spacing and shape constraints. Matching it proves that fewer identical sheets cannot suffice under the external-only model; it does not prove optimal positioning or best offcuts.

**Clear edge strip** is the larger of the fully empty right and top edge strips on a sheet, inset by the edge margin and separated from parts by the part gap. Its bounds conservatively include the search tessellation error. It is not the maximum empty rectangle anywhere on the sheet, and a thin strip is not necessarily useful for a particular machine or future job.

## Reproducible exports

The ZIP contains:

- `Sheet_N.dxf` — nominal cutting/engraving geometry for each sheet;
- `layout.json` — versioned manifest with canonical part geometry, instance identity, zero-based sheet index, rigid translation, counterclockwise rotation, sheet settings, metrics and search statistics;
- `project.json` — generator settings, table batch quantity and exact selected tool projects;
- `README.txt` — dimensions, clearances and CAM reminder.

The coordinate origin is the lower-left corner of the sheet. Rotate about the source part origin, then translate. `layout.json` records the actual placements; replaying the same time budget on a slower computer can evaluate fewer orders. For deterministic comparisons use a fixed pass count.

## Verification and benchmarks

```sh
npm test
npm run build
npm run bench:nesting -- 96
npm run bench:nesting -- 96 constrained-corner
npm run audit:nesting -- /path/to/WeldingTable_Sheets_1450x1150.zip
```

The export audit uses `dxf-parser` to parse the actual archive, compares every native cutting and engraving entity with the manifest and regenerated project, checks intersections with independent `polygon-clipping`, and checks native boundary distances and sheet margins. Its polygon intersection test samples arcs; the reported chord error states that approximation. It does not substitute for a machine-specific CAM review.

`benchmarks/nesting-baseline.json` records the exact inputs and measured sheet counts from commit `640b7e96565ae6b2d42431621a1fd3da10a0b879` (12 orders). These are historical measurements. The command now applies those dimensions and saved origins to the corrected datum grid and complete current inventory, so its historical counts are informational rather than an identical-geometry comparison or an equal-time speed claim.

Measured comparison at the contour-nesting release, before the four plain leg mounting plates were added:

- Six standard fixtures retain their previous sheet count; the search can still improve clear strips or compactness.
- 1450×1150×150 table, corner plates, lifting openings, **2520×1500 sheet**: previous **2 sheets**, contour search **1** for all 18 parts.
- 1250×750×150 table, corner plates, lifting openings, **1820×1500 sheet**: previous **2 sheets**, contour search **1** for all 18 parts.
- 1450×1150×200 table, no corner mounts, lifting openings, **2970×1500 sheet**: previous **2 sheets**, contour search **1** for all 10 parts.
- All comparisons use 10 mm nominal edge and 5 mm nominal part gaps, plus the 0.002 mm export reserve. Full fixtures are the authority for remaining parameters.

The benchmark command includes all current mounting plates and validates completeness/clearance. It does not assert a sheet-count regression against the old grid and old 18-part kit: both rib stations and inventory changed. The pinned JSON remains historical evidence, not an active legacy-layout implementation. Normal UI, exports and current-kit regressions use the corrected geometry. Rib access holes are never treated as nesting space.

A small synthetic U/L interlocking test also improves from two sheets to one; it isolates contour placement from table-specific geometry. Other regression tests cover containment, tangent and sub-chord arc gaps, diagonal-only fit, zero-gap crossing rejection, invalid inputs, deterministic monotone progress, batch counts, stale exports and all native entity transforms at non-quarter-turn angles.

## Library and license

The generator's own code remains MIT licensed. Polygon boolean, offset and Minkowski primitives use [Clipper2's TypeScript port](https://github.com/countertype/clipper2-ts), pinned in the lockfile, under the [Boost Software License 1.0](../public/licenses/clipper2-ts.txt). The browser build distributes its notice at `/licenses/clipper2-ts.txt`. The installed API and [upstream Minkowski documentation](https://www.angusj.com/clipper2/Docs/Units/Clipper/Functions/MinkowskiSum.htm) informed the implementation; this is not a claim to have invented those algorithms.
