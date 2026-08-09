# DELIVERABLE 2 -- IS THE RENDER THE LIMITING FACTOR?

**Yes for perception, decisively. No for the verdict.** Better rendering makes the model see the
mechanism far more reliably, but that improvement only partly survives into the critic's judgement.
The single cheapest fix in the whole pipeline is in here: **printing each actor's speed on the
image takes hard-deceleration recall from 0.073 to 0.440 -- a 6x gain for a text label.**

## Conditions tested (all four, same 80 clips, same critic prompt verbatim from `critic.py`)
| id | rendering | file |
|---|---|---|
| `base` | **what ships today**: 6 panels, fixed 64 m across, grid 10 m | `../scene.py` |
| `enh` | 9 panels, **per-frame auto-zoom** (24-68 m), 2.5 s motion trails, **per-actor speed labels**, actor legend | `audit2/render2.py` |
| `world` | as `enh` but every panel pinned to one fixed world view | `audit2/render2.py` |
| `trails` | **your hypothesis**: every actor's COMPLETE path over the whole clip as one line with 1 s time ticks, plus 3 zoomed snapshots | `audit2/render_trails.py` |

## 1. PERCEPTION -- the render is unambiguously the limiting factor

Scored per actor against facts the trace settles exactly, using the **brief-blind** perception step
so the model cannot be led (`audit2/perception_score.py`, `audit2/perception-by-render.json`):

| question | metric | base | enh | trails |
|---|---|---|---|---|
| does it **move**? | accuracy | 0.789 | 0.830 | **0.997** |
| | recall | 0.854 | 0.800 | **0.996** |
| | specificity | 0.582 | 0.921 | **1.000** |
| does it **enter the ego's lane**? | accuracy | 0.600 | 0.667 | **0.771** |
| | **recall** | **0.366** | 0.500 | **0.629** |
| does it **slow sharply**? | accuracy | 0.362 | **0.605** | 0.591 |
| | **recall** | **0.073** | **0.440** | 0.398 |

**Your hypothesis is confirmed at the perception level.** Full-clip trails give the best
lane-incursion detection (recall 0.366 -> 0.629) and make "does this thing move at all" essentially
perfect (0.789 -> 0.997 accuracy). A 6-panel sample of a 13 s clip really does hide a drift, exactly
as you predicted -- and it also hides whether a thing is moving at all, which I had not expected.

**And an even cheaper win you did not ask about.** On the shipped render the model detects **7.3%**
of hard decelerations. Both improved renders print each actor's speed in km/h on the panel, and
recall jumps to 0.44. **The instrument for "did the lead brake?" is a number printed on the image,
not a picture of a car.** This is ~10 lines in `scene.py`.

## 2. VERDICT -- the improvement only partly survives

Same 77 ground-truth pairs, critic prompt unchanged:

| render | precision | recall | F1 | FP rate | accuracy | TP/FP/FN/TN |
|---|---|---|---|---|---|---|
| **base (shipped)** | 0.545 | 0.333 | 0.414 | 0.085 | 0.779 | 6/5/12/54 |
| **enh** | **0.647** | **0.611** | **0.629** | 0.102 | **0.831** | 11/6/7/53 |
| world | 0.625 | 0.278 | 0.385 | **0.051** | 0.792 | 5/3/13/56 |
| trails | 0.583 | 0.389 | 0.467 | 0.085 | 0.792 | 7/5/11/54 |

- `enh` nearly **doubles recall** (0.333 -> 0.611) and raises precision and F1.
- **McNemar base vs enh: 6 gained, 2 lost, p = 0.289. NOT SIGNIFICANT.** With only 18 positives the
  test is badly underpowered. The direction is consistent and the effect is large, but I cannot
  claim significance and will not.
- The renders disagree with each other on **16%** of clips (verdict agreement 0.83-0.84), which is
  a reminder that the verdict is partly a property of the picture, not of the scenario.

### The dissociation, which is the real finding
`trails` has the **best perception** of lane incursions and near-perfect motion detection, yet gives
only recall 0.389 at the verdict level, while `enh` -- with *worse* perception of lane entry (0.500
vs 0.629) -- gives 0.611. **Seeing the fact correctly and then concluding the brief is realised are
two different failures, and fixing the first does not fix the second.** The brief-blind observer on
the `trails` render reported the mechanism absent on 72 of 80 clips even though it perceived the
underlying motion almost perfectly.

So: **the render is a real, cheap, worthwhile fix, and it is not sufficient.**

## 3. What to actually ship

Scored on the least-circular tier (n = 63; labels the automated predicate arm produced are excluded,
so `predicates.py` is not being graded on its own homework):

| system | precision | recall | F1 | **FP rate** | TP/FP/FN/TN |
|---|---|---|---|---|---|
| critic alone, base render **(today)** | 0.714 | 0.357 | 0.476 | 0.041 | 5/2/9/47 |
| critic alone, `enh` render | 0.800 | 0.571 | 0.667 | 0.041 | 8/2/6/47 |
| `predicates.py` alone | 0.643 | 0.643 | 0.643 | 0.102 | 9/5/5/44 |
| predicates AND critic(base) | **1.000** | 0.214 | 0.353 | **0.000** | 3/0/11/49 |
| **predicates AND critic(`enh`)** | **1.000** | **0.357** | **0.526** | **0.000** | **5/0/9/49** |
| predicates primary, critic(`enh`) only on abstain | 0.688 | 0.786 | 0.733 | 0.102 | 11/5/3/44 |

**Recommendation for a training corpus: require BOTH `predicates.py` = present AND the critic =
verified, and switch the critic's render to `enh`.** That configuration produced **zero false
positives on 49 negatives** (95% CI on the FP rate 0.000-0.073) and **the render change alone
increases its yield by two thirds (recall 0.214 -> 0.357) at no precision cost.**

If you instead want volume, `predicates.py` primary with the critic consulted only on its 16.9%
abstains gives F1 0.733 and recall 0.786 -- but an FP rate of 0.102, which is corpus poisoning.

## Files
`audit2/render2.py`, `audit2/render_trails.py`, `audit2/step3_render.py`,
`audit2/critic-{base,enh,world,trails}.json`, `audit2/vision-gt{,-base,-trails}.json`,
`audit2/perception-by-render.json`, `audit2/score-systems.json`,
example images in `audit2/renders/demo_{base,enh,world,trails}.png`.
