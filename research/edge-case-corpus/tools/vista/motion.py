"""Mechanical scenario facts, computed exactly from the trace.

The independent audit measured the vision critic on facts the trace already settles:
  "does this actor move?"          recall 0.800
  "does it enter the ego's lane?"  recall 0.500     <- misses half of every lane incursion
  "does it slow sharply?"          recall 0.440
So the validator was asking a vision model to perceive geometry that is computable to the millimetre.
This module computes it. The vision critic is then only needed for the genuinely semantic residue
(occlusion, "unexpectedly", intent), not for whether a box moved sideways.

Frame convention: trace uses (x, y); heading is already in that frame and must NOT be negated.
"""
import math

LANE_HALF_W = 1.75          # nominal half lane width, m
INCURSION_LATERAL_M = 1.2   # how far into the ego's lane counts as an incursion
HARD_DECEL_MPS2 = 2.5       # "brakes hard"
MOVES_MPS = 1.0             # "is moving" rather than parked
STOPS_MPS = 0.5             # "comes to a stop"


DECEL_WINDOW_S = 0.3        # single-tick differences are meaningless at dt=0.02


def windowed_decel(sp, window=DECEL_WINDOW_S):
    """Peak deceleration sustained over `window` seconds.

    A tick-to-tick difference at dt = 0.02 s reports 109 m/s^2 for a pedestrian who simply stops,
    which is an artifact of the sampling rate, not a braking event.
    """
    if len(sp) < 2:
        return 0.0
    peak = 0.0
    j = 0
    for i in range(len(sp)):
        while sp[i][0] - sp[j][0] > window:
            j += 1
        dt = sp[i][0] - sp[j][0]
        if dt > 1e-6:
            peak = max(peak, (sp[j][1] - sp[i][1]) / dt)
    return peak


def _present(a, i):
    return a['present'][i]


def ego_frame_offsets(trace, aid):
    """Lateral offset of `aid` from the EGO'S OWN path, per tick, in metres.

    Signed: positive is to the ego's left. This is the quantity "does it come into my lane" actually
    depends on, and it is not the same as the actor's own lateralOffsetM, which is measured against
    whatever lane the actor is in.
    """
    A = trace['ticks']['actors']
    ego, o = A.get('ego'), A.get(aid)
    if not ego or not o:
        return []
    out = []
    for i in range(len(trace['ticks']['t'])):
        if not (_present(ego, i) and _present(o, i)):
            out.append(None)
            continue
        dx, dy = o['x'][i] - ego['x'][i], o['y'][i] - ego['y'][i]
        h = ego['headingRad'][i]
        lon = dx * math.cos(h) + dy * math.sin(h)
        lat = -dx * math.sin(h) + dy * math.cos(h)
        out.append((lon, lat))
    return out


def facts(trace, aid):
    """Everything mechanical we can say about one challenger, exactly."""
    A = trace['ticks']['actors']
    ts = trace['ticks']['t']
    o = A.get(aid)
    if not o:
        return None
    sp = [(t, v) for t, v, p in zip(ts, o['speedMps'], o['present']) if p]
    speeds = [v for _, v in sp]
    peak_decel = windowed_decel(sp)
    off = ego_frame_offsets(trace, aid)
    lats = [p[1] for p in off if p]
    lons = [p[0] for p in off if p]
    # incursion: comes within INCURSION_LATERAL_M of the ego's own path line, having started outside it
    in_lane = [abs(l) <= INCURSION_LATERAL_M for l in lats]
    started_outside = bool(lats) and abs(lats[0]) > INCURSION_LATERAL_M
    entered = started_outside and any(in_lane)
    t_enter = None
    if entered:
        for (t, p) in zip([t for t, p in zip(ts, off) if p], [p for p in off if p]):
            if abs(p[1]) <= INCURSION_LATERAL_M:
                t_enter = t
                break
    # relative heading to the ego, averaged over the ticks both are present: ~180 deg is oncoming
    A2 = trace['ticks']['actors']
    e2 = A2.get('ego')
    rels = []
    for i in range(len(ts)):
        if e2 and e2['present'][i] and o['present'][i]:
            d = o['headingRad'][i] - e2['headingRad'][i]
            rels.append(abs(math.degrees(math.atan2(math.sin(d), math.cos(d)))))
    rel_heading = sum(rels) / len(rels) if rels else None

    lanes = {l for l, p in zip(o['laneRsl'], o['present']) if p and l}
    hd_change = 0.0
    hs = [h for h, p in zip(o['headingRad'], o['present']) if p]
    if len(hs) > 1:
        d = hs[-1] - hs[0]
        hd_change = abs(math.degrees(math.atan2(math.sin(d), math.cos(d))))
    return {
        'actor': aid,
        'kind': trace['header'].get('actorMetadata', {}).get(aid, {}).get('kind'),
        'moves': bool(speeds) and max(speeds) >= MOVES_MPS,
        'maxSpeedMps': round(max(speeds), 2) if speeds else 0.0,
        'minSpeedMps': round(min(speeds), 2) if speeds else 0.0,
        'stops': bool(speeds) and min(speeds) <= STOPS_MPS,
        'peakDecelMps2': round(peak_decel, 2),
        'brakesHard': peak_decel >= HARD_DECEL_MPS2,
        'lateralRangeM': round(max(lats) - min(lats), 2) if lats else None,
        'startLateralM': round(lats[0], 2) if lats else None,
        'minAbsLateralM': round(min(abs(l) for l in lats), 2) if lats else None,
        'entersEgoPath': entered,
        'tEntersEgoPath': t_enter,
        'changesLane': len(lanes) > 1,
        'relHeadingDeg': None if rel_heading is None else round(rel_heading, 1),
        'headingChangeDeg': round(hd_change, 1),
        'startLonM': round(lons[0], 2) if lons else None,
        'aheadAtStart': bool(lons) and lons[0] > 0,
        'coTravelFrac': (round(sum(1 for p in off if p and abs(p[0]) <= 25.0) / max(len(ts), 1), 3)),
    }


