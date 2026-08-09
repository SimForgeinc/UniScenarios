# DELIVERABLE 6 -- THE AUTHORING BOTTLENECK, MEASURED BEFORE YOUR A/B LANDS

`audit2/authoring_audit.py`, `audit2/authoring_incursion.py`, `audit2/incursion_failure_modes.py`,
`audit2/incursion_rate_run.py`. All incursion figures use the corrected arbiter (`arbiter2.py`).

## 1. Your `changeLane` count is CONFIRMED, and sharper than you put it

Counted independently from templates on disk (323 generated-brief templates, 1533 interactions):

| verb[target mode] | count | share |
|---|---|---|
| `set` | 869 | 56.7% |
| `speed[absolute]` | 327 | 21.3% |
| **`route[polyline]`** | **259** | **16.9%** |
| `laneOffset` | 27 | 1.8% |
| `route[nearMiss]` | 18 | 1.2% |
| **`changeLane[absolute]`** | 8 | 0.5% |
| **`changeLane[relative]`** | 4 | 0.3% |
| **`changeLane[toRole]`** | **2** | **0.1%** |

**`changeLane` in all modes: 14 of 1533 = 0.9%.** And the mode you correctly identified as the right
one -- `toRole`, which cannot miss by a lane -- **is used exactly twice in the entire corpus.**

## 2. But the causal step does NOT hold. Templates that already use it do no better.

True incursion rate, corrected arbiter, over the traces of templates grouped by which lateral
primitive they use:

| template uses | templates | cells | true incursion rate | 95% CI |
|---|---|---|---|---|
| **`changeLane`** | 6 | 22 | **0.455** | (0.269, 0.653) |
| `laneOffset` only | 7 | 41 | 0.098 | (0.039, 0.225) |
| **route polylines only** | 98 | 467 | **0.454** | (0.409, 0.499) |

**Fisher exact: odds ratio 1.00, p = 1.000.** The templates that already use `changeLane` produce
incursions at *exactly* the same rate as the hand-rolled polylines.

This is a small sample (22 cells) and it may be confounded -- the authors who reached for
`changeLane` may be the ones who already understood the manoeuvre. But it is the only prospective
evidence available, and **it does not support the hypothesis that the verb is the cause.**
Please do not treat a null A/B as a surprise.

(Note `laneOffset` at 0.098 is much worse than either. If anything should be removed from the
authoring surface, it is that one.)

## 3. What the failure actually is -- 478 gate-passing cells, split by mechanism

| class | n | share | can a lateral primitive fix it? |
|---|---|---|---|
| real incursion | 171 | **0.358** | -- |
| **moved sideways but stopped short** | 83 | **0.174** | **YES -- this is exactly what `changeLane[toRole]` is for** |
| **spawned already inside the ego's corridor, never moved** | 146 | **0.306** | **NO -- nothing can cut into a lane it is already in** |
| never moved, stayed outside | 78 | 0.163 | partly |

**The dominant defect is placement, not manoeuvre.** Of the 146 already-in-lane cells, only 30 are
legitimately-named lead vehicles for car-following briefs. The other **116 are actors named
`oncoming_cutter`, `drifting_motorcycle`, `wrongWayBicycle`, `reckless_turner`, `detachedWheel`** --
names that explicitly promise a lateral manoeuvre -- **placed in the ego's lane at t=0 and never
moving.** That is verbatim the critic's own longest-standing complaint ("a car that is simply
already in the lane is NOT a cut-in"), and it is a **role pose / spawn** problem, not a verb problem.

Of the 83 that moved but stopped short, the median stopped **3.10 m** from the ego's path -- a full
lane short, not a near miss. Widening the corridor to 2.5 m would rescue only 36% of them. They are
aimed at the wrong place, which is precisely the `toRole` case.

## 4. Correction to my own framing: your current run is already far better than 0.352

The 0.352 I quoted pools every run in the project, including the earliest. Per run:

| run | cells | **true incursion rate** | 95% CI | placement defect | targeting defect |
|---|---|---|---|---|---|
| `vista-gen-blind` | 210 | 0.281 | (0.225, 0.345) | 0.290 | 0.162 |
| `vista-gen2-blind` | 162 | 0.426 | (0.352, 0.503) | 0.222 | 0.191 |
| **`vista-gen3-blind`** | 167 | **0.521** | **(0.446, 0.595)** | **0.102** | 0.210 |

**The true incursion rate has risen 0.281 -> 0.426 -> 0.521 across your three runs, and the placement
defect has fallen 0.290 -> 0.222 -> 0.102.** Whatever you changed between gen2 and gen3 already
largely fixed the dominant defect. That is a real, measured improvement that neither of us had
attributed.

**The targeting defect is flat across all three (0.162 / 0.191 / 0.210).** That is the residue, it is
~21% of cells, and it is the one `changeLane[toRole]` is designed to remove.

## 5. Forecast for the A/B, stated in advance so it can be wrong

- gen3 baseline: **0.521**.
- If `changeLane[toRole]` removes the *entire* targeting defect: ceiling **~0.73**.
- If it behaves as the existing `changeLane` templates do (section 2): **no detectable movement**.
- My expectation is between the two and closer to the second, so I would set the bar at
  **detecting a rise above ~0.60**, and I would want n >= 150 cells before believing it.

## 6. To run it when gen4 lands
    python audit2/incursion_rate_run.py /tmp/vista-gen4-blind /tmp/vista-gen3-blind
prints the true incursion rate with a Wilson CI plus the targeting/placement split for each run.
gen4 currently has 5 records and 3 gate-passing cells, far too few to read.
