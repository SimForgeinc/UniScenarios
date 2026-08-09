"""make_controls.py -- deliberately BORING and deliberately BROKEN negative controls.

Purpose: a judge that cannot fail anything is worthless. These build rollouts that PASS the frozen
physical gate (C1..C5) while being obviously not worth a slot in an edge-case corpus, and feed them
to the same judge as the real cells. If the judge calls them "high", the judge is broken.

The controls are synthetic traces written in the engine's own on-disk shape, but their EGO DRIVES A
REAL LANE POLYLINE from a real map, so they render exactly like a real rollout and the judge is given
no cue that they are synthetic.

C5 (`evaluate` verdict/band) is supplied by the caller in the frozen gate, so for the controls it is
stated explicitly rather than earned. C1-C4 are earned outright: they are computed from these traces
by the unmodified gate.py.
"""
import gzip, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import gate as G
import rollout_render as RR

CAR = {'l': 4.8, 'w': 1.9, 'h': 1.5}
SUV = {'l': 4.85, 'w': 1.95, 'h': 1.78}
PED = {'l': 0.6, 'w': 0.6, 'h': 1.75}


def lane_frame(dev_assets, mapid, rsl):
    pl = RR.topo(dev_assets, mapid)['lanes'][rsl]['polyline']
    acc = [0.0]
    for a, b in zip(pl, pl[1:]):
        acc.append(acc[-1] + math.hypot(b['x'] - a['x'], b['y'] - a['y']))

    def at(s):
        s = max(0.0, min(s, acc[-1]))
        for i in range(len(acc) - 1):
            if acc[i + 1] >= s:
                f = (s - acc[i]) / max(acc[i + 1] - acc[i], 1e-9)
                x = pl[i]['x'] + f * (pl[i + 1]['x'] - pl[i]['x'])
                y = pl[i]['y'] + f * (pl[i + 1]['y'] - pl[i]['y'])
                hd = math.atan2(pl[i + 1]['y'] - pl[i]['y'], pl[i + 1]['x'] - pl[i]['x'])
                return x, y, hd
        return pl[-1]['x'], pl[-1]['y'], math.atan2(pl[-1]['y'] - pl[-2]['y'], pl[-1]['x'] - pl[-2]['x'])
    return at, acc[-1]


def pick_long_lane(dev_assets, mapid, min_len=100.0):
    best = None
    for rsl, ln in RR.topo(dev_assets, mapid)['lanes'].items():
        if ln.get('laneType') != 'driving' or ln.get('isJunction'):
            continue
        pl = ln.get('polyline') or []
        L = sum(math.hypot(b['x'] - a['x'], b['y'] - a['y']) for a, b in zip(pl, pl[1:]))
        if L >= min_len and (best is None or L > best[1]):
            best = (rsl, L)
    return best


def _write(trace, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, 'wt') as f:
        json.dump(trace, f)
    return path


def _mk(mapid, clip, dt, warmup, actors, metrics, props=None):
    n = int(round(clip / dt)) + 1
    ts = [round(i * dt, 6) for i in range(n)]
    meta, cols = {}, {}
    for aid, spec in actors.items():
        meta[aid] = {'dims': spec['dims'], 'kind': spec.get('kind', 'car'), 'static': False,
                     'tags': spec.get('tags', [])}
        xs, ys, hs, vs, pr = [], [], [], [], []
        for t in ts:
            x, y, h, v = spec['f'](t)
            xs.append(x); ys.append(y); hs.append(h); vs.append(v); pr.append(True)
        cols[aid] = {'x': xs, 'y': ys, 'headingRad': hs, 'speedMps': vs, 'present': pr,
                     's': [0.0] * n, 'laneRsl': [''] * n, 'lateralOffsetM': [0.0] * n,
                     'motionDirection': ['forward'] * n}
    return {'header': {'mapId': mapid, 'clipSeconds': clip, 'warmupSeconds': warmup, 'dt': dt,
                       'actorIds': list(actors), 'actorMetadata': meta,
                       'propMetadata': props or {}, 'metricSubject': 'ego'},
            'ticks': {'t': ts, 'actors': cols}, 'metrics': metrics, 'events': []}


def control_boring_passby(dev_assets, mapid, out):
    """CONTROL B1 -- 'physically valid but boring'.

    The ego drives a real lane at a rigidly constant 10 m/s and never touches a control. A parked car
    sits 2.2 m off its path. A second car starts 6 m away and diverges immediately (the classic C2
    spawn artifact). The parked car wins the global closest approach at mid-clip, which launders both
    C2 and C3; C4 comes from the scenario-level requiredDecelMax scalar.
    Expected: gate C1-C4 PASS. Correct judgement: BORING.
    """
    at, L = lane_frame(dev_assets, mapid, control_boring_passby.rsl)
    v = 10.0

    def ego(t):
        x, y, h = at(5.0 + v * t)
        return x, y, h, v
    px, py, ph = at(5.0 + v * 6.5)
    off = ph + math.pi / 2
    parked = (px + math.cos(off) * 3.15, py + math.sin(off) * 3.15, ph)

    def other(t):
        x, y, h = at(5.0 + 6.0 + (v + 0.9) * t)
        return x + math.cos(off) * (2.5 + 0.9 * t), y + math.sin(off) * (2.5 + 0.9 * t), h, v + 0.9

    tr = _mk(mapid, 10.0, 0.02, 1.0, {
        'ego': {'dims': CAR, 'kind': 'car', 'tags': ['role:ego'], 'f': ego},
        'other-car': {'dims': CAR, 'kind': 'car', 'tags': ['role:challenger'], 'f': other},
        'parked-car': {'dims': SUV, 'kind': 'car', 'tags': ['role:parked'],
                       'f': lambda t: (parked[0], parked[1], parked[2], 0.0)},
    }, metrics={'minTTC': {'value': 2.4, 't': 0.2, 'pair': ['other-car', 'ego']},
                'requiredDecelMax': {'ego': 1.9}, 'collisions': [], 'triggerNeverFired': [],
                'clippedCriticality': False})
    return _write(tr, out)


