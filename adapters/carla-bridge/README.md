# UniScenarios CARLA bridge

`uniscenarios-carla-bridge` is the optional public CARLA renderer and sensor
adapter for UniScenarios. It consumes the same immutable execution-package and
lease contracts used by SimCloud. The package owns the OpenSCENARIO 1.4
compiler, deterministic execution loop, concrete CARLA backend, materialized
ambient-traffic merge, parity evidence, bounded artifact transport, and the
official schema validator. SimCloud adds only its authenticated remote worker
control plane.

CARLA is optional. The browser editor, local deterministic simulation,
OpenDRIVE tooling, OpenSCENARIO export, and playback do not import CARLA or
require a CARLA server.

## Install

From this repository:

```sh
python3 -m pip install ./adapters/carla-bridge
```

Install the Python client distributed with the exact CARLA server build you
intend to use. The bridge deliberately does not declare `carla` as a package
dependency because the client/server build pair is part of execution
provenance, not a floating package resolution.

The validator also requires `xmllint` on `PATH`. The pinned official ASAM
OpenSCENARIO XML 1.4 schema is bundled in the wheel and its SHA-256 is checked
before every validation.

## Use locally

Start CARLA, then verify the client/server connection without mutating its
world:

```sh
uniscenarios-carla --host 127.0.0.1 --port 2000 probe
```

Execute a locally materialized lease:

```sh
uniscenarios-carla --host 127.0.0.1 --port 2000 run-lease \
  --lease lease.json \
  --manifest manifest.json \
  --xosc scenario.xosc \
  --xodr map.xodr \
  --asset-catalog asset-catalog.json \
  --output-dir output/carla
```

Pass `--materialized-traffic` when the lease references an ambient-traffic
artifact. `--xsd` is optional and defaults to the schema bundled in the wheel.
All input sizes and hashes, execution-package identity, map/catalog bindings,
fixed-step requirements, and output reservations are checked before CARLA is
allowed to execute.

## Develop and verify

```sh
python3 -m pip install -e './adapters/carla-bridge[dev]'
python3 -m pytest adapters/carla-bridge/tests -q
```

The test corpus uses fake CARLA APIs, so it exercises the compiler, runtime,
failure handling, security boundaries, and deterministic evidence without a
GPU server. A real CARLA qualification remains a separate hardware acceptance
gate.

See `docs/carla-renderer-adapter.md` for the ownership boundary, capability
matrix, and real-runtime acceptance criteria.
