"""Synthetic-trace adversarial probes against gate.py.

Every probe builds a minimal, fully-specified trace dict in the engine's own on-disk shape and
runs it through gate.trace_facts / gate.gate_cell. No engine, no CLI: these are unit-level
counter-examples, each of which is a claim about the gate that can be checked by reading it.
"""
import math, os, sys, json, gzip, copy
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gate as G

DT = 0.02

def mk_trace(clip=13.0, warmup=1.0, actors=None, metrics=None, dt=DT):
    n = int(round(clip/dt)) + 1
    ts = [round(i*dt, 6) for i in range(n)]
    meta, cols = {}, {}
    for aid, spec in actors.items():
        meta[aid] = {'dims': spec['dims'], 'kind': spec.get('kind', 'car'), 'static': False, 'tags': []}
        xs, ys, hs, vs, pr = [], [], [], [], []
        for i, t in enumerate(ts):
            st = spec['f'](t)
            xs.append(st[0]); ys.append(st[1]); hs.append(st[2]); vs.append(st[3])
            pr.append(bool(st[4]) if len(st) > 4 else True)
        cols[aid] = {'x': xs, 'y': ys, 'headingRad': hs, 'speedMps': vs, 'present': pr,
                     's': [0.0]*n, 'laneRsl': ['0:0:-1']*n, 'lateralOffsetM': [0.0]*n,
                     'motionDirection': ['forward']*n}
    return {'header': {'clipSeconds': clip, 'warmupSeconds': warmup, 'dt': dt,
                       'actorIds': list(actors), 'actorMetadata': meta, 'metricSubject': 'ego'},
            'ticks': {'t': ts, 'actors': cols},
            'metrics': metrics or {}, 'events': []}

CAR = {'l': 4.8, 'w': 1.9, 'h': 1.5}
PED = {'l': 0.6, 'w': 0.6, 'h': 1.75}

def straight(x0, y0, v, hd=0.0):
    return lambda t: (x0 + v*math.cos(hd)*t, y0 + v*math.sin(hd)*t, hd, v)

M_OK = {'minTTC': {'value': 2.0, 't': 5.0, 'pair': ['x', 'ego']},
        'requiredDecelMax': {'ego': 3.0}, 'collisions': [], 'triggerNeverFired': []}

PROBES = {}
def probe(name):
    def deco(fn):
        PROBES[name] = fn
        return fn
    return deco


@probe('P1-broadphase-shortcircuit')
def p1():
    """A challenger that is far at t=0 and stays far, but whose true minimum is later.
    The gate's `if gap > cut and loc['clearanceM'] < inf: continue` forces tick 0 to always be
    evaluated, so if every later tick is culled the reported clearanceM/closestT are the t=0 values,
    not the minimum. Here the true min (8.0 m) happens at t=6.5 but the gate reports the t=0 value."""
    tr = mk_trace(actors={
        'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
        'far': {'dims': CAR, 'f': lambda t: (10.0*t, 200.0 - 20.0*min(t, 6.5) + 20.0*max(0.0, t-6.5), 0.0, 10.0)},
    }, metrics=M_OK)
    f = G.trace_facts(tr)
    truth = _brute_min(tr, 'far')
    return {'gate_clearanceM': f['clearanceM'], 'gate_closestT': f['closestT'],
            'true_clearanceM': round(truth[0], 3), 'true_closestT': truth[1],
            'defect': abs(f['clearanceM'] - truth[0]) > 0.01}


@probe('P2-absent-challenger')
def p2():
    """Challenger present only for the first 1.0 s, parked on top of the ego's start, then despawns.
    Gate should ignore it after despawn. It does -- but the *closest approach* it records is at
    t<=1.0 which is inside warm-up+0.5, so C2 fires. Included as a control that `present` works."""
    tr = mk_trace(actors={
        'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
        'ghost': {'dims': CAR, 'f': lambda t: (3.0, 2.5, 0.0, 0.0, t <= 1.0)},
    }, metrics=M_OK)
    f = G.trace_facts(tr)
    return {'clearanceM': f['clearanceM'], 'closestT': f['closestT'],
            'ok_ignores_absent': f['closestT'] is not None and f['closestT'] <= 1.0}


