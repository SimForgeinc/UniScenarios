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
is worth more than anything else measured here: across the first four DEV runs, **21 of 32 briefs (0.656) were
admitted at least once** (24/32 = 0.750 over all five DEV runs re-scored in §16), against a best
single-run rate of 0.469 — and the scenarios that resampling
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

### Correction: the apparent HQ generalisation gap was an instrument change
The +0.188 in the table above is **not** a generalisation failure and should not be read as one.
`Q7_contestedSpace` was added *after* DEV run 2 and *before* HELDOUT, so the two splits were scored with
different gates — visible directly in the records, where DEV `qualityLoss` has six keys and HELDOUT has
seven. Recomputed from the traces with a single gate applied to both splits:

| | HQ **with** Q7 | HQ **without** Q7 |
|---|---|---|
| DEV best-of-2 | 9/32 = 0.281 | 14/32 = 0.438 |
| HELDOUT best-of-2 | 15/60 = 0.250 | 27/60 = 0.450 |
| **gap** | **+0.031** | **−0.012** |

Both are ≈ 0. **The quality layer generalises fine.** This was caught by the evaluation lane, which
reproduced each published number and identified which gate had produced it. The lesson is procedural:
adding a clause mid-study silently made two numbers incomparable, and it looked exactly like a real
scientific finding.

### Which Q clauses actually carry weight
Per-cell loss over frozen-passing cells (DEV-sight / DEV-blind / HELD-sight / HELD-blind):

| clause | loss rate | verdict |
|---|---|---|
| **Q7 contested space** | .208 / .275 / .421 / .203 | dominant on both splits; rescues 3/4/7/5 briefs on leave-one-out |
| Q3 no prop overlap | .188 / .158 / .075 / .123 | real and load-bearing |
| Q6 TTC pair is ego | .042 / .075 / .045 / .145 | modest |
| Q2 ego really responded | .036–.058 | modest |
| Q1, Q4, Q5 | .000 everywhere | **never bind — they cost nothing and prove nothing.** Demote to diagnostics |

So the audit clause that mattered was not the one I expected: it is Q7, the requirement that the two
actors ever contest the same ground.

### A bug in Q7 worth recording
`contested_space()` originally caught `ImportError` and returned `None`, and `quality()` mapped `None`
to `Q7 = True`. Running the gate from any working directory where `judge.conflict` was not importable
therefore **silently disabled the clause and inflated the HQ rate — no error, no log line.** It was
found when the evaluation lane's own attribution run hit exactly that path and measured Q7 loss as
0.000 everywhere. Now fixed to fail closed: the import is deliberately unguarded, so a missing measure
raises instead of vanishing. **A quality clause that quietly turns itself off is worse than no clause,
because it looks like it ran.**

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

---

## 13. The corpus that was actually produced

Collected from all six runs (DEV ×4, HELDOUT ×2), keeping the best version of each brief:

| | this lane | lane-1 baseline |
|---|---|---|
| archetypes admitted (frozen gate) | **57** | 29 |
| of those, passing the tightened HQ gate | **35** | not measured |
| taxonomy categories covered | **14 / 15** | 11 / 15 |
| portability violations | **0 / 57** | — |
| replay determinism | **40 / 40 bit-identical** | 156/156 |
| wall clock | ~210 s per brief | ~35 s per brief |

Category spread: C2 cut-in-merge 8, C5 pedestrian 7, C8 workzone 6, C9 hazard 6, C1 car-following 5,
C7 occlusion 5, C3 intersection 4, C6 cyclist-ptw 4, C11 parking 3, C10 oncoming 2, C12 school 2,
C14 loss-of-control 2, C15 adversarial 2, C4 roundabout 1.

**The single empty category is C13.control.** I originally attributed this to authoring — that a signal
phase change is not by itself an encounter — and that was wrong, or at least not the binding reason.
Measured later by the independent capability workstream: **0 of 16 cells had a signal stop line on the
ego's actually-driven route.** The phase changes, it is recorded in the trace, `SignalBook.authorityAt`
returns the correct authority, and `distanceToStopLine` finds nothing, because the bound programs put
their stop lines on lanes the ego never drives (ego on `612:0:-1, 0:0:-3, 775:0:-3, 1:0:-3`; programs on
`26:*, 72:*, 128:*, 74:*`). **A signal scenario can be authored, materialised, simulated and ACCEPTED
while the signal governs nobody.** That is the worst class of defect in this project, because it looks
like it worked. Recorded as Defect 4 in `newcaps/DEFECT-signal-authority.md` with two reproducers.

**Portability was verified mechanically, not assumed** (`collect.py:portability_check`): no `anchor.pin`,
no `sourceMap`, no `scene_absolute` role, no baked map name, no road/lane/site identifier. 0 violations
in 57 templates. Requirement A holds — the emitted artifact is a logical anchor over road structure, and
every scenario materialises at ≥ 3 sites across ≥ 2 maps it was never authored against.

**Cost.** ~210 s per brief against the baseline's ~35 s, roughly 6×. Most of it is model latency across
up to three authoring iterations plus a final multi-site expansion; the simulation itself is seconds.

---

## 14. The one place sight ever looked better — and how much weight it can carry

On HELDOUT, restricted to the **6 briefs both arms admitted** (same sentence, same gate, same frozen
surface), the judged-good rate was:

| | good / cells | rate |
|---|---|---|
| **sight** | 17/18 | **0.944** |
| blind | 9/18 | 0.500 |

