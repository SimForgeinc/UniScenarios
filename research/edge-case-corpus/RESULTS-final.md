# Final corpus

**98 edge-case archetypes, 15/15 taxonomy categories, 3614 validated instances.**

| metric | value |
|---|---|
| archetypes | **98** from 208 briefs |
| categories | **15 / 15** |
| validated instances | **3614** (median 31 per archetype) |
| maps / sites per archetype | median 4 maps, 5 sites |
| DEV admission | 0.493 |
| HELDOUT admission | 0.459 |
| **generalization gap** | **+0.034** (p=0.640, not significant) |
| replay | bit-identical on every checked trace |
| blind judge: critical edge case | 0.968 |
| corpus-layout judge | **inadequate — fitForTrainingData FALSE** |

## Requirement status
A MET · B MET · C MET · D **judge run, corpus FAILS layout review** · E MET · F MET · G MET

## The one thing that is not met
Requirement D asks the blind judge to review the CORPUS LAYOUT. It returns
`fitForTrainingData: false`, citing **C10.oncoming and C13.control at 2 archetypes each**.

Those two categories are mechanism-limited, not tuning-limited:
- **C10.oncoming** — an oncoming vehicle that holds its lane passes safely (87% of failures were
  clearance > 5 m). I added a general `encroach()` operation using the engine's `laneOffset` verb
  (documented as "drift, encroachment, partial blockage, edge-riding") with the drift magnitude and
  UN-R157 lateral rate SOLVED. It doubled the C10 pass rate 8.5% -> 17.2%, but not enough to admit
  more archetypes at >=2 maps and >=3 sites.
- **C13.control** — 87.7% of failures are clearance > 5 m. A signal phase change is not itself an
  encounter. I added explicit guidance that a control brief must also place an actor whose movement the
  control provokes; it did not convert.

## Honest reading
The ALGORITHM generalises: the gap is +0.034 and not significant, admission nearly doubled from
32% to ~47%, and every improvement was mechanism-level with zero per-brief tuning. The CORPUS it
produced is real and proven but **unbalanced**, and the judge is right to say so.
