# Scenario Studio

Open-source desktop app for authoring driving scenarios inside high-fidelity 3D
city models. All TypeScript: Electron + React + three.js.

Status: P0/P1 — 3D city viewer steel thread (tile streaming, LOD, baked
lighting, lane/signal overlays) on the Yale Street map.

## Layout

- `apps/studio` — the app (vite + React; Electron shell)
- `packages/city-renderer` — tile-streamed 3D city viewport
- `packages/xodr-tools` — OpenDRIVE georeferencing, coordinate frames, map
  overlay data (lane polygons, signals)
- `dev-assets/` — local map data (gitignored; see below)
- `fixtures/` — small committed slices of real map data for tests

## Dev

```sh
pnpm install
pnpm dev          # vite dev server for the viewer
```

Map data for development is expected under `dev-assets/<map>/` with the layout
documented in `packages/city-renderer/src/manifest.ts` (3D tile manifest) —
not distributed with the repo.

License: Apache-2.0
