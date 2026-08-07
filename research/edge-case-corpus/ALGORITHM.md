# The algorithm: agent-native tool authoring with a solver-owned coordinate boundary

## What it is
`LLM agent + frozen tool surface + pre-registered rubric + shared graded solver + strict physical gate.`

A **brief** (one sentence of natural language) is the authoring unit. The agent replies with ONLY a JSON
array of tool calls. It never writes a coordinate, a road id, a metre, a tFrac, a radian or a timestamp.

## What is novel, and why
1. **The authoring unit is a layout OPERATION, not a template with slots.** `narrow_lane`, `close_lane`,
   `place_actor`, `require` are verbs over road structure. Object count is open and relationships are
   arbitrary, which a fixed-arity grammar cannot express. The single largest measured jump in this project
   came from adding an operation (MUTCD *shifting* vs *merging* taper), not from tuning a parameter --
   contacts 110/148 -> 19/148. A dial could not have found that; it is a different object layout.
2. **A hard coordinate/time boundary.** The agent expresses intent (site handle, lane by role, zone by name,
   catalog id, count, ordering, target criticality band). The solver owns s, x, y, tFrac, radians, absolute
   time and speed. This is what makes the output portable by construction.
3. **`require(metric, ...)` as declared intent.** The agent says "there should be a near miss between ego and
   X". The solver decides what that MEANS: it installs the arrival relation, picks the criticality measure,
   and solves the parameter ranges. Metric selection is a solver concern, not an authoring concern.
4. **Invalid states are unrepresentable rather than diagnosed.** A missing site is created lazily; a crossing
   VRU is re-bound relative to the ego automatically; two interactions may not take the same state axis --
   the last writer wins. Every one of these replaced a class of agent error, not an instance of one.
5. **The tool surface is frozen by hash before the held-out run**, so generalisation is measured against an
   authoring layer that cannot have been adjusted to fit.

## The measured defects this loop exposed (all fixed generally)
| id | defect | evidence |
|---|---|---|
| F1 | a crossing VRU emitted `kind:on_reference` with absolute `s`; the anchor matcher rejected it at **127/127** sites | 0 sites, 0 cells for every C5/C12 brief |
| F2 | `when="on_approach"` compiled to `trigger {kind:"at", t:0}` -- the timing was silently discarded | all 160 traces graded `band:"no-interaction"` while the rubric still said accept |
| F3 | two interactions could take the same `rules.*` axis of one actor | `invalid_scene` whenever the agent also asked for `ignore_right_of_way` |
| F4 | revived-kernel namespaces held stale copies of the builder class, so fixes silently did not reach the pipeline | manual run gave 40 sites, pipeline gave 0 |
| F5 | the engine's own re-solved `nearMiss` route primitive existed and was unused; a baked polyline was being hand-rolled instead | replaced with the first-class mechanism |
| B4 | `catalogId:"vehicle.boxTruck"` validated exit 0 and materialised as a **sedan** | fixed at source with `isKnownPropCatalogId` + 4 tests |

## The strict physical gate (pre-registered, sha256 `1a08698e95fca4bc`)
A blind judge reading passing traces rejected **27/52**. Inspection showed `evaluate band="critical"` can be
satisfied by spawn-time artifacts (minTTC = 0 at t = 0 with both actors stationary) and by scenes with 16-32 m
separation and zero required deceleration. The gate was therefore **tightened, never relaxed**:
ego must actually drive; the closest approach may not be a spawn artifact; TRUE oriented-bounding-box
clearance (not the engine's circumscribed-circle proxy) must be <= 5 m; and there must be real demand.

Blind-judge agreement moved **0.481 -> 0.917** on the gated set. That is the gate's justification.

## Final measured result
- **29 archetypes admitted** with intact evidence, out of 92 briefs, across **11 of 15** categories.
- **DEV 10/32 = 0.312, HELDOUT 19/60 = 0.317, generalization gap = -0.004.**
- Replay: **156/156 traces bit-identical** via `evidence verify`.
- Blind per-scenario judge: **0.828** agreement that the scene is a critical edge case; **0.517** on category.
- Blind corpus-layout judge: **"inadequate", not fit for training data** -- C13, C3, C4, C6 uncovered.

## Honest limits
The corpus is **29, not ~100**. Four taxonomy categories are empty. The category-level agreement with the
blind judge is barely above chance-adjusted expectation. The algorithm generalises (gap ~ 0) but its
*absolute* admission rate is ~31%, and that is the real bottleneck.
