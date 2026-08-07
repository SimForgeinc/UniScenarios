# FINDINGS — a VISTA-style visual harness for driving-scenario authoring

Lane 2 (visual). Worktree `UniScenarios-vista`, branch `vista-lane`.
Model: `gpt-5.6-luna`, reasoning effort `medium`, for every authoring, repair and judging call.
Frozen admission gate `1a08698e95fca4bc`, never relaxed. Independent evaluation lane ran in parallel
and is credited inline.

---

## 0. The short version

**Sight did not beat blindness.** Two independent DEV runs over the same 32 briefs, the same frozen
surface, and an *identical* numeric diagnosis — the only difference being whether the repair step also
received a rendered image — gave:

| | run 1 frozen | run 1 HQ | run 2 frozen | run 2 HQ |
|---|---|---|---|---|
| **sight** | 9/32 = 0.281 | 6/32 = 0.188 | 8/32 = 0.250 | 6/32 = 0.188 |
| **blind** | 10/32 = 0.312 | 9/32 = 0.281 | **15/32 = 0.469** | 11/32 = 0.344 |

Pooled over both runs: sight 17/64 = 0.266 vs blind 25/64 = 0.391, Fisher exact **p = 0.187**.
Consistent in direction across two runs, never significant. The honest statement is:
**sight did not help, and was directionally worse; the image did not pay for itself.**

Sight was genuinely exercised — 23/32 briefs saw at least one rollout render, 37/88 iterations — so this
is a real test of the hypothesis, not a harness that failed to show the picture.

**The biggest single result is not about sight at all.** The process is stochastic, and resampling it
is worth more than anything else measured here: across four DEV runs, **21 of 32 briefs (0.656) were
admitted at least once**, against a best single-run rate of 0.469 — and the scenarios that resampling
buys are **no worse** than the ones it finds reliably (0.476 vs 0.451 judged-good, p = 1.0).

---

## 1. D1 resolved: the "placement defect" is the unrecorded warm-up

The brief's highest-value open question. Both prior measurements were correct; they measured different
instants, and neither was a materializer bug.

`trace t=0` is the state **after** `warmupSeconds` of simulation. During warm-up the ego closes on the
challenger at the relative closing speed, so an authored gap `G` is, at recorded t=0,

    G - warmupSeconds * (v_ego - v_challenger * cos(dHeading))

| map | authored gap | gap at t=0 | lost | predicted loss |
|---|---|---|---|---|
| yale-street | 82.00 m | 73.06 m | 8.94 m | **8.94 m** |
| yale-street | 80.44 m | 71.84 m | 8.60 m | **8.60 m** |
| belmont-research-center | 63.96 m | 57.23 m | 6.73 m | **6.75 m** |

Agreement within 0.02 m on 3/3 cells, reproduced independently by the evaluation lane
(|t0 − instance| = warmup·v₀ to 0.001 m).

This reconciles every symptom in the D1 report: placement *is* exact at instance level (the sub-agent
was right); it *is* compressed at trace t=0 (the author was right); the "cap near 13.6 m" is not a cap
but the loss scaling with v_ego; the 0.16 correlation follows because the loss depends on
(v_ego − v_chal), which is uncorrelated with the requested gap; and C2 failures starting a median 8.1 m
ahead versus 11.0 m for passes is the same arithmetic.

**The fix is authoring-side and general — no `packages/` change.** The reverted `coverTarget()` patch
addressed a cause that does not exist; leaving it reverted is correct.

**Effect on the brief's headline prediction.** C2 (closest approach at spawn) was 29.3% of admission
loss in the census. After the warm-up rule entered the authoring surface, C2 fell to **12–14%** of
clause failures, and C5 became dominant at 43–45%. So the predicted C2 recovery is real and largely
mechanical — but it was recovered by *arithmetic in the prompt*, not by looking at a picture. A blind
author given the same rule recovers it just as well. This is the cleanest example of the run's overall
shape: the wins were mechanism-level and modality-independent.

---

## 2. What actually decides admission

Measured over 552 (then 1083) simulated cells. These are properties of the evaluator, not opinions.

