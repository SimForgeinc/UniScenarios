# UniScenarios

UniScenarios is an open-source toolkit for authoring, simulating, rendering,
validating, and exporting realistic driving incidents against high-fidelity 3D
city maps. It combines an interactive React/three.js studio with a deterministic
agent-oriented CLI and reusable TypeScript packages.

## Current state

- Five supported development maps with map intelligence and 3D assets
- 500 authored, map-grounded incident designs (100 per map)
- Deterministic materialization, simulation, trace, and evidence pipelines
- Interactive actor placement and concrete trace playback
- Machine-verifiable visual evidence and digest-bound human review records
- One compatibility CLI alias: `scen`; new automation should use `uniscenarios`

The 500 designs are authored and structurally validated. They are not yet all
generated, simulated, rendered, or visually accepted. The checked-in review
ledger intentionally gives no credit to incomplete or rejected evidence.

## Workspace

- `apps/studio` — interactive UniScenarios authoring and playback surface
- `packages/cli` — `uniscenarios`, the machine-readable workflow entry point
- `packages/scenario-model` — versioned scenario documents and JSON Schemas
- `packages/map-intel` — semantic location and map queries
- `packages/anchor-matcher` — logical scenario anchors to concrete map sites
- `packages/sim-engine` — deterministic simulation and trace generation
- `packages/city-renderer` — tile-streamed 3D city viewport
- `packages/xodr-tools` — OpenDRIVE coordinates, lanes, and signals
- `catalog` — the authored five-map incident catalog and taxonomy

## Start the studio

```sh
pnpm install
pnpm dev
```

Local map data belongs under `dev-assets/<map>/`. It is intentionally excluded
from Git; the required layout is defined by
`packages/city-renderer/src/manifest.ts`.

## Use the CLI

```sh
node packages/cli/bin/uniscenarios.js maps list
node packages/cli/bin/uniscenarios.js catalog verify \
  catalog/uniscenarios-five-map-v2.catalog.json
```

CLI stdout is JSON unless `--pretty` is supplied. Validation findings use exit
code 2 so an agent can distinguish repairable scenario defects from command
failures.

See `docs/scenario-visual-qa.md` for the evidence acceptance contract and
`docs/repository-transition.md` for the standalone repository provenance and
naming policy.

Licensed under Apache-2.0.
