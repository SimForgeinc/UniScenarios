"""Deterministic rollout features for the independent quality judge.

Everything here is computed FROM THE RAW TRACE. Nothing is read from `metrics` except where
explicitly labelled `engine_*`, and nothing labelled `engine_*` is allowed to decide anything.
This module is the judge's ground truth: the LLM's claims are checked against it, not the
other way round.

Frame convention (verified, see judge/GATE-AUDIT.md section 6):
  instance pose : (x, z)  with  y = -z
  headingRad    : ALREADY in the (x, y) frame in BOTH instance and trace. Never negate it.
"""
import gzip, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gate as G

DEV_ASSETS_DEFAULT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))), 'dev-assets')


def load_trace(path):
    with gzip.open(path) as f:
        return json.loads(f.read())


def _corners(x, y, hd, l, w):
    return G._corners(x, y, hd, l, w)


def actor_boxes(trace, i):
    """OBB corners for every present actor and every prop at tick index i."""
    out = {}
    meta = trace['header'].get('actorMetadata', {})
    for aid, a in trace['ticks']['actors'].items():
        if not a['present'][i]:
            continue
        d = meta.get(aid, {}).get('dims')
        if d is None:
            raise ValueError(f'actorMetadata.{aid}.dims missing; refusing to guess a footprint')
        out[aid] = {'kind': meta[aid].get('kind', 'car'), 'x': a['x'][i], 'y': a['y'][i],
                    'hd': a['headingRad'][i], 'l': d['l'], 'w': d['w'],
                    'v': a['speedMps'][i], 'prop': False,
                    'corners': _corners(a['x'][i], a['y'][i], a['headingRad'][i], d['l'], d['w'])}
    for pid, p in (trace['header'].get('propMetadata') or {}).items():
        x, y, hd = p['pose']['x'], -p['pose']['z'], p['pose']['headingRad']
        d = p['dims']
        out[pid] = {'kind': 'prop', 'x': x, 'y': y, 'hd': hd, 'l': d['l'], 'w': d['w'],
                    'v': 0.0, 'prop': True, 'collidable': p.get('collidable'),
                    'corners': _corners(x, y, hd, d['l'], d['w'])}
    return out


def _clearance_series(trace, aid, stride=1):
    ts = trace['ticks']['t']
    e = trace['ticks']['actors']['ego']
    a = trace['ticks']['actors'][aid]
    md = trace['header']['actorMetadata']
    el, ew = md['ego']['dims']['l'], md['ego']['dims']['w']
    al, aw = md[aid]['dims']['l'], md[aid]['dims']['w']
    out = []
    for i in range(0, len(ts), stride):
        if not (e['present'][i] and a['present'][i]):
            out.append((ts[i], None)); continue
        out.append((ts[i], G.obb_clearance(
            _corners(e['x'][i], e['y'][i], e['headingRad'][i], el, ew),
            _corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw))))
    return out


def prop_clearance(trace):
    """Ego-vs-prop OBB clearance. The gate never computes this; props are collidable:false
    and absent from ticks['actors'], so the ego can drive straight through one (GATE-AUDIT A7)."""
    pm = trace['header'].get('propMetadata') or {}
    if not pm:
        return {}
    e = trace['ticks']['actors']['ego']; ts = trace['ticks']['t']
    ed = trace['header']['actorMetadata']['ego']['dims']
    out = {}
    for pid, p in pm.items():
        Pc = _corners(p['pose']['x'], -p['pose']['z'], p['pose']['headingRad'],
                      p['dims']['l'], p['dims']['w'])
        best = (float('inf'), None)
        for i in range(len(ts)):
            if not e['present'][i]:
                continue
            c = G.obb_clearance(_corners(e['x'][i], e['y'][i], e['headingRad'][i], ed['l'], ed['w']), Pc)
            if c < best[0]:
                best = (c, ts[i])
        out[pid] = {'minClearanceM': round(best[0], 3), 't': best[1],
                    'collidable': p.get('collidable')}
    return out