Fisher exact **p = 0.0072** — the only significant result in the study. Driven by `c3-ev-crossing`
(3/3 vs 0/3), `c2-parking-cut-in` (3/3 vs 1/3), `c2-blind-spot` (2/3 vs 1/3).

**How much weight this can carry, stated so it is not over-claimed:** n = 6 briefs; it is one of roughly
20 comparisons run in this study, so a Bonferroni-corrected threshold puts it at ≈ 0.14 and it is **not
significant after correction**; and it did **not** replicate on either DEV run (paired 7/12 vs 6/12, and
6/15 vs 7/15). Pooled across all three runs, paired: sight 30/45 = 0.667 vs blind 22/45 = 0.489,
p = 0.13.

The defensible sentence is: *on the held-out split, restricted to briefs both arms admitted, the seeing
arm produced markedly better scenarios (0.94 vs 0.50, p = 0.007 uncorrected); this did not replicate on
either DEV run and should be treated as a hypothesis for a powered rerun.*

It is nevertheless the shape the rest of the evidence predicts: **sight does not get more briefs through
the gate, but when both arms clear the same brief, the seeing arm's version tends to be the better
scenario.** Quality-adjusted yield on HELDOUT is dead level — sight 20 × 0.450 = 9.00, blind
22 × 0.409 = 9.00.

---

## 15. Is this corpus fit for training data? No — it is a candidate pool

The independent judge's blunt assessment, over 252 judged cells, and I agree with it:

- **45–60% of frozen-gate-admitted cells are rejected by an independent quality judge in every run.**
  On HELDOUT, 55% of sight cells and 59% of blind cells are boring, intent-not-realised, or invalid.
- **~24% never realise their brief.** Their taxonomy *label is wrong*, which is worse than a missing
  scenario, because it teaches the wrong association.
- **Mean novelty (R3) is 2.1–2.4 across every run and never moved under any intervention.** The corpus
  is not novel; it is *competent*. Nothing done here made scenarios more distinctive — a fair result
  given that no intervention targeted novelty.
- Coverage ceiling: 21/32 DEV briefs admitted at least once; 11 never admitted at all.

**The three numbers should be reported separately and never conflated.** All three are best-of-2,
one gate, applied identically to both splits:

| tier | count | meaning |
|---|---|---|
| gate-admitted (candidate) | **54 / 92 = 0.587** | passes the frozen contractual gate |
| quality-gated | **24 / 92 = 0.261** | also passes Q1–Q7 |
| judged fit | **≈ 15** | also survives an independent judge at high/acceptable (measured, §17) |

**Do not call any of this a training corpus until the intent-not-realised rate is under ~10%.** The
honest description of the 57 is a *candidate pool* that a judge must still filter. That is a real
improvement on a baseline of 29 whose corpus-layout judge called it "inadequate" — but it is an
improvement in yield, not a solution to the quality problem.

### What would actually raise quality, on this evidence
Nothing measured here moved novelty or intent-realisation. The two concrete leads are:
1. **Verify intent, don't just verify physics.** ~24% of admitted scenarios do not contain the mechanism
   their brief names. The judge can detect this; the gate structurally cannot, because the gate only
   reads trajectories. Putting an intent check *inside* the loop — reject and re-author when the named
   mechanism is absent — is the highest-value untested change.
2. **Novelty needs an explicit objective.** R3 never moved because nothing ever optimised it. Diversity
   against the already-admitted corpus, rather than against the brief alone, is the obvious mechanism.

---

## 16. Definitive numbers — every run re-scored with ONE gate

Because `Q7` was added mid-study, the tables above mix two instruments. Every run was therefore
re-gated from the raw traces with a single current gate (`regate.py`). **These are the numbers of
record.**

| run | n | frozen | HQ (Q1–Q7) |
|---|---|---|---|
| DEV run 1 sight | 32 | 0.281 | 0.156 |
| DEV run 1 blind | 32 | 0.312 | 0.156 |
| DEV run 2 sight | 32 | 0.250 | 0.094 |
| DEV run 2 blind | 32 | **0.469** | 0.219 |
| DEV run 3 blind (prop rule) | 32 | 0.406 | 0.219 |
| HELDOUT sight | 60 | 0.333 | 0.150 |
| HELDOUT blind | 60 | 0.367 | 0.167 |

### Generalisation, like-for-like (best-of-2, same N and same frozen surface on both splits)

| gate | DEV | HELDOUT | **gap** |
|---|---|---|---|
| frozen (contractual) | 0.562 (18/32) | **0.600** (36/60) | **−0.037** |
| HQ (Q1–Q7) | 0.281 (9/32) | 0.250 (15/60) | **+0.031** |

**Both gaps are ≈ 0: neither the authoring surface nor the quality layer is overfitted to DEV.**
HELDOUT is very slightly *better* than DEV on the frozen gate.

### Against the baseline — one N, applied identically everywhere

An earlier draft of this section paired the *largest available* count (a union over five DEV runs and
two HELDOUT runs) with a gap computed at N = 2, which breaks the rule stated in §11. Corrected: **every
number below is best-of-2, the same procedure on both splits, one gate.**

| | this lane | lane-1 baseline |
|---|---|---|
| HELDOUT rate, frozen gate | **0.600** | 0.317 |
| whole corpus, frozen gate | **54/92 = 0.587** | 29/92 = 0.315 |
| whole corpus, HQ gate (strictly harder) | **24/92 = 0.261** | not measured |
| of those, expected to survive an independent judge | **≈ 15** (measured, §17) | not measured |
| generalisation gap, frozen | **−0.037** | −0.004 |
| generalisation gap, HQ | **+0.031** | — |

