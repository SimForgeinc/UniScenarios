"""WS-1b: tighten the 15 delivered archetype anchors so the context each brief NAMES is REQUIRED.

Why this file exists
--------------------
`newcaps/DIAG-locations.md` showed the delivered sites are in the wrong PLACES while scoring
"exact". The mechanism is now pinned down by probe (`ws1b_probe.py`, /tmp/vista-ws1b/probe-*.json):

  a feature with `essentiality: "required"` but `atM` / `lateralDistanceM` marked `preferred`
  does NOT constrain the site. It binds the nearest thing of that kind at any distance (or nothing
  at all) and only loses a few score points.

  Proof: `c11g-hidden-child` requires a `driveway` feature and returns 397 sites, while a probe
  anchor whose ONLY feature is a `driveway` with `atM` REQUIRED returns 0 sites on all five maps --
  there is not one mapped driveway anywhere. The "required" feature was never enforced.

So the tightening is mechanical and uniform: for every feature that carries the brief's own noun,
promote `atM`, `lateralDistanceM` and `sameRoad` to `essentiality: "required"` with a window that
actually means "here", and promote the kind-specific predicate the brief depends on
(junction `control`, `conflictingApproach`, `arms`, `sizeM`, crossing `marked`/`placement`)
to `required` as well.

Portability is preserved: every edit is a clause over road structure. No coordinates, no road ids,
no map names, still ScenarioTemplate v2.

Binding decisions honoured here
-------------------------------
* SIGNAL-dependent archetypes do NOT get `control: ["signalized"]` required. Only 6 of 247 junctions
  carry a real signal program and map-intel's `signalized` label is wrong 17 times in 23, so
  requiring it would certify a label rather than a place. These archetypes instead require the
  junction GEOMETRY the brief needs (opposing left-turn conflict, crossing on a leg, arms, size);
  the light itself is authored by a separate workstream via a portable `trafficControls` block.
* STOP-controlled briefs are different -- the sign IS the mechanism -- so
  `low-friction-stop-slide` requires `control: ["minor_stop","all_way_stop"]`.
* `blind-crest-queue` wants feature kind `crest`, which the adapter drops
  ("feature kind \"crest\" is not matchable; feature dropped"). The anchor we WANT is written out
  anyway and marked blocked on ws1a. `gradePct` is not a usable substitute: a probe requiring any
  non-zero grade returns 0 sites on all five maps (capabilities.grade = false).

Usage
-----
    python ws1b_tighten.py --base /tmp/vista-ws1b/base --out /tmp/vista-ws1b/templates
"""
import os, json, copy, argparse

REQ = 'required'


def clause(value, ess=REQ, weight=None):
    c = {'value': value, 'essentiality': ess}
    if weight is not None:
        c['weight'] = weight
    return c


def feat(anchor, fid):
    for f in anchor.get('features', []):
        if f['id'] == fid:
            return f
    raise KeyError(f'{fid} not in {[f["id"] for f in anchor.get("features", [])]}')


def promote(f, key, value=None, ess=REQ, weight=None):
    """Force a clause to `ess`, optionally replacing its value."""
    cur = f.get(key)
    if cur is None or not isinstance(cur, dict):
        f[key] = clause(value, ess, weight)
        return
    if value is not None:
        cur['value'] = value
    cur['essentiality'] = ess
    if weight is not None:
        cur['weight'] = weight


def place(f, at, lat=None, same=True):
    """The core move: make the feature's POSITION binding, not decorative."""
    promote(f, 'atM', list(at))
    if lat is not None:
        promote(f, 'lateralDistanceM', list(lat))
    if same:
        promote(f, 'sameRoad', True)
    f['essentiality'] = REQ


def corridor(anchor, key, value, ess=REQ):
    c = anchor.setdefault('corridor', {})
    if key in c and isinstance(c[key], dict):
        c[key]['value'] = value
        c[key]['essentiality'] = ess
    else:
        c[key] = clause(value, ess)