@probe('P3-absent-in-the-middle')
def p3():
    """Challenger teleports: present, absent for 3 s while it is moved, present again.
    The gate never checks continuity, so a scenario can *jump* an actor into place. There is no
    C-clause that penalises a discontinuous challenger track."""
    def f_(t):
        if t < 3.0:  return (200.0, 200.0, 0.0, 0.0, True)
        if t < 6.0:  return (200.0, 200.0, 0.0, 0.0, False)
        return (10.0*t + 2.0, 2.6, 0.0, 10.0, True)
    tr = mk_trace(actors={'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
                          'tele': {'dims': CAR, 'f': f_}}, metrics=M_OK)
    g = G.gate_cell_dict(tr, 'accept', 'critical') if hasattr(G, 'gate_cell_dict') else None
    f = G.trace_facts(tr)
    jump = _max_jump(tr, 'tele')
    return {'clearanceM': f['clearanceM'], 'closestT': f['closestT'],
            'max_single_tick_jump_m': round(jump, 2),
            'gate_notices_teleport': False}


@probe('P4-C2-warmup-double-count')
def p4():
    """trace t=0 is ALREADY post-warm-up (verified: ego t=0 pos == instance pos + warmup*v0).
    So `closestT > warmupSeconds + 0.5` demands 0.5 s + one extra warm-up of recorded time.
    Here the conflict is a genuine, moving, mid-clip event at t=1.2 s of recorded time -- 2.2 s
    after the actors were placed -- and the gate rejects it as a 'spawn artifact'."""
    tr = mk_trace(warmup=2.0, actors={
        'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
        'cut': {'dims': CAR, 'f': lambda t: (10.0*t + 12.0 - 4.0*t, 3.0 - 2.0*min(t, 1.2), 0.0, 6.0)},
    }, metrics=M_OK)
    f = G.trace_facts(tr)
    c2_asimpl = f['closestT'] > f['warmupSeconds'] + 0.5
    c2_intent = f['closestT'] > 0.5
    return {'closestT': f['closestT'], 'warmupSeconds': f['warmupSeconds'],
            'C2_as_implemented': c2_asimpl, 'C2_semantic_intent': c2_intent,
            'defect': c2_asimpl != c2_intent}


@probe('P5-decoy-actor-launders-C2-and-C3')
def p5():
    """THE JUNK SCENARIO. Nothing interesting happens to the ego at all.
      * `challenger` is the scenario's nominal actor. It is closest to the ego at spawn (6.1 m)
        and then diverges -- exactly the C2 'spawn artifact' the gate exists to catch.
      * `parked` is a stationary vehicle 2.2 m off the ego's path at x=80 m. The ego merely drives
        past it at a rigidly constant 10 m/s. That single pass-by becomes the global closest
        approach, and it supplies BOTH C3 (2.2 m clearance) and C2 (it happens at t=7.5 s).
      * C4 is supplied by metrics.requiredDecelMax, a scenario-level scalar: any deceleration
        anywhere in the clip, for any reason, satisfies it -- see P6.
    C1..C5 all pass. The gate never requires that the actor satisfying C3 is the actor satisfying
    C2, C4, or the brief. Net result: an ego driving in a straight line at constant speed past a
    parked car is ADMITTED as a critical edge case."""
    tr = mk_trace(actors={
        'ego':        {'dims': CAR, 'f': straight(0, 0, 10.0)},
        'challenger': {'dims': CAR, 'f': lambda t: (2.0 + 10.0*t, 8.0 + 3.0*t, 0.4, 10.4)},
        'parked':     {'dims': CAR, 'f': lambda t: (80.0, 4.1, 0.0, 0.0)},
    }, metrics={'minTTC': {'value': 2.4, 't': 0.1, 'pair': ['challenger', 'ego']},
                'requiredDecelMax': {'ego': 1.9}, 'collisions': [], 'triggerNeverFired': []})
    f = G.trace_facts(tr)
    v = tr['ticks']['actors']['ego']['speedMps']
    g = _gate(tr, 'accept', 'critical')
    return {'per_challenger': f['perChallenger'], 'closestWith': f['closestWith'],
            'ego_speed_min_max': [min(v), max(v)],
            'C1': g['C1'], 'C2': g['C2'], 'C3': g['C3'], 'C4': g['C4'], 'C5': g['C5'],
            'PASS': g['pass'],
            'note': 'ego never changes speed or heading; the only near actor is parked scenery'}