def ego_control_effort(trace):
    """The RHAE analogue: how much control authority did the ego actually have to spend?

    All measured from the trajectory (speedMps, headingRad), never from `metrics`, because
    `metrics.requiredDecelMax` is a counterfactual and can be non-zero for an ego that never
    moves a control (GATE-AUDIT A6 / probe P6).
    """
    ts = trace['ticks']['t']; dt = trace['header'].get('dt', 0.02)
    e = trace['ticks']['actors']['ego']
    v = e['speedMps']; hd = e['headingRad']
    n = len(ts)
    acc, yaw = [], []
    for i in range(n - 1):
        if not (e['present'][i] and e['present'][i + 1]):
            acc.append(0.0); yaw.append(0.0); continue
        acc.append((v[i + 1] - v[i]) / dt)
        dh = (hd[i + 1] - hd[i] + math.pi) % (2 * math.pi) - math.pi
        yaw.append(dh / dt)
    peak_decel = max([-a for a in acc] or [0.0])
    peak_accel = max(acc or [0.0])
    # lateral acceleration = v * yawrate; a real avoidance swerve shows up here
    lat = [abs(yaw[i]) * v[i] for i in range(len(yaw))]
    peak_lat = max(lat or [0.0])
    # speed range actually used
    vs = [v[i] for i in range(n) if e['present'][i]]
    # "interventions": maximal runs where |accel| > 1.0 m/s^2 or |lat| > 1.0 m/s^2, >= 0.2 s long
    def runs(sig, thr, minlen):
        out, cur = [], 0
        for s in sig:
            if abs(s) > thr:
                cur += 1
            else:
                if cur * dt >= minlen: out.append(cur * dt)
                cur = 0
        if cur * dt >= minlen: out.append(cur * dt)
        return out
    brake_eps = runs([a for a in acc], 1.0, 0.2)
    steer_eps = runs(lat, 1.0, 0.2)
    # time spent under meaningful braking
    brake_time = sum(dt for a in acc if a < -1.0)
    return {
        'peakDecelObservedMps2': round(peak_decel, 3),
        'peakAccelObservedMps2': round(peak_accel, 3),
        'peakLatAccelObservedMps2': round(peak_lat, 3),
        'speedMinMps': round(min(vs), 3) if vs else 0.0,
        'speedMaxMps': round(max(vs), 3) if vs else 0.0,
        'speedDropMps': round((max(vs) - min(vs)), 3) if vs else 0.0,
        'brakingEpisodes': len(brake_eps),
        'steeringEpisodes': len(steer_eps),
        'brakingSeconds': round(brake_time, 2),
        'stoppedAtEnd': bool(vs and vs[-1] < 0.5),
        'egoNeverChangedSpeed': bool(vs and (max(vs) - min(vs)) < 0.05),
    }


def rollout_features(trace):
    """Compact, fully-derived description of a rollout. Never returns bulk arrays."""
    hdr = trace['header']; ts = trace['ticks']['t']
    e = trace['ticks']['actors'].get('ego')
    if e is None:
        return {'error': 'no ego'}
    ids = [a for a in trace['ticks']['actors'] if a != 'ego']

    per = {}
    for aid in ids:
        ser = _clearance_series(trace, aid)
        vals = [(t, c) for t, c in ser if c is not None]
        if not vals:
            per[aid] = {'coPresent': False}
            continue
        cmin, tmin = min((c, t) for t, c in vals)
        first_t = vals[0][0]
        # closing-rate at the moment of closest approach, from centre distance
        a = trace['ticks']['actors'][aid]
        i = ts.index(tmin)
        j = max(0, i - 25)
        d1 = math.hypot(e['x'][i] - a['x'][i], e['y'][i] - a['y'][i])
        d0 = math.hypot(e['x'][j] - a['x'][j], e['y'][j] - a['y'][j])
        closing = (d0 - d1) / max(ts[i] - ts[j], 1e-6)
        # heading difference at closest approach -> crossing / head-on / following
        dh = abs((e['headingRad'][i] - a['headingRad'][i] + math.pi) % (2 * math.pi) - math.pi)
        geom = ('following/overtaking' if dh < math.pi / 6 else
                'head-on/oncoming' if dh > 5 * math.pi / 6 else 'crossing')
        av = [a['speedMps'][k] for k in range(len(ts)) if a['present'][k]]
        v_at_min = a['speedMps'][i]
        lane_at_min = a['laneRsl'][i] if 'laneRsl' in a else None
        # continuity: largest single-tick jump while present
        jump = 0.0
        for k in range(len(ts) - 1):
            if a['present'][k] and a['present'][k + 1]:
                jump = max(jump, math.hypot(a['x'][k + 1] - a['x'][k], a['y'][k + 1] - a['y'][k]))
        per[aid] = {
            'kind': hdr['actorMetadata'][aid].get('kind'),
            'tags': hdr['actorMetadata'][aid].get('tags', []),
            'minClearanceM': round(cmin, 3), 'tMinClearance': tmin,
            'clearanceAtFirstCoPresenceM': round(vals[0][1], 3), 'tFirstCoPresence': first_t,
            'closestAtStart': tmin <= first_t + 0.5,
            'closingRateAtMinMps': round(closing, 2),
            'geometry': geom,
            'headingDiffRad': round(dh, 3),
            'speedMinMps': round(min(av), 2) if av else None,
            'speedMaxMps': round(max(av), 2) if av else None,
            'speedAtMinClearanceMps': round(v_at_min, 3),
            'laneAtMinClearance': lane_at_min,
            'presentFrac': round(sum(a['present']) / len(ts), 3),
            'maxTickJumpM': round(jump, 3),
        }

    conflict = None
    cands = [(v['minClearanceM'], k) for k, v in per.items() if 'minClearanceM' in v]
    if cands:
        conflict = min(cands)[1]

    # --- the CONTESTED-SPACE instant, measured rigorously ---
    # RETRACTED v1: an earlier version of this used argmin |lateral bearing offset| subject to the
    # challenger being ahead of the ego. That is a BEARING test, not a path test: it fires whenever the
    # challenger is anywhere on the ego's forward axis, including 16 m away on a piece of road the ego
    # has not reached. It produced a false 'the proximity is not the conflict' flag on 28/28 cells.
    # The correct measure is the space-time footprint minimum in conflict.py: min over ALL tick-index
    # PAIRS (i, j) of clearance(ego_i, challenger_j). See judge/conflict.py for the derivation.
    import conflict as CF
    for aid in list(per):
        if 'minClearanceM' not in per[aid]:
            continue
        try:
            ev = CF.conflict_event(trace, challenger=aid)
        except Exception:                                          # noqa: BLE001
            per[aid]['conflictEvent'] = None
            continue
        per[aid]['conflictEvent'] = None if ev.get('challenger') is None else {
            k: ev[k] for k in ('contested', 'pathSeparationM', 'tCross', 'tChallengerAtCross',
                               'encroachmentGapS', 'whoArrivedFirst', 'clearanceAtCross',
                               'challengerSpeedAtEgoArrival', 'sameEvent', 'lagS', 'geometry')
            if k in ev}

    m = trace.get('metrics', {})
    ctrl = ego_control_effort(trace)
    # ego path
    dist = 0.0; px = py = None
    for x, y, pr in zip(e['x'], e['y'], e['present']):
        if not pr: px = py = None; continue
        if px is not None: dist += math.hypot(x - px, y - py)
        px, py = x, y
    xs = [e['x'][k] for k in range(len(ts)) if e['present'][k]]
    ys = [e['y'][k] for k in range(len(ts)) if e['present'][k]]
    net = math.hypot(xs[-1] - xs[0], ys[-1] - ys[0]) if xs else 0.0

    return {
        'mapId': hdr.get('mapId'), 'clipSeconds': hdr.get('clipSeconds'),
        'warmupSeconds': hdr.get('warmupSeconds'), 'dt': hdr.get('dt'),
        'egoDistanceM': round(dist, 2), 'egoNetDisplacementM': round(net, 2),
        'ego': ctrl,
        'challengers': per,
        'conflictActor': conflict,
        'props': prop_clearance(trace),
        'events': trace.get('events', []),
        'engine_minTTC': (m.get('minTTC') or {}).get('value'),
        'engine_minTTC_pair': (m.get('minTTC') or {}).get('pair'),
        'engine_requiredDecelMaxEgo': (m.get('requiredDecelMax') or {}).get('ego'),
        'engine_collisions': len(m.get('collisions') or []),
        'engine_triggerNeverFired': list(m.get('triggerNeverFired') or []),
        'engine_clippedCriticality': m.get('clippedCriticality'),
        'engine_revealToConflictS': (m.get('revealToConflict') or {}).get('value')
        if m.get('revealToConflict') else None,
        'engine_occluderIneffective': len(m.get('occluderIneffective') or []),
    }


