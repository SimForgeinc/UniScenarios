"""The frozen admission gate (pre-registered sha256 1a08698e95fca4bc), computed from RAW traces.

C1 ego actually drives:        maxSpeedMps >= 2.0 AND distanceTravelledM >= 10.0
C2 not a spawn artifact:       closest approach at t > warmupSeconds + 0.5
C3 genuine proximity:          TRUE oriented-bounding-box clearance <= 5.0 m
C4 genuine demand:             requiredDecelMax(ego) >= 1.5 OR minTTC <= 3.0
C5 evaluate:                   verdict=accept AND band=critical AND 0 collisions AND no never-fired trigger
cells:                         >= 2 maps AND >= 3 distinct sites

NEVER loosened. `minDistance` from the engine is a circumscribed-circle proxy and is not used here.
"""
import gzip, json, math

C1_SPEED, C1_DIST = 2.0, 10.0
C2_MARGIN = 0.5
C3_CLEARANCE = 5.0
C4_DECEL, C4_TTC = 1.5, 3.0
MIN_MAPS, MIN_SITES = 2, 3


def _corners(x, y, hd, l, w):
    c, s = math.cos(hd), math.sin(hd)
    hl, hw = l / 2.0, w / 2.0
    return [(x + c * dx - s * dy, y + s * dx + c * dy)
            for dx, dy in ((hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw))]


def _seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx - ax, by - ay
    d2 = dx * dx + dy * dy
    t = 0.0 if d2 < 1e-12 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / d2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _sat_overlap(A, B):
    """True if two convex polygons overlap (separating-axis test)."""
    for poly in (A, B):
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
            ax, ay = -(y2 - y1), (x2 - x1)
            pa = [ax * px + ay * py for px, py in A]
            pb = [ax * px + ay * py for px, py in B]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


def obb_clearance(A, B):
    """Exact clearance between two convex polygons; 0.0 when they overlap."""
    if _sat_overlap(A, B):
        return 0.0
    best = float('inf')
    for P, Q in ((A, B), (B, A)):
        n = len(Q)
        for p in P:
            for i in range(n):
                d = _seg_dist(p, Q[i], Q[(i + 1) % n])
                if d < best:
                    best = d
    return best


def load_trace(path):
    with gzip.open(path) as f:
        return json.loads(f.read())


def trace_facts(trace):
    """Everything the gate needs, read from the raw trace. Never prints or returns bulk arrays."""
    hdr = trace['header']
    ticks = trace['ticks']
    ts = ticks['t']
    dt = hdr.get('dt', 0.02)
    warmup = hdr.get('warmupSeconds', 0.0)
    meta = hdr.get('actorMetadata', {})
    ego = ticks['actors'].get('ego')
    if ego is None:
        return {'error': 'no ego in trace'}

    # C1 -- ego really drives
    speeds = [v for v, pr in zip(ego['speedMps'], ego['present']) if pr]
    max_speed = max(speeds) if speeds else 0.0
    dist = 0.0
    px = py = None
    for x, y, pr in zip(ego['x'], ego['y'], ego['present']):
        if not pr:
            px = py = None
            continue
        if px is not None:
            dist += math.hypot(x - px, y - py)
        px, py = x, y

    # C2/C3 -- true OBB closest approach against every non-ego actor
    ed = meta.get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)
    er = math.hypot(el, ew) / 2.0
    best = {'clearanceM': float('inf'), 't': None, 'with': None}
    per_challenger = {}
    for aid, a in ticks['actors'].items():
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        al, aw = d.get('l', 0.6), d.get('w', 0.6)
        ar = math.hypot(al, aw) / 2.0
        cut = er + ar + C3_CLEARANCE + 1.0
        loc = {'clearanceM': float('inf'), 't': None}
        for i in range(len(ts)):
            if not (ego['present'][i] and a['present'][i]):
                continue
            gap = math.hypot(ego['x'][i] - a['x'][i], ego['y'][i] - a['y'][i])
            if gap > cut and loc['clearanceM'] < float('inf'):
                continue
            cl = obb_clearance(
                _corners(ego['x'][i], ego['y'][i], ego['headingRad'][i], el, ew),
                _corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw))
            if cl < loc['clearanceM']:
                loc = {'clearanceM': cl, 't': ts[i]}
        per_challenger[aid] = loc
        if loc['clearanceM'] < best['clearanceM']:
            best = {'clearanceM': loc['clearanceM'], 't': loc['t'], 'with': aid}

    m = trace.get('metrics', {})
    min_ttc = (m.get('minTTC') or {}).get('value')
    decel = (m.get('requiredDecelMax') or {}).get('ego', 0.0)
    return {
        'maxSpeedMps': round(max_speed, 3),
        'distanceTravelledM': round(dist, 3),
        'warmupSeconds': warmup,
        'clearanceM': None if best['clearanceM'] == float('inf') else round(best['clearanceM'], 3),
        'closestT': best['t'],
        'closestWith': best['with'],
        'perChallenger': {k: {'clearanceM': None if v['clearanceM'] == float('inf') else round(v['clearanceM'], 3),
                              't': v['t']} for k, v in per_challenger.items()},
        'minTTC': min_ttc,
        'requiredDecelMaxEgo': round(decel or 0.0, 3),
        'collisions': len(m.get('collisions') or []),
        'triggerNeverFired': list(m.get('triggerNeverFired') or []),
        'clipSeconds': hdr.get('clipSeconds'),
        'dt': dt,
    }


