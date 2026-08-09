# DEFECT — a static hazard stops being measured the moment the ego avoids it

Recorded by `caps-catalog`. Verified against `main`-equivalent code in the vista worktree after the
node_modules fix. Two authoring traps and one measurement defect, all measured, none inferred.

## The defect

`trace/metrics.ts observeTick` scores a static/moving pair only while the moving actor is on a genuine
collision course with the static one:

```ts
// Static actors are physical collidables, unlike visual `occluders`, but
// only a dynamic-static collision course enters criticality metrics. This
// keeps an adjacent parked/occluding actor from stealing the incident.
const scorePair = bothStatic
  ? scored
  : (scored || hasArticulatedShape) && (!(a.static || b.static) || staticPath !== null);
```

That guard is right for its stated purpose — a parked car beside the lane must not steal the incident.
But `minDistance` / `minTTC` / `minPET` are *retained minima*, so when the ego swerves and the path
conflict disappears, the pair silently stops updating and the retained value is a sample from **before
the avoidance manoeuvre**.

### Measured

`object.tyre` as a `static: true` role at s=50 in the ego lane; ego on the lane centre; triggered
`laneOffset` avoidance; `rules.collisionAvoidance` disabled so the ego actually passes.

| quantity | value |
|---|---|
| brute-force OBB clearance over all ticks, both bodies present | **0.753 m at t = 1.78** |
| `metrics.minDistance` as reported by the engine | **15.828 m at t = 0.14** |
| `metrics.collisions` | `[]` |

A 0.75 m pass is reported as a 15.8 m pass — a 21x overstatement — and the reported sample is from
0.14 s, before the ego had gone anywhere.

### Blast radius

- **Affected**: `metrics.minTTC`, `metrics.minDistance`, `metrics.minPET`, and therefore `evaluate`
  and anything reading it (the C5 clause). A swerve-past-a-hazard scenario can be judged
  `trivially-safe` on a pre-avoidance sample when the real pass was a near miss. That is a direct path
  to mislabelled training data.
- **Not affected**: the frozen gate's C3. `gate.py` recomputes exact OBB clearance from
  `ticks.actors` x/y/headingRad on every tick where both bodies are present, so it never reads a
  scored pair. Verified independently by the gate owner on a live cell: brute force and gate agree at
  4.956 m / t=8.00 for that cell.
- **Sibling defect, same family**: `sim-engine/src/trace/min-clearance.ts` documents that
  `minDistance` reports a circumscribed-circle proxy rather than footprint clearance. Same metric,
  same fix site — these two should be fixed together.

## Authoring trap 1 — a t=0 avoidance route makes the scenario unmeasurable

Author the avoidance as a `route` polyline at t=0 and the ego is never on a collision course at all, so
the hazard is never a scored pair: 30/30 cells report `minDistance: null` and 29/30 report no finite
`minTTC`. A correctly authored `static: true` hazard, sitting in the lane, with **zero criticality
metrics**.

Author the identical geometry as a **triggered `laneOffset`** and the collision course is preserved:
`minTTC` recorded on 26/30.

Same scenario, same geometry. One of the two silently produces a scenario with nothing to measure.

## Authoring trap 2 — with default rules the ego will not pass a static obstacle at all

With `rules.collisionAvoidance` at its default, the ego **stops short** of a static obstacle in its
lane rather than passing it: it halts at s=44.69 against a hazard at s=50, *after* executing a 1.57 m
lateral displacement that clears a 0.56 m wide tyre by roughly 2 m. Disabling the rule is the only way
observed to make it drive past (it then reaches s=58.31 with 0 collisions).

So "the ego passes debris closely" is close to unauthorable by default. This — not hazard placement —
is why the whole static-hazard family reads as physically-valid-but-boring.

## Fixtures

- `caps-catalog-debris.template.json` — hazard as a static role, ego performs the controlled stop.
- `caps-catalog-debris-contested.template.json` — trap-2 variant: triggered `laneOffset`, ego still
  stops short. Left as the reproduction of the stop-short behaviour.
- Diagnostic-only (not committed): the above plus `set rules.collisionAvoidance=false`, which is the
  configuration that produced the 0.753 m / 15.828 m discrepancy above.
