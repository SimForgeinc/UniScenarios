# Handoff: what the exported OpenDRIVE needs before a traffic signal works downstream

**To:** the map author who builds the RoadRunner scenes for the five dev maps
**From:** the simulation/scenario team
**Subject:** `map.xodr` exports currently declare working traffic-signal control at **6 junctions out
of 247**. Everything else that *looks* signalized in the scene is inert once it reaches us.
**Status:** request for an export change. Nothing here is a defect in your modelling — it is a piece
of OpenDRIVE metadata that RoadRunner only writes when the intersection is configured a particular
way, and we did not tell you we depended on it. This document says exactly what we need, why, how to
produce it, and how to check it yourself before sending an export.

---

## 1. In one paragraph

Our simulator gives a junction a working traffic signal **only when the OpenDRIVE file says so
explicitly, in two places at once**: (a) `<signal>` records with `dynamic="yes"` on the junction's
**own roads** (its incoming roads and its internal connecting roads), and (b) `<controller>` elements
that group those signal ids into stages, **referenced from inside the `<junction>` element itself**.
If either half is missing we produce **no signal at all** — not a red, not a green, not a dark head.
The vehicles then drive through the intersection as if it were uncontrolled, and every scenario that
was supposed to be about a signal silently becomes a scenario about nothing. A visible signal *model*
in the 3-D scene is not enough; a signal *point* near the intersection is not enough. The controller
wiring is the part that carries.

---

## 2. What we read, and in what order

1. `map.xodr` — the OpenDRIVE export. This is the authoritative file. Everything below is about it.
2. `signals.geojson` — derived from `map.xodr` by our asset pipeline. Each `<signal>` becomes a point
   feature carrying `road_id`, `s`, `t`, `type`, `dynamic` and a derived `signal_category`. A head is
   classified `traffic_light` when its OpenDRIVE `type` is in the 1000001 / 1000002 / 1000011 family
   (RoadRunner's standard 3-light heads) — so the category follows straight from what you export.
3. Our runtime builds a *phase program* per junction. It does that by starting from the
   `<junction>` element, reading the `<controller>` ids listed inside it, resolving each to a
   top-level `<controller>` definition, taking the `signalId`s that controller lists, and matching
   those against the `traffic_light` heads on that junction's roads.

**Every one of those steps must succeed.** The step that fails today, on 241 of 247 junctions, is
step 3's very first move: the `<junction>` element has no `<controller>` children, so we stop there
and emit nothing.

---

## 3. The three things an export must contain

For junction *J* to have a working signal:

**(a) Head geometry — `<signal>` records on J's own roads.**
Each physical head is a `<signal>` inside the `<road>` element it belongs to, with
`dynamic="yes"` and a 3-light `type`. The road must be one of J's own: a road named as
`incomingRoad` or `connectingRoad` in one of J's `<connection>` entries (a connecting road also
carries `junction="J"` on its `<road>` element). A head modelled on a *neighbouring* road does not
count, even if it is physically 10 m away and visually governs the intersection.

**(b) Lane applicability — a `<validity>` child on each `<signal>`.**
`<validity fromLane="a" toLane="b"/>` tells us which lanes that head governs, and it is how we bind a
head to a specific approach and therefore to a specific stop line. Without it we fall back to "this
head applies to the whole road", which stops every movement over that line instead of the intended
approach. One `<validity>` per governed lane range.

**(c) Controller wiring — `<controller>` in two places.**
   * A **top-level** `<controller>` element (a sibling of `<road>` and `<junction>`), with a stable
     `id`, a `sequence` giving the stage order, and one `<control signalId="…"/>` per head that is
     green during that stage.
   * A **`<controller>` child inside the `<junction>` element**, one per stage, repeating the same
     `id` and `sequence`. **This is the piece that is missing everywhere.** It is what tells us the
     controller belongs to this intersection; a top-level controller nobody references is invisible
     to us.

We do **not** need real field timings. If you give us the stage membership we synthesise a
deterministic default cycle from it (roughly 12–15 s green, 3 s amber, red for the other stages) and
label it `synthetic-default` so nobody mistakes it for surveyed data. Correct **membership and stage
order** is the valuable part; seconds are not.

