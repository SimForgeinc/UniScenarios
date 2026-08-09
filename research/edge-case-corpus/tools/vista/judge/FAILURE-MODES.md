# FAILURE-MODES.md — what a *seeing* author will still get wrong

Independent evaluation lane. Written after auditing `gate.py`, reading real traces and instances, and
building/calibrating an independent quality judge. Everything here is tied to evidence in
`GATE-AUDIT.md`, `RUBRIC.md`, `gate-probes.json` or a named trace.

Baseline to beat: **31% admission**. The point of this document is that most of the ways a seeing
author fails are *not* the ways a blind author fails, so the loop you build around it has to check
different things.

---

## 0. The one-line version

Sight fixes **placement**. It does not fix **timing**, it does not fix **what the gate is actually
measuring**, and it introduces a brand-new failure class: **confident repair of a hallucinated
problem**. Your loop needs a check for each.

---

## 1. Mirrored/rotated actors — sight makes this WORSE, not better

**Evidence.** Instance files mix frame conventions. Position is `(x, z)` with `y = -z`, but
`headingRad` is **already in the `(x, y)` frame and must not be negated**. Ground truth, yale-street
`25fd4ad6`: ego `headingRad` is `0.9829` in the instance file, `0.9829` in the trace, and
`atan2(vy, vx) = 0.9827`. Prop heading `0.9786` versus its parking lane's `(x,y)` tangent `0.9780`
— 0.001 rad. Negating it gives a **1.96 rad** error.

**Why sight makes it worse.** I made exactly this error during the audit and it produced a render in
which the ego drove *through* two parked SUVs at 0.000 m clearance. It looked like a spectacular engine
defect. It was a sign error in my renderer. A blind author would never have formed that belief. A
**seeing** author will look at a mirrored OBB — which is a car, on a road, at a plausible angle — and
confidently "repair" a problem that does not exist, or fail to see one that does.

**What the loop must check.** Before the agent is shown anything:
```python
assert abs(wrap(headingRad[0] - atan2(y[1]-y[0], x[1]-x[0]))) < 0.05   # for every moving actor
```
and render a small unmistakable **frame-check inset** in every image: a fixed reference arrow whose
world direction is known, so a transform bug is visible in the picture rather than inferred from it.

---

## 2. The agent will not see contact with props. It did not see it when I showed it to it.

**Evidence.** Control B2 (`make_controls.py`): a stationary SUV prop sits dead on the ego's path; the
ego drives straight through it. Props are `collidable:false` and absent from `ticks['actors']`, so
`metrics.collisions` is `[]` and the gate never looks. I rendered it and asked `gpt-5.6-luna` to score
plausibility. **It gave R5 = 3 ("plausible").** The `EGO_INTERSECTS_PROP` mechanical flag had to force
R5 to 0.

Reproduced on the real engine too: changing one number in your gold template
(`props[0].pose.tFrac: -0.78 -> 0.0`) produced 4/4 cells with **0.000 m** ego-prop OBB overlap,
`collisions: []`, the engine's own `no-contact` invariant reporting "held" at 2.1–3.4 m, and C1–C4 all
passing.

**Why.** A top-down render at 60 m across draws a 4.85 m SUV about 30 px long. An ego box overlapping it
by a metre is a few pixels of colour difference. Overlap is a *numeric* fact that happens to have a
*visual* signature too weak to survive rasterisation.

**What the loop must check.** Compute ego-vs-prop OBB clearance yourself every iteration and hard-fail
`<= 0`. Do not delegate it to vision, and do not delegate it to the engine — neither of them looks.

---

## 3. Sight fixes placement, but C2 is dominantly a TIMING failure, not a placement failure

**Evidence.** `D1-RESOLVED.json` is correct and I re-verified it: trace `t=0` is post-warm-up, and
`|trace t0 − instance pose| = warmupSeconds × v0` to 0.001 m on 3/3 cells. The realised gap at the
first *recorded* instant is
```
realised_gap = requested_dsM  −  warmupSeconds × (v_ego − v_challenger·cos Δheading)
```

