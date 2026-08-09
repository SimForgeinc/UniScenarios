# DIAG-locations — location quality of the 15 delivered VISTA archetypes

Worktree `UniScenarios-vista` @ `vista-lane`. Evidence: `/tmp/vista-dataset-all/{train,test}.jsonl`
(293 instances, 72 distinct archetype x map x site sites), the delivered
`*.instance.json` manifests, `dev-assets/<map>/derived/{locations,topology-derived}.json.gz`,
and fresh `uniscenarios sites match <template> --all-maps --max-sites 50` +
`uniscenarios template validate` runs. No template or pipeline code was modified.

**BOTTOM LINE.** The location problem is *not* mostly caused by degraded matching — it is caused by the
site score measuring the wrong thing. Site score answers "did every anchor clause bind?"; it never answers
"is this a sensible PLACE for this brief?" The proof is `c15g-red-light-runner`: all 8 delivered sites and
all 67 delivered instances score **1.00 / exact**, and **0 of 8 are signalized junctions** (5 uncontrolled,
3 minor_stop) — because the template's `junction.control` clause lists all four control types as
`preferred`, so a red-light-runner at an uncontrolled junction is a perfect match. The same failure repeats:
`low-friction-stop-slide` ("slides through a stop-controlled junction") is 5/6 **uncontrolled** and still
4/6 exact; `c4g-circulating-sudden-stop` ("circulating") is 6/6 exact although **zero roundabouts exist on
any of the five maps** (246 junctions: 179 uncontrolled, 41 minor_stop, 23 signalized, 3 all_way_stop);
`c9g-pedestrian-behind-bus` binds a parked-car occluder rather than any of the 14 mapped `bus_stop`
locations at 0/7 sites; `blind-crest-queue` requests feature kind `crest`, which the matcher's
`FeatureKindSchema` does not contain — `template validate` says *"feature kind \"crest\" is not matchable;
feature dropped"* — so all 5 sites score an identical 0.89 and sit 142–272 m from the nearest real crest
(2 of them on a map with no crest at all). All four parking archetypes
(`c11g-hidden-child`, `c11g-wrong-way-aisle`, `c11g-indicator-mislead`, `parked-vans-narrow-road`) have
their parking predicates silently deleted by the adapter ("the matcher has no parking-zone predicates") and
land on arterials and a freeway: **0 of 20** of their sites have `hasParkingAdjacent`, while 155
`NARROW_RESIDENTIAL_STREET_WITH_PARKING` locations and 21 `parking_area` lots sit unused. Consequently
**`--min-score 1.0` is close to useless as a quality lever**: it would keep only 5 of 15 archetypes alive
(the 7 archetypes with 0 exact sites map-wide would vanish entirely), and for 3 of the 5 survivors it
changes nothing semantically. The cheap, correct lever is a *place* gate built from facts map-intel already
publishes — junction `derived_control`, `poi_type`/`SCHOOL_ZONE_BOUNDARY`, `bus_stop`, `parking_lane` /
`parking_area` / `NARROW_RESIDENTIAL_STREET_WITH_PARKING`, `crest_present`, `occlusion_subtype`, and above
all the already-computed but wholly ignored `supported_scenario_templates` whitelist on 275 occlusion
zones. Applying one such filter per archetype keeps 22–81 candidate sites for every archetype except
`c4g-circulating-sudden-stop`, which is unsatisfiable on this map set and should be re-briefed or dropped.

---

## 1. Per-archetype survey — what the delivered sites actually are

`sites (E/D)` = distinct delivered sites exact/degraded. `instances (E/D)` = delivered rows in the dataset.
Scores are the anchor-matcher site scores of the delivered sites.

| archetype | brief needs | sites (E/D) | exact % | instances (E/D) | score min/med | what the sites actually are | verdict |
|---|---|---|---|---|---|---|---|
| c15g-red-light-runner | signalized junction + red signal | 8/0 | 100% | 67/0 | 1/1 | junctions: minor_stop x3, uncontrolled x5; roads: Island Parkway(3), Clipper Drive(1), Road 108(1), El Camino Real(1) | WRONG |
| c4g-circulating-sudden-stop | roundabout / circulating carriageway | 6/0 | 100% | 24/0 | 1/1 | junctions: minor_stop x1, signalized x1, uncontrolled x4; roads: Island Parkway(1), Corona Drive(1), Page Mill Road(1), Egret Way(1) | WRONG (unsatisfiable) |
| low-friction-stop-slide | stop-controlled junction | 4/2 | 66% | 17/23 | 0.92/1 | junctions: minor_stop x1, uncontrolled x5; roads: El Camino Real(2), Island Parkway(1), Robin Drive(1), Regatta Boulevard(1) | WRONG |
| c12g-red-pedestrian-phase | signalized junction + school + controlled crossing | 0/7 | 0% | 0/26 | 0.65/0.74 | junctions: minor_stop x4, signalized x2, uncontrolled x1; roads: College Avenue(3), Corona Drive(2), Road 109(1), Crow Drive(1) | WRONG |
| c9g-pedestrian-behind-bus | bus stopped at the curb | 0/7 | 0% | 0/25 | 0.79/0.81 | road segments x7; roads: Clipper Drive(2), El Camino Real(2), Oregon Expressway(1), Jay Way(1) | WRONG |
| c11g-hidden-child | parking-lot access lane | 0/5 | 0% | 0/31 | 0.87/0.92 | road segments x5; roads: Clipper Drive(1), El Camino Real(1), Page Mill Road(1), Oregon Expressway(1) | WRONG |
| c11g-wrong-way-aisle | marked parking aisle | 0/3 | 0% | 0/21 | 0.9/0.9 | road segments x3; roads: Road 109(1), John T. Knox Freeway(1), West El Camino Real(1) | WRONG |
| c11g-indicator-mislead | parking bay / parking aisle | 1/6 | 14% | 1/13 | 0.96/0.96 | junctions: uncontrolled x7; roads: Page Mill Road(4), Road 109(2), El Camino Real(1) | WRONG |
| blind-crest-queue | crest of a hill | 0/5 | 0% | 0/15 | 0.89/0.89 | road segments x5; roads: Jay Way(2), Road 124(1), El Camino Real(1), Page Mill Road(1) | WRONG |
| parked-vans-narrow-road | narrow ordinary street, vans both kerbs | 0/7 | 0% | 0/10 | 0.86/0.86 | road segments x7; roads: West El Camino Real(2), Concourse Drive(1), Road 26(1), Island Parkway(1) | WRONG |
| child-from-parked-cars | parked cars at the kerb | 0/5 | 0% | 0/8 | 0.88/0.9 | road segments x5; roads: Clipper Drive(2), Road 93(1), Oregon Expressway(1), Jay Way(1) | MARGINAL |
| rideshare-door-pedestrian | kerbside stop | 0/1 | 0% | 0/2 | 0.92/0.92 | road segments x1; roads: Page Mill Road(1) | MARGINAL |
| c12g-suv-ignores-paddle | near the school | 0/1 | 0% | 0/3 | 0.93/0.93 | junctions: uncontrolled x1; roads: Page Mill Road(1) | MARGINAL |
| c1g-illegal-u-turn | any junction | 2/0 | 100% | 2/0 | 1/1 | junctions: uncontrolled x2; roads: Road 102(1), Jay Way(1) | OK |
| c1g-cut-in-turn | side street ahead | 1/1 | 50% | 1/4 | 0.98/1 | junctions: signalized x1, uncontrolled x1; roads: El Camino Real(1), Cambridge Avenue(1) | OK |

### 1b. Why each WRONG/MARGINAL verdict was reached

**c15g-red-light-runner** — needs *signalized junction + red signal*. 0/8 sites signalized (5 uncontrolled, 3 minor_stop) yet all 8 score 1.00 exact — the anchor accepts all four controls, so "exact" certifies nothing about the signal.

**c4g-circulating-sudden-stop** — needs *roundabout / circulating carriageway*. 0 roundabouts exist on any of the 5 maps (246 junctions: 179 uncontrolled / 41 minor_stop / 23 signalized / 3 all_way_stop). All 6 sites are ordinary junctions, one of them 2-arm (a road-to-road link, not an intersection). 6/6 "exact".

**low-friction-stop-slide** — needs *stop-controlled junction*. 5/6 sites are uncontrolled; only 1 is minor_stop. The anchor lists control ["minor_stop","uncontrolled"], so an uncontrolled junction scores 1.00 exact while contradicting the brief.

**c12g-red-pedestrian-phase** — needs *signalized junction + school + controlled crossing*. 2/7 signalized, 5/7 within 200 m of a school, only 1/7 both (yale b6ae5117). belmont + richmond sites have no school anywhere on the map. Scores 0.65-0.82 - the lowest in the corpus.

**c9g-pedestrian-behind-bus** — needs *bus stopped at the curb*. 0/7 sites bind a bus_stop or a BUS_STOP_OCCLUSION; every bound occluder is PARKING_NEAR_CONFLICT_POINT or a crosswalk. Nearest real bus stop is 33.9-193.5 m; only 1/7 is within 50 m. The anchor never uses feature kind "bus_stop" even though the matcher supports it and 14 bus_stop locations exist.

**c11g-hidden-child** — needs *parking-lot access lane*. 0/5 sites have parking adjacent to the corridor. Sites are on El Camino Real (3 lanes one-way), Page Mill Road (3 lanes), Oregon Expressway (2 lanes), John T. Knox Freeway. All 4 parking-zone predicates (orientation/capacity/occupancy/lengthM) are dropped by the adapter, so the "parking" clause is inert.

