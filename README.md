# Welding Table Generator

An independent, browser-only welding-table layout planner. This is a clean-room implementation of publicly observable product behaviour; it is **not affiliated with or endorsed by** the original project, and does not include its source code or assets. [Original project link](https://welding-table-generator.com/).

## Features

- Metric canonical model with mm/in display, D16/D28/custom fixture grids, square/staggered placement, markings, optional construction holes, ribs, tabs and dog-bone reliefs. Skirt perforation keeps the canonical shared-margin layout by default and offers an explicit compact, centred edge-row layout with independent vertical placement.
- Alternative leg mounting with the original skirt bolt pattern or four configurable horizontal corner plates for removable square-tube legs; each plate underside shares the uninterrupted skirt lower plane, while only the two local plate seats step up by one stock thickness. Each skirt joint combines a partial-width locating tab with an adjacent open plate-edge region for a fillet weld, while preserving the physical plate corner. Each plate receives one height-derived vertical support jumper under its inner free corner through a partial-width bottom tab and closed slot. Jumper length is `H − stock thickness`, breadth is `0.3 × H`, and H100/T6 reproduces the 94×30 mm reference blank. Each upper corner plate bolts to a separate plain square mounting plate welded to its tube leg. The four lower plates share the upper plate size, thickness and bolt pattern, have no tabs or slots, and move with their welded legs in exploded view. Bolts are not modelled. `Leg assembly below frame` includes the lower plate, so tube cut length is that value minus stock thickness. All plates and jumpers use the selected table-sheet thickness in 2D, 3D, estimates, nesting and DXF exports.
- Optional large circular assembly-access holes, one per bay in every longitudinal and transverse rib. The diameter is adjustable (80 mm by default); the maximum is derived from actual rib crossings, cross-lap reliefs and a material web of at least one stock thickness or 5 mm, whichever is larger. Oversize holes disable fabrication previews and exports instead of being silently reduced or omitted. This spacing is a geometry constraint, not a structural load rating.
- Interactive SVG layout with pan, wheel/pinch zoom, hole removal and coordinate ruler; Three.js assembly with OrbitControls, hover highlighting, exploded view and dimensions.
- Browser-only JSON open/save/share, production estimates, sheet fit feedback, individual-part DXF ZIPs and full-layout ASCII DXF R12 exports using `OUTLINE`, `ENGRAVE`, and `HOLES` layers.

## Sheet nesting

The **Sheet nesting** view performs contour-aware placement with cached no-fit regions, deterministic order/orientation search and progressive verified results. Inspect each sheet in 3D or 2D, pause and continue the search, and nest batches of identical tables. Rotations are selected automatically. It minimizes sheet count first, then prefers clear edge strips rather than merely displaying a coverage percentage.

Exports retain native DXF lines/arcs/circles and include a reproducible placement manifest and project settings. Missing, stale or invalid placements block export. The search is heuristic, not a universal optimality guarantee; kerf, lead-ins, clamping and cutting sequence still require CAM review.

See [the algorithm, limits, metrics, benchmark fixtures and audit commands](docs/sheet-nesting.md). `npm run bench:nesting -- 96` replays the historical pre-mounting-plate part inventory for a like-for-like algorithm comparison; `npm run audit:nesting -- archive.zip` inspects an actual exported archive.

## Tools

Use **Tools** in the sidebar to choose a separate welded-product workspace. The first tool designs an independently engineered 500 × 200 × 200 mm wedge extension from seven flat steel pieces: a horizontal perforated top, tapered open sides, a slotted mounting end, a shallow free end and two narrow cross ties with matching locating tabs and cuts. Adjust its dimensions, inspect part profiles and the 3D assembly, then run the same automatic contour-aware sheet nesting for the complete cut list. Save or open a versioned project JSON, share a link, or download native per-part and per-sheet DXFs with layout and assembly manifests. Export stays disabled for incomplete or invalid nesting. The table generator's own project and settings remain separate.

This is **not a reconstruction of the manufacturer's dimensioned drawings**. See [the extension's assumptions and fabrication checks](docs/tools-extension.md) before cutting.

## Local run

Requires Node 26.7.0 or newer.

```sh
npm install
npm run dev
```

Open the local Vite address shown in the terminal.

## Production build

```sh
npm run build
npm run preview
```

## Container

```sh
docker build -t welding-table-generator .
docker run --rm -p 8080:80 welding-table-generator
```

The image serves the static SPA with Nginx and exposes `/healthz`. The Woodpecker pipeline publishes `linux/amd64` images to `ghcr.io/krolbot/welding-table-generator` and deploys the exact commit tag to the server-owned Compose stack.

No service, database, account, or backend is involved.

Generated plans are informational. Verify dimensions, kerf allowance, material behaviour, and structural suitability before fabrication.
