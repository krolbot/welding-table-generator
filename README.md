# Welding Table Generator

An independent, browser-only welding-table layout planner. This is a clean-room implementation of publicly observable product behaviour; it is **not affiliated with or endorsed by** the original project, and does not include its source code or assets. [Original project link](https://welding-table-generator.com/).

## Features

- Metric canonical model with mm/in display, D16/D28/custom fixture grids, square/staggered placement, markings, optional construction holes, ribs, tabs and dog-bone reliefs.
- Alternative leg mounting with the original skirt bolt pattern or four configurable horizontal corner plates for removable square-tube legs; each plate interlocks with both adjoining skirts, and DXF exports include the support plates at their own stock thickness.
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
