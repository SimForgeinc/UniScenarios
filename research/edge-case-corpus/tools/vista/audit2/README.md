# audit2 -- independent validation audit of the VISTA scenario validator

Written by the independent auditor. Everything here is under `research/edge-case-corpus/tools/vista/audit2/`.

## Reports (read these)
| file | what it answers |
|---|---|
| `REPORT-1-PRECISION-RECALL.md` | precision/recall/F1/confusion/Wilson CIs of `critic.py`; the operating threshold |
| `REPORT-2-RENDER.md` | is the rendering the limiting factor? (yes for perception, not for the verdict) |
| `REPORT-3-GATE-CLAUSES.md` | Q8, Q7, deduplication, plus engine findings. Includes the two claims that did NOT reproduce |
| `REPORT-4-HYBRID.md` | audit of `hybrid.py`/`motion.py` at 37e6dce, and the `challenger_enters_ego_path` diagnosis |
| `CHECKPOINT-{1,2,3}-*.md` | the working checkpoints the reports were assembled from |

## The reusable validator
    from predicates import parse_brief, evaluate_trace
    preds = parse_brief(brief)                 # one LLM call, TEXT ONLY, closed vocabulary
    r = evaluate_trace(trace_path, preds)      # pure arithmetic on the trace
    r['verdict']                               # 'present' | 'absent' | 'abstain'

    python predicates.py --regression                        # 33/33 constructed negatives
    python predicates.py batch-summary.json --brief "..."     # score a whole batch

`predicates.py` documents its closed vocabulary (`VOCABULARY`), what is deliberately
**not** computable (`NOT_COMPUTABLE`), every numeric threshold with its decisive-TRUE and
decisive-FALSE values (`THRESHOLDS`), and the abstain rule.

## The permanent regression test
`regression-negatives.json` -- 33 (brief, trace) pairs where the brief names an actor class the clip
provably does not contain. Ground truth needs no model and no image, so this is valid against ANY
future validator, vision-based or not. It must score 100%.

## Ground truth
`ground-truth.json` -- 77 labelled pairs with, for each, the label, its confidence, its source, and
the specific measurement that settles it. `FALSE-POSITIVES.json` -- the templates to purge.

## Instruments (all independent of the code under audit)
| file | what it is |
|---|---|
| `obb_indep.py` | from-scratch SAT + polygon distance; does not import `gate.py` |
| `fastgate.py` | numpy re-implementation of C1-C5; agrees with `gate.py` 111/111 where it matters |
| `mechfacts.py` | trajectory fact sheet per actor |
| `speceval.py` | predicate evaluation with abstain bands |
| `briefspec.py` | brief -> spec, text only |
| `visionarm.py` | brief-blind perception, then image-blind entailment |
| `perception_score.py` | scores VLM perception against exactly-computable facts |
| `lane_arbiter.py` | lane incursion from the ENGINE's own `lateralOffsetM` |
| `subtick.py` | 16x temporal supersampling to test for hidden contacts |
| `scoring.py` | precision/recall/F1 with Wilson intervals |

## Renderers
`render2.py` (9 panels, per-frame zoom, trails, speed labels; `world_fixed=True` variant),
`render_trails.py` (complete paths over the whole clip). Examples in `renders/demo_*.png`.

## Errors I made and corrected, recorded on purpose
- classifier matched `'ped'` as a raw substring, so `stopped-bus-0` classified as a pedestrian.
  Invalidated one constructed negative and produced one wrong ground-truth label.
- the first trajectory arm ignored props outside `PRESENT`, and had no abstain band.
- the first auto-zoom took the max over frames and produced a render WIDER than the one it was
  meant to improve on; the first world-fixed view was 114 m across and I misread a moving
  pedestrian as stationary from it.
- I raised a concern that Q2 was inflated by one-tick freezes, measured it, and withdrew it.

## Update after the parent shipped corrections (commit b468960)
`REPORT-5-CORRECTION-AND-DECISION.md` supersedes parts of REPORT-4. It contains two corrections to
this audit's OWN instruments, a re-scoring of the current `hybrid.py`, and the answer to the
AND-vs-veto decision plus a measured way to recover recall at zero cost.
