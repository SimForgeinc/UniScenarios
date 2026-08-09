# UniScenarios

UniScenarios is an open-source toolkit for authoring, simulating, rendering,
validating, and exporting realistic driving incidents against high-fidelity 3D
city maps. It combines an interactive React/three.js studio with a deterministic
agent-oriented CLI and reusable TypeScript packages.

It is also the canonical source for the scenario model, v2 editor, materializer,
simulation and interaction engine, playback, OpenSCENARIO support, and optional
CARLA runtime used by SimCloud Platform. SimCloud adds accounts, durable cloud
jobs, storage, billing, collaboration, and managed workers; it consumes one
exact, immutable UniScenarios package stack and does not maintain private copies
of shared behavior.

## Current state

- Five supported development maps with map intelligence and 3D assets
- 500 authored, map-grounded incident occurrences (100 per map)
- Deterministic materialization, simulation, trace, and evidence pipelines
- Interactive actor placement and concrete trace playback
- Machine-verifiable visual evidence and digest-bound named review records
- One compatibility CLI alias: `scen`; new automation should use `uniscenarios`

The 500 designs are authored and structurally validated. They are not yet all
generated, simulated, rendered, or visually accepted. The checked-in review
ledger intentionally gives no credit to incomplete or rejected evidence.

## Workspace

- `apps/studio` — interactive UniScenarios authoring and playback surface
- `packages/cli` — `uniscenarios`, the machine-readable workflow entry point
- `packages/scenario-model` — versioned scenario documents and JSON Schemas
- `packages/editor-core` — shared framework-neutral v2 editor document,
  interaction controller, route overlays, and viewer contract
- `packages/map-intel` — semantic location and map queries
- `packages/anchor-matcher` — logical scenario anchors to concrete map sites
- `packages/sim-engine` — deterministic simulation and trace generation
- `packages/scenario-materializer` — logical template to concrete instance
  materialization
- `packages/ambient-traffic` — deterministic ambient traffic generation
- `packages/playback` — framework-neutral trace playback state and timing
- `packages/camera-rig` — shared scenario camera models and controls
- `packages/openscenario` — ASAM OpenSCENARIO XML 1.4 import, export, and XSDs
- `packages/trace-comparator` — deterministic trace and behavior comparison
- `packages/city-renderer` — tile-streamed 3D city viewport
- `packages/xodr-tools` — OpenDRIVE coordinates, lanes, and signals
- `packages/esmini-runner` — optional esmini execution adapter
- `packages/prop-catalog` — canonical actor and prop definitions
- `adapters/carla-bridge` — optional public CARLA execution runtime
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
naming policy. See `docs/simcloud-convergence.md` for canonical ownership,
the local-to-product development flow, publication, rollback, and acceptance
gates.

Run `pnpm verify:naming` to check the standalone root name, package scope, CLI
surface, and public documentation naming policy.

Licensed under Apache-2.0.
