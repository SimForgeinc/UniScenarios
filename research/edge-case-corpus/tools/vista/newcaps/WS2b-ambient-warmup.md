# WS-2b: Ambient warm-up / settle (measure M2.3)

## BOTTOM LINE
IN PROGRESS. Design fixed, implementation starting. No measured number yet.

M2.3 number: TBD (baseline from WS-2: 0 of 32 ambient actors below 0.5 m/s at t=0 -> M2.3 FAIL)

## The problem (inherited diagnosis, not re-derived)
`choreography.warmupSeconds` is 0.6 s on the corpus templates. Ambient actors spawn already at
cruise, so at t=0 no one has had time to stop. Measured on a 9-cell c15g `--ambient city` run:
0/32 ambient below 0.5 m/s at t=0 (min 5.02, median 13.60 m/s); by the end of the 13 s clip 14/32
are below 0.5 m/s. The queuing BEHAVIOUR is fine; there is no settle window before t=0.

Raising `warmupSeconds` is forbidden: `sim/engine.ts` integrates the WHOLE scene from
`t = -warmupSeconds`, so it also advances the ego and the authored challenger and destroys the
authored conflict timing.

## The design: an ambient-only settle pre-pass (write-back of initial state)
Instead of lengthening the shared prologue, run a SEPARATE, throw-away simulation that contains
ONLY the generated population, then write its final state back as the ambient actors' *initial*
state in the real input. Authored actors are never in the settle sim and their input bytes are
never touched.

Key facts that make this exact and cheap:
* `sim/engine.ts` (~:547-556) derives `routeS` by PROJECTING `initial.pose` onto the route.
  `initial.laneRef` is advisory. So a settled actor is expressed by rewriting
  `initial.pose` (x,z,headingRad), `initial.speedMps` and `initial.laneRef`, keeping the SAME
  `behavior.route.lanes`. No route surgery is needed.
* Signal phase alignment: `SignalBook.stateAt` uses `elapsed = t + warmupSeconds + offsetS`.
  Real run at `t = -warmupSeconds` has `elapsed = offsetS`. Settle run (warmupSeconds = 0) at
  `u = settleSeconds` has `elapsed = settleSeconds + offsetS'`. Therefore the settle sim uses
  `offsetS' = offsetS - settleSeconds`, and the settle ends on exactly the phase the real run
  begins its prologue with. Queues that formed at a red light are still queued when the real
  clip starts.
* Trace frame is xodr-local; `pose.z = -track.y` (`frames.ts`).
* Determinism: same seed + same profile => same settle => same digest, so M2.4 is preserved.
* Ambient OFF => the pre-pass is not called at all => byte-identical authored traces.


## MEASURED SO FAR (probe A: c15g-red-light-runner-signals, --all-maps --max-sites 3 = 15 cells, --ambient city)

Measured with `audit.py m2_2_2_3_2_5`, identical command except `--ambient-settle`:

| measure | settle 0 (baseline) | settle 20 |
|---|---|---|
| M2.2 median ambient within 60 m at t=0 | 5 (PASS) | **0 (REGRESSED)** |
| M2.3 fraction of cells with >=2 ambient stopped at t=0 | 0.467 (FAIL) | **0.667 (PASS)** |
| M2.3 median t=0 speed spread | 17.82 m/s | 13.00 m/s (still distributed) |
| M2.5 closest partner is ambient | 0 (PASS) | 0 (PASS) |

So the settle DOES build the queues (M2.3 0.467 -> 0.667) and keeps speeds distributed, but v1 of it
**regressed M2.2**: the population was selected for being near the authored choreography and then given
20 s to drive AWAY from it. Two defects in v1, both from the same root cause (selection happens
BEFORE the settle):

1. **Population drains away from the site.** 20 s at ~13 m/s is ~260 m of travel; the selected ring
   is gone by t=0. Median near-ego count 5 -> 0.
2. **Authored spawn exclusion is no longer enforced at t=0.** `exclusionRadiusM` keeps generated cars
   off the authored spawn points at *spawn* time; after 20 s of settle a car can be sitting on the ego.
   Observed as new `spawn_overlap ... overlaps ambient:v1:...` issues.

FIX (v2, in progress): **settle first, select after.** Build a larger settle cohort (targetMultiplier x
the placement target), settle the whole cohort, then apply the near-authored ranking, the authored
reservations and the actor budget to the POST-settle positions. That is the configuration the clip
actually records, so it is the configuration the selection rules should be applied to.

## Status log
- [t0] Stub created.
- [t1] Read WS2-ambient.md, engine spawn path, SignalBook, ambient/traffic.ts. Design above fixed.
  Next: implement `packages/sim-engine/src/ambient/settle.ts`.