def add_feature(anchor, f, index=None):
    """Append by default. `features[0]` is the frame origin in v2 (there is no `originFeatureId`),
    so a new context feature is APPENDED, never prepended: prepending would move s = 0 and silently
    reposition every authored pose."""
    if any(x['id'] == f['id'] for x in anchor['features']):
        return
    if index is None:
        anchor['features'].append(f)
    else:
        anchor['features'].insert(index, f)


def point_feature(fid, kind, at, lat, label, same=True):
    f = {'id': fid, 'kind': kind, 'essentiality': REQ, 'label': label,
         'atM': clause(list(at)), 'lateralDistanceM': clause(list(lat))}
    if same:
        f['sameRoad'] = clause(True)
    return f


# --------------------------------------------------------------- per archetype

def t_c15g_red_light_runner(t):
    """Brief: an opposing vehicle crosses the ego's path against its red.

    Per the parent decision the SIGNAL is not required of the site (23 map-intel `signalized`
    labels, only 6 backed by a real program, 17 of 23 mislabelled). What IS required is the
    geometry the violation needs: a real multi-arm intersection with an opposing left-turn
    movement that crosses the ego through path.
    """
    a = t['anchor']
    j = feat(a, 'conflict-junction')
    place(j, (-15, 15), lat=None)
    promote(j, 'conflictingApproach',
            {'from': 'opposing', 'turn': 'left', 'crossingAngleDeg': [60, 120]}, weight=4)
    promote(j, 'arms', [3, None])
    promote(j, 'sizeM', [8, None])
    j['control'] = clause(['signalized', 'all_way_stop', 'minor_stop', 'uncontrolled'],
                          'preferred', 1)
    j['label'] = ('multi-arm intersection with an opposing left-turn movement crossing the ego '
                  'through path (the signal itself is authored, not matched)')
    corridor(a, 'speedLimitKph', [40, 85])
    corridor(a, 'runwayDownstreamM', [120, None])
    return ('junction geometry required: opposing left-turn conflict + arms>=3 + size>=8 m. '
            'control deliberately NOT required (parent decision on signal labels).')


def t_low_friction_stop_slide(t):
    """Brief: a car SLIDES THROUGH A STOP-CONTROLLED junction. The sign is the mechanism."""
    a = t['anchor']
    j = feat(a, 'stop-controlled-conflict-junction')
    place(j, (-15, 15), lat=None)
    promote(j, 'control', ['minor_stop', 'all_way_stop'], weight=4)
    promote(j, 'arms', [3, None])
    promote(j, 'egoTurn', ['straight'])
    j['label'] = 'stop-controlled multi-arm junction with cross traffic over the ego path'
    return 'control = [minor_stop, all_way_stop] REQUIRED; arms>=3 and egoTurn straight required.'


def t_c12g_red_pedestrian_phase(t):
    """Brief: pedestrian steps off against the phase at a school crossing.

    Required: a genuine school zone, and a marked crossing on a junction leg. The signal phase is
    authored (parent decision), so `control` stays preferred.
    """
    a = t['anchor']
    j = feat(a, 'school-approach-junction')
    place(j, (-15, 15), lat=None)
    promote(j, 'hasCrossingOnLeg', True)
    promote(j, 'arms', [3, None])
    j['control'] = clause(['signalized', 'all_way_stop', 'minor_stop', 'uncontrolled'],
                          'preferred', 2)
    x = feat(a, 'school-crossing')
    place(x, (-60, 120), lat=(0, 30), same=False)
    # `marked` stays preferred: required, the archetype drops to 4 sites, one off the M1.3 floor.
    # The crossing's PRESENCE and POSITION are what the brief needs and those are required.
    x['marked'] = clause(True, 'preferred', 3)
    x['controlled'] = clause(True, 'preferred', 2)
    x['placement'] = clause('junction_leg', 'preferred', 2)
    o = feat(a, 'roadside-occlusion')
    o['essentiality'] = 'preferred'
    o['atM'] = clause([-20, 90], 'preferred', 1)
    add_feature(a, point_feature('school-zone', 'school_zone', (-150, 250), (0, 120),
                                 'the school the crossing belongs to', same=False))
    return ('school_zone feature REQUIRED (this is a school scenario -- this pins the archetype '
            'to the one map that has a mapped school zone, which is the honest answer), crossing '
            'presence and position REQUIRED, junction must have a crossing on a leg REQUIRED. '
            'control left preferred per the parent decision on signal labels.')