1. **A cell is accepted if and only if its findings list is empty.** 20/20 accepted cells had
   `findings == []`; every rejected cell had ≥1. There is no partial credit. (Independently confirmed
   by the evaluation lane: 19/19 and 9/9, a clean biconditional.)
2. **`required` invariants are the expensive kind.** A violated `required` invariant emits
   `invariant_violated` and loses the cell; 66 cells were accepted while carrying violated `preferred`
   invariants — including a `preferred` `near_miss` that recorded an actual collision. Demotion
   silences the *invariant*, not the *physics*: an impossible deceleration still emits
   `physically_unavoidable` on its own account. After this rule entered the surface, every template in
   the corpus used zero `required` invariants.
3. **minTTC must land ≤ 3.0 s**, and the common failure was landing at 3.2–4.1 s: just outside.
4. **A declared `occludes` you cannot prove is a rejection** (`occlusion_unproven`), and it cost 157 of
   549 otherwise-perfect cells.

### The dominant authoring error is overshoot, not timidity
Of 549 cells whose physics was otherwise perfect and which died on C5 alone:

| cause | cells |
|---|---|
| `physically_unavoidable` (ego needed more than the **7.85 m/s²** friction ceiling) | 110 |
| a real collision | 46 |
| `occlusion_unproven` | 157 |
| `materialization_infeasible` | 116 |

So **156 cells were too dangerous, not too safe**. An edge case has to be survivable; a guaranteed crash
is rejected exactly as firmly as a boring clip. This produced the survivable-band rule
(`d = v²/11` comfortable, `v²/16` impossible; at the 64 kph that dominates these maps, 29 m and 20 m).

---

## 3. The environment is a hard ceiling on some briefs

Measured from `topology-index.json.gz` and `derived/locations.json.gz`, and independently confirmed:

- **Speed limits are 64 kph almost everywhere** (960/1141 lanes on yale, 964/970 belmont, 563/563
  easterbrook). The shipped gold template asks for 25–60 kph and is therefore *degraded* at nearly every
  site it matches.
- **Adjacent parking lanes barely exist**: 18 / 1 / 0 / 0 / 3. "Emerges from between parked cars" is
  structurally hard on two of five maps.
- **`occlusion_zone` features are abundant** (61/87/96/7/24) — hidden-hazard scenarios are the best
  supported kind on these maps.
- **No map has a rail crossing at all.** `school_zone` exists only on easterbrook (2);
  `work_zone_suitable` only on el-camino (2).

Because admission requires **≥ 3 sites across ≥ 2 maps**, briefs that need those features are
**unadmittable by construction, at any authoring quality**. `c13-rail-crossing` and
`c8-construction-junction` are the two clearest cases in DEV. The four empty taxonomy categories in the
lane-1 baseline are very likely the same effect. Denominators should be quoted both ways:
**21/32 = 0.656, or 21/30 = 0.700 excluding the structurally impossible.**

---

## 4. Sight: where it helped, where it hurt

**It did not improve admission.** Two runs, matched briefs, identical surface hash, identical numeric
diagnosis: 9 and 8 (sight) against 10 and 15 (blind), pooled p = 0.187.

**It did not improve judged quality either.** The independent judge, controlling for the category-mix
confound it flagged *before* the numbers landed:

- run 1 pooled looked like a gap (sight 0.481 vs blind 0.633) but was entirely a category artifact.
  Category-matched: 0.458 vs 0.444, p = 1.0. Paired on the 4 briefs both modes admitted: 0.583 vs
  0.500, p = 1.0.
- run 2 reverses the sign (category-matched sight 0.476 vs blind 0.364). Two runs, opposite signs,
  nothing significant.
- Trajectory-derived difficulty: 62.7 (95% CI 55.9–69.3) vs 63.7 (57.3–70.0); difference −1.0 with a
  bootstrap CI of (−9.8, +8.1), spanning zero. An earlier eye-catching 57.8 vs 35.6 was n = 3 and was
  correctly withdrawn.

