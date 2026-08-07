# caps-sensor — perception layer

## Status
- [x] Failing test written and confirmed (`sensors` was silently stripped by `parseSimScenarioInput`).
- [x] Engine perception layer: schema, model, runtime, trace channel, metrics.
- [x] `detected(...)` trigger condition — the reaction is genuinely in-loop.
- [ ] scenario-model invariants + `detected` condition
- [ ] materializer passthrough
- [ ] cli invariant checks
- [ ] template proof

## Measured, synthetic straight road, pedestrian 250 m ahead, ego 12 m/s, dash camera
| air | first detection | brake trigger | stops short by | recorded gap reason |
|---|---|---|---|---|
| clear (V = 20 km) | t = 5.02 s | t = 5.02 s | 168.9 m | `below_angular_resolution` |
| dense fog (V = 120 m) | t = 17.40 s | t = 17.40 s | **24.1 m** | `atmospheric_attenuation` |

Line of sight was clear from t = 0 in BOTH runs (`firstLineOfSightT = 0`), so the
12.4 s difference is entirely perception, not geometry.

## Defects the tests caught
1. Static actors are engine occluders, so the pedestrian occluded the sight line to
   *itself*. Fixed: neither endpoint occludes the segment between them.
2. `KOSCHMIEDER_K = 3.912` pairs with a 2% contrast threshold, not 5%. Defaults corrected
   so `fogVisibilityM` means exactly what a weather report means.
3. A map divergence with no declared `observers` tracked nothing when no actor carried a
   sensor. Fixed: empty means every actor.