**c11g-wrong-way-aisle** — needs *marked parking aisle*. 0/3 sites have parking adjacent; one site is on John T. Knox Freeway, one on a 2.10 m-wide one-way link on West El Camino Real. Parking predicates dropped by adapter. A wrong-way motorcycle "down the aisle" is being staged on a freeway.

**c11g-indicator-mislead** — needs *parking bay / parking aisle*. All 7 sites are arterial junctions (Page Mill Road x4, Road 109 x2, El Camino Real). Nearest parking_lane 27-123 m. All 4 parking predicates dropped; egoTurn narrowed to "straight" by the adapter.

**blind-crest-queue** — needs *crest of a hill*. feature kind "crest" is NOT in the matcher FeatureKindSchema - `template validate` reports "feature kind \"crest\" is not matchable; feature dropped". 0/5 sites are near a crest_present location (nearest 142-272 m) and 2/5 are on richmond-field-station which has zero crests. All 5 maps report capabilities.grade=false. Every site scores the identical 0.89 because the crest clause contributes nothing.

**parked-vans-narrow-road** — needs *narrow ordinary street, vans both kerbs*. 0/7 sites have hasParkingAdjacent. 3/7 are 3-lane one-way arterials (El Camino Real, West El Camino Real - one posted 105 kph). One site (belmont 03da3206, Concourse Drive) is a 1.14 m long segment. 155 NARROW_RESIDENTIAL_STREET_WITH_PARKING locations exist and none were used.

**child-from-parked-cars** — needs *parked cars at the kerb*. 0/5 hasParkingAdjacent, and one site is on Oregon Expressway (3 lanes, one-way). It does bind PARKING_NEAR_CONFLICT_POINT occluders 8/8, so the parked-car premise is at least represented - but the street type is wrong.

**rideshare-door-pedestrian** — needs *kerbside stop*. single site on Page Mill Road, 2.53 m lanes, no parking adjacent, but a parking_space 2.2 m away and a PARKING_NEAR_CONFLICT_POINT occluder bound. Only 1 site - below the 4-site floor regardless.

**c12g-suv-ignores-paddle** — needs *near the school*. single site (el-camino 61a8619d, Page Mill Road) 101 m from a school-zone boundary. Plausible, but 1 site only.

**c1g-illegal-u-turn** — needs *any junction*. brief is place-agnostic ("a lead SUV begins a U-turn"). Both sites are 3-arm uncontrolled junctions with the required same-direction through lane. 2/2 exact.

**c1g-cut-in-turn** — needs *side street ahead*. brief is place-agnostic. 2 sites, both junctions with a from-right right-turn conflict. Only 2 sites though.


### 1c. Adapter notes — clauses the matcher silently deletes

`uniscenarios template validate` reports, per template, which authored clauses are dropped before matching.
These are the clauses the author *thought* were constraining the location:

| archetype | dropped clause | reason |
|---|---|---|
| c4g-circulating-sudden-stop | anchor.features.circulation-junction.egoTurn | the matcher evaluates one ego turn; kept "straight" and dropped right, left, uturn |
| c11g-hidden-child | anchor.features.parking-edge.orientation | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-hidden-child | anchor.features.parking-edge.capacity | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-hidden-child | anchor.features.parking-edge.occupancy | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-hidden-child | anchor.features.parking-edge.lengthM | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-wrong-way-aisle | anchor.features.parking-row.orientation | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-wrong-way-aisle | anchor.features.parking-row.capacity | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-wrong-way-aisle | anchor.features.parking-row.occupancy | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-wrong-way-aisle | anchor.features.parking-row.lengthM | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-indicator-mislead | anchor.features.crossing-junction.egoTurn | the matcher evaluates one ego turn; kept "straight" and dropped left, right |
| c11g-indicator-mislead | anchor.features.alternate-parking-aisle.orientation | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-indicator-mislead | anchor.features.alternate-parking-aisle.capacity | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-indicator-mislead | anchor.features.alternate-parking-aisle.occupancy | the matcher has no parking-zone predicates; clause not evaluated |
| c11g-indicator-mislead | anchor.features.alternate-parking-aisle.lengthM | the matcher has no parking-zone predicates; clause not evaluated |
| blind-crest-queue | anchor.features.blind-rise | feature kind "crest" is not matchable; feature dropped |
| parked-vans-narrow-road | anchor.corridor.forbidsAdjacent | adjacent kind "rail" is not evaluable by the matcher |
| c1g-cut-in-turn | anchor.features.side-street-junction.egoTurn | the matcher evaluates one ego turn; kept "straight" and dropped left, right, uturn |

Eight templates are clean; the seven above lose their location semantics before a single site is scored.

### 1d. What the *segment*-anchored archetypes actually got

Every one of these briefs is about a kerb, parked cars, or a narrow street. `park` = segment
`hasParkingAdjacent`.

| arch | map | site | road | lenM | lanesSame | lanesOpp | spd | laneW | park | sw | shldr | oneway | curv |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| blind-crest-queue | belmont | 15643cd5 | Road 124 | 37.89 | 1 | 1 | 64 | 3.3 | False | False | False | False | 0.15 |
| blind-crest-queue | elcamino | 224e2890 | El Camino Real | 43.75 | 1 | 1 | 64 | 3.77 | False | False | False | False | 0.0 |
| blind-crest-queue | elcamino | 2b56b26e | Page Mill Road | 40.21 | 1 | 1 | 64 | 3.72 | False | False | False | False | 0.0 |
| blind-crest-queue | richmond | 9a58b028 | Jay Way | 496.44 | 1 | 0 | 64 | 3.5 | False | True | True | False | 0.54 |
| blind-crest-queue | richmond | dc03d3e5 | Jay Way | 28.42 | 1 | 0 | 40 | 7.22 | False | False | False | True | 0.0 |
| c11g-hidden-child | belmont | 0805d68e | Clipper Drive | 7.38 | 1 | 0 | 64 | 3.33 | False | True | True | True | 0.0 |
| c11g-hidden-child | elcamino | 02efae6c | El Camino Real | 114.95 | 3 | 0 | 64 | 3.12 | False | True | True | True | 5.97 |
| c11g-hidden-child | elcamino | 1e3febda | Page Mill Road | 64.49 | 3 | 0 | 64 | 3.57 | False | True | True | True | 1.75 |
| c11g-hidden-child | elcamino | 3b4f399b | Oregon Expressway | 34.02 | 2 | 0 | 64 | 3.47 | False | True | True | True | 0.66 |
| c11g-hidden-child | richmond | 7f7624a1 | John T. Knox Freeway | 108.3 | 1 | 1 | 64 | 2.46 | False | False | True | False | 4.17 |
| c11g-wrong-way-aisle | belmont | 0cd5159b | Road 109 | 77.77 | 1 | 1 | 64 | 3.3 | False | False | False | False | 1.49 |
| c11g-wrong-way-aisle | richmond | c1f9657e | John T. Knox Freeway | 44.38 | 1 | 1 | 56 | 3.5 | False | False | True | False | 0.0 |
| c11g-wrong-way-aisle | yale | 114d9483 | West El Camino Real | 28.35 | 1 | 0 | 64 | 2.1 | False | False | False | True | 2.54 |
| c9g-pedestrian-behind-bus | belmont | a712ec13 | Clipper Drive | 40.79 | 1 | 0 | 64 | 3.27 | False | True | True | False | 0.67 |
| c9g-pedestrian-behind-bus | belmont | b2dede36 | Clipper Drive | 7.38 | 1 | 0 | 64 | 3.33 | False | True | True | True | 0.0 |
| c9g-pedestrian-behind-bus | elcamino | 2b7458b3 | El Camino Real | 136.83 | 5 | 0 | 64 | 2.83 | False | True | True | True | 1.02 |
| c9g-pedestrian-behind-bus | elcamino | 649bcc09 | El Camino Real | 127.26 | 5 | 0 | 64 | 2.77 | False | True | True | True | 0.84 |
| c9g-pedestrian-behind-bus | elcamino | 8adc0601 | Oregon Expressway | 74.64 | 3 | 0 | 64 | 3.16 | False | True | True | True | 2.23 |
| c9g-pedestrian-behind-bus | richmond | 7f2c4591 | Jay Way | 12.99 | 1 | 0 | 40 | 3.35 | False | False | False | True | 1.02 |
| c9g-pedestrian-behind-bus | yale | e562ab4d | College Avenue | 329.34 | 1 | 1 | 64 | 4.99 | True | True | True | False | 7.4 |
| child-from-parked-cars | belmont | 024a2352 | Road 93 | 28.21 | 1 | 1 | 64 | 3.3 | False | False | False | False | 0.3 |
| child-from-parked-cars | belmont | 3bc3eb1d | Clipper Drive | 40.79 | 1 | 0 | 64 | 3.27 | False | True | True | False | 0.67 |
| child-from-parked-cars | belmont | b2f9c77b | Clipper Drive | 7.38 | 1 | 0 | 64 | 3.33 | False | True | True | True | 0.0 |
| child-from-parked-cars | elcamino | 23e2ee1b | Oregon Expressway | 74.64 | 3 | 0 | 64 | 3.16 | False | True | True | True | 2.23 |
| child-from-parked-cars | richmond | f1e8e363 | Jay Way | 496.44 | 1 | 0 | 64 | 3.5 | False | True | True | False | 0.54 |
| parked-vans-narrow-road | belmont | 03da3206 | Concourse Drive | 1.14 | 1 | 1 | 64 | 3.41 | False | False | False | False | 0.89 |
| parked-vans-narrow-road | belmont | 0623b54e | Road 26 | 199.98 | 1 | 1 | 64 | 3.3 | False | False | False | False | 0.06 |
| parked-vans-narrow-road | belmont | 166bd198 | Island Parkway | 96.81 | 1 | 1 | 64 | 3.12 | False | False | False | False | 0.74 |
| parked-vans-narrow-road | richmond | a4df4515 | Jay Way | 17.98 | 1 | 1 | 64 | 3.5 | False | False | False | False | 0.0 |
| parked-vans-narrow-road | yale | 7c5af008 | El Camino Real | 154.56 | 3 | 0 | 64 | 2.86 | False | True | True | True | 0.16 |
| parked-vans-narrow-road | yale | b6f7e72f | West El Camino Real | 91.54 | 3 | 0 | 64 | 3.12 | False | True | True | True | 8.35 |
| parked-vans-narrow-road | yale | d4dcd337 | West El Camino Real | 583.45 | 3 | 0 | 105 | 3.19 | False | True | True | True | 3.78 |
| rideshare-door-pedestrian | elcamino | 12c3c7ba | Page Mill Road | 41.24 | 1 | 1 | 64 | 2.53 | False | False | False | False | 1.3 |

