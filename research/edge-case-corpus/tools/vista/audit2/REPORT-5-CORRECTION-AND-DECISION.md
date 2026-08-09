# DELIVERABLE 5 -- CORRECTION, RE-SCORING OF CURRENT hybrid.py, AND THE AND-vs-VETO DECISION

## 0. YOU WERE RIGHT, AND IT BROKE MY NUMBERS TOO. Two corrections.

**Your challenge to `lateralOffsetM` is correct.** Measured over 1090 challengers: **37.2%** have a
flat offset series (range < 0.5 m) because it is referenced to the actor's OWN path, and 9.1% have
`laneRsl` entirely None. Using it as a sole arbiter mislabels route-bound actors as
"decisively no incursion".

**And it exposed the same class of bug in my own instrument.** `predicates.trace_facts` measured
distance to the ego's travelled path polyline **with no endpoint rejection**. The polyline only
spans where the ego has been, so a body behind the ego's start point measures a *longitudinal* gap
that I was reading as a lateral offset. Verified: **30 `tailgater` actors scored "excursions" of
26-33 m** while their own lane offset never moved 0.5 m. That is precisely the
missing-longitudinal-gate error I diagnosed in your code, in mine.

Both are fixed in **`audit2/arbiter2.py`** (endpoint rejection + a composite that uses the engine
series only where it varies) and `predicates.py` now returns an `interior` mask and ignores
non-interior samples. **The regression suite is still 33/33 and `predicates.py`'s scores on the
ground truth are unchanged (0.722/0.722), so the bug affected only the incursion arbitration.**

### The corrected incursion numbers -- my REPORT-4 figures were wrong
n = 816 decisively-arbitrated challengers, corrected geometry:

| | I told you | **corrected** |
|---|---|---|
| true incursion rate | 0.286 | **0.352** |
| hybrid BEFORE your fix -- precision | **0.375** | **0.612** |
| hybrid BEFORE your fix -- recall | 0.717 | 0.801 |
| hybrid WITH your 30 m gate -- precision | -- | 0.655 |
| hybrid WITH your 30 m gate -- recall | -- | 0.627 |
| accuracy, before / after your gate | -- | 0.751 / **0.752** |

**I overstated the over-firing badly: precision was 0.612, not 0.375.** My claim that it "fires 253
times when nothing entered anything" was substantially an artifact of my own broken arbiter.
The direction of the finding survives (it was over-firing: precision 0.61 vs recall 0.80) but the
magnitude does not.

**And your 30 m gate is accuracy-neutral (0.751 -> 0.752).** It trades recall (0.801 -> 0.627) for
precision (0.612 -> 0.655). It is a reasonable trade for a corpus filter, but it is not the clear
win I implied. Your cell-level firing rate 0.681 -> 0.404 against a true rate of 0.352 is now
well calibrated, which is the better argument for keeping it.

### The distinction the disagreements revealed -- worth encoding
Where both measures are informative (n = 487) they agree **78.9%**. Of the 103 disagreements,
**55 are cases where the geometry says "encroached" and the engine says "did not move in its lane"**
-- crossing traffic that enters the ego's path *without ever leaving its own lane*. So:

- engine `lateralOffsetM` answers **"did it change lane / drift?"**
- corrected ego-path geometry answers **"did it encroach on the ego's corridor?"**

`challenger_enters_ego_path` is an **encroachment** predicate, so corrected geometry is the right
primary and the engine series is a cross-check on the drift subclass. Your shipped design
(geometry gated longitudinally, `lateralOffsetM` consulted only when it varies) is the correct one.

## 1. CURRENT hybrid.py (b468960), re-scored on the 44 true pairs

**I retract "not materially better". Your fixes are a material improvement.**

| system | precision | recall | F1 | FP rate | TP/FP/FN/TN |
|---|---|---|---|---|---|
| OLD hybrid + veto (what REPORT-4 measured) | 0.615 | 0.444 | 0.516 | 0.192 | 8/5/10/21 |
| **CURRENT hybrid, mechanical only, no veto** | **0.750** | 0.500 | 0.600 | 0.115 | 9/3/9/23 |
| CURRENT hybrid + unanimous veto (base render) | 0.714 | 0.278 | 0.400 | 0.077 | 5/2/13/24 |
| **CURRENT hybrid + unanimous veto (enh render)** | **0.857** | 0.333 | 0.480 | 0.038 | 6/1/12/25 |
| CURRENT hybrid AND predicates.py | 1.000 | 0.222 | 0.364 | 0.000 | 4/0/14/26 |
| **predicates.py AND critic(enh)** | **1.000** | **0.444** | **0.615** | **0.000** | **8/0/10/26** |

Mechanical-only precision **0.542 -> 0.750**. The tautology guard and the oncoming heading check did
exactly what they were meant to.

## 2. YOUR DECISION: is the strict AND right for a training corpus?

**Yes -- but you are running the wrong AND, and that is why it cost you so much yield.**

`predicates.py AND critic(enh)` **dominates** `hybrid + unanimous veto` on both axes:
precision 1.000 vs 0.857 **and** recall 0.444 vs 0.333. There is no trade to make between those two;
one is simply better. So: keep the AND, and make `predicates.py` the mechanical half of it.

On the substantive question -- 1.000 precision at 0.444 recall versus 0.714 at higher yield --
**take the AND.** Not because zero is magic (the 95% CI on that precision is 0.68-1.00, so the true
value could be 0.7), but because the asymmetry is real: a false positive is a permanently mislabelled
training example that teaches the wrong association, and your own retraction of the ~1,300/day figure
is what one bad archetype at 97% of yield does. ~2,200/day already clears the objective.

## 3. THE THING YOU ACTUALLY WANTED: recall without touching precision

**You are paying for unanimity twice. Inside the conjunction it buys nothing.**

Unanimity was my recommendation for the critic used **alone**, where it was the only defence. Once
`predicates.py` has already removed everything it can see, the critic's only remaining job is the
non-computable residue -- and a strict threshold there just discards good scenarios.

Measured, with `predicates.py = present` required in every row:

| critic threshold inside the AND | precision | 95% CI | recall | **false positives** |
|---|---|---|---|---|
| unanimous 6/6 **(what you shipped)** | 1.000 | (0.61, 1.00) | 0.333 | **0** |
| **>= 0.70 (the normal verdict)** | 1.000 | (0.68, 1.00) | **0.444** | **0** |
| **>= 0.34** | 1.000 | (0.72, 1.00) | **0.556** | **0** |

**Zero false positives at every threshold, on all three tiers** (full 77, the 44 true pairs, and the
least-circular 63 where recall goes 0.214 -> 0.357 -> 0.429). The precision CI *tightens* as you
loosen, because there are more accepts supporting it.

**Recommendation: drop unanimity inside the conjunction and use the standard 0.70 verdict --
recall 0.333 -> 0.444, a 33% yield gain at zero measured cost. 0.34 gives 0.556 (+67%) and I would
take it too, though on n=18 positives I would want you to re-measure once you have more labels.**

I also tested pooling the critic over multiple renders (any-of-2, any-of-4, >=2-of-4, all-4). It
does not beat a single good view: `enh` alone at 0.70 is the best configuration measured. Polling
more views only ever *reduced* recall. The lever is the threshold, not the number of views.

## 4. Files
`audit2/arbiter2.py` (corrected arbiter), `audit2/arbiter_validity.py`, `audit2/incursion_v2.py`,
`audit2/incursion-v2.json`, `audit2/score_hybrid_v2.py`, `audit2/hybrid-verdicts-v2.json`.
`REPORT-4-HYBRID.md` section 2 is superseded by section 0 above.