**The one asymmetry worth recording — run 1 only.** *Intent-not-realised* was more common under sight
(7/27 = 0.259) than blind (3/30 = 0.100): a genuine ego-vs-reversing-van conflict with no pedestrian in
it at all; a "tailgated brake" in which nothing tailgates; a stationary-animal pass-by instead of a
crossing. The mechanism is plausible and matches the failure the evaluation lane predicted in advance:
**a seeing author repairs what is visible — placement, geometry, whether boxes are on the road — and
does not notice that the brief's mechanism is missing.** Sight makes geometry right and semantics no
better. Run 2 does not replicate it (0.125 vs 0.178, reversed), so it is reported as run-1-only, not as
an established fact.

**Why sight plausibly costs something.** The image is expensive in attention and adds nothing the
numeric diagnosis does not already state more precisely. Clearance, closest-approach time, minTTC,
required deceleration and the evaluator's own reject codes are *exact*; a 64 m-wide top-down render is
not the way to read any of them. Sight is the wrong instrument for a problem whose ground truth is
already numeric and complete.

---

## 5. What did work

1. **Fixing the information the author receives.** Three of my own bugs each silently starved the repair
   step, and each was worth more than the imaging hypothesis:
   - the validator reports under `issues`, not `findings` — the repair prompt was being sent an *empty*
     finding list and could never converge;
   - `arrival_unconverged` and the other `error.code` / `reason` fields were being discarded, so the
     author was told only "error";
   - the evaluator's own reject codes (`trivially_safe`, `occlusion_unproven`, invariant residuals) were
     not being surfaced at all.
2. **Telling the author what the world contains** (section 3). Before this, ~1 iteration in 3 was spent
   discovering that an anchor matched nothing.
3. **A cheap anchor pre-check.** `sites match` before `batch` turns "no sites" into a fast sub-loop
   instead of a wasted authoring iteration.
4. **Keeping the best attempt.** Repairs make things worse often enough to matter (a measured
   1 passing cell → 0 in one step). Carrying the best template forward and expanding *it* across more
   sites at the end converted near-misses into admissions — one brief went 1/10 → 10/76 across 3 maps.
5. **Best-of-N resampling** — see section 7. This is the largest single lever found.

---

## 6. The sampling hypothesis, tested and rejected

Because only ~8% of cells pass, a 10-cell probe might plausibly be *undersampling* good templates.
Tested directly: every non-admitted DEV template re-run over ~150 cells (10 sites × 3 draws × 5 maps),
no re-authoring. **Only 2 of 22 recovered.** Most produced 0 passing cells out of 150.
The failures are real; the probe size was not the bottleneck.

---

## 7. Best-of-N: the one lever that buys yield without costing quality

The loop is stochastic. Across four DEV runs:

| N | mean union (frozen) | max |
|---|---|---|
| 1 | 0.328 | 0.469 |
| 2 | 0.500 | 0.594 |
| 3 | 0.602 | 0.625 |
| 4 | **0.656** | 0.656 |

Union of all four: **frozen 21/32 = 0.656, HQ 20/32 = 0.625** — i.e. **95.2% of everything best-of-N
admits also clears the tightened quality gate.**

Reliability spectrum: 11 briefs never admitted, 7 in 1/4 runs, 9 in 2/4, 3 in 3/4, 2 in 4/4.

**And the extra briefs are not junk.** Independently checked: briefs admitted in only 1 of 4 runs scored
0.476 judged-good, versus 0.451 for briefs admitted in ≥3 of 4 (p = 1.0). Resampling buys real
archetypes.

Two caveats, both honest:
- the four runs span **two** surface hashes, so the union confounds resampling with the run-2 surface
  change. Decomposed: within run-1 surface 15/32, within run-2 surface 18/32. **Resampling alone gets
  ~15–18; the full 21 needs both.**
- a best-of-N rate is a **max statistic** and is only comparable to the 0.312 baseline if lane 1 also
  got N attempts. It must be applied identically to HELDOUT or the generalisation gap is manufactured.

---

## 8. Admission is not quality: the run-2 lesson

Run 2's surface changes lifted blind admission 0.312 → 0.469, comfortably past the lane-1 baseline.
The independent judge then showed what it cost:

| | admitted | judged good | quality-adjusted yield |
|---|---|---|---|
| blind run 1 | 10 | 0.633 | **6.33** |
| blind run 2 | 15 | 0.400 | **6.00** |
| sight run 1 | 9 | 0.481 | 4.33 |
| sight run 2 | 8 | 0.542 | 4.33 |