@probe('P5b-irrelevant-actor-destroys-C2')
def p5b():
    """The mirror image, and the more damaging one. A GOOD scenario: the challenger cuts across
    the ego and the true conflict is at t=6.4 s. But a second, irrelevant vehicle happens to be
    parked 1.0 m off the ego's shoulder at the ego's spawn point. Because C2 is evaluated on the
    GLOBAL closest approach over all actors rather than on the conflict pair, the parked car's
    spawn-time 1.0 m owns `closestT=0` and C2 rejects the whole cell. The gate's dominant reported
    failure mode (C2, 29.3% of all traces) is exactly this shape, so some unknown share of that
    29.3% is bookkeeping, not scenario error."""
    tr = mk_trace(actors={
        'ego':        {'dims': CAR, 'f': straight(0, 0, 10.0)},
        'challenger': {'dims': CAR, 'f': lambda t: (120.0 - 8.0*t, 14.0 - 1.4*t, math.pi, 8.2)},
        'kerbside':   {'dims': CAR, 'f': lambda t: (1.0, 2.9, 0.0, 0.0)},
    }, metrics={'minTTC': {'value': 1.8, 't': 6.4, 'pair': ['challenger', 'ego']},
                'requiredDecelMax': {'ego': 3.4}, 'collisions': [], 'triggerNeverFired': []})
    f = G.trace_facts(tr)
    g = _gate(tr, 'accept', 'critical')
    pc = f['perChallenger']
    g2 = dict(g)
    g2['C2_if_scored_on_conflict_pair'] = pc['challenger']['t'] > f['warmupSeconds'] + 0.5
    return {'per_challenger': pc, 'closestWith': f['closestWith'],
            'C2_as_implemented': g['C2'],
            'C2_if_scored_on_conflict_pair': g2['C2_if_scored_on_conflict_pair'],
            'PASS': g['pass'], 'defect': (not g['C2']) and g2['C2_if_scored_on_conflict_pair']}


@probe('P6-C4-from-metrics-only')
def p6():
    """C4 reads metrics.requiredDecelMax['ego'] and metrics.minTTC straight out of the trace.
    Neither is checked against the trajectory. Here the ego's speed is *rigidly constant*, so its
    true required deceleration is 0 and its true achieved deceleration is 0, yet the reported
    metric says 3.0 and the gate believes it."""
    tr = mk_trace(actors={'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
                          'p': {'dims': PED, 'f': lambda t: (100.0, 2.0, 0.0, 0.0)}},
                  metrics={'minTTC': {'value': 9.9}, 'requiredDecelMax': {'ego': 3.0},
                           'collisions': [], 'triggerNeverFired': []})
    f = G.trace_facts(tr)
    v = tr['ticks']['actors']['ego']['speedMps']
    true_decel = max((v[i]-v[i+1])/DT for i in range(len(v)-1))
    g = _gate(tr, 'accept', 'critical')
    return {'reported_requiredDecelMaxEgo': f['requiredDecelMaxEgo'],
            'observed_peak_decel_from_trajectory': round(true_decel, 4),
            'C4': g['C4'], 'PASS': g['pass']}


@probe('P7-degenerate-dims')
def p7():
    """gate.obb_clearance returns 0.0 for two zero-area actors 5 m apart, because _sat_overlap
    builds a (0,0) separating axis from every degenerate edge and can never separate. Any actor
    pair with l==w==0 in actorMetadata reports clearance 0 and passes C3 for free."""
    a = G._corners(0, 0, 0, 0.0, 0.0)
    b = G._corners(5, 0, 0, 0.0, 0.0)
    c = G._corners(5, 0, 0, 4.8, 1.9)
    return {'point_vs_point_5m_apart': G.obb_clearance(a, b), 'expected': 5.0,
            'point_vs_car_ok': G.obb_clearance(a, c), 'defect': G.obb_clearance(a, b) != 5.0}


@probe('P8-missing-dims-default')
def p8():
    """Challenger dims default to 0.6 x 0.6 when actorMetadata has none. For a *car* challenger
    that shrinks its footprint by 4.2 m of length, inflating clearance. Direction of the error is
    conservative (rejects), but it is silent and it corrupts the reported clearance number."""
    tr = mk_trace(actors={'ego': {'dims': CAR, 'f': straight(0, 0, 10.0)},
                          'v': {'dims': CAR, 'f': lambda t: (30.0, 3.4, 0.0, 0.0)}}, metrics=M_OK)
    true_c = G.trace_facts(tr)['clearanceM']
    tr2 = copy.deepcopy(tr)
    del tr2['header']['actorMetadata']['v']['dims']
    bad_c = G.trace_facts(tr2)['clearanceM']
    return {'clearance_with_dims': true_c, 'clearance_when_dims_missing': bad_c,
            'error_m': round(abs(true_c-bad_c), 3)}