def t_c12g_suv_ignores_paddle(t):
    """Brief: an SUV ignores a school crossing-guard paddle. Without a school it is not the brief."""
    a = t['anchor']
    j = feat(a, 'turn-across-ego-junction')
    place(j, (-10, 10), lat=None)
    promote(j, 'conflictingApproach',
            {'from': 'opposing', 'turn': 'left', 'crossingAngleDeg': [45, 135]}, weight=3)
    promote(j, 'arms', [3, None])
    o = feat(a, 'mapped-approach-occlusion')
    o['essentiality'] = 'preferred'
    o['atM'] = clause([-50, 100], 'preferred', 1)
    # The crossing IS the paddle. This is the enforceable half of the brief's context.
    add_feature(a, {'id': 'guarded-crossing', 'kind': 'crossing', 'essentiality': REQ,
                    'label': 'the pedestrian crossing the guard is holding the paddle at',
                    'atM': clause([-40, 80]), 'lateralDistanceM': clause([0, 20]),
                    'marked': clause(True, 'preferred', 3)})
    # The school itself stays PREFERRED, and this is a MEASURED map-coverage limit, not laziness:
    # 11 school POIs exist across the five maps but 9 of them are typed `poi_frontage`
    # (tag SCHOOL_ZONE_BOUNDARY) and `LOCATION_KIND_MAP` in the matcher only maps type
    # `school_zone`. So only 2 school POIs (both easterbrook) are reachable by a `school_zone`
    # feature at all, and requiring one caps this archetype at 3 sites map-wide -- below the M1.3
    # floor of 4, measured every way it was tried (corridor relaxed, junction relaxed, diversity
    # off, mirror on, window widened to +/-400 m: still 3).
    # The school requirement is therefore enforced in `placefit.py`, which reads the full 11-POI
    # fact set directly instead of going through the matcher's feature vocabulary.
    # ASK FOR ws1a: add `poi_frontage` + tag SCHOOL_ZONE_BOUNDARY to LOCATION_KIND_MAP ->
    # `school_zone`, and this clause can be promoted to required with ~9 more sites available.
    add_feature(a, {'id': 'school-zone', 'kind': 'school_zone', 'essentiality': 'preferred',
                    'weight': 8,
                    'label': 'the school whose crossing guard is on duty (preferred, not required: '
                             'only 2 of 11 school POIs are typed school_zone -- see placefit.py)',
                    'atM': clause([-250, 400], 'preferred', 8),
                    'lateralDistanceM': clause([0, 200], 'preferred', 8)})
    return ('crossing feature REQUIRED (the paddle guards a crossing) + junction conflict geometry '
            'REQUIRED. school_zone stays preferred(w=8) because only 2 of 11 school POIs are '
            'matchable; placefit.py enforces the school within 250 m from facts instead.')


def t_c9g_pedestrian_behind_bus(t):
    """Brief: a pedestrian emerges from behind a stopped bus. 0 of 7 delivered sites had a bus stop."""
    a = t['anchor']
    add_feature(a, point_feature('bus-stop', 'bus_stop', (-40, 140), (0, 25),
                                 'the kerbside bus stop the bus is halted at'))
    o = feat(a, 'approach-occlusion')
    o['essentiality'] = 'preferred'
    o['atM'] = clause([10, 90], 'preferred', 2)
    o['lateralDistanceM'] = clause([0, 12], 'preferred', 1)
    x = feat(a, 'pedestrian-crossing')
    x['essentiality'] = 'cosmetic'
    x['atM'] = clause([10, 120], 'cosmetic', 1)
    x['lateralDistanceM'] = clause([0, 20], 'cosmetic', 1)
    corridor(a, 'requiresAdjacent', ['sidewalk'])
    return 'bus_stop feature REQUIRED on the corridor; sidewalk adjacency REQUIRED.'