`park` is `True` in **1 of 34** rows. `parked-vans-narrow-road/belmont/03da3206` is a **1.14 m long** segment;
`parked-vans-narrow-road/yale/d4dcd337` is a 3-lane one-way arterial posted **105 kph**;
`c11g-wrong-way-aisle/richmond/c1f9657e` and `c11g-hidden-child/richmond/7f7624a1` are on
**John T. Knox Freeway**.

### 1e. Proximity of every delivered site to the POI its brief needs (metres, blank = none on that map)

| arch | map | site | verdict | score | kind | ctrl | arms | school | bus_stop | parking_lane | parking_area | crosswalk | occlusion_zone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| blind-crest-queue | belmont | 15643cd5 | degr | 0.89 | segm | - |  |  | 153.8 | 4.8 | 164.4 | 63.9 | 4.8 |
| blind-crest-queue | elcamino | 224e2890 | degr | 0.89 | segm | - |  | 95.6 | 57.4 | 55.4 | 37.5 | 26.4 | 4.9 |
| blind-crest-queue | elcamino | 2b56b26e | degr | 0.89 | segm | - |  | 142.7 | 91.4 | 118.5 | 74.7 | 42.0 | 6.7 |
| blind-crest-queue | richmond | 9a58b028 | degr | 0.89 | segm | - |  |  | 223.6 | 15.8 |  | 138.9 | 15.8 |
| blind-crest-queue | richmond | dc03d3e5 | degr | 0.89 | segm | - |  |  | 213.4 | 0.3 |  | 121.5 | 0.3 |
| c11g-hidden-child | belmont | 0805d68e | degr | 0.92 | segm | - |  |  | 33.9 | 22.9 | 60.0 | 13.0 | 15.5 |
| c11g-hidden-child | elcamino | 02efae6c | degr | 0.92 | segm | - |  | 85.3 | 218.2 | 52.9 | 68.3 | 254.4 | 73.5 |
| c11g-hidden-child | elcamino | 1e3febda | degr | 0.92 | segm | - |  | 196.1 | 58.8 | 137.8 | 113.1 | 27.2 | 23.7 |
| c11g-hidden-child | elcamino | 3b4f399b | degr | 0.92 | segm | - |  | 261.6 | 134.7 | 100.5 | 208.0 | 178.2 | 101.9 |
| c11g-hidden-child | richmond | 7f7624a1 | degr | 0.87 | segm | - |  |  | 77.6 | 63.7 |  | 58.8 | 63.7 |
| c11g-indicator-mislead | belmont | 0a4caf4b | degr | 0.96 | junc | uncontrolled | 4.0 |  | 77.6 | 27.0 | 42.5 | 89.2 | 10.6 |
| c11g-indicator-mislead | belmont | 75946896 | degr | 0.96 | junc | uncontrolled | 4.0 |  | 77.6 | 27.0 | 42.5 | 89.2 | 10.6 |
| c11g-indicator-mislead | elcamino | 15475e7d | exac | 1.0 | junc | uncontrolled | 3.0 | 80.6 | 83.6 | 40.3 | 5.9 | 27.2 | 12.0 |
| c11g-indicator-mislead | elcamino | 1d21e199 | degr | 0.97 | junc | uncontrolled | 3.0 | 101.3 | 136.7 | 83.3 | 76.5 | 10.6 | 24.1 |
| c11g-indicator-mislead | elcamino | 6dca8fae | degr | 0.96 | junc | uncontrolled | 3.0 | 165.5 | 74.3 | 122.8 | 90.7 | 50.4 | 7.5 |
| c11g-indicator-mislead | elcamino | 6e6c9d9d | degr | 0.96 | junc | uncontrolled | 3.0 | 145.4 | 107.3 | 82.3 | 94.8 | 37.4 | 7.5 |
| c11g-indicator-mislead | elcamino | 8c56600f | degr | 0.96 | junc | uncontrolled | 3.0 | 87.9 | 115.0 | 48.2 | 36.9 | 41.1 | 8.3 |
| c11g-wrong-way-aisle | belmont | 0cd5159b | degr | 0.9 | segm | - |  |  | 88.0 | 33.3 | 51.9 | 97.0 | 13.4 |
| c11g-wrong-way-aisle | richmond | c1f9657e | degr | 0.9 | segm | - |  |  | 106.2 | 38.9 |  | 84.7 | 84.8 |
| c11g-wrong-way-aisle | yale | 114d9483 | degr | 0.9 | segm | - |  | 109.6 | 107.7 | 5.2 | 137.5 | 34.5 | 5.2 |
| c12g-red-pedestrian-phase | belmont | b76138f6 | degr | 0.76 | junc | uncontrolled | 4.0 |  | 77.6 | 27.0 | 42.5 | 89.2 | 10.6 |
| c12g-red-pedestrian-phase | easterbrook | 47a86229 | degr | 0.65 | junc | minor_stop | 3.0 | 60.0 |  | 183.2 | 131.2 | 2.0 | 133.8 |
| c12g-red-pedestrian-phase | easterbrook | ec1cf0d8 | degr | 0.65 | junc | minor_stop | 4.0 | 79.3 |  | 202.1 | 137.2 | 17.7 | 138.8 |
| c12g-red-pedestrian-phase | richmond | 51cef2c7 | degr | 0.74 | junc | signalized | 4.0 |  | 449.8 | 142.2 |  | 5.6 | 142.2 |
| c12g-red-pedestrian-phase | yale | 0d2f5408 | degr | 0.82 | junc | minor_stop | 4.0 | 74.0 | 113.0 | 21.9 | 181.5 | 10.9 | 21.9 |
| c12g-red-pedestrian-phase | yale | 4a6eb693 | degr | 0.74 | junc | minor_stop | 4.0 | 74.0 | 113.0 | 21.9 | 181.5 | 10.9 | 21.9 |
| c12g-red-pedestrian-phase | yale | b6ae5117 | degr | 0.73 | junc | signalized | 4.0 | 44.9 | 90.7 | 35.9 | 140.2 | 12.3 | 35.9 |
| c12g-suv-ignores-paddle | elcamino | 61a8619d | degr | 0.93 | junc | uncontrolled | 3.0 | 101.3 | 136.7 | 83.3 | 76.5 | 10.6 | 24.1 |
| c15g-red-light-runner | belmont | 0580a017 | exac | 1.0 | junc | uncontrolled | 3.0 |  | 128.7 | 82.9 | 48.1 | 63.7 | 33.8 |
| c15g-red-light-runner | belmont | 0b55e139 | exac | 1.0 | junc | uncontrolled | 4.0 |  | 72.8 | 38.4 | 95.3 | 55.3 | 18.8 |
| c15g-red-light-runner | belmont | 2423a115 | exac | 1.0 | junc | minor_stop | 3.0 |  | 112.7 | 78.8 | 83.4 | 5.2 | 77.0 |
| c15g-red-light-runner | belmont | 44ca495e | exac | 1.0 | junc | minor_stop | 3.0 |  | 157.1 | 23.3 | 177.5 | 17.2 | 23.3 |
| c15g-red-light-runner | belmont | 53ed87a5 | exac | 1.0 | junc | uncontrolled | 3.0 |  | 133.8 | 56.8 | 99.8 | 57.2 | 9.3 |
| c15g-red-light-runner | elcamino | 4d1e283d | exac | 1.0 | junc | uncontrolled | 4.0 | 50.1 | 144.0 | 70.8 | 31.1 | 184.7 | 17.6 |
| c15g-red-light-runner | richmond | 3ca9b608 | exac | 1.0 | junc | uncontrolled | 3.0 |  | 239.9 | 18.0 |  | 132.1 | 18.0 |
| c15g-red-light-runner | richmond | 70c945af | exac | 1.0 | junc | minor_stop | 4.0 |  | 356.3 | 13.2 |  | 159.0 | 13.2 |
| c1g-cut-in-turn | elcamino | 81ade795 | exac | 1.0 | junc | uncontrolled | 3.0 | 62.2 | 110.1 | 90.2 | 5.1 | 152.6 | 5.0 |
| c1g-cut-in-turn | yale | 90fd1b20 | degr | 0.98 | junc | signalized | 4.0 | 116.0 | 69.1 | 31.5 | 100.6 | 17.7 | 18.6 |
| c1g-illegal-u-turn | belmont | 1851803c | exac | 1.0 | junc | uncontrolled | 3.0 |  | 87.4 | 48.6 | 120.7 | 74.7 | 9.0 |
| c1g-illegal-u-turn | richmond | 520c8256 | exac | 1.0 | junc | uncontrolled | 3.0 |  | 212.2 | 10.6 |  | 147.8 | 10.6 |
| c4g-circulating-sudden-stop | belmont | 021189aa | exac | 1.0 | junc | uncontrolled | 3.0 |  | 90.9 | 62.5 | 120.7 | 53.4 | 9.6 |
| c4g-circulating-sudden-stop | easterbrook | 6197fcd9 | exac | 1.0 | junc | minor_stop | 3.0 | 60.0 |  | 183.2 | 131.2 | 2.0 | 133.8 |
| c4g-circulating-sudden-stop | elcamino | 07d43b5d | exac | 1.0 | junc | uncontrolled | 3.0 | 137.0 | 60.3 | 11.7 | 51.6 | 78.6 | 11.1 |
| c4g-circulating-sudden-stop | richmond | 5a809292 | exac | 1.0 | junc | uncontrolled | 3.0 |  | 315.3 | 55.9 |  | 161.8 | 55.9 |
| c4g-circulating-sudden-stop | yale | 01b1c215 | exac | 1.0 | junc | uncontrolled | 2.0 | 101.5 | 57.8 | 67.2 | 151.4 | 27.8 | 49.3 |
| c4g-circulating-sudden-stop | yale | 13d91f73 | exac | 1.0 | junc | signalized | 4.0 | 70.2 | 96.1 | 10.6 | 153.7 | 35.8 | 10.6 |
| c9g-pedestrian-behind-bus | belmont | a712ec13 | degr | 0.8 | segm | - |  |  | 128.1 | 22.3 | 149.6 | 39.2 | 22.3 |
| c9g-pedestrian-behind-bus | belmont | b2dede36 | degr | 0.8 | segm | - |  |  | 33.9 | 22.9 | 60.0 | 13.0 | 15.5 |
| c9g-pedestrian-behind-bus | elcamino | 2b7458b3 | degr | 0.91 | segm | - |  | 91.9 | 47.5 | 117.4 | 57.0 | 81.3 | 62.4 |
| c9g-pedestrian-behind-bus | elcamino | 649bcc09 | degr | 0.91 | segm | - |  | 137.3 | 65.1 | 57.2 | 103.6 | 23.5 | 32.8 |
| c9g-pedestrian-behind-bus | elcamino | 8adc0601 | degr | 0.91 | segm | - |  | 239.6 | 103.3 | 69.9 | 189.4 | 146.6 | 71.9 |
| c9g-pedestrian-behind-bus | richmond | 7f2c4591 | degr | 0.81 | segm | - |  |  | 193.5 | 5.6 |  | 101.0 | 15.3 |
| c9g-pedestrian-behind-bus | yale | e562ab4d | degr | 0.79 | segm | - |  | 47.7 | 102.2 | 59.8 | 116.7 | 38.1 | 16.8 |
| child-from-parked-cars | belmont | 024a2352 | degr | 0.88 | segm | - |  |  | 148.9 | 5.1 | 130.1 | 61.2 | 5.1 |
| child-from-parked-cars | belmont | 3bc3eb1d | degr | 0.9 | segm | - |  |  | 128.1 | 22.3 | 149.6 | 39.2 | 22.3 |
| child-from-parked-cars | belmont | b2f9c77b | degr | 0.9 | segm | - |  |  | 33.9 | 22.9 | 60.0 | 13.0 | 15.5 |
| child-from-parked-cars | elcamino | 23e2ee1b | degr | 0.9 | segm | - |  | 239.6 | 103.3 | 69.9 | 189.4 | 146.6 | 71.9 |
| child-from-parked-cars | richmond | f1e8e363 | degr | 0.88 | segm | - |  |  | 223.6 | 15.8 |  | 138.9 | 15.8 |
| low-friction-stop-slide | belmont | 336833c8 | exac | 1.0 | junc | uncontrolled | 4.0 |  | 35.4 | 59.0 | 59.2 | 92.6 | 11.7 |
| low-friction-stop-slide | elcamino | 0cc6a254 | exac | 1.0 | junc | uncontrolled | 3.0 | 106.3 | 59.2 | 54.5 | 68.8 | 46.7 | 6.1 |
| low-friction-stop-slide | elcamino | 52c74552 | exac | 1.0 | junc | uncontrolled | 3.0 | 99.2 | 70.1 | 24.1 | 14.2 | 39.8 | 6.6 |
| low-friction-stop-slide | richmond | 40964dd2 | degr | 0.98 | junc | uncontrolled | 3.0 |  | 354.5 | 127.8 |  | 8.3 | 127.8 |
| low-friction-stop-slide | richmond | 9cd6f749 | degr | 0.92 | junc | uncontrolled | 4.0 |  | 283.8 | 22.3 |  | 117.1 | 22.3 |
| low-friction-stop-slide | yale | ab81683b | exac | 1.0 | junc | minor_stop | 3.0 | 87.2 | 72.0 | 49.4 | 152.8 | 7.3 | 72.0 |
| parked-vans-narrow-road | belmont | 03da3206 | degr | 0.86 | segm | - |  |  |  |  |  |  |  |
| parked-vans-narrow-road | belmont | 0623b54e | degr | 0.86 | segm | - |  |  | 85.4 | 33.9 | 94.6 | 108.4 | 22.1 |
| parked-vans-narrow-road | belmont | 166bd198 | degr | 0.86 | segm | - |  |  | 37.9 | 67.9 | 71.3 | 92.9 | 9.1 |
| parked-vans-narrow-road | richmond | a4df4515 | degr | 0.86 | segm | - |  |  | 180.1 | 5.6 |  | 62.2 | 5.6 |
| parked-vans-narrow-road | yale | 7c5af008 | degr | 0.88 | segm | - |  | 124.0 | 63.7 | 56.4 | 73.7 | 16.5 | 22.6 |
| parked-vans-narrow-road | yale | b6f7e72f | degr | 0.88 | segm | - |  | 101.1 | 108.2 | 39.8 | 111.6 | 42.5 | 39.8 |
| parked-vans-narrow-road | yale | d4dcd337 | degr | 0.9 | segm | - |  | 117.5 | 73.6 | 61.4 | 144.8 | 42.1 | 61.4 |
| rideshare-door-pedestrian | elcamino | 12c3c7ba | degr | 0.92 | segm | - |  | 157.5 | 76.4 | 140.9 | 57.5 | 63.7 | 4.5 |