def gate_cell(trace_path, verdict=None, band=None):
    """Gate one cell. `verdict`/`band` come from the batch summary's own `evaluate` pass."""
    trace = load_trace(trace_path)
    f = trace_facts(trace)
    if 'error' in f:
        return {'pass': False, 'error': f['error']}
    c1 = f['maxSpeedMps'] >= C1_SPEED and f['distanceTravelledM'] >= C1_DIST
    c2 = f['closestT'] is not None and f['closestT'] > f['warmupSeconds'] + C2_MARGIN
    c3 = f['clearanceM'] is not None and f['clearanceM'] <= C3_CLEARANCE
    c4 = (f['requiredDecelMaxEgo'] >= C4_DECEL) or (f['minTTC'] is not None and f['minTTC'] <= C4_TTC)
    c5 = (verdict == 'accept' and band == 'critical'
          and f['collisions'] == 0 and not f['triggerNeverFired'])
    f.update({'C1': c1, 'C2': c2, 'C3': c3, 'C4': c4, 'C5': c5,
              'pass': bool(c1 and c2 and c3 and c4 and c5),
              'verdict': verdict, 'band': band})
    f.update(quality(trace, f))
    f['passHQ'] = bool(f['pass'] and f['highQuality'])
    return f


def gate_batch(summary_path):
    """Gate a whole `uniscenarios batch` summary. Returns per-cell gates plus the cell-spread rule."""
    s = json.load(open(summary_path))
    cells = []
    for r in s.get('results', []):
        tf = r.get('traceFile')
        if r.get('status') != 'ok' or not tf:
            # the actionable part is r['error'].code / .reason / .detail.reason -- e.g.
            # `arrival_unconverged`. Dropping it leaves the author with nothing to repair.
            e = r.get('error') or {}
            cells.append({'mapId': r.get('mapId'), 'siteId': r.get('siteId'), 'pass': False,
                          'error': e.get('code') or r.get('status') or 'no trace',
                          'errorReason': e.get('reason'),
                          'errorDetail': (e.get('detail') or {}).get('reason'),
                          'errorPath': e.get('path'),
                          'band': r.get('band')})
            continue
        g = gate_cell(tf, r.get('verdict'), r.get('band'))
        g.update({'mapId': r['mapId'], 'siteId': r['siteId'], 'drawIndex': r.get('drawIndex'),
                  'traceFile': tf, 'instanceFile': r.get('instanceFile')})
        cells.append(g)
    ok = [c for c in cells if c.get('pass')]
    hq = [c for c in cells if c.get('passHQ')]
    maps = {c['mapId'] for c in ok}
    sites = {(c['mapId'], c['siteId']) for c in ok}
    hmaps = {c['mapId'] for c in hq}
    hsites = {(c['mapId'], c['siteId']) for c in hq}
    errs = {}
    for c in cells:
        if c.get('error'):
            errs[c['error']] = errs.get(c['error'], 0) + 1
    return {
        'admitted': len(maps) >= MIN_MAPS and len(sites) >= MIN_SITES,
        'admittedHQ': len(hmaps) >= MIN_MAPS and len(hsites) >= MIN_SITES,
        'passingCells': len(ok), 'passingCellsHQ': len(hq), 'totalCells': len(cells),
        'maps': sorted(maps), 'nMaps': len(maps), 'nSites': len(sites),
        'nMapsHQ': len(hmaps), 'nSitesHQ': len(hsites),
        'cells': cells,
        'errorCounts': errs,
        'lossCounts': {k: sum(1 for c in cells if c.get(k) is False) for k in ('C1', 'C2', 'C3', 'C4', 'C5')},
        'qualityLoss': {k: sum(1 for c in cells if c.get(k) is False)
                        for k in ('Q1_jointChallenger', 'Q2_egoReallyResponded', 'Q3_noPropOverlap',
                                  'Q4_headingSane', 'Q5_notClipped', 'Q6_ttcPairIsEgo',
                                  'Q7_contestedSpace')},
    }


