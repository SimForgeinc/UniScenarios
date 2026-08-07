# Why briefs fail the strict gate — census over 819 traces (attempt-3 evidence)

| cause | share |
|---|---:|
| **PASS** | 37.5% |
| **C2 closest approach at spawn** | **29.3%** |
| C3 true clearance > 5 m | 17.6% |
| C1 ego never really drives | 11.0% |
| C4 no deceleration demand | 4.6% |

## Per category (pass rate, then dominant failure)
                       n  PASS  C1_notmoving  C2_spawn  C3_clearance  C4_nodemand
category                                                                         
C1.car-following      96  35.4          24.0      29.2          11.5          0.0
C10.oncoming          60  35.0           0.0      38.3          25.0          1.7
C11.parking           24  20.8          29.2      50.0           0.0          0.0
C13.control           14   0.0           7.1       0.0          92.9          0.0
C14.loss-of-control   24  25.0          20.8      54.2           0.0          0.0
C15.adversarial       60  45.0           6.7      26.7           1.7         20.0
C2.cut-in-merge       60  41.7          20.0      31.7           6.7          0.0
C3.intersection      109   4.6           9.2       7.3          76.1          2.8
C4.roundabout         12   0.0          16.7      33.3          16.7         33.3
C5.pedestrian        120  73.3           0.0      13.3           3.3         10.0
C6.cyclist-ptw        36  22.2           5.6      58.3          13.9          0.0
C7.occlusion          48  50.0           8.3      39.6           2.1          0.0
C8.workzone           84  31.0          16.7      40.5           6.0          6.0
C9.hazard             72  52.8           8.3      37.5           0.0          1.4

## What this says
1. **C5.pedestrian is now the strongest category at 73.3%.** The two VRU fixes (relative-to-ego binding,
   and the engine's own re-solved `nearMiss` crossing primitive) turned the worst category into the best.
   That is evidence the "fix the mechanism, not the scenario" strategy works.

2. **The single biggest remaining loss is C2 — the ego and the challenger are CLOSEST AT SPAWN and then
   diverge.** 29.3% overall, and dominant in C6 (58%), C14 (54%), C11 (50%), C8 (41%), C7 (40%), C9 (38%),
   C10 (38%). This is spawn GEOMETRY, not timing: the challenger is being placed too near the ego's start,
   so the "encounter" is an artifact of initial placement rather than a developed conflict.
   **Next general fix:** enforce a minimum initial separation derived from the clip — the challenger must
   start far enough away that the solved arrival lands mid-clip, not at t=0.

3. **C3.intersection (76% clearance failures) and C13.control (93%)** are the loose-encounter categories:
   the actors never actually get near each other. For C3 this is already improved by (a) not installing a
   redundant arrival sync over the junction role's native `arriveAtConflict`, and (b) gate-aligned solving.
   C13 has no conflict mechanism at all yet — a signal phase change is not by itself an encounter; it needs
   a second actor whose movement the phase change provokes.

## Arithmetic for requirement A
Corpus is now **208 briefs** (tranche 1: 92, frozen `dd4f360c`; tranche 2: 116, frozen `9327be88`).
- at 32% admission -> 66 archetypes
- at 45% admission -> 93 archetypes
- at 55% admission -> 114 archetypes

**Requirement A is therefore a RATE problem as much as a COUNT problem.** Fixing C2 alone would move the
ceiling from ~37% toward ~60% of traces, which is the difference between ~66 and ~100+ admitted archetypes.

## Note for the visual lane
C2 is exactly the failure a human would catch in one glance at a top-down render: two boxes sitting on top
of each other at t=0. It is invisible to a blind agent and cost 29% of all traces. This is the strongest
single argument for the VISTA-style harness.
