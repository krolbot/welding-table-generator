# Compact table extension

Select **Tools → Compact table extension**. It is a distinct three-plate product, not the existing seven-part wedge resized.

The five supplied views show one perforated working top, a central longitudinal spine with five rounded windows and one mounting end. Both longitudinal sides of the spine remain open. There is no second side, bottom, cross tie or free-end plate. The spine has full depth over most of its length and a local taper at its free end. The label states 500 × 100 × 100 mm, 6 mm stock, D16, Ст3 and a pair of two.

## Editable model

The defaults reproduce the labelled envelope, twenty holes in the working top and four in the mounting end. In the application, thickness is inherited from **Table generator → Metal Thickness**, not from the photo's 6 mm label. The Tools thickness field is read-only for this product; importing a tool uses the current table stock, while shared links preserve the host table configuration too. One copy is one extension; use two copies for the advertised pair.

- Hole diameter: 16 mm. Proposed pitch and edge origin: 50 and 25 mm.
- Proposed free-end depth: 40 mm; taper length: 120 mm.
- Proposed window border inset: 8 mm; rounded corners: 3 mm radius. The five cells form an alternating diagonal truss. Exact window proportions are inferred, not factory measurements. Insetting both neighboring cells retains twice the inset across their shared diagonal.
- Proposed locating tabs: 20 mm wide, with 0.2 mm total mating clearance.

All these parameters are editable. Invalid combinations are rejected with structured fabrication errors. In particular, a width or grid placing holes through the central spine is not repaired by silently removing holes or shifting their datum.

## Assembly interfaces

X points away from the host table, Y across the working top, Z up. The outside envelope starts at zero; the working face is Z=height. The spine is centred at Y=width/2. All parts use the same stock thickness.

Two upper spine tabs at X=length/3 and 2×length/3 seat in closed top mortises. Two root tabs at one third and two thirds of the mounting-body height seat in the mounting-end mortises. The mounting end has two upper tabs at Y=width/4 and 3×width/4, seated in top edge notches. Tabs finish flush at the external faces; slot widths include the configured total clearance. The spine body starts behind the mounting end with half the total clearance.

The end's first hole row is always `holeInset` down from the assembled working face. It does not move when stock thickness changes. Grid diameter/pitch alone does not certify compatibility with any manufacturer's locking hardware; verify the actual fastener grip range and table datums.

## Shared fabrication and persistence

The three canonical `FabricationPart` contours drive the ordinary 2D view, assembled/exploded Three view, weight and cut estimates, shared nesting worker, native DXF and ZIP. Window fillets remain true DXF arcs; grid holes remain circles. `compactExtension` version 1 preserves its settings in JSON, links and browser storage, without reinterpreting existing `extension` version 3 projects.

The configured extension can be added to the table cut job. Its dimensions and quantity are snapshots, but changing table thickness also regenerates all selected compact extensions, their joints and cut geometry. An unsafe stock/joint combination rejects the thickness change without altering the saved configuration. Other tool families retain their independent thickness and mismatch guards. Export manifests contain the actual resolved stock. All copies must use the table's stock thickness and fit within its verified table-only sheet-count limit. The shared exporter rejects stale, partial or invalid layouts; no tool-only sheet is added as an escape hatch.

This is a reference-based design, not a manufacturer's dimensioned drawing or a load rating. Confirm steel grade, hardware clearance, sample joint fit, actual angles/flatness, weld sequence/distortion and CAM kerf, lead-ins and cutting order before fabrication.
