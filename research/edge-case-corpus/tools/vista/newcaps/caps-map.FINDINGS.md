# caps-map — road-network inventory and the lane-offset silent clamp

## 1. Finding: the maps are not single-lane. The 87.8% figure is a group-counting artifact.

The brief reported that grouping non-junction driving lanes by (road, laneSection, sign of lane id)
gives 714 / 813 = 87.8% single-lane groups, and concluded that adjacent same-direction lanes barely
exist. The count is correct and the conclusion does not follow.

**The derivation is faithful.** Parsing the five `map.xodr` directly and counting `<lane type="driving">`
per (road, laneSection, side) on non-junction roads reproduces the same 714 exactly
(yale 157, belmont 211, el-camino 167, easterbrook 74, richmond 105). `map-intel` is not collapsing
anything, so there is nothing to fix in the derivation.

**The denominator is the problem.** A group is one road section's lanes on one side, and these roads
average ~13 m, so a group is 1 lane or it is 7. Counting groups weights a 7-lane arterial exactly as
much as a 13 m single-lane stub. Weighted by the thing that matters:

| unit | 1 lane | >= 2 lanes | share >= 2 |
|---|---|---|---|
| driving lanes | 697 | 300 | 30.1% |
| corridors (`map-intel` Segment chains) | 390 | 116 | 22.9% |

Per map, segments with `minThroughLanesSameDir >= 2`: yale 38, belmont 11, el-camino 46,
easterbrook 12, richmond 9. `factIndex.segmentsByLaneCount` — the matcher's own pre-filter — agrees.

**Two independent derivations agree.** `map-intel/build/segments.ts` counts the cross-section by
`road:section` row; `anchor-matcher/cross-section.ts` counts it by geometric lateral chaining, which
also finds split carriageways whose parallel same-direction lanes live on different `roadId`s. Over all
506 segments the two disagree on 4, and only 2 multi-lane corridors are hidden by the row-based one.
Not worth a rewrite.

**Acceptance, on unmodified code.** A template with `corridor.throughLanesSameDir: [2, 8] required`
plus a `lane_offset` k=-1 role at `onMissing: 'fail'` matches 23 sites on 4 of the 5 maps, every one
verdict `exact`, with the neighbour on a genuinely different lane. Zipper merges, cut-ins and lane
splitting were already structurally buildable. **No map augmentation was needed and none was built.**

## 2. What was actually broken: `pose.laneOffset` was silently discarded.

`OnReferenceRoleSchema` carries a full `FramePose`, so `kind: "on_reference"` with
`pose.laneOffset: -1` is legal, validates clean, and is the obvious way to write "start in the lane
beside the ego". `adaptRole` mapped `on_reference` to the matcher's `{ dsM, tFrac }`, which has no lane
index at all — the offset was deleted at the seam between the two vocabularies and the actor bound to
`k = 0`, the ego's own lane, with no note and no warning.

Measured on `caps-map.template.json` against HEAD: the `neighbour` role bound to **the ego's own lane
at 12 of 18 matched sites**, and to a downstream lane of the same reference path at the other 6. Never
once to the adjacent lane. `template validate` reported `ok: true` with zero adapter notes.

Two more silent paths shared the defect:
- `bind.ts` `relative_to` resolved `dLane` through an unconditional nearest-lane clamp with no
  `onMissing` field at all, so the silent branch was not even reachable by an author trying to avoid it.
- `materialize.ts` `framePosePoint` fell back to the reference lane with a note when the site had no
  lane at the requested `k`. That path carries prop poses, `route` polyline vertices, arrival triggers
  and `at.pose` invariants, so a scenario could measure a station it never described while
  `manifest.feasible` stayed `true`.

## 3. The fix

- `anchor-matcher/types/roles.ts` — `onMissing` added to `relative_to`; default changed to `fail` on
  both lane-indexed kinds. Relocation is now something an author asks for, never something they get by
  omission.
- `anchor-matcher/bind.ts` — one `resolveLaneOffset` shared by `lane_offset` and `relative_to`, so
  "the lane you asked for is not here" has one answer instead of one per role kind.
- `anchor-matcher/types/site.ts`, `degradation.ts` — bindings record `requestedK`, and "sanctioned
  clamp" is keyed on the author's stated `onMissing` rather than on which role kind happened to own
  the field.
- `scenario-materializer/adapt.ts` — a non-zero `pose.laneOffset` on `on_reference` is carried into a
  `lane_offset` binding at `onMissing: 'fail'` and reported as an adapter note. On the kinds whose lane
  is structural (`opposing`, `at_lane_drop`, `conflicting_gate`, ...) it is reported as not applied.
- `scenario-materializer/materialize.ts` — `framePosePoint` throws `lane_offset_unavailable` (and
  `lane_offset_unroutable`), and the prop loop's best-effort `catch` re-raises those two rather than
  deleting an occluder the scenario depends on.

## 4. Proof

`caps-map.template.json` — 18 sites over 4 maps, `batch --all-maps --draws 2 --max-sites 3` produces
**22 cells, 10 accepted, 10 in the `critical` band, 0 infeasible**, with `neighbour` on a real adjacent
lane at every site.

`caps-map-negative.template.json` — requires a one-lane corridor and authors a prop row beside it.

```
HEAD:  instantiate succeeds. manifest.feasible = true, issues = []. Three cones placed in the ego's
       own lane. Only a note: "no lane at k = -1; using the reference lane".
now:   exit 2
       {"code":"lane_offset_unavailable","path":"props.lane-markers.pose.laneOffset",
        "reason":"no lane at lane offset -1 at this site",
        "detail":{"siteId":"0310e370db41734c","requestedK":-1,"availableK":[0],
                  "hint":"require corridor.throughLanesSameDir so only sites wide enough to hold this
                          pose are matched"}}
```

## 5. Regression evidence

`map-intel` 131, `xodr-tools` 54, `anchor-matcher` 128, `scenario-materializer` 75 — all pass.
The `packages/cli` suite has 70 pre-existing failures in this worktree from other agents' in-flight
work; a HEAD baseline built by copying the worktree and reverting only these six files fails the
**same 70 of 370**, so this change introduces **0 new failures and 0 regressions**. The six
`vista-corpus` templates carrying a non-zero `relative_to` `dLane` match exactly the same number of
sites before and after.
