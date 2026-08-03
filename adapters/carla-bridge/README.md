# UniScenarios CARLA bridge

This optional service is a renderer/sensor adapter, not a scenario runtime. It
consumes an immutable, deterministic UniScenarios control stream and applies
each frame to CARLA in synchronous fixed-step mode. UniScenarios remains the
semantic authority; CARLA supplies Unreal rendering, public actors, traffic
lights, collisions, cameras, and sensors.

The checked-in client contract deliberately has no `carla` dependency. Its
protocol, capability gate, exact-binding checks, two execution modes, and
deterministic stepping can be tested without installing a multi-gigabyte
simulator. The SimForge worker supplies the CARLA Python backend.

Hard gates:

- the XML 1.4 bytes and official-XSD receipt, complete OpenDRIVE bytes,
  controller digest, compiled payload, and allowlisted asset catalog are all
  hash-closed before CARLA starts; the receipt must name the repository-pinned
  official ASAM 1.4.0 XSD digest and the exact submitted XML digest, and the
  worker independently reruns network-disabled `xmllint` against its own
  digest-verified XSD instead of trusting that receipt;
- actor catalog bindings and OpenDRIVE signal IDs must resolve exactly and once;
- CARLA loads the exact map before the bridge becomes the only synchronous tick
  owner and applies the declared fixed step;
- every control-stream index is contiguous and its time equals `index * step`;
- every submitted job declares a hash-bound actor lifecycle policy; authored
  exports use `persist-to-final-frame`, which rejects `destroy` in every
  captured frame with diagnostic `USC-ACTOR-LIFECYCLE-001`, while the explicit
  `generic-v3` policy remains available for worker-internal lifecycle tests;
- `authoritative-trace` applies exact compiled poses; `native-dynamics` applies
  exact compiled controls while retaining the trace as the comparison target;
- every expected frame and CARLA readback frame carries complete actor and
  physical-signal closure, lifecycle, pose, heading, speed, exact road/lane
  occupancy, collision edges, resolved CARLA actor/blueprint/OpenDRIVE
  identities, existence, and an explicit no-teleport result; payload-
  derived capabilities cannot be omitted by the caller;
- inputs and frame/actor/signal counts are bounded; every backend tick is a
  strictly increasing integer and results require job-bound CARLA build, map,
  payload, fixed-step, bridge-revision, collision, and runtime provenance;
- worker identity is independently attested from a fixed read-only build
  manifest plus a live CARLA version probe; both the caller's expectation and
  backend observations must match it, so echoed caller provenance is not
  accepted as proof;
- tick IDs must be contiguous, and every observation names that exact CARLA
  frame plus snapshot elapsed time advancing by exactly one fixed step;
- both execution modes compare CARLA readback to the same authoritative frames
  before success: 3D position <= 0.25 m, heading <= 2 degrees, speed <= 0.25
  m/s, exact fixed-step timestamps, lifecycle, signal, collision, and road/lane
  occupancy;
- cleanup is mandatory on every backend exit and is responsible for restoring
  world settings, traffic lights, sensors, and actors;
- unknown features, unknown signal states, missing or extra actors/signals,
  stale map or asset bindings, unsupported lifecycle transitions, empty or
  incomplete evidence, threshold violations, or cleanup failures reject the
  job;
- ScenarioRunner/OpenSCENARIO 1.0 down-conversion is a separate feature-gated
  path and can never silently replace trace replay.

Run the dependency-free contract tests with:

```sh
python3 -m unittest discover -s adapters/carla-bridge/tests -v
```

See `docs/carla-renderer-adapter.md` for deployment design, primary-source
research, the capability matrix, and conformance thresholds.