### 1f. What each archetype's occlusion/point features actually bound

| archetype | bound feature kinds (delivered sites) |
|---|---|
| c11g-hidden-child | PARKING_NEAR_CONFLICT_POINT x4, parking_space x4 |
| c11g-wrong-way-aisle | parking_lane x10, parking_space x5 |
| parked-vans-narrow-road | PARKING_NEAR_CONFLICT_POINT x28 |
| c11g-indicator-mislead | parking_space x28 |
| c12g-red-pedestrian-phase | crosswalk x18, PARKING_NEAR_CONFLICT_POINT x12 |
| child-from-parked-cars | PARKING_NEAR_CONFLICT_POINT x8 |
| blind-crest-queue | PARKING_NEAR_CONFLICT_POINT x20 |
| c9g-pedestrian-behind-bus | crosswalk x16, PARKING_NEAR_CONFLICT_POINT x8 |
| rideshare-door-pedestrian | PARKING_NEAR_CONFLICT_POINT x3 |
| c12g-suv-ignores-paddle | PARKING_NEAR_CONFLICT_POINT x4 |

`c9g-pedestrian-behind-bus` never binds a bus stop. `blind-crest-queue` binds a parked-car occluder as its
"terrain occlusion".

---

## 2. The fact vocabulary map-intel actually publishes

Source: `dev-assets/<map>/derived/topology-derived.json.gz` → `factIndex`, and
`derived/locations.json.gz` → `locations[].{type, tags, affordances, facts}`.
This is exactly what a better anchor *can* ask for.

### 2a. Location types (counts per map)

| value | yale | belmont | elcamino | easterbrook | richmond | ALL |
|---|---|---|---|---|---|---|
| address | 326 | 140 | 180 | 106 | 1 | 753 |
| building_entrance | 326 | 140 | 180 | 106 | 1 | 753 |
| bus_stop | 6 | 2 | 5 | 0 | 1 | 14 |
| crosswalk | 12 | 10 | 5 | 13 | 5 | 45 |
| driving_corridor | 136 | 146 | 132 | 51 | 65 | 530 |
| junction | 56 | 74 | 68 | 17 | 31 | 246 |
| junction_movement | 537 | 548 | 480 | 279 | 175 | 2019 |
| midblock_segment | 123 | 110 | 141 | 29 | 93 | 496 |
| occlusion_zone | 61 | 87 | 96 | 7 | 24 | 275 |
| parking_area | 7 | 3 | 9 | 2 | 0 | 21 |
| parking_lane | 70 | 30 | 21 | 2 | 32 | 155 |
| parking_space | 639 | 859 | 1387 | 98 | 254 | 3237 |
| poi_frontage | 21 | 1 | 8 | 1 | 0 | 31 |
| school_zone | 0 | 0 | 0 | 2 | 0 | 2 |
| sidewalk | 5 | 3 | 9 | 11 | 0 | 28 |
| work_zone_suitable | 0 | 0 | 2 | 0 | 0 | 2 |

