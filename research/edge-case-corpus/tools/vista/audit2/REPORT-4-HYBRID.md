# DELIVERABLE 4 -- AUDIT OF hybrid.py (commit 37e6dce)

Both requests answered. `hybrid.py` and `motion.py` were imported **unmodified** from the vista dir,
so this measures the shipped validator. Scripts: `audit2/score_hybrid.py`,
`audit2/hybrid_predicate_audit.py`, `audit2/incursion_audit.py`, `audit2/lane_arbiter.py`,
`audit2/incursion_rate.py`, `audit2/incursion_variants.py`.

## REQUEST 1 -- is hybrid materially better than 0.545 precision?

**Honest answer: better, but not materially. The real gain is recall, not precision.**

On your production distribution (the 44 true pairs -- real briefs on their own gate-passing cells):

| system | precision | recall | F1 | **FP rate** | TP/FP/FN/TN |
|---|---|---|---|---|---|
| vision critic alone (the old thing) | 0.545 | 0.333 | 0.414 | 0.192 | 6/5/12/21 |
| hybrid, strict (`present` only) | 0.600 | 0.333 | 0.429 | 0.154 | 6/4/12/22 |
| **hybrid AS SHIPPED** (+ unanimous critic veto on `present_needs_vision`) | **0.615** | **0.444** | 0.516 | **0.192** | 8/5/10/21 |
| hybrid mechanical only, **no veto applied** | 0.542 | 0.722 | 0.619 | **0.423** | 13/11/5/15 |
| **hybrid + unanimous veto, but on the `enh` render** | **0.714** | **0.556** | **0.625** | **0.154** | 10/4/8/22 |

- Precision 0.545 -> **0.615**, 95% CI (0.32, 0.86). That improvement is **well inside the noise**.
- Recall 0.333 -> **0.444** is the real gain, and it is what let your A/B detect the 0.259 -> 0.500
  authoring improvement that the old critic scored at 2/27.
- **The vision veto is doing essential work.** Without it the mechanical layer alone has an FP rate of
  **0.423** on true pairs. Keep the veto; do not ship `present_needs_vision` as an accept.
- **Switching the critic's render to `enh` is worth more than anything else here**: precision
  0.615 -> 0.714 and recall 0.444 -> 0.556, for a rendering change (REPORT-2).

### hybrid's 5 false positives, and the two bugs behind them
| brief | what hybrid required | why it is wrong |
|---|---|---|
| `c8-shifted-alignment` | **only** `static_obstacle_present` | that predicate is `len(propMetadata) >= 1` -- it asks "does this clip have any prop", which is true of 64% of clips. The brief was reduced to a tautology. |
| `c10-ego-overtake` | **only** `challenger_oncoming` | the "oncoming" car travels 1.7 m in the whole clip |
| `c11g-wrong-way-aisle` | `challenger_oncoming` + `is_vehicle` | the motorcycle's relative heading is **+32.5 deg, i.e. same-direction** |
| `c9g-falling-tree-branch` | vehicle predicates + `static_obstacle_present` | the "branch" is a 5.5x2.0 m car-shaped actor that moves 0.6 m |
| `c10g-trailer-jackknife` | 8 predicates, all held | `central` was `ego_brakes_hard`, which fires on 89% of clips |

**BUG 1 -- `challenger_oncoming` never checks relative heading.** It tests
`headingChangeDeg < 45 AND aheadAtStart AND moves AND minAbsLateral < 6`. A lead vehicle travelling
the same way satisfies all four. Measured against true relative heading at closest approach:

| | truly oncoming | crossing | **same-direction** |
|---|---|---|---|
| predicate fires | 3 | 3 | **16** |
| does not fire | 6 | 14 | 24 |

**precision 3/22 = 0.136, recall 0.333.** One-line fix: require
`abs(relative heading at closest approach) > 135 deg`.

**BUG 2 -- several predicates are near-tautologies.** Base rates over 45 traces:
`challenger_is_ahead` **45/45 = 1.000** (it reads `lons[0] > 0` at the first tick and challengers are
always spawned ahead), `ego_brakes_hard` 0.889, `challenger_brakes_hard` 0.844,
`challenger_stops_in_path` 0.711, `static_obstacle_present` 0.644. A predicate that fires on
everything cannot discriminate, but the parser is free to choose it as `central`.
**Suggest: refuse to accept a brief whose `central` predicate has a base rate above ~0.6.**

