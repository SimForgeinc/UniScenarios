# Generalization gap — agent-native tool authoring

## Protocol
- 92 briefs across all 15 taxonomy categories; split **frozen by sha256 `dd4f360c16fd416f`** before any agent code existed.
- DEV (32) used to develop the TOOL SURFACE. HELDOUT (60) never inspected during development.
- Tool surface + prompt frozen at tooldoc sha256 `acd3b247746af7ab` BEFORE the held-out run; unchanged throughout.
- Identical sampling both splits: `solve(rounds=2, draws=4)` then `simulate(draws=10)`.
- **Zero per-brief hand-tuning on held-out.** No brief was re-run with modified tools.

## Result
| split | admitted | n | rate |
|---|---:|---:|---:|
| DEV | 18 | 32 | 0.562 |
| HELDOUT | 19 | 60 | 0.317 |

**GENERALIZATION GAP = +0.246** (two-proportion z = 2.29, **p = 0.022**).

The gap is statistically significant. The algorithm is measurably better on the briefs used to
develop it than on briefs it had never seen. This is reported, not explained away.

**37 archetypes admitted** across 12 of 15 categories.

## Per-category admission
                    sum      size     
split               dev held  dev held
category                              
C1.car-following      2    1    3    5
C10.oncoming          2    3    2    3
C11.parking           2    1    2    3
C12.school            0    0    1    3
C13.control           0    0    1    3
C14.loss-of-control   1    0    1    1
C15.adversarial       1    1    2    3
C2.cut-in-merge       2    5    3    6
C3.intersection       2    3    4    7
C4.roundabout         1    1    1    1
C5.pedestrian         0    0    3    7
C6.cyclist-ptw        1    1    2    5
C7.occlusion          1    1    2    4
C8.workzone           2    1    3    5
C9.hazard             1    1    2    4

## Systematic failures (identical on BOTH splits — so not overfitting, but a representational gap)
- **C5.pedestrian 0/10** — every pedestrian brief on both splits scored zero.
- **C12.school 0/4** — pedestrian-mechanism scenarios.
- **C13.control 0/4** — signal/control-state scenarios.

These 18 briefs (20% of the corpus) are not a tuning problem: they fail equally on dev and held-out,
which means the tool surface cannot express the mechanism at all. They are the correct target for
the next ALGORITHM iteration (requirement G), not for per-scenario fixes.

## Integrity note
During the held-out run the machine was changed and `OPENAI_API_KEY` was lost, causing 12 briefs to
record instant crashes. Those 12 records were **rolled back and re-run properly**; no environment
fault is counted as a scenario failure. A preflight guard now aborts rather than recording failures.