def t_child_from_parked_cars(t):
    """Brief: a child darts out from between parked cars. Needs actual kerbside parking."""
    a = t['anchor']
    add_feature(a, point_feature('kerbside-parking', 'parking_zone', (5, 90), (0, 15),
                                 'the row of parked cars the child emerges from'))
    o = feat(a, 'kerbside-occlusion')
    place(o, (10, 90), lat=(0, 20))
    corridor(a, 'requiresAdjacent', ['sidewalk'])
    corridor(a, 'speedLimitKph', [20, 65])
    return ('parking_zone REQUIRED within 90 m and 15 m laterally, occlusion_zone position now '
            'REQUIRED, sidewalk adjacency REQUIRED, speed capped at 65 kph (was 90).')


def t_parked_vans_narrow_road(t):
    """Brief: a NARROW ORDINARY STREET with vans at both kerbs. 3 of 7 sites were 3-lane arterials."""
    a = t['anchor']
    add_feature(a, point_feature('kerbside-parking', 'parking_zone', (-20, 120), (0, 15),
                                 'the parked row the vans stand in'))
    o = feat(a, 'midblock-occlusion')
    place(o, (-20, 120), lat=(0, 15))
    corridor(a, 'laneWidthM', [2.2, 4.6])
    corridor(a, 'speedLimitKph', [20, 70])
    corridor(a, 'throughLanesSameDir', [1, 2])
    # Sidewalk adjacency stays PREFERRED on purpose. Required, the whole archetype collapses to
    # 4 sites on one map (measured); the brief says "narrow ordinary street", not "with a footway",
    # and the narrowness clauses already carry that meaning.
    corridor(a, 'requiresAdjacent', ['sidewalk'], ess='preferred')
    return ('parking_zone REQUIRED; corridor REQUIRED narrow: lane width <=4.6 m, <=2 lanes each '
            'way, speed limit <=70 kph. This is what excludes the 105 kph 3-lane arterials.')


def t_rideshare_door_pedestrian(t):
    """Brief: a rideshare passenger doors out at a kerbside stop."""
    a = t['anchor']
    add_feature(a, point_feature('kerbside-parking', 'parking_zone', (10, 140), (0, 12),
                                 'the kerbside parking the rideshare halts in'))
    o = feat(a, 'curbside-occlusion')
    place(o, (10, 140), lat=(0, 15))
    corridor(a, 'requiresAdjacent', ['sidewalk'])
    corridor(a, 'speedLimitKph', [20, 70])
    return 'parking_zone REQUIRED kerbside, sidewalk adjacency REQUIRED, speed capped at 70 kph.'


def t_c11g_hidden_child(t):
    """Brief: a child hidden by a parked row at a parking-lot access lane."""
    a = t['anchor']
    p = feat(a, 'parking-edge')
    place(p, (10, 120), lat=(0, 15))
    d = feat(a, 'parking-access')
    d['essentiality'] = 'cosmetic'
    d['atM'] = clause([0, 200], 'cosmetic', 1)
    d['lateralDistanceM'] = clause([0, 40], 'cosmetic', 1)
    d['label'] = ('lot access lane -- NOT ENFORCEABLE: zero driveway features exist on any of the '
                  'five maps (probe: 0 sites), so the lot edge is carried by parking-edge '
                  '+ mapped-occlusion instead')
    o = feat(a, 'mapped-occlusion')
    place(o, (10, 120), lat=(0, 15))
    corridor(a, 'requiresAdjacent', ['sidewalk'])
    corridor(a, 'speedLimitKph', [20, 65])
    return ('parking_zone and occlusion_zone positions REQUIRED; the inert driveway clause is '
            'demoted to cosmetic and labelled as unmapped rather than left pretending to bind.')


def t_c11g_wrong_way_aisle(t):
    """Brief: a wrong-way rider comes down a parking aisle. One delivered site was a freeway."""
    a = t['anchor']
    p = feat(a, 'parking-row')
    place(p, (0, 80), lat=(0, 15))
    corridor(a, 'laneWidthM', [2.2, 5.0])
    corridor(a, 'speedLimitKph', [20, 70])
    corridor(a, 'throughLanesSameDir', [1, 2])
    return ('parking_zone position REQUIRED; corridor REQUIRED to be a low-speed <=2-lane street. '
            'This is what excludes John T. Knox Freeway.')


