# Tooling-grid interface

This is the generator's geometric contract, **not universal compatibility certification for every D16/D28 accessory**. Diameter, pitch, origin, hole finish/tolerance, stock and fastener grip are separate requirements.

## Fixed datums

- **D16/50:** Ø16 mm, 50 mm pitch, 25 mm origin.
- **D28/100:** Ø28 mm, 100 mm pitch, 50 mm origin.
- **Custom:** diameter, pitch and origin are explicit. Editing one selects Custom; the values are not silently replaced by a nominal profile.
- On the top, origins are measured from its −X and −Z edges in assembly. On long skirts, the horizontal origin is measured from the same −X edge; on short skirts, from the same −Z edge. Opposite faces have the same global phase, not mirrored phases.
- Vertical skirt origins are measured down from the **assembled top working surface**, not the skirt blank, its tabs, centre or nominal top. Existing assembly offsets for ordinary and corner-plate mounts are accounted for without moving accepted joints.
- Non-pitch dimensions keep the near datum unchanged. The unused remainder stays at the far edge. For example, changing a D16 top length from 1450 to 1460 mm does not change its 25 mm origin. A custom-sized far corner is not automatically phase-compatible with an accessory referenced to that far edge.
- **Square** has full-pitch rows and columns. **Diagonal** retains all square points and adds each complete cell's centre; adjacent rows are half a pitch apart with alternating half-pitch horizontal offsets. The existing wire value `stagger` now identifies this documented lattice in schema version 2; legacy projects require explicit review.

The same canonical points drive 2D, Three.js, engraving, estimates, native DXF, nesting and archives. Rib stations, locating slots, mounting and lifting cutouts can interrupt individual grid holes. They do not shift the lattice to hide a collision. Deliberate manual removals can also leave gaps.

## Stock and hole validation

A table grid leaves at least 3 mm of metal between holes and adjacent cuts. Diagonal nearest-neighbour separation is `pitch / sqrt(2)`. The first side row requires:

`origin ≥ stock thickness + hole radius + 3 mm`

Thus D16/25 permits stock up to 14 mm under this geometric web rule; D28/50 permits up to 33 mm. These are **not strength ratings or catalog stock recommendations**. Additional joints, cutouts and leg plates have their own constraints. Invalid combinations return a `FabricationError` with a stable `code` and `details`, and block fabrication exports and nesting rather than recentering, shrinking or omitting required geometry.

Custom holes retain their explicit local coordinates. Holes outside the active part, inside slots/windows, too close to another cut, or with colliding serialized IDs are rejected. A valid custom hole replaces conflicting automatic grid holes rather than producing overlapping circles. Removed-hole records are explicit and retained.

The separate wedge extension reuses the fixed lattice but retains its existing 8 mm web. Its fixed 25 mm first row therefore requires 4–9 mm stock. T10 is rejected; the former thickness-dependent row shift is deleted. See [extension geometry](tools-extension.md).

## Project transition

Table fabrication files now contain `schemaVersion: 2`. JSON import, URL parameters and browser storage use one typed decoder; malformed values, conflicting aliases, unknown fields, duplicate URL parameters and future versions are rejected, not coerced or silently clamped.

Unversioned files enter a review state. The old centred/canonical/compact algorithms are gone. The original payload remains downloadable and is backed up as `tableGenParams.previous` before confirmation. Until then editing and fabrication exports are blocked and autosave cannot overwrite it.

An old file did not reliably record whether its origin was a deliberate custom value or a preset default. The decoder therefore preserves that value. Review offers an explicit D16/D28 profile-origin conversion where applicable, or keeping the saved origin under the new fixed-datum geometry. Neither choice claims that the old fabrication coordinates were unchanged. Manual coordinates and removed-hole records are preserved; review them against the regenerated part before cutting.

New JSON, share links, subsequent field edits and reloads retain the same fabrication values. Display units are presentation only: selecting inches does not convert D16/50 into an imperial fixture system.

Extension version 2 similarly requires an explicit transition to version 3. Square and corner-bracket projects retain their own version 2 contracts. No old grid implementation remains as an export fallback.

## Actual hardware fit

Before claiming compatibility with a purchased item, identify the manufacturer and part number and verify:

1. Hole diameter, required tolerance/finish, pitch and mating pattern.
2. Edge origins, first side-row depth and orientation against the actual manufacturer's dimensioned drawing.
3. The fastener's specified grip range against the **complete clamped stack**, not just a nominal D16 label. A bolt joining two plates may need a different working length from a clamp fixed to one plate. Do not substitute a catalog table thickness for the bolt's permitted grip range.
4. Seating, thread/ball-lock engagement, underside access and collision with ribs/slots/legs.
5. Flatness, weld distortion, material, load and CAM allowances independently of the coordinate checks.

No accessory model or fastener grip range has been supplied, so the generator does not report physical fit as verified. Manufacturer families vary: [Siegmund systems](https://www.siegmund.com/en-us/Product-Information/Product-Information/Systems-in-comparison), [DEMMELER tables](https://www.demmeler.com/products-shop/original-3d-clamping-systems/3d-welding-tables), [BuildPro BP16](https://www.stronghandtools.com/pages/bp16-system-overview) and [imperial 5/8-inch tables](https://www.stronghandtools.com/pages/5-8-tables-overview). A 5/8-inch hole and 2-inch pitch are 15.875 and 50.8 mm, not D16/50. The selected 25/50 mm origins are this application's declared design datums, not a claim of a universal industry standard.