### 2b. Subtypes

| value | yale | belmont | elcamino | easterbrook | richmond | ALL |
|---|---|---|---|---|---|---|
| angled | 557 | 852 | 1384 | 98 | 238 | 3129 |
| gas_station | 2 | 0 | 0 | 0 | 0 | 2 |
| hospital | 4 | 0 | 1 | 0 | 0 | 5 |
| hotel | 2 | 1 | 0 | 0 | 0 | 3 |
| left | 85 | 131 | 96 | 38 | 37 | 387 |
| parallel | 82 | 7 | 3 | 0 | 16 | 108 |
| restaurant | 7 | 0 | 4 | 0 | 0 | 11 |
| retail | 0 | 0 | 1 | 0 | 0 | 1 |
| right | 202 | 182 | 151 | 107 | 56 | 698 |
| road_segment_feature | 28 | 20 | 18 | 10 | 8 | 84 |
| school | 6 | 0 | 2 | 1 | 0 | 9 |
| straight | 239 | 192 | 225 | 130 | 81 | 867 |
| uturnleft | 6 | 19 | 5 | 3 | 0 | 33 |
| uturnright | 5 | 24 | 3 | 1 | 1 | 34 |

### 2c. Affordances

| value | yale | belmont | elcamino | easterbrook | richmond | ALL |
|---|---|---|---|---|---|---|
| conflictPoint | 378 | 459 | 378 | 218 | 164 | 1597 |
| crossing | 12 | 10 | 5 | 13 | 5 | 45 |
| cyclistSpawn | 104 | 71 | 59 | 18 | 0 | 252 |
| occluder | 61 | 87 | 96 | 7 | 24 | 275 |
| parkedVehicle | 716 | 892 | 1417 | 102 | 286 | 3413 |
| pedestrianSpawn | 678 | 354 | 472 | 209 | 80 | 1793 |
| propPlacement | 893 | 1086 | 1647 | 136 | 403 | 4165 |
| route | 876 | 881 | 836 | 398 | 364 | 3355 |
| stopPoint | 6 | 2 | 5 | 0 | 1 | 14 |
| vehicleSpawn | 1498 | 1738 | 2219 | 478 | 618 | 6551 |

### 2d. Tags

| value | yale | belmont | elcamino | easterbrook | richmond | ALL |
|---|---|---|---|---|---|---|
| ARMS_0 | 0 | 1 | 0 | 0 | 0 | 1 |
| ARMS_1 | 1 | 6 | 0 | 0 | 0 | 7 |
| ARMS_2 | 13 | 19 | 24 | 5 | 9 | 70 |
| ARMS_3 | 32 | 40 | 40 | 5 | 16 | 133 |
| ARMS_4 | 10 | 8 | 4 | 7 | 6 | 35 |
| BIKE_INTERSECTION_MIXING_ZONE | 10 | 3 | 8 | 0 | 0 | 21 |
| BIKE_LANE_SHARED_ROADWAY | 2 | 10 | 1 | 4 | 0 | 17 |
| BIKE_LANE_STANDARD | 13 | 15 | 9 | 4 | 0 | 41 |
| BLOCKED_LANE | 3 | 0 | 0 | 0 | 0 | 3 |
| BUILDING_ENTRANCE | 326 | 140 | 180 | 106 | 1 | 753 |
| CONTROL_ALL_WAY_STOP | 2 | 1 | 0 | 0 | 0 | 3 |
| CONTROL_MINOR_STOP | 10 | 14 | 0 | 15 | 2 | 41 |
| CONTROL_SIGNALIZED | 16 | 0 | 6 | 0 | 1 | 23 |
| CONTROL_UNCONTROLLED | 28 | 59 | 62 | 2 | 28 | 179 |
| CROSSWALK | 2 | 3 | 4 | 5 | 0 | 14 |
| CROSSWALK_MARKED_SIGNALIZED | 5 | 0 | 0 | 0 | 1 | 6 |
| CROSSWALK_MARKED_UNSIGNALIZED | 5 | 7 | 1 | 8 | 4 | 25 |
| GAS_STATION_APPROACH | 2 | 0 | 0 | 0 | 0 | 2 |
| HIGH_SPEED_ARTERIAL_SEGMENT | 1 | 0 | 1 | 0 | 5 | 7 |
| HOSPITAL_APPROACH | 4 | 0 | 1 | 0 | 0 | 5 |
| HOTEL_APPROACH | 2 | 1 | 0 | 0 | 0 | 3 |
| JUNCTION_MOVEMENT | 537 | 548 | 480 | 279 | 175 | 2019 |
| LEFT_TURN_CONFLICT | 31 | 48 | 33 | 10 | 13 | 135 |
| MIDBLOCK | 123 | 110 | 142 | 32 | 93 | 500 |
| MIDBLOCK_WITH_PARKING | 13 | 0 | 0 | 0 | 5 | 18 |
| MULTILANE | 45 | 16 | 62 | 10 | 6 | 139 |
| NARROW_RESIDENTIAL_STREET_WITH_PARKING | 70 | 30 | 21 | 2 | 32 | 155 |
| OCCLUSION | 61 | 87 | 96 | 7 | 24 | 275 |
| OCCLUSION_BUS | 2 | 1 | 1 | 0 | 1 | 5 |
| OCCLUSION_DELIVERY_TRUCK | 3 | 0 | 0 | 0 | 0 | 3 |
| OCCLUSION_PARKING_VRU | 56 | 86 | 95 | 7 | 23 | 267 |
| ONE_WAY | 47 | 18 | 60 | 10 | 11 | 146 |
| OVERTURE | 2 | 3 | 4 | 5 | 0 | 14 |
| PARKING_ANGLED | 557 | 852 | 1384 | 98 | 238 | 3129 |
| PARKING_LOT_APPROACH | 7 | 3 | 9 | 2 | 0 | 21 |
| PARKING_PARALLEL | 82 | 7 | 3 | 0 | 16 | 108 |
| PARKING_SPACE | 639 | 859 | 1387 | 98 | 254 | 3237 |
| PEDESTRIAN_AT_BUS_STOP | 2 | 1 | 1 | 0 | 1 | 5 |
| PEDESTRIAN_DARTOUT | 56 | 86 | 95 | 7 | 23 | 267 |
| PEDESTRIAN_ORIGIN | 326 | 140 | 180 | 106 | 1 | 753 |
| RESTAURANT_FRONTAGE | 7 | 0 | 4 | 0 | 0 | 11 |
| RETAIL_FRONTAGE | 0 | 0 | 1 | 0 | 0 | 1 |
| SCHOOL_ZONE | 0 | 0 | 0 | 2 | 0 | 2 |
| SCHOOL_ZONE_BOUNDARY | 6 | 0 | 2 | 1 | 0 | 9 |
| SHOULDER_PRESENT | 0 | 0 | 2 | 0 | 0 | 2 |
| SIDEWALK_PEDESTRIAN_NETWORK | 33 | 17 | 27 | 21 | 3 | 101 |
| STRAIGHT | 113 | 88 | 134 | 25 | 66 | 426 |
| TRANSIT_BUS_STOP | 6 | 2 | 5 | 0 | 1 | 14 |
| TURN_LEFT | 85 | 131 | 96 | 38 | 37 | 387 |
| TURN_RIGHT | 202 | 182 | 151 | 107 | 56 | 698 |
| TURN_STRAIGHT | 239 | 192 | 225 | 130 | 81 | 867 |
| TURN_UTURNLEFT | 6 | 19 | 5 | 3 | 0 | 33 |
| TURN_UTURNRIGHT | 5 | 24 | 3 | 1 | 1 | 34 |
| UNPROTECTED_LEFT | 60 | 131 | 85 | 38 | 33 | 347 |
| UNPROTECTED_MOVEMENT | 322 | 385 | 310 | 201 | 133 | 1351 |
| VRU_SENSITIVE | 0 | 0 | 0 | 2 | 0 | 2 |
| WORK_ZONE_SUITABLE | 0 | 0 | 2 | 0 | 0 | 2 |
| sideswipe_prone | 70 | 30 | 21 | 2 | 32 | 155 |
| unsafe_cut_in_prone | 28 | 20 | 18 | 10 | 8 | 84 |

### 2e. Fact keys (indexed facts; `values` shows the value domain where small)

