# DELIVERABLE 1 -- PRECISION AND RECALL OF THE CRITIC

**Headline: at the shipped operating point the critic's precision is 0.545 (95% CI 0.280-0.787) and
its recall is 0.333 (0.163-0.563). On the distribution it will actually face in production it is not
statistically distinguishable from accepting everything (Fisher p = 0.31). It should not be used as
the sole filter for a training corpus.**

## The ground truth (77 pairs, `audit2/ground-truth.json`)

Built from evidence the critic's own prompt never touches. Three sources, in strict precedence:

| source | n | what it is |
|---|---|---|
| **construction** | 33 | A brief whose named actor class is provably ABSENT from the clip's actor+prop inventory, paired with a gate-passing trace from a different brief. GT = absent, **certain**, no model and no image involved. |
| trajectory + vision concordant | 15 | A deterministic predicate evaluation agreed with a decomposed vision arm |
| adjudicated by me | 26 | I read the exact geometry and decided, recording the number that settles it |
| vision arm alone | 3 | mechanisms no trajectory predicate can express |

Labels: **18 present, 59 absent**. Realistic-distribution (stratum B) base rate: **18/44 = 0.409**.

### How the trajectory arm works, and why it is not circular
`audit2/briefspec.py` asks the model to translate the **brief text only** -- it never sees a
rendering -- into predicates from a closed vocabulary (`ENTERS_EGO_PATH`, `CROSSES_EGO_PATH`,
`DECELERATES_HARD`, `OCCLUDED_BY`, `TURNS`, ...). `audit2/mechfacts.py` computes the corresponding
geometry from the raw trace. `audit2/speceval.py` evaluates one against the other with an explicit
**abstain band** on every numeric test, so pairs the trajectory cannot settle are handed on rather
than forced.

**Validation of the instrument: it returns "absent" on 33/33 constructed negatives** while abstaining
on 14/46 true pairs -- i.e. it is decisive exactly where it should be.

### Errors I made and corrected (all in `ground-truth.json`)
- my actor classifier matched `'ped'` as a raw substring, so **`stopped-bus-0` classified as a
  pedestrian**. That invalidated one constructed negative (removed) and produced one wrong GT label
  (`c8g-cyclist-emerges-from-barriers`, corrected present -> it was scored a false positive before).
- 2 pairs excluded on re-review as indefensible either way (`c14-friction-patch`,
  `c5g-shoulder-drift`); 1 more excluded for an uninterpretable ego freeze.
- the first version of the trajectory arm ignored props entirely outside `PRESENT`, and used hard
  thresholds with no abstain band. Both fixed before any scoring.

## Results

### Full set (n = 77)
| | GT present | GT absent |
|---|---|---|
| critic **verified** | 6 | **5** |
| not verified | 12 | 54 |

**precision 0.545** (0.280-0.787) | **recall 0.333** (0.163-0.563) | F1 0.414 | accuracy 0.779
**false-positive rate 0.085** (0.037-0.184)

### The split that matters
| stratum | n | TP | **FP** | FN | TN | FP rate |
|---|---|---|---|---|---|---|
| **constructed negatives** (named actor simply not there) | 33 | 0 | **0** | 0 | 33 | **0.000** |
| **true pairs** (right actors, wrong behaviour) | 44 | 6 | **5** | 12 | 21 | **0.192** |

**The critic is perfect at the easy question and useless at the hard one.** It never once verified a
clip whose named actor class was absent -- 33/33. Every false positive is a clip that contains the
right cast doing the wrong thing, which is the failure mode that actually occurs in production.

### On the realistic distribution (stratum B, n = 44)
- base rate of mechanism present: **0.409**
- critic precision: **0.545** -- a lift of only **+0.136**
- **Fisher exact on the 2x2: odds ratio 2.10, p = 0.314.** Not significant. On the population it
  will face, the critic's verdict carries no demonstrable information.

## Threshold: what minimises false positives and what it costs

Votes are 6 per pair, so `yesFraction` is quantised to 1/6 and only three operating points exist.

