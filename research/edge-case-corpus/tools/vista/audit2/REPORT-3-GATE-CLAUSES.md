# DELIVERABLE 3 -- AUDIT OF THE TWO NEWEST GATE CLAUSES, AND DEDUPLICATION

Summary of what reproduced and what did not:

| claim | verdict |
|---|---|
| Q8: ego and lead interpenetrating with `collisions == []` | **CONFIRMED, and understated** |
| Q8: "39 of 65 gate-passing cells in that batch" | **did not reproduce** (that batch has 5 passing cells); population rate is **29.4% of 1642** |
| Q8: 0.10 m threshold | defensible, but **not** for the sampling reason -- keep it, restate why |
| Q7: "median rejected cell missed by 0.20 m" | **did not reproduce** -- measured **1.97 m**, ~10x off |
| Q7: 2.0 m threshold | **right number, wrong argument**. Keep it; justify from lane geometry |
| Q7 has no timing constraint | **real hole**, 10.8% of rescued cells are >4 s apart |
| dedup: "310 raw -> 61" | **reproduced exactly** |
| dedup: too aggressive? | **no** -- if anything **too lax**, and on the wrong axes |
| Q2 is weak because of one-tick freezes | **I raised this and withdrew it**: 2 cells of 1642 |

---

# CHECKPOINT 1 — Q8 / interpenetration, verified independently

Instruments: `audit2/obb_indep.py` (from-scratch SAT + polygon distance, does NOT import gate.py),
`audit2/fastgate.py` (numpy re-implementation of C1-C5). fastgate cross-checked against gate.py on
150 random traces: **111/111 exact agreement in the decision-relevant regime (clearance <= 5 m)**,
gate.py never under-reports. Scanned all 3390 accept/critical cells across 13 runs
(`audit2/scan-all.json`, `audit2/scan_all.py`).

## 1. Your interpenetration finding is CONFIRMED, and understated

el-camino-road/10e7aead286038ac draw-000, ego vs `slowLead`, both 4.8 x 1.9 m:
- min OBB clearance 0.0 at t=5.66 (centre distance 4.4531 m -- your figure, reproduced exactly)
- it gets far worse: at **t=7.30 the centres are 0.883 m apart**
- Monte-Carlo (400k samples, independent of SAT): **62.5% of the ego footprint is inside the lead
  footprint** -- 5.70 m^2 of overlap
- sustained **268 ticks = 5.36 s** of continuous interpenetration
- `metrics.collisions == []`, verdict accept, band critical

## 2. Rate: your "39/65 in that batch" did not reproduce, the global rate is worse

That specific batch (c1-ccrm-blind/batch-final) has only **5** C1-C5-passing cells, 2 of which
interpenetrate -- not 39/65. Wherever 39/65 came from, it is not that batch. But the population rate
is the real story:

| | n | |
|---|---|---|
| accept/critical cells scanned | 3390 | |
| pass frozen gate C1-C5 | 1642 | |
| ...of which TRUE OBB interpenetration | **482** | **29.4%** |
| ...of which clearance < 0.10 m (Q8 as written) | 518 | 31.5% |

Per run it ranges 0.108 (vista-critic-blind) to **0.457** (vista-gen-blind). Median penetration depth
among overlapping cells is **1.449 m**; the max is 1.900 m, which is exactly the vehicle width --
i.e. total lateral interpenetration. Median duration 43 ticks (0.86 s).

**Q8 is not a nicety. It removes ~30% of everything the frozen gate admits.**

## 3. ROOT CAUSE: the engine's collision detector misses half of all interpenetrations

Cross-tab over the 3390 accept/critical cells:

| | true OBB overlap | no overlap |
|---|---|---|
| `metrics.collisions` > 0 | 565 | 61 |
| `metrics.collisions` == 0 | **576** | 2188 |

- The engine **misses 576/1141 = 50.5%** of true interpenetrations, at median depth 1.6 m.
- It also reports 61 collisions where the OBBs never overlap (different body model, or a bug).

The detector is alive (626 non-zero across the sample) but is roughly a coin flip. **C5's
"0 collisions" clause therefore carries almost no information about contact**, which is exactly why
Q8 had to exist. This is an engine bug worth filing separately from the gate.

## 4. Is 0.10 m the right threshold? Partly justified, but NOT for the reason one would assume

I tested the obvious a-priori justification -- that dt=0.02 s sampling could hide a contact between
ticks. Median relative closing speed at closest approach is 5.1 m/s, so v_rel*dt = 0.102 m (p90
0.29 m), which *predicts* a threshold of about 0.10-0.29 m.

**That prediction is wrong.** I re-computed the closest approach with 16x temporal supersampling
(linear pose interpolation, unwrapped headings) on all 667 gate-passing cells with
0 < clearance <= 2.0 m (`audit2/subtick.py`, `audit2/subtick.json`):

- **0 of 667 cells revealed a hidden sub-tick contact.**
- Median (recorded - supersampled) clearance drop: **0.000 m**; worst band median 0.002 m.

The closest approach is a smooth quadratic minimum, so linear per-tick travel wildly overestimates
the error. **dt=0.02 s is already adequate. Discretisation does not justify any margin.**

### What the distribution actually says
Clearance among the 1642 gate-passing cells:

| band | n | |
|---|---|---|
| exactly 0.0 (overlap) | **482** | 29.4% |
| (0, 0.05) | 21 | 1.3% |
| [0.05, 0.10) | 15 | 0.9% |
| [0.10, 0.20) | 38 | 2.3% |
| [0.20, 0.30) | 24 | 1.5% |