# ---------------------------------------------------------------- difficulty
def difficulty(feat):
    """RHAE analogue: difficulty = the action/intervention budget the ego actually had to spend,
    plus how little margin it ended up with. 0-100. Computed, never asked of the model.

    Deliberately built ONLY from trajectory-derived quantities so that it cannot be inflated by
    `metrics.requiredDecelMax`, which is a counterfactual (GATE-AUDIT A6).
    """
    ego = feat['ego']
    conf = feat['challengers'].get(feat['conflictActor'] or '', {})
    clr = conf.get('minClearanceM')

    def sat(x, lo, hi):
        if x is None: return 0.0
        return max(0.0, min(1.0, (x - lo) / (hi - lo)))

    # 1. longitudinal authority actually spent (0 at 0.5 m/s2, 1 at 6.0 m/s2)
    lon = sat(ego['peakDecelObservedMps2'], 0.5, 6.0)
    # 2. lateral authority actually spent (0 at 0.3, 1 at 4.0 m/s2)
    lat = sat(ego['peakLatAccelObservedMps2'], 0.3, 4.0)
    # 3. how much speed the ego had to give up, relative to what it had
    give = sat(ego['speedDropMps'] / max(ego['speedMaxMps'], 1e-6), 0.05, 0.9)
    # 4. margin left (1 when it ended up at 0 m, 0 at 5 m)
    marg = 1.0 - sat(clr, 0.0, 5.0) if clr is not None else 0.0
    # 5. number of separate interventions (1 is routine, 3+ is a multi-decision scenario)
    nint = sat(ego['brakingEpisodes'] + ego['steeringEpisodes'], 1.0, 4.0)
    # 6. how little warning: reveal-to-conflict, when the scenario declares an occlusion
    r = feat.get('engine_revealToConflictS')
    warn = (1.0 - sat(r, 0.5, 4.0)) if r is not None else 0.0

    score = 100.0 * (0.24 * lon + 0.16 * lat + 0.14 * give + 0.24 * marg +
                     0.12 * nint + 0.10 * warn)
    return {
        'score': round(score, 1),
        'components': {'longitudinalAuthority': round(lon, 3), 'lateralAuthority': round(lat, 3),
                       'speedGivenUp': round(give, 3), 'marginLost': round(marg, 3),
                       'interventionCount': round(nint, 3), 'shortWarning': round(warn, 3)},
        'basis': 'trajectory-derived only; metrics.requiredDecelMax deliberately excluded',
    }