Good news: `actorMetadata.kind` **is** populated (pedestrian/car/truck/van/motorcycle/bicycle/bus/
static_object), so `challenger_is_*` works, and "ALWAYS BIND THE ACTOR TYPE" is doing real work.

## REQUEST 2 -- `challenger_enters_ego_path`

**Your diagnosis is inverted. The predicate is not too strict -- it is far too loose, and it is not
your bottleneck.**

### An arbiter neither of us wrote
The trace already carries `ticks.actors[aid].lateralOffsetM`: **the engine's own per-tick lateral
offset of each body from its lane centreline.** That is exactly the quantity the predicate is trying
to estimate, computed exactly, and it depends on neither implementation. Sanity-checked by hand on
`c12-crossing-guard`: `child_near` 3.71 -> -0.53 m (a real incursion), `crossing_guard` constant
3.97 m (never moves), ego within +-0.85 m.

Definition: a body made an incursion if, while co-present with the ego, its own lateral offset went
from `>= 2.25 m` to `<= 1.25 m`. Bodies in the band between are not scored.

### Result, 951 decisively-arbitrated challengers across all runs
| variant | precision | recall | F1 | accuracy | TP/FP/FN/TN |
|---|---|---|---|---|---|
| **A -- hybrid as shipped** | **0.375** | 0.717 | 0.493 | 0.671 | 152/**253**/60/486 |
| B -- hybrid + longitudinal gate `abs(lon) <= 30 m` (1-line) | 0.459 | 0.613 | 0.525 | **0.753** | 130/153/82/586 |
| C -- distance to the ego's **path polyline**, excursion >= 2.8 m | 0.453 | **0.726** | **0.558** | 0.743 | 154/186/58/553 |

**Recall is already 0.717. Precision is 0.375.** It fires 253 times when nothing entered anything.

### The cause
`ego_frame_offsets` computes `lat = -dx*sin(h) + dy*cos(h)` at the same tick, **with no longitudinal
gate**. A body 100 m away at right angles to the ego's instantaneous heading gets `lat = 100`. Then
as the ego drives on or turns, the geometry rotates and `|lat|` falls below 1.2 m --
`started_outside` is True and `any(in_lane)` is True, so **`entersEgoPath` fires for a body that
never changed lanes at all.** Verbatim start-lateral values from its false positives:
`cyclist 102.57 m`, `splitterVan -67.64 m`, `pickup -66.96 m`, `oncoming_suv -40.26 m`. The engine
says those same bodies moved **0.16-0.67 m** sideways in their own lanes; the median lateral range of
a hybrid false positive is **0.21 m**, versus **3.29 m** for a true incursion.

**It is measuring "did the ego eventually get near this thing", not "did this thing move into my lane".**

### Why authored incursions "fail to happen" -- they mostly genuinely do not
Over **1489 gate-passing cells**, using the engine arbiter:
- cells that **truly** contain a lateral incursion: **426 = 0.286**
- cells where `entersEgoPath` fires: 775 = 0.520

So **only 29% of everything your gate admits contains a lateral incursion at all** (per run: 0.078 to
0.443). A brief requiring one will fail roughly 7 times in 10 no matter how the predicate is written.
**The 18-30 misses per run are an authoring/environment limit, not a threshold problem** -- and the
predicate is currently *hiding* how bad it is by over-firing.

### What to do
1. **Stop estimating it. Use `lateralOffsetM` directly.** The simulator computes the right quantity
   exactly; `audit2/lane_arbiter.py` is ~25 lines and is a drop-in replacement.
2. If you keep the ego-frame method, add the longitudinal gate: precision 0.375 -> 0.459, accuracy
   0.671 -> 0.753, 100 fewer false positives.
3. `INCURSION_LATERAL_M = 1.2 m` is a secondary issue and is measured to the challenger's **centre**,
   so a 1.9 m car must come more than halfway into the ego's lane to qualify. If you keep it, add
   half the challenger's width.
4. Track the true incursion rate (0.286) as an **authoring** metric. That is the volume blocker.