| fact | yale | belmont | elcamino | easterbrook | richmond | ALL | values |
|---|---|---|---|---|---|---|---|
| address_formatted | 0 | 0 | 0 | 0 | 1 | 1 | 1301 S 46th St, Richmond, 94804 |
| address_number | 0 | 0 | 180 | 0 | 1 | 181 | 59 distinct |
| approach_count | 56 | 74 | 68 | 17 | 31 | 246 | 1, 2, 3, 4, 5, 6, 7, 8 |
| approach_lane_count | 56 | 74 | 68 | 17 | 31 | 246 | 23 distinct |
| arm_count | 593 | 622 | 548 | 296 | 206 | 2265 | 0, 1, 2, 3, 4 |
| bike_lane_adjacent | 26 | 18 | 14 | 5 | 0 | 63 | true |
| bike_lane_present | 49 | 42 | 25 | 10 | 0 | 126 | true |
| building_id | 0 | 0 | 332 | 0 | 0 | 332 | 46 distinct |
| bus_stop_nearby | 2 | 1 | 1 | 0 | 1 | 5 | true |
| commercial_nearby | 3 | 0 | 0 | 0 | 0 | 3 | true |
| complexity_class | 56 | 74 | 68 | 17 | 31 | 246 | complex, simple, standard |
| confidence | 61 | 87 | 96 | 7 | 24 | 275 | 36 distinct |
| conflict_pair_count | 56 | 74 | 68 | 17 | 31 | 246 | 36 distinct |
| conflicting_movement_count | 537 | 548 | 480 | 279 | 175 | 2019 | 20 distinct |
| connected_road_names | 132 | 86 | 152 | 20 | 55 | 445 | 123 distinct |
| control_type | 56 | 74 | 68 | 17 | 31 | 246 | stop, traffic_light, uncontrolled |
| crest_present | 3 | 2 | 3 | 5 | 0 | 13 | true |
| crosswalk_nearby | 10 | 6 | 0 | 0 | 4 | 20 | true |
| curvature_class | 108 | 126 | 114 | 41 | 57 | 446 | curved, straight |
| curvature_deg_per_10m | 123 | 110 | 143 | 29 | 93 | 498 | 128 distinct |
| cyclist_spawn | 63 | 45 | 31 | 11 | 0 | 150 | true |
| derived_control | 56 | 74 | 68 | 17 | 31 | 246 | all_way_stop, minor_stop, signalized, uncontrolled |
| distance_to_crosswalk_m | 61 | 87 | 0 | 7 | 24 | 179 | 101 distinct |
| distance_to_intersection_m | 61 | 87 | 96 | 7 | 24 | 275 | 27 distinct |
| distance_to_junction_m | 0 | 0 | 0 | 29 | 0 | 29 | 21 distinct |
| driving_lane_count | 28 | 20 | 18 | 10 | 8 | 84 | 9 distinct |
| entry_heading_deg | 0 | 0 | 0 | 98 | 254 | 352 | 90 distinct |
| exit_count | 537 | 548 | 480 | 279 | 175 | 2019 | 0, 1 |
| exit_road_name | 534 | 541 | 475 | 277 | 175 | 2002 | 108 distinct |
| feature_count | 32 | 6 | 22 | 12 | 1 | 73 | 1 |
| formatted | 0 | 0 | 0 | 0 | 1 | 1 | 1301 S 46th St, Richmond, 94804 |
| grade_class | 120 | 131 | 115 | 46 | 54 | 466 | flat, moderate, steep |
| grade_pct | 28 | 20 | 20 | 10 | 8 | 86 | 22 distinct |
| has_bike_adjacent | 123 | 110 | 143 | 29 | 93 | 498 | false, true |
| has_bike_lane | 28 | 20 | 18 | 10 | 8 | 84 | false, true |
| has_opposing_conflict | 56 | 74 | 68 | 17 | 31 | 246 | false, true |
| has_parking_adjacent | 123 | 110 | 143 | 29 | 93 | 498 | false, true |
| has_parking_lane | 28 | 20 | 18 | 10 | 8 | 84 | false, true |
| has_shoulder_adjacent | 123 | 110 | 143 | 29 | 93 | 498 | false, true |
| has_sidewalk | 28 | 20 | 18 | 10 | 8 | 84 | false, true |
| has_sidewalk_adjacent | 123 | 110 | 143 | 29 | 93 | 498 | false, true |
| has_signal | 56 | 74 | 68 | 17 | 31 | 246 | false, true |
| has_stop_sign | 56 | 74 | 68 | 17 | 31 | 246 | false, true |
| heading_change_deg | 0 | 0 | 0 | 279 | 175 | 454 | 93 distinct |
| internal_lane_count | 56 | 74 | 68 | 17 | 31 | 246 | 29 distinct |
| intersection_nearby | 60 | 87 | 96 | 7 | 23 | 273 | true |
| is_all_way_stop | 56 | 74 | 68 | 17 | 31 | 246 | false |
| is_junction_internal | 28 | 20 | 18 | 10 | 8 | 84 | false |
| is_marked | 10 | 7 | 1 | 8 | 5 | 31 | true |
| is_midblock | 10 | 7 | 1 | 8 | 5 | 31 | false, true |
| is_near_junction | 10 | 7 | 1 | 8 | 5 | 31 | false, true |
| is_one_way | 123 | 110 | 143 | 29 | 93 | 498 | false, true |
| is_parallel_parking | 639 | 859 | 1387 | 98 | 254 | 3237 | false, true |
| is_protected | 537 | 548 | 480 | 279 | 175 | 2019 | false, true |
| is_signalized | 10 | 7 | 1 | 8 | 5 | 31 | false, true |
| junction_control | 537 | 548 | 480 | 279 | 175 | 2019 | all_way_stop, minor_stop, signalized, uncontrolled |
| junction_size_m | 56 | 0 | 0 | 17 | 31 | 104 | 103 distinct |
| lane_count | 119 | 127 | 114 | 41 | 58 | 459 | 10 distinct |
| lane_count_class | 27 | 15 | 34 | 3 | 14 | 93 | multi-lane, single-lane |
| lane_count_per_direction | 28 | 20 | 18 | 10 | 8 | 84 | 0, 1, 2, 3, 4, 5 |
| lane_type | 2302 | 2153 | 2674 | 710 | 682 | 8521 | bidirectional, biking, driving, parking, restricted, shoulder, sidewalk |
| lane_width_m | 0 | 110 | 0 | 29 | 93 | 232 | 126 distinct |
| lanes_opposing | 123 | 110 | 143 | 29 | 93 | 498 | 0, 1, 2 |
| lanes_same_dir | 123 | 110 | 143 | 29 | 93 | 498 | 1, 2, 3, 4, 5 |
| layer_id | 32 | 6 | 22 | 12 | 1 | 73 | bus_stops, gas_stations, hospitals, hotel, restaurant, retail, schools, sidewalks |
| leg_label | 34 | 49 | 39 | 12 | 19 | 153 | 3-leg, 4-way, multi-leg |
| length_m | 135 | 145 | 128 | 50 | 65 | 523 | 95 distinct |
| min_radius_m | 4 | 3 | 4 | 1 | 7 | 19 | 14 distinct |
| nearest_junction_approach_count | 10 | 6 | 1 | 7 | 5 | 29 | 2, 3, 4, 5, 6 |
| number | 0 | 0 | 180 | 0 | 1 | 181 | 59 distinct |
| occlusion_subtype | 61 | 87 | 96 | 7 | 24 | 275 | BUS_STOP_OCCLUSION, COMMERCIAL_DELIVERY_OCCLUSION, PARKING_NEAR_CONFLICT_POINT |
| on_narrow_road | 3 | 0 | 0 | 0 | 0 | 3 | false |
| overture_speed_limit_mph | 95 | 109 | 108 | 10 | 13 | 335 | 15, 20, 25, 30, 35, 65 |
| parking_cluster_id | 56 | 0 | 0 | 7 | 23 | 86 | 62 distinct |
| parking_length_m | 56 | 86 | 95 | 7 | 23 | 267 | 52 distinct |
| parking_lot_egress | 7 | 3 | 9 | 2 | 0 | 21 | true |
| parking_nearby | 56 | 86 | 95 | 7 | 23 | 267 | true |
| parking_present | 17 | 1 | 0 | 0 | 2 | 20 | true |
| pedestrian_spawn | 282 | 191 | 234 | 80 | 73 | 860 | true |
| poi_name | 3 | 0 | 0 | 0 | 0 | 3 | R&B Seafood Restaurant, Restaurant frontage (2 features), Restaurant frontage (6 features) |
| poi_type | 100 | 96 | 127 | 21 | 25 | 369 | 10 distinct |
| postcode | 652 | 280 | 360 | 212 | 2 | 1506 | 94002, 94301, 94304, 94305, 94306, 94404, 94804, 95129 |
| resolved_name | 99 | 86 | 98 | 40 | 54 | 377 | 53 distinct |
| road_access_distance_m | 0 | 0 | 0 | 0 | 2 | 2 | 8, 8.1 |
| road_access_road_name | 326 | 140 | 180 | 106 | 1 | 753 | 50 distinct |
| road_class | 108 | 126 | 114 | 41 | 57 | 446 | motorway, primary, residential, secondary, tertiary, unclassified |
| road_name | 1299 | 1517 | 2010 | 408 | 522 | 5756 | 110 distinct |
| runway_downstream_m | 0 | 0 | 0 | 29 | 0 | 29 | 23 distinct |
| runway_upstream_m | 123 | 110 | 141 | 29 | 93 | 496 | 95 distinct |
| school_sign_codes | 0 | 0 | 0 | 2 | 0 | 2 | ["S1-1","S4-2P","S4-3P"], ["S1-1"] |
| school_sign_count | 0 | 0 | 0 | 2 | 0 | 2 | 13, 2 |
| segment_length_m | 0 | 0 | 0 | 29 | 93 | 122 | 57 distinct |
| severity | 61 | 87 | 96 | 7 | 24 | 275 | high, low, medium |
| sidewalk_present | 89 | 43 | 63 | 38 | 7 | 240 | true |
| size_class | 57 | 77 | 72 | 19 | 31 | 256 | large, medium, small |
| source_count | 77 | 33 | 30 | 4 | 32 | 176 | 27 distinct |
| source_file | 77 | 33 | 30 | 4 | 32 | 176 | geojson, overture |
| space_count | 126 | 119 | 120 | 11 | 55 | 431 | 39 distinct |
| speed_class | 136 | 146 | 132 | 51 | 65 | 530 | high, medium |
| speed_limit_kph | 660 | 658 | 623 | 310 | 268 | 2519 | 105, 40, 56, 64, 89 |
| speed_limit_mph | 28 | 20 | 18 | 10 | 8 | 84 | 25, 35, 40, 55, 65 |
| stall_length_m | 0 | 859 | 1387 | 98 | 254 | 2598 | 125 distinct |
| stall_width_m | 0 | 859 | 1387 | 98 | 254 | 2598 | 110 distinct |
| street | 326 | 140 | 180 | 106 | 1 | 753 | 48 distinct |
| street_name | 326 | 140 | 180 | 106 | 1 | 753 | 50 distinct |
| supported_scenario_templates | 61 | 87 | 96 | 7 | 24 | 275 | ["bus_blocking_crosswalk","pedestrian_emerging_around_bus"], ["child_dartout_from_parked_cars","pedestrian_emerging_between_parked_cars"], ["double_parked_delivery_truck","pedestrian_emerging_around_truck"] |
| turn_relation | 537 | 548 | 480 | 279 | 175 | 2019 | Left, Right, Straight, UTurnLeft, UTurnRight |
| unprotected_left_candidate | 22 | 43 | 38 | 4 | 16 | 123 | true |
| usable_length_m | 0 | 0 | 2 | 0 | 0 | 2 | 25 |
| vehicle_spawn | 164 | 200 | 182 | 58 | 88 | 692 | true |
| width_class | 107 | 121 | 114 | 41 | 57 | 440 | medium, narrow, wide |
| zone_length_m | 0 | 0 | 0 | 2 | 0 | 2 | 270, 90 |

