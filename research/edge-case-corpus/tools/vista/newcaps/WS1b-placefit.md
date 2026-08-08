# WS-1b PLACE FIT

**Worktree** `/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista` @ `vista-lane`.
Owner: WS-1b (PLACE FIT). Source of truth for the diagnosis: `newcaps/DIAG-locations.md`.

## BOTTOM LINE
IN PROGRESS. Plan is fixed and evidence-backed; edits not yet applied. If this line still says
IN PROGRESS the agent died before finishing -- the plan below is still correct and executable.

Planned change: turn each brief's own noun into a REQUIRED anchor clause (junction `control`,
`bus_stop` / `school_zone` / `parking_lane` / `parking_area` / `crest` features), keeping templates
portable v2 (no coords/road ids/map names). Expected candidate counts per DIAG s.4 all clear the
M1.3 >=4 floor except `c4g-circulating-sudden-stop`, which is unsatisfiable (0 roundabouts on all
5 maps) and is handled in section C.

## Binding parent decisions
- SIGNAL-dependent archetypes: do NOT require `control:["signalized"]`. Only 6/247 junctions have a
  real signal program and map-intel's `signalized` label is wrong 17 times in 23. Require the
  junction GEOMETRY the brief needs; a separate workstream authors the light via a portable
  `trafficControls` block.
- Stop-controlled briefs ARE different: `low-friction-stop-slide` really does require
  `control: ["minor_stop","all_way_stop"]`.
- Sibling `ws1a-loud-predicates` is concurrently adding a `crest` feature kind, parking-zone
  predicates, and a `supported_scenario_templates` query. Where those do not exist yet, author the
  anchor we WANT, mark it blocked-on-ws1a, move on.

## Planned per-archetype tightening (from DIAG s.3/s.4, expected candidates)
| archetype | required place fact | expected candidates |
|---|---|---|
| c15g-red-light-runner | junction geometry (NOT control=signalized, per parent) | tbd |
| low-friction-stop-slide | control = [minor_stop, all_way_stop] REQUIRED | 29 |
| c12g-red-pedestrian-phase | crosswalk feature + school within ~200 m | 23 |
| c12g-suv-ignores-paddle | school_zone within ~250 m | 55 |
| c9g-pedestrian-behind-bus | feature kind bus_stop required | 22 |
| child-from-parked-cars | parking_lane within ~25 m | 81 |
| parked-vans-narrow-road | parking_lane within ~20 m + narrow/residential | 75 |
| rideshare-door-pedestrian | parking_lane (parallel) within ~25 m | 72 |
| c11g-hidden-child | parking_area within ~60 m | 57 |
| c11g-wrong-way-aisle | parking_area within ~60 m | 67 |
| c11g-indicator-mislead | parking_area within ~60 m | 31 |
| blind-crest-queue | crest_present within ~60 m (blocked on ws1a `crest` kind) | 32 |
| c1g-illegal-u-turn | place-agnostic, no change needed | 238 |
| c1g-cut-in-turn | place-agnostic, no change needed | 67 |
| c4g-circulating-sudden-stop | UNSATISFIABLE -- see section C | -- |

## Status
- [x] baseline sitecount captured (/tmp/vista-ws1b/sitecount-before.json)
- [ ] A. tighten 15 archetype anchors to REQUIRED context (M1.3: >=4 sites each)
- [ ] B. placefit.py mechanical site-fit checker -> JSON for audit.py --placefit
- [ ] C. c4g-circulating-sudden-stop disposition

## Per-archetype before/after (sitecount.py, --all-maps --max-sites 400)

ROUND 1 (over-tight, 3 below floor -- being relaxed):

| archetype | sites before | sites after | verdict |
|---|---|---|---|
| `blind-crest-queue` | 377 | 48 | OK |
| `c11g-hidden-child` | 397 | 7 | OK |
| `c11g-indicator-mislead` | 156 | 65 | OK |
| `c11g-wrong-way-aisle` | 272 | 3 | **BELOW 4** |
| `c12g-red-pedestrian-phase` | 360 | 4 | OK |
| `c12g-suv-ignores-paddle` | 113 | 1 | **BELOW 4** |
| `c15g-red-light-runner` | 200 | 83 | OK |
| `c1g-cut-in-turn` | 67 | 26 | OK |
| `c1g-illegal-u-turn` | 388 | 286 | OK |
| `c4g-circulating-sudden-stop` | 389 | 78 | OK |
| `c9g-pedestrian-behind-bus` | 463 | 6 | OK |
| `child-from-parked-cars` | 463 | 5 | OK |
| `low-friction-stop-slide` | 132 | 24 | OK |
| `parked-vans-narrow-road` | 431 | 0 | **BELOW 4** |
| `rideshare-door-pedestrian` | 463 | 7 | OK |