The mass at exactly 0.0 is a **distinct population**, ~13x the local density of the continuum
(~36 cells per 0.1 m band). There is **no natural gap** anywhere in (0, 0.3) -- the density is flat.

**Verdict on the threshold: 0.10 m is defensible but arbitrary, and it is doing very little work.**
Rejecting only true overlap (threshold at 0+) captures **482/518 = 93%** of Q8's effect. The extra
0.10 m buys 36 cells (2.2% of gate-passing) on no principled basis. Moving to 0.20 m would cost a
further 38 on equally no basis. My recommendation: **keep 0.10 m, but state it as a rendering/realism
convention ("bodies within 10 cm are visually indistinguishable from contact"), not as a physics or
sampling argument** -- because the sampling argument is measurably false.


---

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


---

# CHECKPOINT 3 -- is deduplication honest?

Instruments: `audit2/dedup_audit.py`, `audit2/dedup2.py`. Run over the actual harvest population
(the 394 `passHQ` cells produced by mass-simulating 5 verified templates), using the project's own
`gate.deduplicate` unmodified.

## 1. Your "310 raw -> 61" reproduces exactly

| batch | passHQ | distinct |
|---|---|---|
| harvest1 / c9g-displaced-drain-grate | 302 | 54 |
| harvest1 / c3g-trailer-offtrack | 8 | 7 |
| harvest1 / c12g-backward-school-gate | 0 | 0 |
| **harvest1 total** | **310** | **61** |
| harvest2 / c9g-pedestrian-behind-bus | 72 | 45 |
| harvest2 / c10g-left-turn-no-yield | 12 | 3 |

Confirmed. Note the `gate.py` docstring still says "302 ... collapsed to 134", which is the stale
pre-Q8 figure; with Q8 in place it is 302 -> 54.

## 2. It is NOT too aggressive -- same-signature cells really are the same scenario

The signature is `(map, site, clearance/0.5 m, minTTC/0.5 s, egoPeakDecel/1.0)`. The honest test is
whether cells sharing a signature also agree on quantities the signature **never looks at**.
Over the 394 harvest cells in 109 signature groups:

| quantity NOT in the signature | overall SD | mean within-group SD | ratio |
|---|---|---|---|
| closestT | 2.345 s | **0.056 s** | 0.024 |
| pathSeparationM | 0.791 m | **0.016 m** | 0.020 |
| encroachmentGapS | 1.099 s | **0.016 s** | 0.014 |
| egoPeakDecelMps2 | 0.475 | 0.026 | 0.055 |
| minTTC | 1.125 s | 0.054 s | 0.048 |
| clearanceM | 0.352 m | 0.036 m | 0.102 |
| egoSpeedDropMps | 1.555 | 0.307 | 0.197 |

Within a group the spread is **1.4%-20%** of the population spread. Also: **0 of 109 groups contain
more than one distinct challenger** -- the signature implicitly pins down *who the conflict is with*
without ever encoding it. Cells collapsed together are genuinely the same event with numerical
jitter on top. The collapse is justified.

## 3. It IS too lax -- what survives as "distinct" mostly is not

The complementary test: at the SAME site, how much do cells that dedup **kept as different** differ?

| quantity | between-group SD at one site | within-group SD | ratio |
|---|---|---|---|
| pathSeparationM | 0.017 m | 0.016 m | **1.0x** |
| closestT | 0.072 s | 0.056 s | **1.3x** |
| egoPeakDecelMps2 | 0.065 | 0.026 | 2.5x |
| clearanceM | 0.114 m | 0.036 m | 3.2x |
| minTTC | 0.280 s | 0.054 s | 5.2x |

Two cells at the same site that the signature calls **different lessons** differ by, typically,
**11 cm of clearance, 0.28 s of TTC and 0.065 m/s^2 of ego deceleration**, and are
**indistinguishable** in closest-approach time and path separation. No driving policy learns
anything different from a near miss at 1.2 m versus 1.3 m at the same site with the same challenger
under the same geometry.

**The 61 surviving scenarios are still mostly near-duplicates.** The band widths (0.5 m, 0.5 s,
1.0 m/s^2) are far finer than the true structure of the population, so which side of a band a cell
lands on is arbitrary.

## 4. It is also the wrong signature

The deeper problem is that all three numeric fields are **outcome** variables -- how close, how
soon, how hard -- and outcomes are exactly what parameter jitter perturbs. "Teaches a different
lesson" is a statement about **conflict structure**, not about outcome magnitude. A signature that
matched the claim would be over:

    (mapId, siteId, challenger CLASS, conflict GEOMETRY {crossing | oncoming | following},
     whoArrivedFirst, occluded {yes|no}, ego response type {brake | swerve | none},
     and only then a COARSE severity band -- e.g. clearance in {contact, <1 m, 1-3 m, 3-5 m})

All of those are already computed: class from `actorMetadata.dims`, geometry and `whoArrivedFirst`
from `judge/conflict.py`, occlusion from a sightline test, ego response from the speed trace.

**Recommendation:** do not tighten the existing bands -- change the axes. And in the meantime treat
the "distinct" count as a soft upper bound rather than a corpus size. On the evidence here,
61 distinct is closer to ~30 genuinely different lessons.

## 5. Caveat against my own result
This is measured on 5 templates from 2 harvest runs, and 302 of the 394 cells come from a single
template (`c9g-displaced-drain-grate`) which -- see REPORT-1 -- is itself a confirmed critic false
positive whose mechanism is absent. The within/between ratios are therefore dominated by one
scenario family. The direction of the conclusion is clear, the exact ratios are not general.