Now put those two facts together, because the combination is the trap:

* If the agent draws on a **t=0 render built from the instance file**, it is drawing on the *authored*
  state, which is `warmupSeconds × Δv` metres away from anything the trace will ever contain. It will
  see a correct-looking 20 m gap and get an 11 m one.
* If the agent draws on a **t=0 render built from the trace**, it is looking at a state that already
  happened — it cannot edit it, only re-author the instance that produced it, which puts the warm-up
  term back.

So the headline prediction — "render t=0 and check separation before simulating, recover part of the
29.3% C2 loss" — is only true if the render is of the instance **with the warm-up term applied
forward**. Rendering the raw instance will systematically overstate the gap by `warmupSeconds × Δv`,
which at typical numbers is 8–11 m: the entire difference between the C2-failing median (8.1 m) and the
passing median (11.0 m).

**What the loop must check.** Render **`t = warmupSeconds` propagated from the instance**, label it as
such, and show the agent both the authored gap and the realised gap as two numbers. Then measure
recovery against `C2_spawn = closestT > 0.5` as well as against the frozen `C2`, because the frozen
clause is over-strict by exactly `warmupSeconds` (`GATE-AUDIT` A4) and will otherwise flatter the fix.

---

## 4. The agent will optimise for the gate's letter and produce junk

**Evidence.** `GATE-AUDIT` probe `P5`, and control B1 on a real map: an ego driving in a straight line
at a rigidly constant 10 m/s past a parked car 3.15 m off its path satisfies **C1–C5**. C2, C3 and C4 are
never required to name the same actor: C3 is a min over all actors, C2 is scored on whoever won that
min, and C4 is a scenario-level scalar.

An author that can *see* the corridor is strictly better at finding this than a blind one. "Put a
stationary vehicle near the ego's path" is a visible, one-step, permanently-reusable way to buy C2 and
C3, and it is exactly the kind of move a repair loop discovers when the gate is the reward.

**What the loop must check.**
* Require **one challenger** to satisfy C2 ∧ C3 ∧ C4 jointly.
* Add a clause the gate has no analogue of: **the ego's own trajectory must show a response**,
  measured from `speedMps` and `headingRad`, not from `metrics.requiredDecelMax` (which reports 3.0 for
  an ego whose speed array is rigidly constant — probe `P6`).
* Run the independent judge on every admitted cell and treat `physically-valid-but-boring` as a
  rejection. On control B1 it returns exactly that, unprompted, with no caps applied.

---

## 5. RETRACTED AND REPLACED — the near-miss instant *is* the conflict; what is wrong is that the challenger has stopped

**I got this wrong the first time and I am correcting it here rather than quietly editing it.**

**What I originally claimed.** That the min-clearance instant is never the interaction, on 28/28 cells.

**Why it was wrong.** My first "contested-space" measure was `argmin_t |lateral offset of the challenger
in the ego frame|` subject to the challenger being ahead. That is a **bearing** test, not a **path**
test. It fires whenever the challenger is anywhere on the ego's forward axis — including 16 m away, on a
piece of road the ego has not reached yet. Of course it never coincided with the closest approach; it was
never measuring the same kind of thing.

**The correct measure**, now in `judge/conflict.py`. Over **all pairs of tick indices `(i, j)` —
different times allowed** — compute the true OBB clearance between `ego at t_i` and `challenger at t_j`:

```
pathSeparationM  = min over (i, j) of clearance(ego_i, challenger_j)
```

`pathSeparationM == 0` means the two bodies genuinely occupied the same ground at some point:
**the space was contested**. It cleanly separates the two things simultaneous clearance conflates —
*spatial* separation (how close the paths came, timing removed) and *temporal* separation
(`encroachmentGapS = |t_i − t_j|`, a post-encroachment time measured from footprints rather than
predicted). A genuine conflict is small in both.

**The corrected result on the same 28 cells:**

```
28/28 cells: the minimum-clearance instant IS the contested-space instant (within 1.0 s)
```
* `pathSeparationM = 0.000` in **28/28** — every cell is a real encroachment; the child's body and the
  ego's body occupied the same ground.