**The comparison against the baseline is not like-for-like and should not be quoted as 1.86×.**
Lane 1's 29 is *one arm, one run*; best-of-2 is a max over two arms. Single-arm, same frozen surface,
whole corpus:

| arm | corpus | vs baseline |
|---|---|---|
| sight | 28/92 = 0.304 | **0.97×** — at or slightly below it |
| blind | 37/92 = 0.402 | **1.28×** |
| best-of-2 | 54/92 = 0.587 | 1.86×, but the baseline never got a second attempt |

**The defensible claim is 1.28× single-arm, or 1.86× with best-of-2 against a baseline given one
attempt.** Running the baseline surface twice would settle it and has not been done.

They are also **candidate** archetypes, not archetypes: 45–60% are rejected by an independent judge
(§15). The baseline's 29 were never judged either, so this does not undermine the count comparison —
it undermines the word.

### A negative result on my own fix
DEV run 3 added the prop-placement rule ("keep props out of the ego's driving line") to address the
regression in §8. It **did not work**: frozen admission 0.406 vs 0.469, HQ identical at 0.219, and
per-cell `Q3_noPropOverlap` failures rose from 0.069 to 0.132. Telling the author where *not* to put
props appears to have made it place more of them. The prop problem remains open, and `Q3` remains the
only thing catching it.

### Reproducibility from the committed artifacts
Six templates drawn at random from the committed corpus were re-run from a clean state at a *reduced*
site budget (`--max-sites 4` against the 8–10 used originally): **4/6 still admit**. The two that did
not each produced 2 passing cells and missed only the "≥ 3 distinct sites" clause — a sampling artifact
of the smaller budget, not a defect in the template. Replay determinism was separately verified at
**40/40 bit-identical** via `evidence verify`.

---

## 17. External validation: the physics-only quality layer predicts an independent LLM judge

The strongest evidence that the Q layer is measuring something real, rather than my own preferences.
Over all **252 judged cells**, with `passHQ` recomputed independently by the evaluation lane:

| | HQ-pass | HQ-fail | Fisher |
|---|---|---|---|
| judged **good** | 80/130 = **0.615** | 37/122 = 0.303 | **p < 1e-6** |
| judged **invalid** | 2/130 = **0.015** | 30/122 = 0.246 | **p < 1e-6** |

Two independently built instruments — mine physics-only, theirs an LLM with vision — agree strongly.
**The Q layer doubles the judged-good rate and all but eliminates `invalid`.** This is a better argument
for the tightening than any admission count, because the two instruments share no code, no inputs beyond
the trace, and no author.

It also converts the earlier extrapolated "≈ 13 judged fit" into a measured figure:
0.615 × 24 ≈ **15** like-for-like.

### The one thing the quality layer cannot do — and it is the important one

| | HQ-pass | HQ-fail | Fisher |
|---|---|---|---|
| intent-not-realised | 0.185 | 0.164 | **p = 0.74** |

**Identical.** Every clause in the gate and in the Q layer is a physics clause, and no physics clause
can tell whether the brief's *mechanism* is present. A clip in which a car is simply already in the
ego's lane has exactly the same trajectory statistics as one in which a car cuts in. **The quality layer
has taken physics as far as physics goes.**

This is the direct motivation for the critic (§18), and it is why the remaining ~18% intent failure rate
cannot be fixed by tightening the gate further.

---

## 18. The critic in the loop — application (b) from the brief, built and measured

A second agent watches the **rendered rollout** and rules on one question only: *does the clip contain
the mechanism the brief names?* It never sees the template, the gate result, or the author's reasoning —
only the brief and the pictures — so its verdict is independent of the thing it is checking.

This is the one place where sight is the right instrument. The repair loop's question ("is the clearance
small enough?") is numeric, and the trace answers it exactly; an image is strictly worse. The critic's
question is *semantic*, and **no number in the trace answers it** — §17 shows intent-not-realised is
statistically identical for cells that pass and fail every physics clause I have (0.185 vs 0.164,
p = 0.74).

