"""Evaluate a brief-spec against deterministic trajectory facts, WITH AN ABSTAIN BAND.

The spec comes from `briefspec.py` (text only). The facts come from `mechfacts.py` (trace only).
Neither has seen a picture, so this arm of the ground truth cannot fail in the same way the
critic does.

Every predicate returns True / False / None, and None is used deliberately: each numeric test has
a decisive-TRUE threshold, a decisive-FALSE threshold, and a band between them where the
trajectory honestly does not settle the question. Pairs that land in the band are handed to the
vision arm and to manual adjudication rather than being forced.

The FALSE thresholds are set well clear of the TRUE ones because a wrong FALSE would invent a
false positive against the critic that is really my own measurement error.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

COMPAT = {
    'pedestrian': {'pedestrian', 'pedestrian_or_object'},
    'animal':     {'animal', 'pedestrian_or_object'},
    'object':     {'object', 'pedestrian_or_object', 'small'},
    'cyclist':    {'cyclist', 'motorcycle'},
    'motorcycle': {'motorcycle', 'cyclist'},
    'car':        {'car', 'van', 'truck', 'bus'},
    'van':        {'van', 'car', 'truck'},
    'truck':      {'truck', 'bus', 'van', 'car'},
    'bus':        {'bus', 'truck'},
}
STRICT = {k: {k} for k in COMPAT}
STRICT['car'] = {'car', 'van'}

CORRIDOR_HALF_W = 1.75
T = {   # (decisive TRUE at/beyond, decisive FALSE at/beyond, direction)
    'entryExcursion':   (2.80, 1.50),      # m outside corridor before entering it
    'insideMargin':     (0.00, 1.00),      # m by which minLat exceeds the corridor edge -> never in
    'decel':            (2.00, 1.00),      # m/s^2 over 0.30 s
    'pathSep':          (0.50, 2.00),      # m, timing removed
    'aheadFrac':        (0.60, 0.30),
    'turnDeg':          (45.0, 20.0),
}


def _cands(facts, cls, table, include_props=True):
    allow = table.get(cls, {cls})
    out = [a for a in facts.get('actors', {}).values()
           if a.get('class') in allow or a.get('geomClass') in allow]
    if include_props:
        out += [p for p in facts.get('props', []) if p.get('class') in allow]
    return out


def _tri(hits_true, hits_false, n, why_t, why_f):
    """True if anything decisively satisfies; False only if EVERYTHING decisively fails."""
    if hits_true:
        return True, f'{why_t}: {hits_true}'
    if n and len(hits_false) == n:
        return False, f'{why_f}'
    return None, f'borderline ({len(hits_false)}/{n} decisively fail, none decisively pass)'


def evaluate_predicate(pred, facts, table=COMPAT):
    name = pred[0]
    cls = pred[1] if len(pred) > 1 else None
    occ = pred[2] if len(pred) > 2 else None
    acts = _cands(facts, cls, table)
    live = [a for a in acts if a.get('coPresentTicks', 0) > 0 or a.get('isStatic')]

    if name == 'PRESENT':
        if live:
            return True, f"{[a['id'] for a in live]} present"
        have = sorted({a['class'] for a in facts.get('actors', {}).values()}) + \
               sorted('prop:' + p['class'] for p in facts.get('props', []))
        return False, f'no {cls}; clip contains {have}'

    if not live:
        return False, f'no actor or prop of class {cls} at all'

    def num(getter, key, higher_is_true=True):
        tt, ff = T[key]
        ht, hf = [], []
        for a in live:
            v = getter(a)
            if v is None:
                continue
            if (v >= tt) if higher_is_true else (v <= tt):
                ht.append(f"{a['id']}={v}")
            elif (v <= ff) if higher_is_true else (v >= ff):
                hf.append(f"{a['id']}={v}")
        return _tri(ht, hf, len(live), f'{key}>={tt}' if higher_is_true else f'{key}<={tt}',
                    f'all {cls} fail {key}: ' + '; '.join(f"{a['id']}({_summ(a)})" for a in live))

    if name == 'ENTERS_EGO_PATH':
        tt, ff = T['entryExcursion']
        ht, hf = [], []
        for a in live:
            if a.get('isStatic'):
                hf.append(f"{a['id']}=static-prop"); continue
            exc = a.get('entryExcursionM')
            minlat = a.get('minLateralOffsetFromEgoPathM')
            halfw = CORRIDOR_HALF_W + (a.get('dims') or [0, 0.6])[1] / 2.0
            if exc is not None and exc >= tt:
                ht.append(f"{a['id']} entered from {exc} m out at t={a.get('tEntersCorridor')}")
            elif minlat is not None and minlat > halfw + T['insideMargin'][1]:
                hf.append(f"{a['id']} never inside (minLat={minlat} vs corridor {halfw:.2f})")
            elif exc is not None and exc <= ff:
                hf.append(f"{a['id']} was already inside (excursion only {exc} m)")
        return _tri(ht, hf, len(live), 'enters ego corridor from outside',
                    'no ' + str(cls) + ' enters: ' + '; '.join(hf))

    if name == 'CROSSES_EGO_PATH':
        return num(lambda a: a.get('pathSeparationOBBM'), 'pathSep', higher_is_true=False)
    if name == 'AHEAD_OF_EGO':
        return num(lambda a: a.get('fracTimeAheadOfEgo'), 'aheadFrac')
    if name == 'BEHIND_EGO':
        return num(lambda a: (None if a.get('fracTimeBehindEgo') is None
                              else a.get('fracTimeBehindEgo')), 'aheadFrac')
    if name == 'TURNS':
        return num(lambda a: (None if a.get('netHeadingChangeDeg') is None
                              else abs(a['netHeadingChangeDeg'])), 'turnDeg')
    if name == 'DECELERATES_HARD':
        ht, hf = [], []
        for a in live:
            d = a.get('peakDecelSmoothMps2')
            vm = a.get('maxSpeedMps') or 0.0
            if d is None:
                continue
            if d >= T['decel'][0] and vm >= 3.0:
                ht.append(f"{a['id']} decel={d} vmax={vm}")
            elif d <= T['decel'][1] or vm < 1.0:
                hf.append(f"{a['id']} decel={d} vmax={vm}")
        return _tri(ht, hf, len(live), 'decelerates hard having been moving',
                    'no ' + str(cls) + ' decelerates: ' + '; '.join(hf))
    if name == 'ONCOMING':
        ht = [a['id'] for a in live if a.get('geometry') == 'oncoming']
        hf = [a['id'] for a in live if a.get('geometry') == 'same-direction']
        return _tri(ht, hf, len(live), 'oncoming geometry', 'none oncoming (all same-direction)')
    if name == 'STARTS_STATIONARY_THEN_MOVES':
        ht = [a['id'] for a in live if a.get('stationaryThenMoves') is True]
        hf = [a['id'] for a in live if a.get('isStatic') or (a.get('maxSpeedMps') or 0) < 0.5]
        return _tri(ht, hf, len(live), 'starts stopped then moves off', 'none moves off from rest')
    if name == 'MOVES_THEN_STOPS':
        ht = [a['id'] for a in live if a.get('movesThenStops') is True]
        hf = [a['id'] for a in live if a.get('isStatic')]
        return _tri(ht, hf, len(live), 'moves then comes to rest', 'none')
    if name == 'OCCLUDED_BY':
        allow = table.get(occ, {occ}) if occ else None
        ht, hf = [], []
        for a in live:
            got = False
            for h in (a.get('occludedByAtSomeTime') or []):
                oid = h['id']
                oa = facts['actors'].get(oid)
                ocl = oa['class'] if oa else next(
                    (p['class'] for p in facts['props'] if p['id'] == oid), None)
                if allow is None or ocl in allow:
                    got = True
                    ht.append(f"{a['id']} occluded by {oid} for {h['nSamples']} samples")
            if not got:
                hf.append(f"{a['id']} never occluded by a {occ}")
        return _tri(ht, hf, len(live), 'occluder between ego and hazard', '; '.join(hf))
    return None, f'unknown predicate {name}'


def _summ(a):
    return (f"vmax={a.get('maxSpeedMps')} decel={a.get('peakDecelSmoothMps2')} "
            f"geom={a.get('geometry')} minLat={a.get('minLateralOffsetFromEgoPathM')} "
            f"entryExc={a.get('entryExcursionM')} pathSep={a.get('pathSeparationOBBM')} "
            f"ahead={a.get('fracTimeAheadOfEgo')} turn={a.get('netHeadingChangeDeg')}")


def evaluate(spec, facts, table=COMPAT):
    core, sec = [], []
    for p in spec.get('core', []):
        v, why = evaluate_predicate(p, facts, table)
        core.append({'pred': p, 'value': v, 'why': why})
    for p in spec.get('secondary', []):
        v, why = evaluate_predicate(p, facts, table)
        sec.append({'pred': p, 'value': v, 'why': why})
    vals = [c['value'] for c in core]
    if not vals:
        verdict = 'undecidable'
    elif any(v is False for v in vals):
        verdict = 'absent'
    elif all(v is True for v in vals):
        verdict = 'present'
    else:
        verdict = 'undecidable'
    return {'verdict': verdict, 'core': core, 'secondary': sec,
            'nCoreFalse': sum(1 for v in vals if v is False),
            'nCoreTrue': sum(1 for v in vals if v is True),
            'nCoreNone': sum(1 for v in vals if v is None)}