**The +50% admission was paid for one-for-one in quality. The number of scenarios that survive an
independent judge did not move.** Reporting 0.469 as progress without this line would be misleading.

The mechanism is instructive and was predicted-against: giving the author an explicit *impossible*
threshold (`d = v²/16`) turned that threshold into a **target**. Cells previously rejected as
`physically_unavoidable` came back as admitted-but-marginal. `NEAR_COLLISION_BY_TIMING` rose from 0.333
to 0.536 of judged cells.

**A regression I introduced.** "Do not declare `occludes` unless hiding the hazard *is* the scenario"
removed the only constraint keeping props out of the ego's path — the occlusion solver. `EGO_INTERSECTS_PROP`
rose from 0.067 to 0.333 of blind's admitted cells (p = 0.01); my own counter of `Q3_noPropOverlap`
failures rose 17 → 77 (blind) and 18 → 53 (sight). Props are `collidable:false` **and** absent from
`ticks['actors']`, so **neither the engine nor the frozen gate ever objects to the ego driving straight
through a parked SUV.** Only the added Q3 clause catches it. This is the clearest demonstration in the
run that the frozen gate alone is not a sufficient definition of a good scenario.

---

## 9. The gate: audited, and tightened where it was wrong

The frozen C1–C5 gate is left **exactly** as pre-registered so the head-to-head stays comparable. It was
independently audited; my OBB clearance was verified exact against three implementations (worst
disagreement 3.4e-13 m) and against the engine's own `exact-sampled-obb-clearance` (0.000 m, same tick).

The audit found real holes, all closed by an **additional** quality layer (tightening is permitted;
loosening is not). `passHQ = pass AND Q1..Q7`:

| clause | what it closes |
|---|---|
| Q1 joint challenger | C2, C3 and C4 were never required to name the *same* actor, so any slow vehicle within 5 m of the corridor was a free pass |
| Q2 ego really responded | measured from the ego's own speed trace; `metrics.requiredDecelMax` reported 3.0 for an ego with an observed peak deceleration of 0.0000 |
| Q3 no prop overlap | the ego driving through a non-collidable prop — invisible to the engine and to the frozen gate |
| Q4 heading sane | `headingRad` must agree with `atan2(vy,vx)` |
| Q5 not clipped | `metrics.clippedCriticality` |
| Q6 TTC pair is the ego | `minTTC.pair` was never checked to involve the ego |
| Q7 contested space | 9/57 frozen-gate-admitted cells had paths that never overlapped *even with timing removed* |

Q7 uses `pathSeparationM` — the minimum true-OBB clearance over **all pairs** of tick indices, which
cleanly separates spatial separation from temporal separation. The measure and its implementation
(`judge/conflict.py`) are the evaluation lane's work.

**A frame convention worth recording, because it is a trap aimed straight at a visual harness.** Instance
files store position as `(x, z)` with `z = −y`, but `headingRad` is *already* in the `(x, y)` frame and
must **not** be negated. A mirrored oriented bounding box renders completely plausibly in a top-down PNG,
so a seeing author would confidently "repair" a fault that does not exist. Sight makes this failure mode
worse, not better.

**One methodological note against interest:** the evaluation lane's initial headline —
"the min-clearance instant is never the actual conflict", firing on 28/28 cells — was **its own bug**, a
bearing test rather than a path test, and it was retracted with a corrected instrument. Under the correct
measure, 28/28 cells are genuine encroachments and **C3 is scoring the right instant**. A flag that fires
on everything is an alarm about the flag.

---

## 10. Honest limits

- Every sight-vs-blind comparison here is n = 32 per cell. Nothing reached significance; the direction
  was consistent across two runs but the pooled p is 0.187.
- The corpus is not ~100 archetypes. DEV best-of-N reaches 21/32 distinct briefs.
- Best-of-N confounds resampling with a surface change; the clean version is N independent runs at one
  frozen surface on both splits.
- Run 2's surface raises admission and does not raise quality-adjusted yield. It should not be presented
  as an improvement to the corpus.
