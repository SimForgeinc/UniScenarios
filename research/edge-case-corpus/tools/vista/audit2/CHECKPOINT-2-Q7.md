# CHECKPOINT 2 -- Q7, deduplication, and the Q layer's actual bite

Instruments: `audit2/q7_audit.py` (+ `q7-scan.json`), `audit2/qlayer.py` (+ `qlayer.json`).
Both run the project's own `gate.py` and `judge/conflict.py` unmodified, over all
**1642 C1-C5-passing cells** across 13 runs.

## 1. Your stated justification for relaxing Q7 to 2.0 m does NOT reproduce

> "among Q7-failing cells the median pathSeparationM was 0.20 m and the 25th percentile 0.09 m --
> paths missing by centimetres"

Measured on the population that argument is about -- gate-passing cells that fail **nothing except**
the original `pathSeparationM == 0` rule (n = 395):

| | claimed | measured |
|---|---|---|
| median pathSeparationM | 0.20 m | **1.973 m** |
| 25th percentile | 0.09 m | **0.972 m** |

Off by roughly **10x**. Not one of the 13 runs has a median below 1.16 m. Over all 485 cells with
pathSep > 0 the median is 1.868 m. Wherever 0.20 m came from, it is not this measurement.

**The consequence is the uncomfortable one.** 2.0 m lands essentially exactly on the *median of the
distribution it is filtering* (1.973 m), and rescues **202/395 = 51.1%** of the cells the original
clause rejected. A threshold placed at the median of the population it is meant to exclude, argued
for on a figure that is 10x off, is the textbook signature of a yield dial rather than a criterion.

## 2. But 2.0 m is nevertheless the RIGHT number -- for a reason you did not give

Two independent arguments support it:

**(a) Lane geometry.** Measured over all 2523 driving lanes in the five dev maps, the median
`representativeWidthM` is **3.50 m** (p25 3.22, p75 3.77). Two 1.90 m vehicles in adjacent lanes
therefore have a body-to-body gap of **1.32-1.87 m**. So:
- any threshold **below ~1.9 m makes an adjacent-lane close pass structurally impossible to pass
  Q7** -- and you explicitly want those to count;
- two lanes apart is 2 x 3.50 - 1.90 = **5.10 m**.
- Any threshold in **(1.9, 5.1)** selects exactly "same lane or the adjacent lane".
- **2.0 m is the tightest value in that band**, i.e. the most conservative choice that still does
  what you said you wanted. That is a real argument. Use it instead.

**(b) The empirical distribution has a trough there.** Histogram of pathSeparationM over the 847
otherwise-clean cells: a huge mode at [0, 0.25) (n=484), then a flat shelf, a **minimum at
[2.25, 2.50) (n=13)**, then a second mode at [2.50, 3.00) (n=116). 2.0-2.4 sits in the valley
between the two populations, not on a slope. Moving to 2.5 or 3.0 would cut into the second mode
(3.0 m would rescue 89% of the rejected set -- clearly too lax).

**Verdict: keep 2.0 m, replace the justification.** The number survives; the argument for it does not.

## 3. Q7 has no timing constraint at all, and that IS a hole

`pathSeparationM` is a minimum over ALL PAIRS of tick indices -- timing is deliberately removed.
Q7 as written is `contested or pathSep <= 2.0` and never looks at `encroachmentGapS`, even though
`conflict.py` computes it and the evaluation lane's own FAILURE-MODES.md pairs the two
(`pathSep <= 2.0` **and** `encroachmentGapS <= 4.0` **and** `|lagS| <= 1.0`).

Among the **1426 Q7-passing** cells:
- 33.4% have the two bodies at that contested point more than **1 s** apart
- 11.4% more than 2 s, 4.1% more than **4 s**, max **12.9 s**

Among the **269 cells rescued by the 0 -> 2.0 m relaxation**, **29 (10.8%) have
encroachmentGapS > 4 s** -- their paths come within 2 m of each other, but they are never there at
anything like the same time. That is not a contested space; it is two vehicles using the same road
several seconds apart.

**Recommendation: `Q7 = contested OR (pathSep <= 2.0 AND encroachmentGapS <= 4.0)`.** Costs ~29
cells of the 269 rescued and closes the only genuine hole in the clause.

## 4. Structural note: Q7 is partly redundant with C3

`pathSeparationM` (timing-decoupled minimum) is **by construction <= the simultaneous minimum
clearance**, which C3 already caps at 5.0 m. Confirmed: 1642/1642 gate-passing cells have
pathSep <= 5.0. So Q7 at 5.0 m would be exactly vacuous, and Q7's whole usable range is (0, 5).
2.0 m is at 40% of that range.

## 5. Marginal bite of every clause (n = 1642 gate-passing cells)

| clause | fails | rate |
|---|---|---|
| Q1_jointChallenger | 0 | 0.000 |
| Q2_egoReallyResponded | 81 | 0.049 |
| Q3_noPropOverlap | 167 | 0.102 |
| Q4_headingSane | 3 | 0.002 |
| Q5_notClipped | 0 | 0.000 |
| Q6_ttcPairIsEgo | 173 | 0.105 |
| Q7_contestedSpace | 216 | 0.132 |
| **Q8_noBodyOverlap** | **517** | **0.315** |
| **highQuality (all eight)** | **654 pass** | **0.398** |

**Q1 and Q5 never fire on a single one of 1642 cells.** They are dead clauses on this population --
harmless, but they should not be counted as evidence that the Q layer is doing eight things.
It is doing five, and Q8 alone does more work than the other seven combined.

### A concern I raised and then had to withdraw -- Q2 is fine
I flagged Q2 as weak because it thresholds `egoPeakDecelMps2 >= 1.0` computed **per tick**, and the
engine really does freeze an actor's speed to exactly 0 in a single tick on contact (verified:
el-camino-road/10e7aead, ego 2.035 -> 0.000 m/s in one 0.02 s tick = **101.7 m/s^2**). Freezes are
real and occur in **4.9%** of gate-passing cells.

**But the concern does not survive measurement** (`audit2/engine_checks.py`). Re-running Q2 with a
0.30 s window instead of a single tick, over all 1642 gate-passing cells:

| Q2 variant | passes |
|---|---|
| as written (per-tick >= 1.0 AND drop >= 1.5) | 1561/1642 = 0.951 |
| windowed 0.30 s | 1559/1642 = 0.949 |
| **pass ONLY because of the per-tick spike** | **2** |

Two cells out of 1642. The cells that contain a freeze almost all brake genuinely as well, so the
spike never actually decides anything. **Leave Q2 alone.** Negative result, recorded because I
raised it.

### Separately: reversing is structurally unbuildable in this engine
`speedMps` is unsigned, so "the car reverses" is invisible to every check in the pipeline. Recovered
from the sign of displacement projected on each body's own heading, over all 1642 gate-passing cells:
**exactly 1 cell contains any actor that travels >= 0.8 m backwards.** Median max backward travel
0.000 m; 99th percentile 0.001 m.

Three of the 46 briefs I sampled require a reversing vehicle (`c1g-overshot-driveway-reverse`,
`c5-reversing-ped`, `c11-backing-out`). **None of them can ever be realised**, and the critic handled
the three inconsistently -- rejected, uncertain, and **verified** (a confirmed false positive).
Briefs naming a reverse manoeuvre should be filtered out at generation time, not authored and then
judged.
