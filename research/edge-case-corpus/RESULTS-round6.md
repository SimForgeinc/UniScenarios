# Round 6 — full 208-brief corpus run

## Headline
**99 edge-case archetypes admitted from 208 briefs (47.6%), all 15 taxonomy categories covered.**

| metric | value |
|---|---|
| archetypes admitted (evidence intact) | **99 / 208** |
| categories covered | **15 / 15** |
| DEV admission | 0.521 (38/73) |
| HELDOUT admission | 0.452 (61/135) |
| **generalization gap** | **+0.069** (p=0.344, not significant) |
| >=2 maps AND >=3 sites | 99/99 (median 4 maps, 5 sites) |
| replay bit-identical | **297/297** |
| rubrics pre-registered (sha256) | 99/99 |
| blind judge: is a critical edge case | **0.980** |
| blind judge: category (kappa) | 0.384 (kappa 0.336) |
| corpus-layout judge | **inadequate / fitForTrainingData = FALSE** |

Progression across rounds: 37 -> 40 -> 52 -> 29(strict gate introduced) -> **99**.
Admission rate: 32% -> **47.6%**.

## What is NOT met, stated plainly
1. **Requirement B's occlusion clause fails for all 10 C7 archetypes.** `declaredOcclusion` is EMPTY in
   0/30 traces. `occluderIneffective` reads 0 only because nothing was ever declared. Root cause: the tool
   surface has **no occlusion operation** — the agent can place an occluder prop but cannot declare the
   occlusion relation the engine would prove. Those 10 are valid critical near-misses but are NOT proven
   occlusion scenarios. Conservatively **89/99 satisfy requirement B in full**.
2. **The corpus-layout judge failed the corpus**: "inadequate", `fitForTrainingData: false`, citing uneven
   balance — C10.oncoming, C13.control and C2.cut-in-merge have only 2 archetypes each; C3 and C4 only 4.
3. Category agreement with the blind judge is 0.384 (kappa 0.336) — better than chance (0.072)
   but modest. The commonest confusion is occlusion -> pedestrian, which is defensible: an occluded
   pedestrian dart-out is legitimately both.

## Known open defect
**D1** (`DEFECT-D1-relative-dsM.json`): `sampledFrameS()` returns `refFrameS + dsM`, then `framePoint()`
calls `Route.poseAt()` which **clamps**. Every authored "N metres ahead of the ego" collapses to ~9 m with
a hard ceiling near 17 m. Direction is correct; distance is not honoured (correlation 0.16). Linked to the
dominant gate failure (C2, closest-approach-at-spawn: passing traces start 11.0 m apart, C2 failures 8.1 m,
Mann-Whitney p=0.0001). Fixing it should raise admission further. An attempted fix in `coverTarget()` was
wrong and has been reverted; the tree is clean.

## Evidence
`gold-corpus-v3/` — 99 archetype directories, 3 traces + instances each, `MANIFEST.json`,
`JUDGE.json`, `occlusion-check.json`. 21 MB.