@probe('P9-subtick-aliasing')
def p9():
    """Clearance is evaluated only at trace samples, exactly like the engine's own
    'exact-sampled-obb-clearance'. Two cars crossing at 90 deg at 25 m/s each have a sharp minimum
    in time; at dt=0.02 s each actor moves 0.5 m between samples. Agreement between the gate and
    the engine is therefore agreement between two samplers with the SAME aliasing, and does not
    establish that either equals the true continuous minimum."""
    def build(dt, phase):
        return mk_trace(clip=6.0, dt=dt, actors={
            'ego': {'dims': CAR, 'f': lambda t: (-40.0 + 25.0*(t+phase), 0.0, 0.0, 25.0)},
            'x': {'dims': CAR, 'f': lambda t: (0.0, -40.0 + 25.0*(t+phase-0.35), math.pi/2, 25.0)}},
            metrics=M_OK)
    coarse = [G.trace_facts(build(0.02, p))['clearanceM'] for p in (0.0, 0.005, 0.010, 0.015)]
    fine = G.trace_facts(build(0.0005, 0.0))['clearanceM']
    return {'clearance_dt0.02_at_3_sampling_phases': coarse,
            'clearance_dt0.0005_reference': fine,
            'aliasing_spread_m': round(max(coarse)-min(coarse), 3),
            'worst_overestimate_vs_reference_m': round(max(coarse)-fine, 3)}


@probe('P10-ego-drives-in-reverse-circle')
def p10():
    """C1 measures max speed and *path length*, not progress. An ego doing donuts in a car park
    at 10 m/s racks up 130 m of path and 0 m of displacement. C1 cannot tell them apart."""
    R = 130.0/(2*math.pi)   # exactly one revolution in 13 s at 10 m/s
    tr = mk_trace(actors={
        'ego': {'dims': CAR, 'f': lambda t: (R*math.cos(math.pi + 10.0*t/R), R*math.sin(math.pi + 10.0*t/R),
                                             math.pi + 10.0*t/R + math.pi/2, 10.0)},
        'p': {'dims': PED, 'f': lambda t: (-(R+2.75), 0.0, 0.0, 0.0)}}, metrics=M_OK)
    f = G.trace_facts(tr)
    x, y = tr['ticks']['actors']['ego']['x'], tr['ticks']['actors']['ego']['y']
    net = math.hypot(x[-1]-x[0], y[-1]-y[0])
    g = _gate(tr, 'accept', 'critical')
    return {'distanceTravelledM': f['distanceTravelledM'], 'net_displacement_m': round(net, 2),
            'C1': g['C1'], 'PASS': g['pass']}


# ---------- helpers ----------
def _gate(tr, verdict, band):
    f = G.trace_facts(tr)
    c1 = f['maxSpeedMps'] >= G.C1_SPEED and f['distanceTravelledM'] >= G.C1_DIST
    c2 = f['closestT'] is not None and f['closestT'] > f['warmupSeconds'] + G.C2_MARGIN
    c3 = f['clearanceM'] is not None and f['clearanceM'] <= G.C3_CLEARANCE
    c4 = (f['requiredDecelMaxEgo'] >= G.C4_DECEL) or (f['minTTC'] is not None and f['minTTC'] <= G.C4_TTC)
    c5 = verdict == 'accept' and band == 'critical' and f['collisions'] == 0 and not f['triggerNeverFired']
    return {'C1': c1, 'C2': c2, 'C3': c3, 'C4': c4, 'C5': c5,
            'pass': bool(c1 and c2 and c3 and c4 and c5)}

def _brute_min(tr, aid):
    ts = tr['ticks']['t']; e = tr['ticks']['actors']['ego']; a = tr['ticks']['actors'][aid]
    md = tr['header']['actorMetadata']
    el, ew = md['ego']['dims']['l'], md['ego']['dims']['w']
    al, aw = md[aid]['dims']['l'], md[aid]['dims']['w']
    best, bt = float('inf'), None
    for i in range(len(ts)):
        if not (e['present'][i] and a['present'][i]): continue
        c = G.obb_clearance(G._corners(e['x'][i], e['y'][i], e['headingRad'][i], el, ew),
                            G._corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw))
        if c < best: best, bt = c, ts[i]
    return best, bt

def _max_jump(tr, aid):
    a = tr['ticks']['actors'][aid]
    m = 0.0
    for i in range(len(a['x'])-1):
        if a['present'][i] and a['present'][i+1]:
            m = max(m, math.hypot(a['x'][i+1]-a['x'][i], a['y'][i+1]-a['y'][i]))
    return m


if __name__ == '__main__':
    out = {}
    for name in sorted(PROBES):
        r = PROBES[name]()
        out[name] = r
        print(f"--- {name}\n    {PROBES[name].__doc__.strip()[:400]}\n    => {json.dumps(r)}\n")
    here = os.path.dirname(os.path.abspath(__file__))
    json.dump(out, open(os.path.join(here, 'gate-probes.json'), 'w'), indent=1)
