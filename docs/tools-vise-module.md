# Vise mounting module

Choose **Tools → Vise mounting module**. The default envelope is **250 × 250 × 100 mm**. One assembly contains five laser-cut flat plates: one slotted top, one full-depth mounting wall, one shallow free-end wall and two identical curved sides. The underside is open; no bending or bottom plate is implied.

## Reference and proposed dimensions

The supplied kit photographs establish the envelope, five-piece construction, perforated sides and radial-slot top. The reference's 8 mm label is not an independent stock setting: the module inherits the host table's metal thickness, as requested.

[Umetalli's vise mounting plate](https://umetalli.com/products/vise-mount-01-250x250x100-6-mm), SKU WTA-001-VM00, corroborates the radial-groove arrangement used to bolt a vise to a table extension. Its public gallery shows eight separate rounded slots and a separate central hole—not one connected star-shaped cut. It is an analogous product, not proof that the pictured Russian kit is the same model. No dimensioned slot drawing was available there.

The following are proposed, editable design dimensions, not factory measurements:

- Eight slots at 45° intervals, 16 mm wide and 80 mm overall length. The closest slot tip is 30 mm from the top centre. Both ends are semicircles; slot length includes them.
- A 50 mm free-end depth and an upward-curving lower side profile. The curve is a circular arc tangent to the root underside.
- Two 20 mm locating tabs per wall/top interface and one per side/end interface, with 0.2 mm total longitudinal joint clearance.

The central hole and peripheral fixture holes use the inherited table-hole diameter. Slots retain their separate width setting because their function is bolting the vise, not accepting table-grid pins. Check the vise base and fasteners before choosing slot dimensions.

## Host mounting interface

The tool uses the same `fixtureGridPoints` function as the table. Diameter, pitch, edge origin, square/staggered pattern and stock resolve through `projectAtTable` in editing, selected cut jobs and project import. These controls are read-only in Tools; change them in Table generator.

At D16/50 with a 25 mm origin, the 250 mm mounting wall has five holes per square-grid row, at horizontal coordinates **25, 75, 125, 175, 225 mm**. Their depths are **25 and 75 mm below the assembled working surface**. The staggered pattern adds its canonical intermediate row; it is not a recentered square grid. Changing plate thickness never moves these datums.

The complete mounting-wall grid is mandatory. Invalid clearance blocks the configuration instead of deleting or moving a hole. Side upper rows are also retained; lower side rows intentionally stop where the curved outline leaves insufficient material. Peripheral top holes use square-grid stations, also valid stations of the staggered pattern.

Matching coordinates assume aligned working surfaces and edge datums. This is not a blanket D16 compatibility certificate: manually removed host holes, optional construction openings, pin tolerances, actual wall thickness, fastener grip and rear access must be checked for the chosen mounting position. A D28/100 or custom table does not silently resize the 250 mm module; incompatible dimensions are rejected. For a selected module, every nominal mounting-grid coordinate must fit within at least one host side: a 50 mm-deep table cannot accept the default module's 75 mm-deep row. Selected modules cause unsafe stock/grid or host-envelope changes to be rejected atomically, without changing the saved table. This checks the nominal grid envelope, not manually removed host holes or hardware clearance.

## Assembly interfaces

Axes: X points away from the host table, Y spans the module width, Z points upward.

- The top occupies `Z = height − thickness … height`.
- Mounting and free-end wall centre planes are `X = thickness/2` and `X = length − thickness/2`.
- Side centre planes are `Y = thickness/2` and `Y = width − thickness/2`.
- The free wall begins at `Z = height − tipHeight`; its exported blank contains only that shallow wall.
- Wall tabs end flush at the top working plane and enter open edge notches. The notch width is tab width plus total clearance; its inward depth is stock thickness plus half clearance.
- Side/end tabs enter open vertical end-wall notches. Side bodies stop inward of the wall by half clearance. Joint centres are shared by both mating parts.

These are locating joints for a welded assembly, not a locking fastening system or a weld specification. Fixture, tack, measure and sample-cut the joint before committing the full sheet.

## Shared outputs and checks

Four canonical part definitions expand to five physical instances. They drive the existing 2D layout, assembled/exploded Three.js view, estimates, shared nesting worker, native DXF and ZIP. Rounded slot ends and curved side profiles remain DXF arcs rather than polylines. The version-1 `viseModule` project preserves settings in JSON, browser storage and share links. Existing tool schemas are unchanged.

**Add to table cut job** retains dimensions and job quantity while stock and mounting-grid settings continue to follow the table. The entire kit must fit the same verified table-only sheet-count ceiling through the existing engine. Save/share/import, layout invalidation and assembly/layout manifests use the resolved dimensions. Incomplete, stale or invalid layouts cannot export.

Verification covers 4/6/8 mm stock, square/staggered grids, zero/nonzero clearance, multiple envelopes, complete mounting coordinates versus actual table skirt holes, all mating planes, real Three.js through-cuts, native DXF/ZIP and mixed sheet jobs. Minimum webs are geometry guards, not strength calculations. Vise loads, weld sizes, steel grade, allowable deflection, kerf and machine-specific CAM settings remain unverified.