### 2f. Structural limits worth stating up front

* **No roundabouts.** 246 junctions across all 5 maps: 179 uncontrolled, 41 minor_stop, 23 signalized,
  3 all_way_stop. `roundabout` and `yield` are accepted by `JunctionControlSchema` but never occur.
* **Signals are concentrated.** All 23 signalized junctions are yale-street (16), el-camino-road (6),
  richmond-field-station (1). belmont-research-center and easterbrook-discovery-school have **zero**.
* **Grade is not modelled.** `maps list` reports `capabilities.grade = false` on all 5 maps; only 13
  locations carry `crest_present`, and richmond-field-station has none.
* **Parking lots are not drivable.** `parking_area` affordances are `[parkedVehicle, pedestrianSpawn,
  vehicleSpawn]` — no `route`. There is no aisle centreline, so no scenario can be driven *inside* a lot;
  only the lot approach/egress on the public road is reachable.
* **The matcher has no parking-zone predicates.** `orientation`, `capacity`, `occupancy`, `lengthM` on a
  `parking_zone` feature are all dropped.
* **`crest` is not a matchable feature kind.** `FeatureKindSchema` = junction, crossing, merge, lane_drop,
  parking_zone, bus_stop, driveway, school_zone, work_zone_suitable, occlusion_zone.
* **The matcher evaluates exactly one ego turn**; multi-valued `egoTurn` collapses to the first value.
* **`supported_scenario_templates` already exists and is ignored.** 275 occlusion zones carry an explicit
  whitelist of the scenario templates they were built for:
  `child_dartout_from_parked_cars` / `pedestrian_emerging_between_parked_cars` (267),
  `bus_blocking_crosswalk` / `pedestrian_emerging_around_bus` (5),
  `double_parked_delivery_truck` / `pedestrian_emerging_around_truck` (3).
  Nothing in the anchor-matcher or harvest path reads this field.

---

## 3. Proposal — a location-quality signal beyond clause conformance

**Shape.** Keep `score` as-is (clause conformance, a *feasibility* number) and add a second, orthogonal
number, `placeFit` ∈ [0,1], computed from map-intel facts about the chosen site and reported alongside
`verdict`. A site is admissible only if `score >= minScore` **and** `placeFit >= minPlaceFit`. Three
ingredients, all from facts that exist today:

1. **Hard place predicates (veto, weight 1.0).** A per-archetype list of `fact = value` assertions the site
   MUST satisfy — e.g. `derived_control == "signalized"` for a red-light runner. This is what turns the
   brief's own nouns ("signalized", "school", "bus", "parking aisle", "crest") into a checkable claim.
   Mechanically this is what the anchors *should already* have expressed by marking `control` (and the
   parking / bus / school features) `essentiality: "required"` with a single value — the plumbing exists,
   the templates just do not use it.
2. **Named-context proximity (graded, weight 0.6).** Distance from the site anchor to the nearest location
   of the semantic class the brief names (`bus_stop`, school POI, `parking_lane`, `parking_area`,
   `crest_present`), scored `1.0` under 25 m, decaying to `0` at 150 m. This is the number that would have
   caught "school-bus scenario 194 m from the nearest bus stop" and "school scenario on a map with no
   school".
3. **Author-intent whitelist (veto where present, weight 1.0).** Honour
   `occlusion_zone.facts.supported_scenario_templates`. If an archetype's mechanism is
   `pedestrian_emerging_around_bus`, only bind occluders whose whitelist contains it. This single check
   fixes `c9g-pedestrian-behind-bus` and `child-from-parked-cars` with zero new data.

A useful fourth, cheap term: **plausibility veto** — reject sites whose `road_class` /
`HIGH_SPEED_ARTERIAL_SEGMENT` / `speed_limit_kph` contradicts the brief's street noun (a "narrow ordinary
street" scenario must not land on a 105 kph 3-lane one-way), and reject degenerate geometry
(`segment_length_m < 20 m`, which produced the 1.14 m site).

**Per-archetype fact requirements (only facts that exist):**

| archetype | required place fact(s) | source | available (all maps) |
|---|---|---|---|
| c15g-red-light-runner | junction `derived_control`/`control_type` == signalized (equivalently tag CONTROL_SIGNALIZED, or `has_signal=true`) | topology-derived.junctions[].control; locations junction facts | 23 signalized junctions (yale 16, elcamino 6, richmond 1) |
| c12g-red-pedestrian-phase | signalized junction AND a `crosswalk` with tag CROSSWALK_MARKED_SIGNALIZED on a leg AND a school within ~200 m (`poi_type=school` / SCHOOL_ZONE_BOUNDARY / type `school_zone`) | junction control + locations type crosswalk/tags + school locations | 23 signalized; 6 CROSSWALK_MARKED_SIGNALIZED; 9 SCHOOL_ZONE_BOUNDARY + 2 school_zone |
| c12g-suv-ignores-paddle | school within ~250 m (SCHOOL_ZONE_BOUNDARY / type school_zone / `poi_type=school`) | locations | 9 school POIs (yale 6, elcamino 2, easterbrook 1) + 2 school_zone (easterbrook) |
| low-friction-stop-slide | junction control in {minor_stop, all_way_stop} (tags CONTROL_MINOR_STOP / CONTROL_ALL_WAY_STOP, `has_stop_sign=true`) | topology-derived.junctions[].control | 44 stop-controlled junctions (41 minor_stop + 3 all_way_stop) |
| c4g-circulating-sudden-stop | roundabout — DOES NOT EXIST. Fallback proxy: `arm_count>=4` AND `junction_size_m>=25` AND `complexity_class=complex|standard` | topology-derived.junctions | 0 roundabouts; 35 ARMS_4 junctions; 8 complexity_class=complex |
| c9g-pedestrian-behind-bus | `bus_stop` location on the corridor (affordance stopPoint, tag TRANSIT_BUS_STOP) or occlusion_zone with `occlusion_subtype=BUS_STOP_OCCLUSION` / `supported_scenario_templates` containing `pedestrian_emerging_around_bus` | locations type bus_stop; occlusion_zone facts | 14 bus_stop (yale 6, elcamino 5, belmont 2, richmond 1); 5 BUS_STOP_OCCLUSION |
| child-from-parked-cars | occlusion_zone with `supported_scenario_templates` ∋ `child_dartout_from_parked_cars` (tag OCCLUSION_PARKING_VRU / PEDESTRIAN_DARTOUT) AND segment `hasParkingAdjacent` or a `parking_lane` within 25 m | occlusion_zone facts; topology-derived.segments | 267 OCCLUSION_PARKING_VRU; 155 parking_lane; only 15 segments with hasParkingAdjacent |
| parked-vans-narrow-road | segment `hasParkingAdjacent=true` AND `width_class=narrow` / laneWidth<=3.4 m AND `road_class` in {residential, unclassified} AND NOT `HIGH_SPEED_ARTERIAL_SEGMENT`; prefer tag NARROW_RESIDENTIAL_STREET_WITH_PARKING / MIDBLOCK_WITH_PARKING | topology-derived.segments + locations parking_lane tags/facts | 155 NARROW_RESIDENTIAL_STREET_WITH_PARKING, 18 MIDBLOCK_WITH_PARKING, 112 road_class=residential; 15 segments hasParkingAdjacent (yale 11, belmont 2, richmond 2, elcamino 0, easterbrook 0) |
| rideshare-door-pedestrian | `parking_lane` with `is_parallel_parking=true` (PARKING_PARALLEL) within 25 m, plus sidewalk adjacency | locations parking_lane; segments hasSidewalkAdjacent | 108 PARKING_PARALLEL, 155 parking_lane, 180 segments/locations with has_sidewalk_adjacent=true |
| c11g-hidden-child / c11g-wrong-way-aisle / c11g-indicator-mislead | a `parking_area` (PARKING_LOT_APPROACH, `poi_type=parking_lot`, `space_count`) within ~60 m, plus `parking_lot_egress=true` for the aisle mouth. NOTE: parking_area has affordances [parkedVehicle, pedestrianSpawn, vehicleSpawn] but NOT `route` — there is no drivable aisle geometry, so a scenario can never be *driven inside* a lot; the best available is the lot APPROACH/egress. | locations type parking_area | 21 parking_area (elcamino 9, yale 7, belmont 3, easterbrook 2, richmond 0); 21 parking_lot_egress |
| blind-crest-queue | `crest_present=true`, or `grade_class` in {moderate,steep} with `grade_pct`. Requires adding `crest` to FeatureKindSchema OR a fact-level pre-filter. | locations facts | 13 crest_present (yale 3, belmont 2, elcamino 3, easterbrook 5, richmond 0); 62 moderate + 7 steep grade_class. All 5 maps report capabilities.grade=false. |
| c1g-illegal-u-turn / c1g-cut-in-turn | none beyond current clauses (place-agnostic briefs). Optional: prefer `unsafe_cut_in_prone` (84) / `UNPROTECTED_LEFT` (347) tags for realism. | locations tags | 84 unsafe_cut_in_prone, 347 UNPROTECTED_LEFT |

