# Sheet nesting

The sheet planner packs complete sets of welding-table parts in the browser. It uses the same nominal contours as the assembly and DXF exporters. It does **not** change tab geometry, holes, weld joints, the old strip layout, or the original individual-part export.

## Using it

1. Set **Sheet size** in the sidebar and open **Sheet nesting**.
2. The first verified layout appears while the worker continues improving it. Select the sheet to inspect and switch between **3D** and **2D cut plan**. The green rectangle in 2D is a clear edge strip, with the requested part gap excluded; it is not a cut line or a complete inventory of usable offcuts.
3. In **Spacing, rotations & batch**, set the edge and inter-part gaps, permitted rotations, and number of identical tables to cut together. These settings are saved in project JSON and share links. Batch quantity changes only sheet nesting.
4. Choose a search budget. **Pause search** finishes the current pass; **Continue improving** resumes the same search and contact cache. **Restart**, changing fabrication settings, or leaving this view terminates that worker. A longer budget does not guarantee a better result. The displayed time is worker compute time, not wall-clock time spent paused or rendering.
5. **Download sheet DXFs (ZIP)** exports the best verified result available at that moment, even while the search continues. Missing parts, invalid geometry, stale settings, duplicates and clearance violations prevent export.

The default rotation policy permits quarter turns. Fixed orientation and 0°/180° preserve a chosen source axis. 45° and 15° steps add orientations at greater computational cost. No mirroring is performed. Limits: 256 part instances, 32 sheets, 24 orientations and 4,096 search passes. A numeric edit is debounced; changing theme or mm/in display does not restart the calculation.

## Geometry and search

- **Contact regions:** `clipper2-ts` computes pairwise Minkowski contact paths in explicitly scaled integer coordinates, **1 unit = 0.001 mm**. The floating convenience wrappers are not used.
- **Solid containment:** a raw closed-path Minkowski boundary sweep has a hole when one solid is completely inside another. The forbidden region includes `A − B[0]` and `A[0] − B` as well as the sweep before union/offset. Treating every NFP hole as free material would be unsafe.
- **Feasible translations:** intersect the rectangular sheet's inset placement region with the complement of the translated forbidden regions. Vertices include contacts between contours, other forbidden regions and sheet edges. Bounding-box-only candidates are retained as cheap initial seeds, not the only possible placements.
- **Search:** the first twelve deterministic orders establish a fast incumbent. Contact-region placement then explores seed orders and mutations of elite placement order **and per-instance orientation**. The objective is lexicographic: valid result, fewer unplaced parts, fewer sheets, larger total clear edge strips, smaller occupied bounding area. The incumbent never worsens under that objective.
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
- `project.json` — generator settings, including batch quantity and rotation policy;
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

`benchmarks/nesting-baseline.json` records the exact inputs and measured sheet counts from commit `640b7e96565ae6b2d42431621a1fd3da10a0b879` (12 orders). The upgraded benchmark uses 96 orders, so this is a quality comparison with a larger computation budget, not an equal-time speed claim.

Measured comparison:

- Six standard fixtures retain their previous sheet count; the search can still improve clear strips or compactness.
- 1450×1150×150 table, corner plates, lifting openings, **2520×1500 sheet**: previous **2 sheets**, contour search **1** for all 18 parts.
- 1250×750×150 table, corner plates, lifting openings, **1820×1500 sheet**: previous **2 sheets**, contour search **1** for all 18 parts.
- 1450×1150×200 table, no corner mounts, lifting openings, **2970×1500 sheet**: previous **2 sheets**, contour search **1** for all 10 parts.
- All comparisons use 10 mm nominal edge and 5 mm nominal part gaps, plus the 0.002 mm export reserve. Full fixtures are the authority for remaining parameters.

A small synthetic U/L interlocking test also improves from two sheets to one; it isolates contour placement from table-specific geometry. Other regression tests cover containment, tangent and sub-chord arc gaps, diagonal-only fit, zero-gap crossing rejection, invalid inputs, deterministic monotone progress, batch counts, stale exports and all native entity transforms at non-quarter-turn angles.

## Library and license

The generator's own code remains MIT licensed. Polygon boolean, offset and Minkowski primitives use [Clipper2's TypeScript port](https://github.com/countertype/clipper2-ts), pinned in the lockfile, under the [Boost Software License 1.0](../public/licenses/clipper2-ts.txt). The browser build distributes its notice at `/licenses/clipper2-ts.txt`. The installed API and [upstream Minkowski documentation](https://www.angusj.com/clipper2/Docs/Units/Clipper/Functions/MinkowskiSum.htm) informed the implementation; this is not a claim to have invented those algorithms.