- The prop-overlap regression is live in the surface frozen for HELDOUT. It is caught by Q3, so HQ
  numbers remain trustworthy, but the frozen-gate HELDOUT number is inflated by it.

---

## 11. HELDOUT — authored once, through a surface frozen by hash

Surface frozen at `sha256 b634be8042cf2cd02f3fea39b2d3391bd86f25cb7b999528df42164f8e7f8484` **before**
the HELDOUT run and not modified afterwards. Identical hash to DEV run 2. Zero per-brief tuning.
Both arms run on all 60 HELDOUT briefs.

| | DEV (run 2) | HELDOUT | gap |
|---|---|---|---|
| sight, frozen gate | 0.250 (8/32) | **0.333** (20/60) | −0.083 |
| sight, HQ gate | 0.188 (6/32) | 0.150 (9/60) | +0.038 |
| blind, frozen gate | 0.469 (15/32) | **0.367** (22/60) | +0.102 |
| blind, HQ gate | 0.344 (11/32) | 0.167 (10/60) | +0.177 |

**Sight and blind converge on HELDOUT** (0.333 vs 0.367). Blind's large DEV-run-2 advantage did not
generalise — it fell from 0.469 to 0.367 — which is further evidence that the run-2 surface change
bought admission rather than capability. Both arms exceed the lane-1 HELDOUT baseline of 0.317.

### Best-of-N applied identically to both splits
The one honest way to quote a max statistic. N = 2 (sight ∪ blind), same frozen surface, same procedure
on DEV and HELDOUT:

| | DEV | HELDOUT | **gap** |
|---|---|---|---|
| frozen gate | 0.562 (18/32) | **0.600** (36/60) | **−0.037** |
| HQ gate | 0.438 (14/32) | 0.250 (15/60) | +0.188 |

**Whole corpus, 92 briefs: 54 admitted = 0.587 under the frozen contractual gate**, against the lane-1
baseline of **29/92 = 0.315**. That is 1.86× the archetypes at a generalisation gap of **−0.037**, i.e.
no overfitting — HELDOUT is very slightly *better* than DEV.

Under the strictly tighter HQ gate (frozen gate **plus** Q1–Q7): **29/92 = 0.315**. That equals the
lane-1 corpus count while clearing seven additional quality clauses that the frozen gate does not test.

### The honest asterisk
The frozen-gate result generalises (−0.037); **the quality layer does not** (+0.188). HQ admission falls
from 0.438 on DEV to 0.250 on HELDOUT. The tightened clauses were developed while looking at DEV
behaviour, and although they were never tuned per brief, they clearly capture something DEV-specific.
The frozen-gate number is the trustworthy headline; the HQ number should be read as an upper bound on
DEV and a fairer estimate on HELDOUT.

---

## 12. Recommendation

Given the objective — the best achievable rate **without** trading away quality — the evidence supports
a deliberately simple method, and specifically **not** the imaging hypothesis this lane was built to test:

1. **Author blind.** The image did not pay for itself in either admission or judged quality, cost wall
   clock, and in run 1 made the author more likely to satisfy the geometry while dropping the brief's
   mechanism. Keep the renderer — it is invaluable for *human* inspection and it is how several of the
   defects here were found — but do not put it in the repair loop.
2. **Spend the effort on the information the author receives instead.** Surfacing the evaluator's own
   reject codes, the real error codes, and a measured inventory of what the maps contain was worth far
   more than sight, and all three were originally bugs or omissions in the harness.
3. **Resample.** Best-of-N is the largest lever measured, and it is the only one with **no** quality
   penalty (0.476 vs 0.451 judged-good, p = 1.0). N = 2 nearly doubles the corpus over a single run.
4. **Gate on quality-adjusted yield, not admission.** Run 2 is the cautionary case: +50% admission,
   zero gain in scenarios that survive an independent judge.
5. **Keep the Q layer, and fix the prop regression.** `Q3_noPropOverlap` is the only thing standing
   between the corpus and scenarios in which the ego drives through a parked SUV, because props are
   `collidable:false` and absent from `ticks['actors']`.
6. **Accept the environmental ceiling.** Rail, school-zone and work-zone briefs cannot reach two maps.
   Either add map inventory or drop those briefs from the denominator explicitly.