| accept when | TP | FP | FN | TN | precision | recall | FP rate (95% CI) |
|---|---|---|---|---|---|---|---|
| yesFrac >= 0.17 | 10 | 11 | 8 | 48 | 0.476 | 0.556 | 0.186 (0.107-0.304) |
| yesFrac >= 0.34-0.50 | 9 | 10 | 9 | 49 | 0.474 | 0.500 | 0.169 (0.095-0.285) |
| **yesFrac >= 0.67-0.83 (SHIPPED)** | 6 | 5 | 12 | 54 | 0.545 | 0.333 | 0.085 (0.037-0.184) |
| **yesFrac == 1.00 (UNANIMOUS 6/6)** | 4 | 2 | 14 | 57 | **0.667** | **0.222** | **0.034 (0.009-0.115)** |

**Answer: require UNANIMITY.** Moving 0.70 -> 1.00 halves the false-positive rate (0.085 -> 0.034)
and raises precision 0.545 -> 0.667. **It costs a third of the remaining recall (0.333 -> 0.222).**
Given that a false positive permanently mislabels a training example and a false negative only costs
yield -- and yield is cheap, since simulation runs at ~150 scenarios/second -- this is clearly the
right trade. But note honestly: **even at unanimity, one in three accepted scenarios still lacks its
mechanism**, and the CI on that precision runs from 0.300 to 0.903.

## Why it fails: it is not the prompt, it is the perception
Measured directly, per actor, against facts the trace settles exactly
(`audit2/perception_score.py`), on the BETTER of my renders:

| question the model was asked | n | recall | specificity | accuracy |
|---|---|---|---|---|
| does this actor **move**? | 306 | 0.800 | 0.921 | 0.830 |
| does it **enter the ego's lane**? | 147 | **0.500** | 0.915 | 0.667 |
| does it **slow sharply**? | 253 | **0.440** | 0.974 | 0.605 |

**The model misses half of every lane incursion and more than half of every hard deceleration, while
almost never inventing one that is not there.** That asymmetry propagates exactly as observed: many
false negatives, few false positives. Verbatim examples where the geometry is not close:
- `c4-exit-cut` -- *"The challenger remains in its own adjacent circulating lane and does not cut
  laterally into the ego's lane"*. The challenger travels 49.8 m, turns 88.8 deg and moves **16.58 m
  laterally** into the corridor to a 0.02 m offset.
- `c10g-left-turn-no-yield` -- *"it stays in its opposing lane and continues straight"*. Net heading
  change **89.3 deg**.
- `c3g-child-behind-bus` -- *"the child does not visibly run across"*. The child runs **10.1 m at
  3.2 m/s** across the ego path (pathSep 0.0).

## The five false positives, each verified against raw geometry
| brief | yesFrac | what the trace says |
|---|---|---|
| `c9g-falling-tree-branch` | 1.00 | the "branch" is a 5.5 x 2.0 m **car-shaped** actor that travels **0.6 m** and stays **3.46 m** from the ego path. The critic reported it *"dragged down and trails behind the bus into the ego lane"*. Invented. |
| `c11g-wrong-way-aisle` | 0.83 | the motorcycle travels **3.4 m**, stays **3.45 m** from the ego path, relative heading **+32.5 deg (same-direction)**. Critic: *"travels toward it in the opposing direction"*. Invented. |
| `c9g-displaced-drain-grate` | 0.83 | the grate **never moves**, sits **4.83 m** from the ego path, and is **never occluded** by the SUV. Critic: *"initially hidden behind it"*. |
| `c11-backing-out` | 1.00 | the vehicle travels **1.5 m**, reverses **0.000 m**, minimum offset from the ego path **2.76 m**. Critic: *"reaches the ego's lane"*. |
| `c8-shifted-alignment` | 0.83 | the critic's own description says the ego *"remains behind the truck, **without** passing around the work-zone"* -- and it still voted YES 5 times out of 6. |

**`c9g-displaced-drain-grate` deserves separate attention: it is the single highest-yield template in
the whole corpus** (302 of the 310 harvested "training-grade" cells came from it), it was
intent-verified by the critic, and its mechanism is absent.

## Files
`audit2/ground-truth.json`, `audit2/score-base.json`, `audit2/critic-base.json`,
`audit2/vision-gt.json`, `audit2/pairs.json`, and the instruments
`briefspec.py` / `mechfacts.py` / `speceval.py` / `perception_score.py` / `scoring.py`.
