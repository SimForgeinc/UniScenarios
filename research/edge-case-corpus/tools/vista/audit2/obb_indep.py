"""Independent OBB overlap / interpenetration check.

Deliberately does NOT import gate.py: written from scratch (shapely-free, own SAT + own
polygon distance) so a bug in gate.obb_clearance cannot hide here.
"""
import gzip, json, math


def corners(x, y, hd, l, w):
    c, s = math.cos(hd), math.sin(hd)
    hl, hw = l / 2.0, w / 2.0
    return [(x + c*dx - s*dy, y + s*dx + c*dy) for dx, dy in ((hl,hw),(hl,-hw),(-hl,-hw),(-hl,hw))]


def _axes(P):
    n = len(P)
    for i in range(n):
        x1,y1 = P[i]; x2,y2 = P[(i+1) % n]
        ex, ey = x2-x1, y2-y1
        L = math.hypot(ex, ey)
        if L > 1e-12:
            yield (-ey/L, ex/L)


def penetration_depth(A, B):
    """Signed: >0 = overlap depth (min translation distance), 0.0 = touching/disjoint.

    Full SAT with normalised axes so the returned depth is in METRES.
    """
    best = float('inf')
    for ax, ay in list(_axes(A)) + list(_axes(B)):
        pa = [ax*px + ay*py for px, py in A]
        pb = [ax*px + ay*py for px, py in B]
        ov = min(max(pa), max(pb)) - max(min(pa), min(pb))
        if ov <= 0:
            return 0.0
        best = min(best, ov)
    return best


def _seg_dist(p, a, b):
    ax, ay = a; bx, by = b; px, py = p
    dx, dy = bx-ax, by-ay
    d2 = dx*dx + dy*dy
    t = 0.0 if d2 < 1e-12 else max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy)/d2))
    return math.hypot(px-(ax+t*dx), py-(ay+t*dy))


def gap(A, B):
    """Positive separation between disjoint polys; 0.0 if overlapping."""
    if penetration_depth(A, B) > 0.0:
        return 0.0
    best = float('inf')
    for P, Q in ((A, B), (B, A)):
        n = len(Q)
        for p in P:
            for i in range(n):
                best = min(best, _seg_dist(p, Q[i], Q[(i+1) % n]))
    return best


def load(path):
    with gzip.open(path) as f:
        return json.loads(f.read())


def analyse(trace_path):
    """Per-challenger min gap and max penetration depth over the whole clip."""
    tr = load(trace_path)
    hdr = tr['header']; ticks = tr['ticks']; ts = ticks['t']
    meta = hdr.get('actorMetadata', {})
    ego = ticks['actors'].get('ego')
    if ego is None:
        return {'error': 'no ego'}
    ed = meta.get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)
    out = {}
    for aid, a in ticks['actors'].items():
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        al, aw = d.get('l', 0.6), d.get('w', 0.6)
        mn_gap, mx_pen, t_gap, t_pen = float('inf'), 0.0, None, None
        n_overlap_ticks = 0
        centre_at_min = None
        for i in range(len(ts)):
            if not (ego['present'][i] and a['present'][i]):
                continue
            cd = math.hypot(ego['x'][i]-a['x'][i], ego['y'][i]-a['y'][i])
            if cd > (el+ew+al+aw):       # cheap reject, generous
                continue
            A = corners(ego['x'][i], ego['y'][i], ego['headingRad'][i], el, ew)
            B = corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw)
            p = penetration_depth(A, B)
            g = 0.0 if p > 0 else gap(A, B)
            if p > 0:
                n_overlap_ticks += 1
            if g < mn_gap:
                mn_gap, t_gap, centre_at_min = g, ts[i], cd
            if p > mx_pen:
                mx_pen, t_pen = p, ts[i]
        out[aid] = {'dims': [al, aw], 'minGapM': None if mn_gap == float('inf') else round(mn_gap, 4),
                    'tMinGap': t_gap, 'centreDistAtMinGapM': None if centre_at_min is None else round(centre_at_min, 4),
                    'maxPenetrationM': round(mx_pen, 4), 'tMaxPen': t_pen,
                    'nOverlapTicks': n_overlap_ticks}
    m = tr.get('metrics', {})
    return {'egoDims': [el, ew], 'perChallenger': out,
            'metricsCollisions': len(m.get('collisions') or []),
            'metricsMinTTC': (m.get('minTTC') or {}).get('value'),
            'nTicks': len(ts), 'dt': hdr.get('dt'),
            'anyOverlap': any(v['maxPenetrationM'] > 0 for v in out.values()),
            'minGapAll': min([v['minGapM'] for v in out.values() if v['minGapM'] is not None], default=None)}