Validated against ground truth before use: it accepts the gold dart-out (confidence 0.94) and rejects a
brief whose mechanism is absent from the same clip (confidence 0.98, *"There is no oncoming vehicle
turning left across the ego path"*), while still correctly noting the clip contains a genuine conflict.

### Critic-vs-gate agreement — the requested deliverable

Run in-loop over DEV (blind arm, 32 briefs):

| | |
|---|---|
| gate-admitted | 8/32 |
| critic **agreed** the brief's mechanism is present | **4/8 = 0.500** |
| critic **vetoed** | 4/8 = 0.500 |
| final admitted (gate **and** critic) | 4/32 = 0.125 |

**The critic rejected half of what the frozen gate admitted — but on n = 8 briefs**, Wilson 95% CI
(0.215, 0.785). That interval is far too wide to quote 0.50 as a point estimate; the defensible claim is
that a large fraction fails, not that it is exactly half. Applied to the full 60-scenario corpus:
**19/60 = 0.317 intent-verified**, of which **10** also clear the physics quality gate, across 11
categories.

**Two independent intent checks, built from different evidence, both find a large intent-failure rate
that the gate cannot see** — but they are not the same number and should not be pooled as one:

| instrument | unit | rate | 95% CI |
|---|---|---|---|
| this lane's critic | brief-level, n = 8 | 0.500 | (0.215, 0.785) |
| evaluation lane's judge, intent-specific only | cell-level, n = 252 | 0.302 | (0.248, 0.361) |

Fisher exact p = 0.255 — **consistent, not identical, and both intervals are wide.** The judge's
headline 0.45–0.60 is a *five-dimension* rejection rate; decomposing it, 0.302 is intent-specific
(intent-not-realised + invalid) and a further 0.234 is novelty/boredom, which has nothing to do with
intent. Only the 0.302 is comparable to my critic.

**The lane-1 baseline's 0.517 is deliberately excluded from that comparison.** It is *category
agreement* — whether a judge assigns the same taxonomy label — and a scenario can realise its brief
perfectly while being labelled C7 instead of C5, or vice versa. It is context, not a third intent check.

So the supportable statement about the baseline is the weaker one: *its 29 archetypes were never
intent-checked, and on this evidence a substantial fraction would fail such a check.* The specific
figure of ~50% is **not** supported.

### What the critic actually catches
Verbatim, and these are errors no trajectory statistic can see:

- `c9-animal` — *"No animal is present; the actor crossing near the ego is a pedestrian."* The scenario
  is filed under C9.hazard with an animal in its name and contains no animal.
- `c1-tailgated-brake` — *"There is no vehicle behind the ego, so the ego is not being tailgated."*
  Caught four times running; the gate admitted it every time.
- `c8-taper-merge` — *"There is no visible lane-closure taper forcing a lateral merge."*
- `c6-dooring` — *"The cyclist does enter the ego's path, but no parked-car door opening is shown."*

These are **mislabelled** scenarios, which §15 argues is worse than a missing one: a corpus that teaches
"animal crossing" from a clip containing a pedestrian teaches the wrong association.

### It repairs as well as rejects
`c11-double-park` was vetoed at iteration 2 (*"the truck is not shown becoming double-parked or moving
into and blocking the ego lane"*), the critic's specific complaint was fed back as the repair
instruction, and the re-authored version was accepted 2/2 at the final expansion. The critic is not only
a filter; its feedback is actionable in a way the gate's numbers are not.

### The cost, split so the critic is not blamed for more than it did
Two separate drops are easy to conflate:

| step | rate | attributable to |
|---|---|---|
| run-2 blind arm, gate-admitted | 0.469 | — |
| critic-in-loop run, gate-admitted **before any veto** | 0.250 | run-to-run variation, **plus** possibly the critic's feedback changing what the author attempts |
| after the critic's veto | 0.125 | **the veto itself** |

**Only the 0.250 → 0.125 step is the critic.** The first drop is not cleanly attributable and should not
be charged to it. The veto is the correct direction — it removes scenarios that were never valid rather
than degrading capability — but it means an intent-verified corpus needs **best-of-N on top of the
critic**, not instead of it.

## 19. Final state of the corpus

| tier | count | verified how |
|---|---|---|
| gate-admitted candidates (best-of-2) | **54 / 92** | frozen contractual gate, 0 portability violations, 40/40 replay-deterministic |
| \+ physics quality gate Q1–Q7 | **24 / 92** | doubles the independent judge's good-rate, near-eliminates `invalid` (§17) |
| \+ intent verified by the critic | **10–19** | a second agent confirms the brief's mechanism is on screen |

**The honest headline: 54 candidate archetypes at a generalisation gap of −0.037, of which 24 clear a
strictly tighter quality gate and 10 of those are also confirmed by an independent critic to contain
the event they claim — against a single-attempt baseline of 29 that was never intent-checked at all.**

Separately, and on a different denominator: **19 of the 60 scenarios produced across all runs were
intent-verified** by the critic, 10 of them also clearing the quality gate. The nested chain is
54 → 24 → 10; the 19 is not a subset of the 24 and must not be quoted as though it were.

---

## 20. Method note: how the errors in this study were actually caught

Both lanes shipped wrong results and then corrected them. The corrections came from one mechanism, and
it is the most transferable thing here.

**Errors this lane published and then had to fix:**
- a headline pairing an N = 5 count with an N = 2 generalisation gap, breaking a rule stated two
  sections earlier in the same document;
- three different corpus counts (54 / 57 / 60) in one report;
- `Q7` failing *open*, so a quality clause silently disabled itself and inflated the rate it was meant
  to protect;
- a headline nesting error implying 19 intent-verified scenarios were a subset of the 24 quality-gated
  ones, when only 10 are;
- pooling three rejection rates that measure three different things as "convergence".

**Errors the evaluation lane published and then retracted:**
- a `PROXIMITY_IS_NOT_THE_CONFLICT` headline firing on 28/28 cells, which was a bearing test rather
  than a path test — its own bug;
- nearly reporting this lane's `Q7` as broken when it was the reviewer's own import that was disabled;
- a report generator printing a directional claim backwards.

**Not one of these was caught by careful reading.** Every one was caught by *measuring the same thing
twice by different means and treating the disagreement as a bug until proven otherwise*: OBB clearance
against three implementations and the engine's own invariant; admission re-derived from raw traces by
both lanes independently; the Q layer checked against an LLM judge sharing no code with it; conflict
geometry measured by bearing and then by all-pairs path separation.

The corollary, in the reviewer's words, is that **an adversarial reviewer has to be adversarial toward
its own instruments first** — and the specific tell worth internalising is that *a flag which fires on
everything is an alarm about the flag, not a finding.* Both lanes hit that exact failure, in opposite
directions, within a day of each other.

---

## 21. Scaling to training data: what actually changed

The objective moved from "beat a baseline admission rate" to "produce thousands of training-grade
scenarios per day". That reframing exposed problems the earlier framing could not see.

### The validator was the bottleneck, and it was not trustworthy
An independent audit measured the vision-only critic at **precision 0.545 (CI 0.280-0.787), recall
0.333, FP rate 0.085** over 77 ground-truth pairs — **statistically indistinguishable from accepting
everything** (base rate 0.409, Fisher p = 0.31). Its errors were perceptual, not linguistic, measured
against facts the trace settles exactly:

| question the trace answers exactly | critic recall |
|---|---|
| does this actor move? | 0.800 |
| **does it enter the ego's lane?** | **0.500** |
| **does it slow sharply?** | **0.440** |

It missed half of every lane incursion. Verbatim on one case: the critic said a challenger *"remains in
its own adjacent circulating lane"* when it had moved **16.58 m laterally** and turned **88.8°**.

**Worse, it had certified my highest-yield template.** `c9g-displaced-drain-grate` — source of 302 of
310 harvested cells — is a confirmed false positive: the grate never moves, sits 4.83 m from the ego
path, and is never occluded. **The previously reported ~1,300 scenarios/day is retracted**; it was
mostly one non-existent mechanism replicated across sites.

### The fix: compute what is computable, and see only what is not
`motion.py` + `hybrid.py` invert the labour. An LLM reads **only the brief text** and selects from a
closed vocabulary of 18 predicates; **code evaluates them against trace geometry exactly**; the vision
critic is demoted to a **veto on the non-computable residue** (occlusion, "unexpectedly", a door
opening). A predicate the vocabulary cannot express returns `abstain` rather than a guess.
Scored 6/6 on hand-labelled cases including three adversarial negatives on the same clip.

Two bugs found and fixed while building it: a pedestrian who simply stops reported **109 m/s²** of
braking (a dt = 0.02 s sampling artifact — now a 0.3 s windowed measure), and "two parked vehicles"
was being counted as two challengers when parked cars are **props**, absent from `ticks['actors']`.

### The co-travel rule: a clean A/B win
Diagnosed by rendering a failure and adjudicating it myself — a van meant to travel alongside the ego
spent **9 of 13 seconds far ahead in another lane**, converging only in the final frame. The surface
now requires sustained co-travel for alongside/repeatedly/tailgating briefs. On the **identical 84
briefs**, only the surface differing:

| | admitted | **intent-realised** |
|---|---|---|
| surface v3 | 27/84 | **7/27 = 0.259** |
| surface v4 (co-travel) | 28/84 | **14/28 = 0.500** |

Admission was flat; **intent realisation doubled** — which is exactly the axis that matters, and exactly
the axis the old validator could not measure.

The dominant residual failure is `challenger_enters_ego_path` (missing 18-30 times per run): **getting
another road user to actually move into the ego's lane is the hardest thing to author.**

### Measured end-to-end throughput

| stage | time |
|---|---|
| author 84 generated briefs, 6 workers | 64 min |
| intent-verify 28 admitted templates | 167 s |
| harvest 7,620 concrete simulations | 247 s |
| **total** | **71 min** |

28 admitted → **11 intent-verified** → **204 distinct training-grade scenarios**
→ **≈ 4,140 distinct training-grade scenarios per day.**

Yield concentration is now healthy: the top template contributes **31%**, against 97% (from a false
positive) in the retracted run.

### Two more gate clauses, both found by measurement
- **Q8 `noBodyOverlap`** — the frozen C3 bounds clearance from above only, so a true clearance of
  **0.00 m** satisfies it. On one site the ego and lead are both 4.8 m long yet **4.453 m apart
  centre-to-centre** — interpenetrating — with `collisions == []` and `evaluate` returning
  `accept/critical`. **39 of 65 gate-passing cells were the ego driving through the car in front.**
- **Q7 corrected.** It originally required paths to literally intersect; the median cell it rejected
  missed by **0.20 m**, and it would reject any legitimate close pass. Relaxed to a 2.0 m path
  separation.

### Honest counting
`gate.deduplicate()` bands cells by (map, site, clearance/0.5 m, minTTC/0.5 s, decel/1 m/s²). One
template produced 302 "training-grade" cells that collapsed to **134 distinct**, with ego peak
deceleration varying by **sd 0.02 m/s²** across all 302. Only deduplicated counts are reported.

### Brief supply is no longer the limit
`briefgen.py` generates fresh briefs, constrained to the engine's actual primitives (describe observable
motion, never internal mechanical causes — the simulator cannot burst a tyre or jackknife a trailer).
That cut unbuildable briefs **31% → 4%**. Generated briefs author at 0.32-0.39, the same as the
hand-written ones. It did **not** by itself raise intent realisation — a negative result; the
co-travel rule did.

---

## 22. Corrections forced by the second independent audit

Two numbers I published did not reproduce. Both are corrected here; the conclusions they supported
survive, but the arguments were wrong.

### "39 of 65 gate-passing cells were interpenetrations" — did not reproduce
That specific batch contains only **5** C1–C5-passing cells. Wherever the 39/65 came from, it was not
that batch, and it should not have been quoted. The correct figure is from a scan of **3,390
accept/critical cells across 13 runs**:

| | n |
|---|---|
| cells passing the frozen gate C1–C5 | 1,642 |
| …of which the ego truly interpenetrates another body | **482 = 29.4%** |

**The finding is confirmed and understated.** On the worked case the ego's footprint is **62.5%
inside** the lead's (5.70 m² of overlap, 1.80 m depth) sustained for **5.36 s**, with
`metrics.collisions == []` and `evaluate` returning accept/critical. Root cause, independently
established: **the engine's collision detector misses 50.5% of true interpenetrations**, so C5's
"zero collisions" clause carries almost no information. Q8 is doing work nothing else does.
Sub-tick aliasing was ruled out: 16× supersampling over 667 cells found **zero** hidden contacts, so
the 0.10 m threshold is a rendering convention, not a sampling safeguard.

### "The median Q7-rejected cell missed by 0.20 m" — did not reproduce
Measured over the population Q7 actually filters, the median is **1.973 m**, roughly 10× my figure.
My 0.20 m came from a small non-representative sample.

**The 2.0 m threshold is nevertheless right, for a reason I did not give.** Adjacent 3.5 m lanes
carrying 1.9 m-wide vehicles leave a body-to-body gap of about **1.6 m**, so any threshold below
~1.9 m makes adjacent-lane conflicts *structurally impossible* to express. The number stands; the
justification is lane geometry, not a sample median.

**And Q7 had a real hole**: it ignored timing entirely, so **10.8%** of the cells the relaxation
rescued had the two bodies on the same ground **more than 4 s apart** — which is not a conflict.
Q7 now requires `pathSeparationM <= 2.0 AND encroachmentGapS <= 4.0`.

### My lane-incursion predicate was inverted, and worse than I reported
I attributed the dominant residual failure to authoring. The auditor showed the **predicate itself**
was broken: `ego_frame_offsets` had **no longitudinal gate**, so a body 100 m off to the side scored a
huge lateral offset, and the moment the ego turned the projection collapsed below the threshold and
was scored as "entered my lane". Independently measured **precision 0.375**, firing **253** times when
nothing entered anything — false positives with start-lateral offsets of 102.57 m, −67.64 m and
−40.26 m on bodies the engine says moved 0.16–0.67 m sideways.

Corrected with a 30 m longitudinal gate and corroboration from the engine's own `lateralOffsetM`.
Firing rate on a held sample fell **0.681 → 0.404**, against an independently measured true rate of
**0.286**. One caveat found while fixing it: `lateralOffsetM` is identically ~0 for `relative_to`/
route-bound actors (it is measured against their own path), reading 0.00–0.06 m throughout the gold
dart-out, so it **cannot** be used alone — it would reject a textbook incursion.

**The volume consequence is the real finding: only 28.6% of gate-passing cells truly contain a lateral
incursion.** That is an authoring limit, and the broken predicate had been concealing how bad it is.

### Two more validator bugs, both mine
- **`challenger_oncoming` never checked relative heading.** It fired on 22 actors of which 16 were
  travelling the *same* direction — precision **0.136**. An ordinary lead vehicle satisfied every
  condition. Now requires a relative heading ≥ 120°.
- **Near-tautologies were being accepted as the central requirement.** Base rates: `challenger_is_ahead`
  **1.000**, `ego_brakes_hard` 0.889, `static_obstacle_present` 0.644 — and one template was admitted
  on `static_obstacle_present` alone. A verdict now abstains if it rests only on predicates with a base
  rate above 0.6.

### Deduplication was too LAX, not too aggressive
The 310 → 61 collapse reproduced exactly, and the signature was vindicated on the axes it uses
(0/109 groups mixed different challengers). But cells kept as "different lessons" differ by **11 cm of
clearance and 0.065 m/s²** while being identical in closest-approach time and path separation. All
three banded fields are **outcome magnitudes — precisely what parameter jitter perturbs.** The
signature is now over conflict *structure*: road-user kind, conflict geometry, whether an incursion
occurred, and coarse timing.

### Also corrected
- `Q1` and `Q5` **never fire on any of 1,642 cells** — they cost nothing and prove nothing.
- I raised a concern that `Q2` was weakened by one-tick freezes; the auditor tested it and **withdrew
  it** (2 cells of 1,642). Q2 is left alone.
- **No vehicle in this engine can reverse** (1 body in 1,642 moved >0.8 m backwards), so briefs naming
  a reversing manoeuvre are unbuildable and are now filtered at generation.

---

## 23. The capability workstream: what was actually missing, and what only looked missing

I dispatched five parallel agents to implement the functionality that a user-supplied list of 67
edge-case topics could not express. The headline result is not the code. It is this:

**Four of five gaps turned out to be capabilities that already existed and were unreachable.**

| gap | what I claimed | what was true |
|---|---|---|
| reverse | "no vehicle can reverse" (1 body in 1,642 moved >0.8 m backwards) | reverse works under `kinematic-v1`; under `dynamic-v1`, **the default**, the body detaches from its route entirely — `s` pinned at 0.0001 m and `laneRsl` null for all 601 ticks across 30/30 cells, all rejected `no_interaction`. Authoring is via `role.extensions.motionSemantics`, a `z.record(z.string(), z.unknown())` field absent from all three published JSON Schemas, so no LLM author can discover it |
| catalog | "no animal id, no debris, no traffic furniture" | the entire construction and debris inventory already existed — `construction.jersey_barrier`, `hazard.tire_debris`, `street.shopping_cart` — under names no author reaches for. Only `animal.*`, `hazard.ladder`, `hazard.mattress` were genuinely absent |
| sensors | "no sensor model" | correct, and worse: `sensors` is **silently stripped** by `parseSimScenarioInput`, so a template can declare them, validate clean, and simulate as if it never said anything |
| signals | "no blackout or flashing arrow" | correct, plus a live defect: `phaseForbidsEntry` classified a dark signal (`off`) as **PERMISSIVE**. Every scenario ever run with a blackout had the ego drive straight through at speed; the law is an all-way stop. `flashing_red` was treated as a solid red — wrong in the opposite direction |
| lanes | "87.8% of sections are single-lane, so cut-ins are unbuildable" | **a group-counting artifact of mine.** See below |

### The single-lane claim was wrong, and it was steering the authoring
I counted *groups*, where a group is a `(road, laneSection, side)` row on roads averaging ~13 m. That
denominator is close to meaningless. Measured properly:

- **30.1%** of driving lanes sit in a corridor two or more lanes wide
- **22.9%** of matchable corridors have `throughLanesSameDir >= 2`, on **all five maps**
- a template requiring `[2, 8]` matches **23 sites across 4 maps at verdict `exact`, on unmodified code**

So multi-lane cut-ins, zipper merges and lane splitting were buildable the whole time.

**And the real defect was found in the process.** `pose.laneOffset` is SILENTLY DISCARDED for
`on_reference` roles in `adapt.ts`; `relative_to` `dLane` clamps unconditionally; `framePosePoint`
falls back to the reference lane with only a note. `template validate` reports ok in every case. So
when this document told authors to "start in the adjacent lane", they wrote the natural thing —
`kind:"on_reference"` with `pose.laneOffset:-1` — it was thrown away, and the actor spawned in the
ego's own lane and sat there. That is exactly the tripled spawned-already-in-lane defect and the
measured **0.521 -> 0.238** collapse in true incursion rate. The one binding that works,
`kind:"lane_offset"`, is the one an author is least likely to reach for.

### The pattern worth generalising
Of five gaps, one was a genuine absence (a sensor model), one was half-absent (animal models), and
three were **discoverability or default-path failures**. In every one of those three the capability
existed, was reachable only through an undocumented or non-default path, and failed silently when
reached the obvious way. That is a far more dangerous failure mode than a missing feature, because a
missing feature announces itself and a silent fallback does not: the scenario still validates, still
simulates, still passes the gate, and is simply not what it claims to be.

The authoring surface has been corrected accordingly: it now exposes **54 catalog ids and 26 aliases**
instead of 18, names `kind:"lane_offset"` as the binding that carries a lane offset, and no longer
tells authors that adjacent lanes do not exist.

### Two engine defects recorded independently of the feature work
- `newcaps/DEFECT-signal-authority.md` — blackout classified permissive; `flashing_red` as solid red.
- `newcaps/DEFECT-reverse-route-detachment.md` — `dynamic-v1` computes `trackingYaw = yaw + PI` while
  the actor is registered with the authored pose heading equal to the route tangent rather than
  tangent + PI, so tracking starts 180 degrees wrong and steering saturates. The two physics backends
  disagree about what a route means for a reversing actor.

Both would have produced confidently mislabelled training data, and neither is visible from any metric
the gate reads.

### Delivered so far
- `caps-catalog` — 22/22 green. `animal.deer` is 1.76 x 0.46 x 1.62 (a deer, not a human); aliases
  resolve to real footprints; `construction.pedestrian_barrier` no longer materialises as a 1 m cube;
  and **class/catalog agreement is now enforced for every class**, so the live defect I captured —
  a role tagged `class:animal` filled with `pedestrian.adult_walking` — is a hard error.
- `caps-surface` — 11/11 and 5/5 green. Localised surface patches with taper, overlap resolution and
  no grip leakage into neighbouring lanes, so "black ice on the bend" no longer means making the whole
  world slippery. Signal blackout and flashing arrows with correct right-of-way.

---

## 24. Measured throughput on a clean machine, with the FP-0 validator

Every earlier throughput figure in this document was taken on a compromised setup: up to 31 orphaned
worker processes competing for CPU, a CLI that resolved `@uniscenarios/*` to the MAIN checkout rather
than the worktree, and a JSON parser that silently discarded whole briefs. Those numbers are withdrawn.
This one is measured end to end after all three were fixed.

| stage | input | output | wall clock |
|---|---|---|---|
| author (6 workers, 2 runs x 84 generated briefs) | 168 briefs | 46 admitted templates | ~122 min |
| intent-verify (`predicates` AND `critic@enh`, the FP-0 config) | 46 templates | **11 verified** | 458 s |
| harvest (8 sites x 20 draws, 5 maps) | 11 templates | 8,420 simulated -> 407 training-grade -> **218 distinct** | 325 s |

**218 distinct training-grade scenarios in 135 minutes = ~2,324 per day** at 6 workers.

Every one of those 218 passes the frozen gate `1a08698e95fca4bc`, the Q1-Q8 physics quality layer, and
an intent check requiring a mechanical trajectory validator and an independent vision critic to AGREE
(audited precision 1.000, false-positive rate 0.000 on 49 negatives).

### Where the time actually goes
Simulation is free: 8,420 concrete scenarios in 325 s, and a standalone measurement put it at
~25,000/hour on 4 workers. **93% of the wall clock is LLM authoring.** The scaling lever is therefore
templates per hour, not cells per template — and cells per template saturates anyway, at roughly 50
distinct behaviours before parameter draws stop producing new ones.

### The honest bottleneck
11 verified from 46 admitted is 24%. That is the conjunction doing its job: `predicates` alone runs at
a 0.102 false-positive rate, which is corpus poisoning, and the AND buys precision 1.000 at the cost of
recall. For a training corpus that is the right trade, because a false positive is permanent
mislabelling and a false negative only costs yield — and yield is the cheap thing, since another 84
briefs cost an hour of machine time and nothing else.

### Delivered artifacts
- `/tmp/vista-dataset/` — `train.jsonl` (7 archetypes, 189 scenarios), `test.jsonl` (3 archetypes,
  29 scenarios), `MANIFEST.json`. **Split by ARCHETYPE, not by scenario**: no mechanism appears in both
  halves, so a model cannot see the same situation at a different site and score it as generalisation.
- `/tmp/vista-showcase-final/` — 20 ego-centric renders, 8 frames each, ego ringed, with measured
  clearance / minTTC / actual braking in the caption so a picture can be checked against its numbers.

---

## 25. The capability workstream, completed: five for five

All five parallel workstreams landed, verified end to end through the CLI, and committed. The gold
regression is unchanged after all of it (3/3 frozen, 3/3 HQ, every Q clause clean), and all eight
packages typecheck clean.

**Every single workstream's headline finding was the same shape, and it was not the one I predicted:
the capability existed and was unreachable, or was reachable and broken in the default path.**

| workstream | what I claimed was missing | what was actually true |
|---|---|---|
| reverse | "no vehicle can reverse" | reverse existed, authored only via `role.extensions.motionSemantics` — a `z.record(z.string(), z.unknown())` field absent from all three published JSON Schemas — and then **broken under `dynamic-v1`, the default backend**, by a sign error in the tyre-slip model |
| catalog | "no animal / debris / traffic furniture" | the entire construction and debris inventory existed under names no author reaches for. Only `animal.*`, `hazard.ladder`, `hazard.mattress` were genuinely absent |
| sensors | "no sensor model" | correct, and worse: `sensors` was **silently stripped** by `parseSimScenarioInput`, so a template could declare them, validate clean, and simulate as if it had said nothing |
| signals | "no blackout or flashing arrow" | correct, plus `phaseForbidsEntry` classified a dark signal as **PERMISSIVE**, and stop lines were bound to lanes the ego never drives — **0 of 16 cells** had a stop line on the driven route |
| lanes | "87.8% single-lane, so cut-ins are unbuildable" | **a group-counting artifact of mine.** 22.9% of corridors are multi-lane on all five maps. The real defect was `pose.laneOffset` being silently discarded |

Two of my five diagnoses were wrong. Three agents corrected my *measurements* rather than my code.

### The reverse root cause, because it is the sharpest example
```
frontSlip = atan2(vy + lf*r, |u|) - steerRad            // as written: unsigned
frontSlip = atan2(vy + lf*r, |u|) - direction * steerRad // fixed
```
A tyre is symmetric: the lateral slip velocity a steer `d` produces is `-u·sin(d)`, which changes sign
with `u`. So a reversing car yawed the **opposite way to the command**, every correction was positive
feedback, steering saturated in ~3 s, and the body left its route — `s` pinned at 0.0001 m and
`laneRsl` null for all 601 ticks across 30/30 cells, every one rejected `no_interaction`. Forward
motion is bit-identical (`direction = +1`). Verified after the fix: median 4.40 m rearward, max 9.11 m,
20/30 cells over 3 m, heading held to 0.0°.

### Authoring traps found, now surface rules 19-24
- **A carriageway hazard must be a ROLE with `static: true`, never a prop.** Props have no actor track;
  criticality metrics iterate actors only, so a prop-authored obstacle has **no TTC and no PET by
  construction**.
- **The ego stops short of a static obstacle rather than passing it** (s=44.7 against a hazard at
  s=50). "Ego passes debris closely" is close to unauthorable with collision avoidance on — which is
  why the whole static-hazard family reads as physically-valid-but-boring.
- **Never author the avoidance as a t=0 route polyline.** It removes the collision course, so the pair
  is never scored: 30/30 cells with `minTTC: null` despite a correctly placed hazard. Triggered
  `laneOffset` records on 26/30. General form: *an evasive action authored as an initial condition
  deletes the conflict it was meant to evade.*
- **Engine criticality metrics go stale after an avoidance** — one case reported `minDistance 15.83 m`
  when the true closest approach was 2.03 m. `evaluate` reads those, so a real near miss can be graded
  `trivially-safe`. (My gate is immune: it recomputes OBB clearance from raw ticks.)
- **A negative constant `s` on an `on_reference` role silently zeroes site matching.** Swept
  `-50 … -1` and the JSON number `-35`: **0 sites on every map**, no clause attributed, no validator
  finding. The same value as an unfoldable expression matches 3 sites per map. The safer-looking
  authoring is the one that fails.

### Engine defects recorded independently of the features
`newcaps/DEFECT-signal-authority.md` (blackout permissive; flashing_red as solid red; stop lines on
un-driven lanes), `DEFECT-reverse-route-detachment.md` (the slip sign, and the two backends disagreeing
about what a route means for a reversing actor), `DEFECT-self-occlusion.md` (real but latent — 0 of
14,309 declarations affected, so my occlusion rule stands), `DEFECT-negative-role-s-infeasible.md`,
and `OPEN-reversing-pedestrian-golden.md`, which I deliberately left red rather than re-baseline.

### A methodological failure of my own worth recording
For several hours I reported "`npx tsc --noEmit` clean" as evidence the tree was healthy. **There is no
root tsconfig in this repo**, so that command silently prints help and exits 1 — it was checking
nothing. Per-package typechecking immediately surfaced real errors that had been hiding, including four
in `cli` caused by an exhaustiveness gate that a released agent's change had broken. Verifying with a
command whose failure mode looks like success is worse than not verifying.