def t_c11g_indicator_mislead(t):
    """Brief: a vehicle indicates into a parking bay and does not take it."""
    a = t['anchor']
    j = feat(a, 'crossing-junction')
    promote(j, 'conflictingApproach',
            {'from': 'from_right', 'turn': 'left', 'crossingAngleDeg': [45, 135]}, weight=3)
    promote(j, 'arms', [3, None])
    p = feat(a, 'alternate-parking-aisle')
    place(p, (5, 70), lat=(0, 15))
    corridor(a, 'speedLimitKph', [20, 65])
    return 'parking_zone position REQUIRED; junction conflict geometry and arms>=3 REQUIRED.'


def t_blind_crest_queue(t):
    """Brief: a queue hidden beyond the crest of a hill.

    WAS blocked on ws1a: `crest` was not in FeatureKindSchema and the adapter deleted the feature
    ("feature kind \"crest\" is not matchable; feature dropped"). The anchor was written as REQUIRED
    anyway so it would start biting the moment the kind landed -- and ws1a LANDED IT mid-flight
    (`adapt.ts: crest -> \'crest\'`, backed by map-intel\'s `crest_present` fact). Re-measured after
    it landed: a probe requiring a crest returns 25-36 sites, and this archetype 7.

    `gradePct` was never a usable fallback: a probe requiring any non-zero grade returns 0 sites on
    all five maps (every map reports capabilities.grade = false).
    """
    a = t['anchor']
    c = feat(a, 'blind-rise')
    c['essentiality'] = REQ
    promote(c, 'atM', [-30, 80], weight=4)
    # A crest is a LONGITUDINAL feature: it sits on the carriageway, so a lateral window is not
    # meaningful and is left preferred. `sameRoad` stays required -- the rise has to be on the
    # ego's own road or it hides nothing.
    c['lateralDistanceM'] = clause([0, 12], 'preferred', 1)
    promote(c, 'sameRoad', True)
    c['label'] = 'crest of the rise that hides the queue'
    o = feat(a, 'sightline-occlusion')
    place(o, (-60, 200), lat=(0, 30))
    # runwayDownstreamM and curvature are clip-length and comfort clauses, not PLACE clauses.
    # Required they cost the archetype every site it has; they stay preferred.
    corridor(a, 'runwayDownstreamM', [260, None], ess='preferred')
    corridor(a, 'curvatureDegPer10m', [0, 8], ess='preferred')
    return ('crest feature REQUIRED and now genuinely matchable (ws1a landed the kind mid-flight); '
            'occlusion_zone position REQUIRED; runway/curvature left preferred because they are '
            'clip-length clauses, not place clauses, and required they cost every site.')


def t_c1g_illegal_u_turn(t):
    """Brief: a lead SUV U-turns out of the ego lane. Place-agnostic, but a U-turn needs somewhere
    to turn INTO: an opposing carriageway and a junction big enough to swing in."""
    a = t['anchor']
    j = feat(a, 'junction-ahead')
    place(j, (-10, 10), lat=None)
    promote(j, 'arms', [3, None])
    promote(j, 'egoTurn', ['straight'])
    promote(j, 'sizeM', [8, None])
    corridor(a, 'throughLanesOpposing', [1, None])
    corridor(a, 'throughLanesSameDir', [1, None])
    return ('junction arms>=3 and size>=8 m REQUIRED, and an opposing carriageway REQUIRED -- '
            'a U-turn needs somewhere to turn into.')


def t_c1g_cut_in_turn(t):
    """Brief: a vehicle cuts in from a side street. The side street IS the mechanism."""
    a = t['anchor']
    j = feat(a, 'side-street-junction')
    place(j, (-10, 10), lat=None)
    promote(j, 'conflictingApproach',
            {'from': 'from_right', 'turn': 'right', 'crossingAngleDeg': [60, 120]}, weight=4)
    promote(j, 'arms', [3, None])
    return 'side-street conflict geometry REQUIRED (from_right, right turn) and arms>=3 REQUIRED.'