---

## 4. A minimal, correct, real example

This is copied from `richmond-field-station/map.xodr`, junction 238 — one of the six that already
works. Four stages, four controllers, heads on the junction's own roads.

```xml
<OpenDRIVE>

  <!-- (a) each physical head lives on the road it stands on. Road 250 is one of
       junction 238's own connecting roads: note junction="238" on the <road>. -->
  <road name="Road 250" length="1.5943710121982452e+01" id="250" junction="238">
    ...
    <signals>
      <signal name="Signal_3Light_Post01" id="369"
              s="6.2600902204499276e+00" t="4.3955963809017078e+00"
              zOffset="4.5054335192610147e+00" hOffset="1.1608017360318637e+00"
              orientation="-" dynamic="yes" type="1000011" subtype="10"
              height="1.1595988869667053e+00" width="5.2492314245162142e-01">
        <!-- (b) which lanes this head governs -->
        <validity fromLane="0" toLane="0"/>
      </signal>
      ...
    </signals>
  </road>

  <!-- (c1) top-level controller definitions: one per stage, in sequence order,
       each listing the heads that are green during that stage. -->
  <controller name="ctrl379" id="379" sequence="0">
    <control signalId="373" type=""/>
    <control signalId="369" type=""/>
  </controller>
  <controller name="ctrl380" id="380" sequence="1">
    <control signalId="376" type=""/>
    <control signalId="370" type=""/>
    <control signalId="378" type=""/>
    <control signalId="368" type=""/>
  </controller>
  <!-- ctrl381 (sequence 2) and ctrl382 (sequence 3) follow the same shape -->

  <junction id="238" name="junction238">
    <connection id="0"  incomingRoad="18" connectingRoad="239" contactPoint="end">
      <laneLink from="1" to="1"/>
    </connection>
    ...
    <!-- (c2) THE MISSING PIECE ON EVERY OTHER JUNCTION.
         These four lines are what bind the controllers above to this junction. -->
    <controller id="379" type="0" sequence="0"/>
    <controller id="380" type="0" sequence="1"/>
    <controller id="381" type="0" sequence="2"/>
    <controller id="382" type="0" sequence="3"/>
  </junction>

</OpenDRIVE>
```

Everything outside the four `<controller id=… type="0" sequence=…/>` lines inside `<junction>` is
already normal RoadRunner output. Those four lines are the difference between a signal that works and
a signal that does not exist.

---

## 5. Where the five maps stand today

