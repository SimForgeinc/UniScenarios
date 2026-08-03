# UniScenarios CARLA bridge

This optional service is a renderer/sensor adapter, not a scenario runtime. It
consumes an immutable, deterministic UniScenarios control stream and applies
each frame to CARLA in synchronous fixed-step mode. UniScenarios remains the
semantic authority; CARLA supplies Unreal rendering, public actors, traffic
lights, collisions, cameras, and sensors.

The checked-in scaffold deliberately has no `carla` dependency. Its protocol,
capability gate, exact-binding checks, and deterministic stepping can be tested
without installing a multi-gigabyte simulator. A deployment supplies a small
backend implementing `CarlaBackend` with the CARLA Python API.

Hard gates:

- the complete OpenDRIVE bytes must match `mapXodrSha256` before the world loads;
- actor catalog bindings and OpenDRIVE signal IDs must resolve exactly and once;
- the bridge owns the only synchronous tick client and uses the declared fixed
  step;
- world loading happens before synchronous settings are applied, and every job
  restores settings, lights, sensors, and actors through backend cleanup;
- every control-stream index is contiguous and its time equals `index * step`;
- unknown features, unknown signal states, missing actors/signals, stale map
  bindings, or unsupported lifecycle transitions reject the job;
- ScenarioRunner/OpenSCENARIO 1.0 down-conversion is a separate feature-gated
  path and can never silently replace trace replay.

Run the dependency-free contract tests with:

```sh
python3 -m unittest discover -s adapters/carla-bridge/tests -v
```

See `docs/carla-renderer-adapter.md` for deployment design, primary-source
research, the capability matrix, and conformance thresholds.