def all_facts(trace):
    return [facts(trace, a) for a in trace['ticks']['actors'] if a != 'ego']


def ego_facts(trace):
    A = trace['ticks']['actors']
    ts = trace['ticks']['t']
    e = A.get('ego')
    sp = [(t, v) for t, v, p in zip(ts, e['speedMps'], e['present']) if p]
    speeds = [v for _, v in sp]
    peak = windowed_decel(sp)
    return {'maxSpeedMps': round(max(speeds), 2) if speeds else 0.0,
            'minSpeedMps': round(min(speeds), 2) if speeds else 0.0,
            'peakDecelMps2': round(peak, 2),
            'stops': bool(speeds) and min(speeds) <= STOPS_MPS}


# ---------------------------------------------------------------- lane incursion, corrected
# The first implementation computed the challenger's lateral offset from the EGO'S OWN PATH with no
# longitudinal gate. A body 100 m off to the side scores lat = 100; the ego then turns, the projection
# collapses, and it was scored as "entered my lane". Independently measured precision 0.375, firing
# 253 times when nothing entered anything (false positives with start-lateral 102.57 m, -67.64 m,
# -40.26 m, on bodies the engine says moved 0.16-0.67 m sideways).
#
# The engine already publishes the right quantity: ticks.actors[aid].lateralOffsetM, its own
# lane-relative offset. Use it, and require the body to be longitudinally NEAR the ego at the time.
INCURSION_OUT_M = 2.25      # clearly outside a ~3.5 m lane (half width 1.75 + margin)
INCURSION_IN_M = 1.25       # clearly inside one
INCURSION_LON_M = 30.0      # and it has to happen near the ego to be an incursion into ITS lane


def lane_incursion(trace, aid):
    """Did `aid` move from outside the ego's lane to inside it, WHILE LONGITUDINALLY NEAR the ego?

    Two sources disagree and each is blind in a different place, so both are used:
      * the ego-frame geometric offset works for every actor, but without a longitudinal gate a body
        100 m off to the side scores as "entering" the moment the ego turns and the projection
        collapses (measured precision 0.375, 253 spurious firings);
      * the engine's own `lateralOffsetM` is exact for lane-bound actors, but is identically ~0 for
        `relative_to`/route-bound actors such as a polyline-routed pedestrian, because it is measured
        against that actor's own path. On the gold dart-out it reads 0.00-0.06 m throughout, so used
        alone it would reject a textbook incursion.

    So: the geometric test decides, gated longitudinally; `lateralOffsetM` is consulted only to
    corroborate when it actually varies. Returns None when neither can speak.
    """
    A = trace['ticks']['actors']
    e, o = A.get('ego'), A.get(aid)
    if not e or not o:
        return None
    off = ego_frame_offsets(trace, aid)
    lat_series = [v for v in (o.get('lateralOffsetM') or []) if v is not None]
    engine_informative = bool(lat_series) and (max(map(abs, lat_series)) >= INCURSION_OUT_M)

    was_out, entered, seen = False, False, False
    for i, p in enumerate(off):
        if p is None:
            continue
        lon, lat = p
        if abs(lon) > INCURSION_LON_M:      # too far ahead/behind for this to be OUR lane
            continue
        seen = True
        if abs(lat) >= INCURSION_OUT_M:
            was_out = True
        elif abs(lat) <= INCURSION_IN_M and was_out:
            entered = True

    if engine_informative:
        eng_out, eng_in = False, False
        for i in range(len(trace['ticks']['t'])):
            if not (e['present'][i] and o['present'][i]):
                continue
            v = o['lateralOffsetM'][i]
            if v is None:
                continue
            if abs(v) >= INCURSION_OUT_M:
                eng_out = True
            elif abs(v) <= INCURSION_IN_M and eng_out:
                eng_in = True
        return bool(entered and eng_in)
    return entered if seen else None