Counted directly from the delivered `map.xodr` files (`<junction>` elements, `<signal>` records on
each junction's own incoming/connecting roads, and `<controller>` children of `<junction>`):

| map | `<junction>` elements | junctions with a **working** signal | junctions with dynamic heads but **no** controller wiring | `<signal>` records total | of which `dynamic="yes"` |
|---|---:|---:|---:|---:|---:|
| yale-street | 56 | **4** — 134, 303, 345, 447 | 0 | 143 | 69 |
| richmond-field-station | 31 | **1** — 238 | 0 | 39 | 12 |
| el-camino-road | 68 | **1** — 590 | **1** — 2218 | 73 | 30 |
| belmont-research-center | 75 | **0** | 0 | 50 | **0** |
| easterbrook-discovery-school | 17 | **0** | 0 | 54 | **0** |
| **total** | **247** | **6** | **1** | **359** | **111** |

Read that as three separate problems:

1. **belmont-research-center and easterbrook-discovery-school contain no dynamic traffic-signal head
   at all.** Their 104 `<signal>` records are static furniture — stop signs (`type="206"`), speed
   limit plates (`type="274"`), street-name and bike-lane plates, and `roadMark`/`StopLine` markings.
   All of them are `dynamic="no"`. Nothing on these two maps can ever be a traffic light as exported.
   Between them that is **92 junctions with zero signal capability**.
2. **el-camino-road junction 2218 is one line away from working.** It has dynamic 3-light heads on
   its own roads, and a working head geometry, but the `<junction>` element carries no `<controller>`
   children, so we never find them. This is the cheapest possible fix and a good first test case.
3. **The remaining junctions have neither.**

### The junctions our topology pipeline *labels* signalized, and what they actually contain

Separately from the export, our own map-analysis layer labels a junction `signalized` if any
traffic-light point falls within (junction size / 2 + 22 m) of the junction centre. That heuristic is
ours, not yours, and it is too generous — it picks up neighbouring intersections' heads. It labels
**23** junctions signalized when only **6** can actually produce a signal. Full detail, so you can
see which ones are real:

| map | junction | `<controller>` children | `<signal>` on its own roads | of those, dynamic 3-light | verdict |
|---|---:|---:|---:|---:|---|
| yale-street | 134 | 4 | 32 | 19 | **works** |
| yale-street | 303 | 1 | 24 | 19 | **works** |
| yale-street | 345 | 4 | 22 | 19 | **works** |
| yale-street | 447 | 4 | 31 | 12 | **works** |
| richmond-field-station | 238 | 4 | 17 | 12 | **works** |
| el-camino-road | 590 | 4 | 40 | 25 | **works** |
| el-camino-road | 2218 | 0 | (heads present) | >0 | needs (c) only |
| yale-street | 115, 387, 788, 883, 1111, 1369, 1382 | 0 | 0 | 0 | nothing there |
| yale-street | 247, 817, 1280 | 0 | 1 | 0 | a sign or stop line only |
| yale-street | 548, 762 | 0 | 3 | 0 | signs / stop lines only |
| el-camino-road | 245 | 0 | 2 | 0 | signs only |
| el-camino-road | 581, 2013, 2089, 2203 | 0 | 0 | 0 | nothing there |

The clearest illustration is **yale-street junction 387**. Our pipeline calls it "a signalized
four-way". Its `<junction>` element has zero controllers, and its incoming and connecting roads carry
zero `<signal>` records of any kind. It sits 51.6 m from junction 345 — a genuinely signalized
intersection — and the 22 m proximity pad borrows eight of 345's physical heads. In the export,
junction 387 is an uncontrolled intersection, and that is how it behaves.

---

## 6. How to check an export yourself, before sending it

No repository access needed — these run against a plain `.xodr`.

**A. Junctions that carry controller wiring (the one number that matters).** With `xmllint`:

```bash
# how many junctions are wired
xmllint --xpath 'count(//junction[controller])' map.xodr; echo
# the ids of the wired ones
xmllint --xpath '//junction[controller]/@id' map.xodr; echo
# total junctions, for the ratio
xmllint --xpath 'count(//junction)' map.xodr; echo
```

A healthy export has the first number equal to the number of intersections you actually signalized in
RoadRunner. Today it is 4, 1, 1, 0, 0 on the five maps.

**B. Dynamic heads present but unwired — the "nearly works" list.**

```bash
python3 - <<'PY'
import re, sys, collections
x = open('map.xodr').read()
roads = {}
for r in re.finditer(r'<road\b([^>]*)>([\s\S]*?)</road>', x):
    rid = re.search(r'\bid="([^"]+)"', r.group(1)).group(1)
    roads[rid] = r.group(2)
for j in re.finditer(r'<junction\b([^>]*)>([\s\S]*?)</junction>', x):
    jid  = re.search(r'\bid="([^"]+)"', j.group(1)).group(1)
    body = j.group(2)
    own  = set(re.findall(r'incomingRoad="([^"]+)"', body)) | set(re.findall(r'connectingRoad="([^"]+)"', body))
    ctrl = re.findall(r'<controller[^>]*\bid="([^"]+)"', body)
    heads = sum(1 for rid in own
                for s in re.findall(r'<signal\b([^>]*)', roads.get(rid, ''))
                if 'dynamic="yes"' in s and re.search(r'type="10000\d\d"', s))
    if heads or ctrl:
        state = 'WORKS' if (heads and ctrl) else ('NO CONTROLLER WIRING' if heads else 'CONTROLLERS BUT NO HEADS')
        print(f'junction {jid:>6}  dynamic heads {heads:3}  <controller> children {len(ctrl)}  -> {state}')
PY
```

Every line must read `WORKS`. A line reading `NO CONTROLLER WIRING` is a signal that will be silently
dropped; a line reading `CONTROLLERS BUT NO HEADS` is a controller referencing heads we cannot find
(usually because the heads were modelled on an adjacent road rather than the junction's own).

**C. Every controller referenced by a junction actually exists at top level.**

```bash
xmllint --xpath '//junction/controller/@id' map.xodr    # referenced
xmllint --xpath '//OpenDRIVE/controller/@id' map.xodr   # defined
```
The first set must be a subset of the second.

**D. If you have the repo checked out**, this prints the same census across all five maps and is the
exact predicate the simulator uses:

```bash
node packages/cli/bin/uniscenarios.js instantiate <template>.json --map <mapId> --site <siteId> --out /tmp/i.json
python3 -c "import json;d=json.load(open('/tmp/i.json'));print('signalPrograms:',len(d['signalPrograms']))"
```
`signalPrograms: 0` at a junction you believe is signalized means the export did not carry it.

---

## 7. What goes wrong downstream when the wiring is absent

These are measured consequences, not predictions.

* **No signal state exists in the recorded episode.** The simulator publishes a per-signal phase
  channel only for signals it built a program for. With no program the channel is empty, so nothing
  downstream — analysis, video overlays, dataset labels — can say what colour anything was.
* **"Obey the signal" becomes a no-op.** A vehicle's *obey signals* rule is consulted only when the
  episode has at least one signal or stop line. With none, setting it true or false changes nothing.
  Two vehicles both told to obey a red will drive straight through the intersection at speed.
* **Signal-conditioned triggers never fire.** A scenario that says "the pedestrian steps out when the
  ego's signal turns green" waits forever, because the phase it is waiting for does not exist.
* **Signal-based checks silently pass.** A check of the form "the ego's indication must have been red
  at the moment of entry" grades as *unchecked* rather than *failed*, so it drops out of the verdict
  instead of raising an alarm. This is the dangerous one: the scenario reports success.

Concretely: of 293 delivered driving scenarios, 93 have a written brief that names a traffic signal
("runs the red light", "proceeds on green", "the red pedestrian phase"). **88 of those 93 contain no
signal state whatsoever.** They are usable clips of vehicles conflicting at an intersection, but they
are not the signal scenarios they claim to be, and we have had to introduce an automatic rejection
rule for them.

---

## 8. What we are asking for, in priority order

1. **el-camino-road junction 2218** — add the `<controller>` children to the `<junction>` element.
   The heads are already correct. This is the smallest possible change and lets us verify the whole
   chain on a junction that has never worked.
2. **belmont-research-center** — at least 2–3 signalized intersections with full wiring. This map
   carries the largest share of our intersection scenarios and currently has **no** dynamic signal
   head anywhere, so every signal scenario on it is unbuildable from the map.
3. **easterbrook-discovery-school** — at least one signalized intersection, ideally the one adjacent
   to the school crossing, so school-zone pedestrian-phase scenarios become possible.
4. **yale-street and el-camino-road** — where a junction was intended to be signalized but has no
   heads of its own (yale 115 / 387 / 788 / 883 / 1111 / 1369 / 1382, el-camino 581 / 2013 / 2089 /
   2203), either wire it properly or leave it visually unsignalized, so the scene and the data agree.
5. **Add `<validity>` to heads wherever the head governs a specific approach**, so a protected turn
   can be represented distinctly from the through movement.

If it is easier to hand over one worked intersection than a whole map, junction 2218 on
el-camino-road is the one we would like first, and we will verify it end to end and report back the
same day.

---

## 9. Two notes to prevent wasted work

* **Do not add heads by moving them closer to the junction.** Physical distance is irrelevant to us;
  the head has to be *on one of the junction's own roads* and referenced by a controller the junction
  names. Nudging a head 5 m changes nothing.
* **Do not spend time on phase timings.** We synthesise a default cycle from stage membership and
  label it as synthetic. If you *do* have real timings we will happily take them, but their absence is
  not what is blocking us.

Thank you — this is a small, mechanical addition to the export, and it unblocks an entire category of
scenario that we currently cannot build from the maps at all.