# ---------------------------------------------------------------- quality layer
# The frozen gate C1..C5 above is physics-only and is left EXACTLY as pre-registered so the
# head-to-head with the blind lane stays comparable. The checks below are ADDITIONAL (tightening
# is permitted, loosening is not). They close the holes found by the independent audit:
#   Q1 joint attribution  -- C2/C3 must be won by the SAME challenger, not by different ones
#   Q2 real ego response  -- measured from the ego speed trace, not taken from a metrics field
#   Q3 no phantom driving -- the ego must not pass through a prop (props are collidable:false
#                            and absent from ticks['actors'], so nothing else checks this)
#   Q4 heading sanity     -- headingRad must agree with atan2(vy,vx); a mirrored box renders
#                            plausibly and would make a SEEING author repair a phantom fault
#   Q5 not clipped        -- metrics.clippedCriticality must be false
#   Q6 the pair is the ego -- minTTC must actually involve the ego

Q_RESPONSE_DECEL = 1.0      # m/s^2 actually observed in the ego speed trace
Q_RESPONSE_DROP = 1.5       # m/s of speed actually given up


def ego_response(trace):
    """What the ego ACTUALLY did, from its own speed trace."""
    ego = trace['ticks']['actors'].get('ego')
    ts = trace['ticks']['t']
    if not ego:
        return {'peakDecelMps2': 0.0, 'speedDropMps': 0.0, 'headingErrRad': None}
    sp = [(t, v) for t, v, p in zip(ts, ego['speedMps'], ego['present']) if p]
    peak = 0.0
    for (t0, v0), (t1, v1) in zip(sp, sp[1:]):
        if t1 > t0:
            peak = max(peak, (v0 - v1) / (t1 - t0))
    drop = (max(v for _, v in sp) - min(v for _, v in sp)) if sp else 0.0
    # heading vs actual direction of travel, at the fastest moving tick
    herr = None
    best_i, best_v = None, 0.0
    for i in range(len(ts) - 1):
        if ego['present'][i] and ego['present'][i + 1] and ego['speedMps'][i] > best_v:
            best_v, best_i = ego['speedMps'][i], i
    if best_i is not None and best_v > 1.0:
        vx = ego['x'][best_i + 1] - ego['x'][best_i]
        vy = ego['y'][best_i + 1] - ego['y'][best_i]
        if math.hypot(vx, vy) > 1e-6:
            d = ego['headingRad'][best_i] - math.atan2(vy, vx)
            herr = abs(math.atan2(math.sin(d), math.cos(d)))
    return {'peakDecelMps2': round(peak, 3), 'speedDropMps': round(drop, 3),
            'headingErrRad': None if herr is None else round(herr, 4)}