---

## 4. Cheapest immediate change

`harvest.py` calls `batch ... --max-sites N` with **no `--min-score`**, so the template's own
`policy.minScore` (as low as **0.0** for `c12g-red-pedestrian-phase` and `c1g-cut-in-turn`, 0.1 for
`rideshare-door-pedestrian`, 0.15 for `blind-crest-queue`) is what actually gates. Adding
`--min-score 1.0` is a one-line change and is the obvious first move — but the table below shows what it
buys and what it costs. `pool` counts come from a fresh `sites match --all-maps --max-sites 50` run.

| archetype | pool (all maps) | exact in pool | per-map exact | --min-score 1.0 usable? | recommended semantic filter | sites after filter | after filter AND exact |
|---|---|---|---|---|---|---|---|
| c15g-red-light-runner | 179 | 57 | yale:19, belmont:19, elcamino:11, easterbrook:3, richmond:5 | YES | junction.control = ["signalized"] (required) | 28 | 14 |
| c4g-circulating-sudden-stop | 239 | 203 | yale:50, belmont:50, elcamino:50, easterbrook:20, richmond:33 | YES | no roundabout exists — re-brief as "junction ahead", or arm_count>=4 AND junction_size_m>=25 | 56 | 42 |
| low-friction-stop-slide | 126 | 55 | yale:10, belmont:22, elcamino:16, easterbrook:1, richmond:6 | YES | junction.control = ["minor_stop","all_way_stop"] (required) | 29 | 7 |
| c12g-red-pedestrian-phase | 226 | 0 | — | NO — archetype dies | control=signalized AND school<=200m AND crosswalk<=40m | 23 | 0 |
| c9g-pedestrian-behind-bus | 250 | 0 | — | NO — archetype dies | feature kind bus_stop (required), or bus_stop<=40m | 22 | 0 |
| c11g-hidden-child | 227 | 0 | — | NO — archetype dies | parking_area (lot) <=60m | 57 | 0 |
| c11g-wrong-way-aisle | 188 | 0 | — | NO — archetype dies | parking_area (lot) <=60m | 67 | 0 |
| c11g-indicator-mislead | 152 | 2 | elcamino:2 | NO — only 2 | parking_area (lot) <=60m | 31 | 2 |
| blind-crest-queue | 220 | 0 | — | NO — archetype dies | crest_present location <=60m (needs FeatureKind or fact filter) | 32 | 0 |
| parked-vans-narrow-road | 237 | 0 | — | NO — archetype dies | segment.hasParkingAdjacent OR parking_lane<=20m | 75 | 0 |
| child-from-parked-cars | 250 | 0 | — | NO — archetype dies | parking_lane<=25m | 81 | 0 |
| rideshare-door-pedestrian | 250 | 0 | — | NO — archetype dies | parking_lane<=25m | 72 | 0 |
| c12g-suv-ignores-paddle | 113 | 8 | yale:3, belmont:2, elcamino:3 | YES | school<=250m | 55 | 6 |
| c1g-illegal-u-turn | 238 | 184 | yale:50, belmont:49, elcamino:50, easterbrook:10, richmond:25 | YES | (none needed) | 238 | 184 |
| c1g-cut-in-turn | 67 | 6 | belmont:1, elcamino:4, easterbrook:1 | YES | (none needed) | 67 | 6 |

**Read-out.**

* `--min-score 1.0` is **usable for 5 of 15** archetypes: `c1g-illegal-u-turn` (184), `c4g-circulating-sudden-stop`
  (203), `c15g-red-light-runner` (57), `low-friction-stop-slide` (55), `c12g-suv-ignores-paddle` (8),
  `c1g-cut-in-turn` (6). Of these, `c1g-cut-in-turn` at 6 is thin (1 map contributes 4 of them).
* It **kills 8 archetypes outright** — `blind-crest-queue`, `c11g-hidden-child`, `c11g-wrong-way-aisle`,
  `c12g-red-pedestrian-phase`, `c9g-pedestrian-behind-bus`, `child-from-parked-cars`,
  `parked-vans-narrow-road`, `rideshare-door-pedestrian` have **zero** exact sites map-wide — and starves
  `c11g-indicator-mislead` (2, both on one map).
* And for three of the survivors it fixes **nothing**: exact-only still leaves `c15g-red-light-runner` at
  33/57 uncontrolled and 10/57 minor_stop, `low-friction-stop-slide` at 48/55 uncontrolled, and
  `c4g-circulating-sudden-stop` at 0/203 roundabouts.

**Therefore the cheapest change that actually improves locations is not `--min-score`, it is a one-value
tightening of the `control` clause plus a proximity filter**, both expressible in existing template syntax
and existing CLI flags:

| priority | change | cost | effect |
|---|---|---|---|
| 1 | `c15g-red-light-runner`: `junction.control = ["signalized"], essentiality: "required"` | one clause | 8 nonsense sites → 28 correct candidates (yale 20, elcamino 4, richmond 4); still >= 4 |
| 2 | `low-friction-stop-slide`: `junction.control = ["minor_stop","all_way_stop"], required` | one clause | 29 candidates over 4 maps; still >= 4 |
| 3 | `c9g-pedestrian-behind-bus`: add `features: [{kind: "bus_stop", atM: [20,60], required}]` | one feature | 22 candidates within 40 m of a real bus stop (yale 13, belmont 3, elcamino 4, richmond 2) |
| 4 | `c12g-red-pedestrian-phase`: `control = ["signalized"], required` + school-zone feature | two clauses | 23 candidates (yale 19, elcamino 4); still >= 4 |
| 5 | `parked-vans-narrow-road` / `child-from-parked-cars`: require `parking_lane` within 20–25 m | one feature | 75 and 81 candidates respectively |
| 6 | `c11g-*` (3 archetypes): require a `parking_area` within 60 m | one feature | 31–67 candidates each |
| 7 | `blind-crest-queue`: cannot be fixed in the template — `crest` is not a matchable kind. Either add it to `FeatureKindSchema` or pre-filter sites to within 60 m of a `crest_present` location (32 candidates, and drop richmond-field-station which has none). | matcher change | — |
| 8 | `c4g-circulating-sudden-stop`: unsatisfiable — no roundabout on any map. Re-brief as an ordinary junction, or retire. | brief change | — |
| 9 | Add `--min-score 0.9` to `harvest.py` as a floor for everything (currently absent; template floors go as low as 0.0). Every delivered site already scores >= 0.65, so this is only a guard against future silent slippage. | one flag | — |

Ordering matters: doing (1)-(6) first and *then* raising `--min-score` gives both a correct place and a
clean bind. Raising `--min-score` alone certifies the wrong places more confidently.

---

## Appendix — reproduction

```bash
cd /Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista
node packages/cli/bin/uniscenarios.js maps list
node packages/cli/bin/uniscenarios.js template validate /tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json
node packages/cli/bin/uniscenarios.js sites match /tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json --all-maps --max-sites 50
node packages/cli/bin/uniscenarios.js locations find --map yale-street --type bus_stop
```

Fact/type/tag counts were read directly from `dev-assets/<map>/derived/topology-derived.json.gz`
(`factIndex.locationsByType|BySubtype|ByTag|ByAffordance|ByFact`) and
`dev-assets/<map>/derived/locations.json.gz`. Junction control was read from
`topology-derived.junctions[].control`; segment adjacency from `topology-derived.segments[]`.
Site → feature mapping used `manifest.site.originFeatureId` in each delivered `*.instance.json`.