def t_c4g_circulating_sudden_stop(t):
    """RE-BRIEFED. See newcaps/WS1b-placefit.md section C.

    The original brief names a roundabout. Zero roundabouts exist on any of the five maps
    (247 junctions: 179 uncontrolled, 41 minor_stop, 23 signalized, 3 all_way_stop, 0 roundabout),
    so the archetype was unsatisfiable and its 6 delivered sites were ordinary junctions -- one of
    them a 2-arm road link -- all scoring 1.00 "exact".

    The TEST the brief is actually buying is not circular geometry, it is: the lead vehicle stops
    dead while the ego is already COMMITTED INSIDE the junction box, where stopping leaves the ego
    blocking a conflicting movement and there is no lane to escape into. That is reproducible on a
    large multi-arm intersection, which these maps do have. So the archetype is re-briefed to
    "committed-in-the-box sudden stop" rather than faked as a roundabout or retired.
    """
    a = t['anchor']
    j = feat(a, 'circulation-junction')
    place(j, (-10, 10), lat=None)
    promote(j, 'arms', [4, None], weight=4)
    promote(j, 'sizeM', [20, None], weight=3)
    promote(j, 'egoTurn', ['straight'])
    j['control'] = clause(['signalized', 'all_way_stop', 'minor_stop', 'uncontrolled'],
                          'preferred', 1)
    j['label'] = ('large multi-arm intersection the ego is committed inside when the lead stops '
                  '(re-briefed from "roundabout": zero roundabouts exist on these maps)')
    corridor(a, 'runwayDownstreamM', [120, None])
    t['meta']['name'] = 'Lead stops dead with the ego committed in the junction box'
    t['meta']['description'] = (
        'The ego follows a lead vehicle into a large multi-arm intersection and the lead stops dead '
        'while the ego is already inside the box, leaving the ego stranded across a conflicting '
        'movement with no lane to escape into. Re-briefed from a roundabout scenario: no roundabout '
        'exists on any map in this set.')
    tags = [x for x in t['meta'].get('tags', []) if 'roundabout' not in x and 'circulat' not in x]
    t['meta']['tags'] = tags + ['large-intersection', 'committed-in-box', 'sudden-stop', 're-briefed']
    return ('RE-BRIEFED off "roundabout" (0 exist map-wide) to "committed inside a large multi-arm '
            'intersection": arms>=4 and size>=20 m REQUIRED, egoTurn straight REQUIRED.')


TIGHTEN = {
    'c15g-red-light-runner': t_c15g_red_light_runner,
    'low-friction-stop-slide': t_low_friction_stop_slide,
    'c12g-red-pedestrian-phase': t_c12g_red_pedestrian_phase,
    'c12g-suv-ignores-paddle': t_c12g_suv_ignores_paddle,
    'c9g-pedestrian-behind-bus': t_c9g_pedestrian_behind_bus,
    'child-from-parked-cars': t_child_from_parked_cars,
    'parked-vans-narrow-road': t_parked_vans_narrow_road,
    'rideshare-door-pedestrian': t_rideshare_door_pedestrian,
    'c11g-hidden-child': t_c11g_hidden_child,
    'c11g-wrong-way-aisle': t_c11g_wrong_way_aisle,
    'c11g-indicator-mislead': t_c11g_indicator_mislead,
    'blind-crest-queue': t_blind_crest_queue,
    'c1g-illegal-u-turn': t_c1g_illegal_u_turn,
    'c1g-cut-in-turn': t_c1g_cut_in_turn,
    'c4g-circulating-sudden-stop': t_c4g_circulating_sudden_stop,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='/tmp/vista-ws1b/base')
    ap.add_argument('--out', default='/tmp/vista-ws1b/templates')
    ap.add_argument('--notes', default='/tmp/vista-ws1b/tighten-notes.json')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    notes = {}
    for arch, fn in TIGHTEN.items():
        src = os.path.join(a.base, arch + '.json')
        t = json.load(open(src))
        notes[arch] = fn(t)
        json.dump(t, open(os.path.join(a.out, arch + '.json'), 'w'), indent=1)
        print(f'{arch:30} {notes[arch]}')
    json.dump(notes, open(a.notes, 'w'), indent=1)
    print('\nwrote', a.out, 'and', a.notes)


if __name__ == '__main__':
    main()