* `encroachmentGapS` ranges **0.38 – 1.80 s**, median ~1.5 s. These are genuinely tight crossings.
* `lagS = tMinClear − tCross` has median **0.12 s**, max **0.72 s**. The gate is scoring the right event.

**So the frozen gate's C3 is not measuring the wrong moment. I withdraw that claim, and with it the
`PROXIMITY_IS_NOT_THE_CONFLICT` fire rate of 28/28.** It now fires on 0/28, which is correct.

### What survives, sharpened

`judge/conflict.py` shows the real defect underneath, and it is narrower and more actionable:

```
20/28 cells pass the candidate tightening clause C3b
 8/28 FAIL, every one of them for the same reason:
     ! the challenger had stopped (0 m/s) by the time the ego arrived
```

Worked case (`vista-probe0` yale `25fd4ad6` d0): the child occupies the contested ground at
**t = 6.88 s while moving at 2.2 m/s**; the ego arrives at **t = 8.50 s**; encroachment gap **1.62 s**.
That is a real conflict. But by t = 8.50 the child has **stopped dead** and is standing at 3.5 m to the
ego's left, and the ego is *accelerating* through the moment the gate calls the closest approach
(6.1 → 8.1 → 11.1 m/s). The encroachment was real; the *near miss the gate scores* is a pass-by of a
now-stationary pedestrian, 1.6 s after the fact.

That is a **realism** defect (route exhaustion, §6), not a conflict-detection defect — which is why
`c3b_conflict_is_the_proximity()` ships with `min_challenger_speed` **defaulted to 0.0, i.e. off**.
Turning it on would reject 8/28 cells that contain genuine 1.5 s-PET encroachments. Report it, do not
gate on it.

### What the loop should actually take from this
* Use `conflict.py:conflict_event()` as the **gate-side** measurement. It is honest about
  "there was no contested-space event at all" (`contested: False` plus the exact miss distance), which
  is the case the bearing heuristic could never express.
* The tightening worth considering is `C3b` **without** the stopped-challenger clause: require
  `pathSeparationM <= 2.0`, `encroachmentGapS <= 4.0`, and `|lagS| <= 1.0`. On this batch that is a
  no-op (28/28 pass), which is the right behaviour for a clause aimed at other archetypes — the
  categories that lose to C3 (`C3.intersection` 76%, `C13.control` 93%) are exactly the ones where
  `pathSeparationM` will be large and `contested` will be `False`.
* Keep `CHALLENGER_STOPPED_AFTER_CROSSING` as a **quality flag**. It fires on 10/28 and it is a real
  wart, but it is not grounds for rejection.

**Method note, since it is the point of this lane:** the thing that caught my error was building the
rigorous measurement and running it against the heuristic I had already published. A flag that fires on
100% of cells is not a finding, it is a bug — I should have treated the 28/28 as the alarm it was
instead of the headline.

## 6. Route exhaustion: actors stop dead and stand in the carriageway

**Evidence.** Same cell. The child's authored route ends at `tFrac 1.0` (the far lane edge). When it
runs out, the child's speed goes to 0 and it stands there for the remaining 4+ s of the clip, in the
carriageway. Every `expA` cell I looked at does this.

A seeing author will not notice, because a stationary yellow box at the kerb looks like a pedestrian
waiting — which is a normal thing for a pedestrian to do. A judge with a plausibility rubric will
eventually notice, but only if it is told the actor's speed *at that instant* (I had to add
`speedAtMinClearanceMps` to the facts block before the model would comment on it).

**What the loop must check.** Flag any actor whose speed falls below 0.2 m/s and stays there while it is
inside a `driving`-type lane. Either extend the route to the sidewalk or make the stop intentional.

---

## 7. Occluders that do not occlude

**Evidence.** In the 28-cell run, site `33a100467f1b70e4` produced 4/4 cells with
`occluderIneffective: never_blocked_before_conflict` and `no_interaction`, driven by
`runway_insufficient` — "route provides 32.3 m ahead of the spawn but the actor covers 155.6 m in 13 s".
My judge scored all of them `intent-not-realised` (R1 = 1), independently agreeing with the gate.

