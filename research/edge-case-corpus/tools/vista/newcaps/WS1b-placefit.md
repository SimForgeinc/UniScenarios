# WS-1b — PLACE FIT

Worktree `/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista` @ `vista-lane`.
Diagnosis this builds on: `newcaps/DIAG-locations.md`. Nothing in `gate.py`, `loccritic.py`,
`audit.py` or `sitecount.py` was modified; the full harvest was not run.

## BOTTOM LINE

The delivered corpus is in the wrong PLACE **60 % of the time**, and the reason is now pinned to a
single mechanical defect rather than a judgement call: **a feature marked `essentiality: "required"`
does not constrain the site if its `atM` / `lateralDistanceM` clauses are `preferred`.** It binds the
nearest thing of that kind at any distance, or nothing at all, and loses a few score points.
Proof: `c11g-hidden-child` declares a *required* `driveway` feature and returns 397 sites, while a
probe whose only feature is a `driveway` with `atM` **required** returns **0 sites on all five maps**
— there is not one mapped driveway anywhere. The "required" feature was never enforced. That single
fact explains every WRONG verdict in DIAG-locations without appealing to anyone's taste.

Fixing it is mechanical and was applied to all 15 archetypes: promote the position clauses of the
feature carrying the brief's own noun, plus the junction/corridor predicate the brief depends on, to
`required`. **All 15 archetypes clear the M1.3 floor of >= 4 usable sites** (thinnest:
`c12g-red-pedestrian-phase` and `child-from-parked-cars` at 5, `c9g-pedestrian-behind-bus` at 6,
`blind-crest-queue` and `c11g-hidden-child` at 7). Candidate pools fall
by 45-99 % — that fall *is* the deliverable: it is the count of sites that were being certified
"exact" in places the brief does not describe.

`placefit.py` measures M1.1 with no LLM anywhere: every judgement is a distance, a count, a lane width
or an enum lookup in `dev-assets/<map>/derived/*.json.gz`. On the delivered corpus it reports
**0.3993 (117/293)** against the tightened declarations
(target >= 0.95 → FAIL). That number is expected and is the point: the corpus was harvested against
the loose templates, so it measures the damage rather than the fix. A re-harvest against
`/tmp/vista-ws1b/templates/` is what should move it, and is NOT part of this workstream.

`c4g-circulating-sudden-stop` was **re-briefed, not faked and not retired** — see section C.

