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

## Status log
- [t0] Stub created.
- [t1] Read WS2-ambient.md, engine spawn path, SignalBook, ambient/traffic.ts. Design above fixed.
  Next: implement `packages/sim-engine/src/ambient/settle.ts`.