def control_ghost_prop(dev_assets, mapid, out):
    """CONTROL B2 -- 'physically impossible but admitted'.

    Identical ego motion, but a stationary SUV prop is placed IN the ego's lane, dead on its path.
    Props are collidable:false and are absent from ticks['actors'], so the ego drives straight
    through it, `metrics.collisions` stays empty, and the gate never looks (GATE-AUDIT A7).
    Expected: gate C1-C4 PASS. Correct judgement: INVALID.
    """
    at, L = lane_frame(dev_assets, mapid, control_boring_passby.rsl)
    v = 10.0

    def ego(t):
        x, y, h = at(5.0 + v * t)
        return x, y, h, v
    px, py, ph = at(5.0 + v * 6.5)
    off = ph + math.pi / 2
    ped = (px + math.cos(off) * 3.0, py + math.sin(off) * 3.0)
    props = {'ghost-suv': {'catalogId': 'vehicle.suv', 'collidable': False, 'dims': SUV,
                           'pose': {'x': px, 'z': -py, 'headingRad': ph}}}
    tr = _mk(mapid, 10.0, 0.02, 1.0, {
        'ego': {'dims': CAR, 'kind': 'car', 'tags': ['role:ego'], 'f': ego},
        'bystander': {'dims': PED, 'kind': 'pedestrian', 'tags': ['role:ped'],
                      'f': lambda t: (ped[0], ped[1], ph + math.pi / 2, 0.0)},
    }, metrics={'minTTC': {'value': 2.9, 't': 6.0, 'pair': ['bystander', 'ego']},
                'requiredDecelMax': {'ego': 1.6}, 'collisions': [], 'triggerNeverFired': [],
                'clippedCriticality': False}, props=props)
    return _write(tr, out)


def control_real_conflict(dev_assets, mapid, out):
    """CONTROL B3 -- a positive control: a genuine late cut-in that the ego has to brake hard for.
    Expected: gate PASS, and the judge should NOT call it boring. If the judge cannot separate B3
    from B1 it is not measuring anything."""
    at, L = lane_frame(dev_assets, mapid, control_boring_passby.rsl)

    def ego(t):
        # brakes hard from 12 to 6 m/s between t=5 and t=7
        if t < 4: s, v = 11.0 * t, 11.0
        elif t < 6: s, v = 11.0 * 4 + 11.0 * (t - 4) - 1.5 * (t - 4) ** 2, 11.0 - 3.0 * (t - 4)
        else: s, v = 11.0 * 4 + 11.0 * 2 - 6.0 + 5.0 * (t - 6), 5.0
        x, y, h = at(3.0 + s)
        return x, y, h, v

    def cutin(t):
        # runs alongside in the next lane, then cuts across into the ego's lane at t=5
        s = 3.0 + 19.0 + 8.4 * t
        x, y, h = at(s)
        lat = 3.4 if t < 3.6 else max(0.0, 3.4 * (1 - (t - 3.6) / 1.6))
        off = h + math.pi / 2
        return x + math.cos(off) * lat, y + math.sin(off) * lat, h - 0.20 * (1 if 3.6 <= t < 5.2 else 0), 8.4

    tr = _mk(mapid, 10.0, 0.02, 1.0, {
        'ego': {'dims': CAR, 'kind': 'car', 'tags': ['role:ego'], 'f': ego},
        'cutin-car': {'dims': CAR, 'kind': 'car', 'tags': ['role:challenger'], 'f': cutin},
    }, metrics={'minTTC': {'value': 1.4, 't': 4.6, 'pair': ['cutin-car', 'ego']},
                'requiredDecelMax': {'ego': 3.4}, 'collisions': [], 'triggerNeverFired': [],
                'clippedCriticality': False})
    return _write(tr, out)


if __name__ == '__main__':
    dev = sys.argv[1]; out_dir = sys.argv[2]
    mapid = 'yale-street'
    rsl, L = pick_long_lane(dev, mapid)
    control_boring_passby.rsl = rsl
    print(f'using lane {rsl} of {mapid}, length {L:.1f} m')
    made = {
        'B1-boring-passby': control_boring_passby(dev, mapid, os.path.join(out_dir, 'B1.trace.json.gz')),
        'B2-ghost-prop': control_ghost_prop(dev, mapid, os.path.join(out_dir, 'B2.trace.json.gz')),
        'B3-real-cutin': control_real_conflict(dev, mapid, os.path.join(out_dir, 'B3.trace.json.gz')),
    }
    for k, p in made.items():
        f = G.gate_cell(p, verdict='accept', band='critical')
        print(f"{k:18s} C1={f['C1']} C2={f['C2']} C3={f['C3']} C4={f['C4']} C5={f['C5']} "
              f"PASS={f['pass']}  clearance={f['clearanceM']} m @ t={f['closestT']}")
    json.dump(made, open(os.path.join(out_dir, 'controls.json'), 'w'), indent=1)