def prop_clearance(trace):
    """Closest approach between the ego footprint and any prop footprint. None if no props."""
    hdr = trace['header']
    props = hdr.get('propMetadata') or {}
    ego = trace['ticks']['actors'].get('ego')
    if not props or not ego:
        return None
    ed = hdr.get('actorMetadata', {}).get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)
    best = float('inf')
    boxes = []
    for pid, pm in props.items():
        p, d = pm.get('pose', {}), pm.get('dims', {})
        boxes.append((pid, _corners(p.get('x', 0.0), -p.get('z', 0.0), p.get('headingRad', 0.0),
                                    d.get('l', 4.5), d.get('w', 1.9))))
    worst = None
    for i in range(len(trace['ticks']['t'])):
        if not ego['present'][i]:
            continue
        ec = _corners(ego['x'][i], ego['y'][i], ego['headingRad'][i], el, ew)
        for pid, pc in boxes:
            c = obb_clearance(ec, pc)
            if c < best:
                best, worst = c, pid
    return {'minPropClearanceM': round(best, 3), 'prop': worst}


def quality(trace, facts):
    """The additional checks. Returns dict of booleans plus the measurements behind them."""
    resp = ego_response(trace)
    pc = prop_clearance(trace)
    m = trace.get('metrics', {})
    warm = facts['warmupSeconds']

    # Q1: one challenger must win BOTH C2 and C3
    joint = None
    for aid, v in facts['perChallenger'].items():
        if v['clearanceM'] is not None and v['clearanceM'] <= C3_CLEARANCE \
                and v['t'] is not None and v['t'] > warm + C2_MARGIN:
            if joint is None or v['clearanceM'] < facts['perChallenger'][joint]['clearanceM']:
                joint = aid
    q1 = joint is not None

    q2 = (resp['peakDecelMps2'] >= Q_RESPONSE_DECEL and resp['speedDropMps'] >= Q_RESPONSE_DROP)
    q3 = pc is None or pc['minPropClearanceM'] > 0.0
    q4 = resp['headingErrRad'] is None or resp['headingErrRad'] < 0.05
    q5 = not m.get('clippedCriticality', False)
    pair = (m.get('minTTC') or {}).get('pair') or []
    q6 = ('ego' in pair) if pair else False

    ce = contested_space(trace, joint)          # raises if the measure is unavailable
    q7 = bool(ce.get('contested'))

    return {'Q7_contestedSpace': q7,
            'pathSeparationM': (ce or {}).get('pathSeparationM'),
            'encroachmentGapS': (ce or {}).get('encroachmentGapS'),
            'Q1_jointChallenger': q1, 'Q1_challenger': joint,
            'Q2_egoReallyResponded': q2, 'Q3_noPropOverlap': q3, 'Q4_headingSane': q4,
            'Q5_notClipped': q5, 'Q6_ttcPairIsEgo': q6,
            'egoPeakDecelMps2': resp['peakDecelMps2'], 'egoSpeedDropMps': resp['speedDropMps'],
            'egoHeadingErrRad': resp['headingErrRad'], 'propClearance': pc,
            'highQuality': bool(q1 and q2 and q3 and q4 and q5 and q6 and q7),
            # diagnostic only: C2 measured from the START OF RECORDING rather than from
            # warmup+0.5, because trace t=0 is ALREADY post-warm-up and the frozen clause
            # therefore demands 2*warmup+0.5 s after spawn
            'C2_spawnOnly': facts['closestT'] is not None and facts['closestT'] > C2_MARGIN}


# Q7 -- the paths must actually contest the same ground.
# Measured by the independent evaluation lane: 9 of 57 frozen-gate-admitted cells had an ego and a
# challenger whose paths NEVER overlapped, even with timing removed. Such a cell cannot be an edge
# case under any rubric, because nothing was ever contested. Uses judge/conflict.py, whose
# pathSeparationM is the min true-OBB clearance over ALL PAIRS of tick indices (time decoupled).
def contested_space(trace, challenger=None):
    """FAILS CLOSED. An earlier version swallowed ImportError and returned None, and quality()
    mapped None -> Q7 True, so running from a cwd where `judge.conflict` was not importable silently
    disabled the clause and INFLATED the HQ rate with no error and no log line. A quality clause that
    quietly turns itself off is worse than no clause, because it looks like it ran."""
    import sys, os as _os
    here = _os.path.dirname(_os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    from judge.conflict import conflict_event      # deliberately unguarded: must raise, not vanish
    return conflict_event(trace, challenger=challenger)
