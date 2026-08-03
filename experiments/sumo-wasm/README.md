# SUMO WebAssembly feasibility spike

This directory is an opt-in experiment. It does **not** replace the native
UniScenarios traffic controller or add SUMO to the initial Studio download.

## Decision boundary

The experiment may be connected to the editor only if the release artifact:

- lazy-loads in a dedicated worker;
- is at most 12 MiB compressed and initializes within 1.5 seconds on the
  representative laptop;
- remains below 256 MiB of WebAssembly heap;
- has p95 worker step time below half of the requested simulated interval
  (at least 2x realtime headroom) for the selected actor tier;
- is deterministic for the same network, route input, and seed;
- preserves authored actor ownership while SUMO traffic reacts to those actors.

Failure of a tier selects the existing browser-native provider. It must never
stall the viewport or silently lower authored-scenario fidelity.

## Architecture

1. Maps are converted to SUMO `.net.xml` assets offline. Network import and
   `netconvert` are intentionally absent from the browser artifact.
2. `SumoWasmTrafficProvider` lazy-creates `sumoWasmWorker.ts`. Only that worker
   imports `sumo.mjs` and instantiates the WebAssembly module.
3. The network and route XML are transferred once and written to Emscripten's
   in-memory filesystem. There are no TraCI sockets and no Python runtime.
4. Before each step, authored actors and relevant hazards are mirrored as
   externally controlled SUMO proxies. The timeline remains authoritative;
   mirrored states are excluded from the returned ambient-state buffer.
5. SUMO-owned actors are returned as 32-byte packed records in a transferred
   `ArrayBuffer`, avoiding per-actor objects and structured-clone work.

The proxy design is required for safe coexistence. A stopped authored car,
moving cut-in, crossing pedestrian/cyclist, or lane-blocking construction
object must affect SUMO's car following and conflict handling without SUMO
also moving that authored actor.

## Pinned upstreams

- Eclipse SUMO 1.27.1, commit
  `7717f2379d9e314a0c81c5cec748444de06a2a91`
- Apache Xerces-C++ 3.2.5, commit
  `53c16411466bf90c62617831fe92ed0f41e70882`

`build.sh` clones and verifies those commits. The source trees and generated
artifacts are ignored; no upstream source is vendored in this repository.

## Source closure

Stock `libsumo` is an API layer, not an isolated small simulation kernel. Its
headless link closure includes:

- `libsumostatic` and the network loader;
- microscopic car-following, lane-changing, junction, traffic-light, action,
  trigger, transportable, device, and output libraries;
- mesoscopic simulation code;
- shared vehicle, routing, XML, geometry, I/O, and utility libraries;
- Xerces-C++ for mandatory XML parsing.

At the pinned release this is roughly 56 libsumo files, 376 microscopic files,
478 utility files, and 16 network-loader files. The stock link also pulls the
TraCI server and emissions implementations even though the browser API neither
opens sockets nor requests emissions. Those are the main later size-pruning
targets, but removing them is a maintained SUMO fork and is not part of the
first correctness gate.

The build disables FOX/GUI, OpenSceneGraph, GDAL, PROJ, FFMPEG, GL2PS,
JuPedSim, Eigen, Parquet, Boost, SWIG language bindings, FMI, tests, and
network-enabled Xerces. Emscripten's in-memory filesystem is still required by
SUMO's loader. SUMO's unconditional native `-pthread` flag is patched out so a
single dedicated worker does not require cross-origin isolation or a browser
thread pool.

## Build

Install `git`, CMake, Ninja, Python 3, and Emscripten, then run:

```sh
experiments/sumo-wasm/build.sh
```

Outputs are written under `experiments/sumo-wasm/dist/`. They are deliberately
not copied into Studio's public assets until all gates pass.

For the repeatable load test, generate a four-lane 5x5 network with the pinned
native SUMO package and run the Node harness:

```sh
netgenerate --grid --grid.number 5 --grid.length 1000 \
  --grid.attach-length 100 --default.lanenumber 4 --tls.guess true \
  -o /tmp/uniscenarios-sumo-grid.net.xml
node experiments/sumo-wasm/benchmark.mjs \
  experiments/sumo-wasm/dist/sumo.mjs \
  /tmp/uniscenarios-sumo-grid.net.xml
```

Generate the same grid without `--default.lanenumber 4` and use it to verify
that a stopped externally owned obstacle creates a real following queue:

```sh
node experiments/sumo-wasm/proxy-smoke.mjs \
  experiments/sumo-wasm/dist/sumo.mjs \
  /tmp/uniscenarios-sumo-single-lane-grid.net.xml
```

Copy that network plus the browser benchmark files into `dist/`, serve the
directory, and open `browser-benchmark.html?actors=100` or `?actors=500` to
exercise the real module worker and transferable state-buffer path.

## Measured feasibility result

Measured on an Apple M4 (10 logical CPUs, 24 GiB), Chromium's in-app browser,
Emscripten 6.0.5, and the pinned sources above:

| Gate | Result | Status |
| --- | ---: | --- |
| WebAssembly, uncompressed | 10.37 MiB | informational |
| WebAssembly, gzip-9 | 2.36 MiB | pass (limit 12 MiB) |
| JavaScript glue | 291 KiB | pass |
| Worker factory, 100 / 500 actors | 134 / 136 ms | pass |
| Network start, 100 / 500 actors | 303 / 289 ms | pass |
| Worker step p95, 100 / 500 active actors | 3.9 / 13.8 ms | pass |
| Worker step p99, 100 / 500 active actors | 6.2 / 19.4 ms | pass |
| State copy p95, 100 / 500 active actors | 0.1 / 0.1 ms | pass |
| WebAssembly heap | 64 MiB | pass (limit 256 MiB) |
| Main-frame p99 while worker runs | 10.2 / 10.3 ms | pass |
| Same-input determinism at 32/100/500 | stable packed-state digest | pass |

The browser harness deliberately isolates traffic computation from the 3D
renderer. Its result demonstrates that the simulation and transport do not
block the main thread; it is not a claim about whole-editor render FPS.

The recommendation is to keep the existing controller as the default and add
SUMO as a lazy, opt-in ambient provider. A deployment should retain the
adaptive fallback and collect full-editor frame timing. The bridge can mirror
authored cars and hazards as hidden occupancy proxies. In the stopped-obstacle
acceptance test, all 10 baseline cars were moving and the leader reached
x=859.6 m; with the proxy at x=400 m, nine cars stopped and the leader held at
x=392.8 m. Scenario-specific reaction tests for moving cut-ins, crossing
pedestrians/cyclists, construction geometry, stop/red queues, and highway
merges remain production gates rather than something the kernel benchmark
alone can establish.

## Licensing and distribution

SUMO is `EPL-2.0 OR GPL-2.0-or-later`; this experiment uses the EPL-2.0 path.
Xerces-C++ is Apache-2.0. The optional GPL dependencies used by SUMO's GUI and
"extra" build are excluded.

Serving the statically linked `.wasm` file to website users is distribution of
the EPL Program. A production release must therefore:

- retain SUMO and third-party copyright/license notices;
- include the EPL-2.0 license and a clear source-availability statement;
- provide the exact pinned SUMO source plus every applied patch/build script
  in a reasonable, durable way;
- keep modifications to SUMO source under EPL-2.0;
- audit the final link's third-party closure and reproduce its license bundle.

The TypeScript provider and narrow C ABI are separate project files, but the
WebAssembly binary statically contains SUMO. EPL does not require unrelated
UniScenarios source files to be relicensed. This is an engineering assessment,
not legal advice; counsel should approve the production notice/source-offer
flow.

Official references:

- https://github.com/eclipse-sumo/sumo
- https://eclipse.dev/sumo/docs/Libsumo.html
- https://eclipse.dev/sumo/docs/Downloads.html
- https://www.eclipse.org/legal/epl-2.0/