Two requirements could not be expressed in a template at all and are enforced by `placefit.py`
directly from facts, with the blocking ask written down: **crests** (kind not in `FeatureKindSchema`,
blocked on ws1a) and **schools on 4 of the 5 maps** (9 of 11 school POIs are typed `poi_frontage`,
which the matcher's `LOCATION_KIND_MAP` does not map).

---

## A. Anchor tightening — before / after

Counts from `sitecount.py` (unmodified) over all five maps, `--max-sites 400`.
Baseline: `/tmp/vista-ws1b/sitecount-before.json`. After: `/tmp/vista-ws1b/sitecount-after.json`.
Tightened templates: `/tmp/vista-ws1b/templates/`, regenerated deterministically by
`ws1b_tighten.py` from the untouched originals in `/tmp/vista-ws1b/base/`.

| archetype | sites before | sites after | M1.3 (>=4) | place-fit rate of the DELIVERED corpus | what was made REQUIRED |
|---|---|---|---|---|---|
| `blind-crest-queue` | 377 | 7 | OK | 0.0 | crest feature REQUIRED and now genuinely matchable (ws1a landed the kind mid-flight); occlusion_zone position REQUIRED; runway/curvature left preferred because they are clip-length clauses, not place clauses, and required they cost every site. |
| `c11g-hidden-child` | 397 | 7 | OK | 0.0 | parking_zone and occlusion_zone positions REQUIRED; the inert driveway clause is demoted to cosmetic and labelled as unmapped rather than left pretending to bind. |
| `c11g-indicator-mislead` | 156 | 65 | OK | 0.5714 | parking_zone position REQUIRED; junction conflict geometry and arms>=3 REQUIRED. |
| `c11g-wrong-way-aisle` | 272 | 143 | OK | 0.0 | parking_zone position REQUIRED; corridor REQUIRED to be a low-speed <=2-lane street. This is what excludes John T. Knox Freeway. |
| `c12g-red-pedestrian-phase` | 360 | 5 | OK | 0.2308 | school_zone feature REQUIRED (this is a school scenario -- this pins the archetype to the one map that has a mapped school zone, which is the honest answer), crossing presence and position REQUIRED, junction must have a crossing on a leg REQUIRED. control left preferred per the parent decision on signal labels. |
| `c12g-suv-ignores-paddle` | 113 | 27 | OK | 1.0 | crossing feature REQUIRED (the paddle guards a crossing) + junction conflict geometry REQUIRED. school_zone stays preferred(w=8) because only 2 of 11 school POIs are matchable; placefit.py enforces the school within 250 m from facts instead. |
| `c15g-red-light-runner` | 200 | 83 | OK | 0.209 | junction geometry required: opposing left-turn conflict + arms>=3 + size>=8 m. control deliberately NOT required (parent decision on signal labels). |
| `c1g-cut-in-turn` | 67 | 26 | OK | 1.0 | side-street conflict geometry REQUIRED (from_right, right turn) and arms>=3 REQUIRED. |
| `c1g-illegal-u-turn` | 388 | 286 | OK | 0.5 | junction arms>=3 and size>=8 m REQUIRED, and an opposing carriageway REQUIRED -- a U-turn needs somewhere to turn into. |
| `c4g-circulating-sudden-stop` | 389 | 78 | OK | 0.0 | RE-BRIEFED off "roundabout" (0 exist map-wide) to "committed inside a large multi-arm intersection": arms>=4 and size>=20 m REQUIRED, egoTurn straight REQUIRED. |
| `c9g-pedestrian-behind-bus` | 463 | 6 | OK | 0.12 | bus_stop feature REQUIRED on the corridor; sidewalk adjacency REQUIRED. |
| `child-from-parked-cars` | 463 | 5 | OK | 0.5 | parking_zone REQUIRED within 90 m and 15 m laterally, occlusion_zone position now REQUIRED, sidewalk adjacency REQUIRED, speed capped at 65 kph (was 90). |
| `low-friction-stop-slide` | 132 | 24 | OK | 0.025 | control = [minor_stop, all_way_stop] REQUIRED; arms>=3 and egoTurn straight required. |
| `parked-vans-narrow-road` | 431 | 118 | OK | 0.6 | parking_zone REQUIRED; corridor REQUIRED narrow: lane width <=4.6 m, <=2 lanes each way, speed limit <=70 kph. This is what excludes the 105 kph 3-lane arterials. |
| `rideshare-door-pedestrian` | 463 | 7 | OK | 0.0 | parking_zone REQUIRED kerbside, sidewalk adjacency REQUIRED, speed capped at 70 kph. |

**M1.3: 0 archetypes below 4.** `audit.py --sitecounts /tmp/vista-ws1b/sitecount-after.json` reports
`M1.3 pass: True, belowFour: {}`.

### The two binding parent decisions, as implemented
* **Signal-dependent archetypes do NOT require `control: ["signalized"]`.** `c15g-red-light-runner`
  and `c12g-red-pedestrian-phase` instead require the junction GEOMETRY the violation needs —
  an opposing left-turn conflict, `arms >= 3`, `sizeM >= 8 m`, and (for the pedestrian phase) a
  crossing on a leg. The light is a separate workstream's `trafficControls` block.
  Consequence to read honestly: `c15g` scores **1.00 place fit**, and that is *by construction* of
  this decision — M1.1 no longer asks about the signal at all. Whether the light exists is M4.4's
  question, not this instrument's.
* **Stop-controlled briefs are different.** `low-friction-stop-slide` requires
  `control: ["minor_stop","all_way_stop"]`. It keeps 24 sites (floor 4) and its delivered corpus
  place fit collapses to **0.025** — 39 of 40 delivered instances are at junctions that carry no
  stop sign, which is exactly the defect DIAG named.

### Where a requirement could NOT be expressed, and what is blocked on ws1a
**ws1a landed `crest` and the parking-zone predicates MID-FLIGHT.** All work below was authored
against the pre-ws1a matcher (which dropped both), deliberately writing the anchor we WANTED so it
would bite the moment the kind arrived — and it did. Re-validated after `adapt.ts: crest -> 'crest'`
landed: **0 dropped clauses** on 12 of 15 templates, `blind-crest-queue`'s required crest now matches
for real (probe: 25-36 sites), and its own pool rose 4 → 7. Nothing had to be re-authored.

| want | status | what was done instead |
|---|---|---|
| feature kind `crest` | **LANDED mid-flight** (was: `feature kind "crest" is not matchable; feature dropped`) | the required `crest` anchor was authored anyway and now binds for real; `blind-crest-queue` 4 → 7 sites. `placefit.py` independently checks `crest_present` within 60 m from facts. |
| parking-zone predicates (`orientation`/`capacity`/`occupancy`/`lengthM`) | **LANDED mid-flight** — the 13 dropped-clause notes on the 3 `c11g-*` templates are gone | the parking requirement is carried by the `parking_zone` feature's REQUIRED position instead, which is enforceable today. `placefit.py` additionally separates a parking **lot** (`parking_area`) from a kerb **lane** (`parking_lane`), which no template can express. |
| query `supported_scenario_templates` | not verified as a template-level clause | `placefit.py` reads the whitelist straight out of `occlusion_zone.facts` — 275 zones carry it (`child_dartout_from_parked_cars` 267, `pedestrian_emerging_around_bus` 5, `delivery_truck` 3). |
| **NEW ASK for ws1a** | — | add `poi_frontage` + tag `SCHOOL_ZONE_BOUNDARY` to `LOCATION_KIND_MAP` → `school_zone`. Today only **2 of 11** school POIs are typed `school_zone` (both easterbrook), which is why requiring a school caps `c12g-suv-ignores-paddle` at **3 sites — below the M1.3 floor**, measured every way it was tried (corridor relaxed, junction relaxed, diversity off, mirror on, window widened to +/-400 m: still 3). |

Also recorded, since it silently defeats an authored requirement: **zero `driveway` point features
exist on any of the five maps.** `c11g-hidden-child`'s "parking-lot access lane" clause is therefore
demoted to `cosmetic` and labelled as unmapped rather than left pretending to bind.

---

## B. `placefit.py` — mechanical M1.1, no LLM

`research/edge-case-corpus/tools/vista/placefit.py`

```bash
.venv/bin/python placefit.py \
  --dataset /tmp/vista-dataset-all/train.jsonl /tmp/vista-dataset-all/test.jsonl \
  --templates /tmp/vista-ws1b/templates \
  --out /tmp/vista-placefit.json
.venv/bin/python audit.py --dataset /tmp/vista-dataset-all/{train,test}.jsonl \
  --sitecounts /tmp/vista-ws1b/sitecount-after.json --placefit /tmp/vista-placefit.json
```

Emits `{"summary": {"n","pass","rate","perArchetype",...}, "records":[...]}`; verified that
`audit.py --placefit` reads it as **M1.1 rate 0.3993, pass False**.

**What a requirement is.** Two sources, both mechanical, no hand-maintained duplicate of the brief:
1. **The archetype's own tightened template.** Only clauses the author marked `required` are read —
   a `preferred` clause is a wish and grading a scenario against a wish is the conflation that
   produced this whole problem. Required feature positions become proximity assertions against
   map-intel locations; required junction clauses become lookups in `topology-derived.junctions[]`
   for the site's own `manifest.site.originFeatureId`; required corridor clauses become lookups in
   the `segments[]` entry that owns the ego's lane.
2. **`EXTRA`** — the ~14 assertions map-intel publishes as facts that a v2 anchor physically cannot
   express (school POIs, crests, the `supported_scenario_templates` whitelist, parking **lot** vs
   parking **lane**, "not a 3-lane 105 kph arterial").

**Conventions verified, not assumed.** Locations carry SCENE `{x,y,z}` and **plot_y = -scene_z**;
topology junctions already carry plot `centerXY` (checked: 5.6 m from the driven path of a delivered
junction-anchored site). Distance is measured **laterally to the ego's driven path**, not from the
ego spawn — the spawn sits an approach runway (60-120 m) upstream of the event, and a spawn-relative
window wrongly rejected 53 of 67 correctly-placed `c15g` sites before this was fixed.

**Nothing defaults to pass.** An unreadable trace or map asset is `unmeasurable` and counts as a
FAILURE; an archetype that declares no required context returns `None` and is counted `undeclared`,
never a pass.

### Result on the delivered corpus: **0.3993 (117/293)**, target 0.95 → FAIL

Negative control: the same instrument run against the ORIGINAL loose templates
(`--templates /tmp/vista-ws1b/base`) scores **0.4573 (134/293)** — higher, as it must be, because
the loose declarations assert less. The tightened declaration is strictly harder to satisfy.

Cross-check against DIAG-locations' independent findings — the two instruments agree:

| DIAG-locations said | placefit.py measures |
|---|---|
| `low-friction-stop-slide` 5/6 sites uncontrolled | 0.025 (39/40 fail `junction.control`) |
| `c9g-pedestrian-behind-bus` binds 0 of 14 bus stops | 0.12 (21/25 have no whitelisted occluder, 11/25 no bus stop within 40 m) |
| `blind-crest-queue` sites 142-272 m from any crest | 0.00 (15/15 fail `crest within 60 m`) |
| `c11g-hidden-child` 0/5 with parking adjacent | 0.00 (25/31 have no `parking_area` within 60 m) |
| `c4g` 0 roundabouts, one site a 2-arm link | 0.21 (19/24 fail `arms >= 4`) |

### Every failing clause, by volume

| records failing | archetype | clause |
|---|---|---|
| 53 | `c15g-red-light-runner` | required feature conflict-junction (junction) |
| 39 | `low-friction-stop-slide` | junction.control |
| 39 | `low-friction-stop-slide` | stop-controlled junction |
| 25 | `c11g-hidden-child` | parking lot within 60 m |
| 23 | `low-friction-stop-slide` | required feature stop-controlled-conflict-junction (junction) |
| 21 | `c11g-wrong-way-aisle` | parking lot within 60 m |
| 21 | `c9g-pedestrian-behind-bus` | occluder whitelisted for pedestrian_emerging_around_bus |
| 20 | `c11g-hidden-child` | required feature mapped-occlusion (occlusion_zone) |
| 20 | `c11g-hidden-child` | required feature parking-edge (parking_zone) |
| 19 | `c4g-circulating-sudden-stop` | junction.arms |
| 19 | `c4g-circulating-sudden-stop` | large multi-arm junction box |
| 16 | `c12g-red-pedestrian-phase` | required feature school-zone (school_zone) |
| 15 | `blind-crest-queue` | crest within 60 m |
| 15 | `blind-crest-queue` | required feature blind-rise (crest) |
| 12 | `c9g-pedestrian-behind-bus` | required feature bus-stop (bus_stop) |
| 11 | `c9g-pedestrian-behind-bus` | bus stop within 40 m |
| 10 | `c11g-hidden-child` | corridor.requiresAdjacent |
| 9 | `c12g-red-pedestrian-phase` | required feature school-crossing (crossing) |
| 9 | `c12g-red-pedestrian-phase` | school within 250 m |
| 9 | `c4g-circulating-sudden-stop` | required feature circulation-junction (junction) |
| 6 | `c12g-red-pedestrian-phase` | required feature school-approach-junction (junction) |
| 5 | `c11g-wrong-way-aisle` | required feature parking-row (parking_zone) |
| 4 | `parked-vans-narrow-road` | corridor.throughLanesSameDir |
| 4 | `parked-vans-narrow-road` | narrow ordinary street |
| 3 | `c11g-indicator-mislead` | parking lot within 60 m |
| 3 | `c11g-indicator-mislead` | required feature crossing-junction (junction) |
| 3 | `c4g-circulating-sudden-stop` | junction.sizeM |
| 3 | `child-from-parked-cars` | kerbside parking |
| 3 | `child-from-parked-cars` | required feature kerbside-parking (parking_zone) |
| 2 | `rideshare-door-pedestrian` | corridor.requiresAdjacent |
| 1 | `c1g-illegal-u-turn` | required feature junction-ahead (junction) |
| 1 | `c9g-pedestrian-behind-bus` | corridor.requiresAdjacent |
| 1 | `child-from-parked-cars` | corridor.requiresAdjacent |
| 1 | `parked-vans-narrow-road` | corridor.speedLimitKph |

---

## C. `c4g-circulating-sudden-stop` — RE-BRIEFED, not retired

**Why it was unsatisfiable.** Zero roundabouts exist on any of the five maps (247 junctions:
179 uncontrolled, 41 minor_stop, 23 signalized, 3 all_way_stop, **0 roundabout**). All 6 delivered
sites were ordinary junctions — one of them a 2-arm road-to-road link, i.e. not an intersection at
all — and all 6 scored **1.00 / exact**, because the anchor listed `roundabout` among six accepted
control values as a `preferred` clause. The template asked for nothing and got a perfect mark.

**Decision: RE-BRIEF.** Retiring it would throw away a mechanism the corpus genuinely lacks, and
faking it would put a "circulating" label on a T-junction. The test the brief is actually buying is
not circular geometry — it is: **the lead vehicle stops dead while the ego is already COMMITTED
INSIDE the junction box**, where stopping strands the ego across a conflicting movement and there is
no lane to escape into. Circulating carriageway is one way to produce that; a large multi-arm
intersection is another, and these maps have those.

New brief: *"The ego follows a lead vehicle into a large multi-arm intersection and the lead stops
dead while the ego is already inside the box, leaving the ego stranded across a conflicting movement
with no lane to escape into."*

Anchor: `arms >= 4` REQUIRED, `sizeM >= 20 m` REQUIRED, `egoTurn: straight` REQUIRED,
`runwayDownstreamM >= 120 m`. `meta.name`, `meta.description` and `meta.tags` are rewritten
(`roundabout` / `circulating` tags removed, `re-briefed` added) so nothing downstream still claims a
roundabout. **78 sites survive** across all five maps (was 389), and place fit on the existing
delivered instances is 0.21 — i.e. 19 of the 24 delivered instances do NOT satisfy the new brief and
would be replaced by a re-harvest. That is the honest number.

---

## Reproduction

```bash
cd /Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista/research/edge-case-corpus/tools/vista
V=/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista/.venv/bin/python

# 1. what the matcher can actually see (writes /tmp/vista-ws1b/probe-kinds.json)
$V ws1b_probe.py

# 2. regenerate the tightened templates from the untouched originals
$V ws1b_tighten.py --base /tmp/vista-ws1b/base --out /tmp/vista-ws1b/templates

# 3. M1.3 before / after
$V sitecount.py --dataset /tmp/vista-ws1b/ds-base.jsonl --out /tmp/vista-ws1b/sitecount-before.json
$V sitecount.py --dataset /tmp/vista-ws1b/ds-new.jsonl  --out /tmp/vista-ws1b/sitecount-after.json

# 4. M1.1
$V placefit.py --templates /tmp/vista-ws1b/templates --out /tmp/vista-placefit.json
$V audit.py --dataset /tmp/vista-dataset-all/train.jsonl /tmp/vista-dataset-all/test.jsonl \
   --sitecounts /tmp/vista-ws1b/sitecount-after.json --placefit /tmp/vista-placefit.json
```

Artefacts: `/tmp/vista-ws1b/{base,templates}/`, `sitecount-{before,after}.json`,
`probe-kinds*.json`, `probe-junction.json`, `tighten-notes.json`, `validate-after.json`,
`RESULTS.json`, `placefit-BASE-templates.json`, and `/tmp/vista-placefit.json`.

## Handover / open items
1. **Re-harvest against `/tmp/vista-ws1b/templates/`** is required before M1.1 can improve; this
   workstream deliberately did not run it.
2. **ws1a `crest` has landed** — no action left. `blind-crest-queue` binds real crests now (7 sites).
   Its delivered instances still score 0.00 place fit because they were harvested against the old
   template; item 1 (re-harvest) is what fixes them.
3. **map-intel / ws1a**: map `poi_frontage` + `SCHOOL_ZONE_BOUNDARY` into `school_zone`, which
   unblocks promoting `c12g-suv-ignores-paddle`'s school clause to required.
4. **`c12g-red-pedestrian-phase` now only matches easterbrook-discovery-school** (5 sites). That is
   the honest consequence of requiring a mapped school zone, and item 3 is what widens it again.
5. `c12g-suv-ignores-paddle` has a **pre-existing** validation error unrelated to anchors
   (`"pose.stopArm" applies to vehicle, but role "traffic_marshal" is a pedestrian`), present in the
   original template and left untouched.
