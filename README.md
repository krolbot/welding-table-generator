# Welding Table Generator

An independent, browser-only welding-table layout planner. This is a clean-room implementation of publicly observable product behaviour; it is **not affiliated with or endorsed by** the original project, and does not include its source code or assets. [Original project link](https://welding-table-generator.com/).

## Features

- Metric canonical model with mm/in display, D16/D28/custom fixture grids, square/staggered placement, markings, optional construction holes, ribs, tabs and dog-bone reliefs. Skirt perforation keeps the canonical shared-margin layout by default and offers an explicit compact, centred edge-row layout with independent vertical placement.
- Alternative leg mounting with the original skirt bolt pattern or four configurable horizontal corner plates for removable square-tube legs; each plate underside shares the uninterrupted skirt lower plane, while only the two local plate seats step up by one stock thickness, retain partial-width skirt tabs and open a stock-thickness weld relief at the physical corner. Each plate receives one height-derived vertical support jumper under its inner free corner through a partial-width bottom tab and closed slot. Jumper length is `H − stock thickness`, breadth is `0.3 × H`, and H100/T6 reproduces the 94×30 mm reference blank. Plates and jumpers use the selected table-sheet thickness in 2D, 3D, estimates and DXF exports.
- Interactive SVG layout with pan, wheel/pinch zoom, hole removal and coordinate ruler; Three.js assembly with OrbitControls, hover highlighting, exploded view and dimensions.
- Browser-only JSON open/save/share, production estimates, sheet fit feedback, individual-part DXF ZIPs and full-layout ASCII DXF R12 exports using `OUTLINE`, `ENGRAVE`, and `HOLES` layers.

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