The occlusion geometry is a **3-body, time-varying** relation: observer, occluder and target must be
collinear-ish *before* the conflict and not after. A single top-down frame shows you where three boxes
are; it does not show you a line-of-sight sweep over time.

**What the loop must check.** Do not ask the agent to verify occlusion by looking. Render the
**line-of-sight segment ego→target** explicitly, coloured by blocked/clear, at 3–4 times spanning
`firstBlockedT → losOpenT → conflictT`, and check `revealToConflictS` numerically. Sight can confirm a
computed occlusion; it cannot discover one.

---

## 8. Site runway: the agent cannot see what is off the edge of the picture

**Evidence.** `runway_insufficient` at `33a10046`: 32.3 m of route ahead of the spawn, 155.6 m needed.
That is invisible in a 60–180 m viewport centred on the site — the road simply ends somewhere outside
the frame, or the lane chain has no successor.

**What the loop must check.** Compute `route.lengthM` ahead of the spawn against `v0 * clipSeconds`
*before* rendering, and either draw the available runway as an explicit coloured bar along the ego lane
or refuse the site. This is a pure precondition; do not spend an authoring iteration on it.

---

## 9. Scale illusions in a top-down view

A 60 m-across panel renders a 0.6 m child as ~10 px and a 5 m clearance as ~85 px. Two boxes that are
"clearly separated" on screen can be 0.3 m apart, and two that "nearly touch" can be 4 m apart. The
absolute quantities the gate thresholds on (5.0 m clearance, 1.5 m/s² decel, 3.0 s TTC) are all below
the resolution at which a human — or a model — reliably reads a top-down render.

**What the loop must check.** Never ask the agent for a metric quantity it has to estimate from pixels.
Ask it for **relations** ("is the child on the same side as the parked cars?", "does the challenger
cross the ego's path or run parallel to it?", "is anything overlapping?") and compute every number
yourself. My judge is built this way deliberately: the model gets a verified numeric appendix and is
told that if its description disagrees with the numbers, the numbers win.

---

## 10. Site diversity is not what the ≥3-sites rule thinks it is

**Evidence.** In the 28-cell run, all four parameter draws at yale-street `25fd4ad601d7872b` produced a
minimum clearance of **2.128 m**, to three decimals, despite different `arrivalTtc`, `childSpeedKph` and
`gapM`. The clearance is pinned by lane geometry, not by the draw. Site `f40e79ec8edcfd77` behaves the
same way (3.396–3.675 m across four draws).

The spread rule counts `(mapId, siteId)` pairs. It does not check that the resulting conflicts differ.
A "corpus" of 3 sites × 4 draws can be 3 samples wearing 12 hats — which is a plausible part of why the
corpus-layout judge called the corpus "inadequate, not fit for training data" while the per-cell gate
was satisfied.

**What the loop must check.** Add a diversity clause over admitted cells: require the admitted set to
span some minimum range in (clearance, contested-space geometry, ego peak deceleration, conflict time),
not just in site id.

---

## 11. Priority order, if you only implement some of it

1. **§2** ego-vs-prop clearance `> 0`. One function you already have; catches physically impossible
   scenarios that everything else waves through.
2. **§1** heading-convention assertion + frame-check inset. One line; prevents a whole class of
   confident wrong repairs.
3. **§4** per-challenger C2∧C3∧C4 conjunction + a trajectory-derived ego-response clause. Removes the
   thing your repair loop will otherwise learn to exploit.
4. **§3** render the warm-up-propagated state, and report `C2_spawn` alongside `C2`. Without this your
   headline C2-recovery number is measured against a moving target.
5. **§5** use `conflict.py:conflict_event()` as the gate-side conflict measure (path separation and encroachment gap, reported separately from simultaneous clearance).
6. **§8** runway precondition before rendering. Free admission; costs nothing.
7. **§6, §7, §9, §10** as budget allows.
