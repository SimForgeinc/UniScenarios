"""Strict admission gate (contract section 2, pre-registered sha256 1a08698e95fca4bc).

Computed from RAW TRACES. The engine's minDistance is a circumscribed-circle proxy and is
never used here: C3 uses a true oriented-bounding-box clearance computed from x/y/heading/dims.
"""
import gzip, json, math, glob, os

# ---------- true oriented-bounding-box clearance ----------

def _corners(x, y, h, l, w):
    c, s = math.cos(h), math.sin(h)
    hl, hw = l / 2.0, w / 2.0
    return [(x + c * dx - s * dy, y + s * dx + c * dy)
            for dx, dy in ((hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw))]

def _seg_dist(p, q, r, s):
    def d2(a, b): return (a[0]-b[0])**2 + (a[1]-b[1])**2
    def pt_seg(p, a, b):
        vx, vy = b[0]-a[0], b[1]-a[1]
        L = vx*vx + vy*vy
        t = 0.0 if L < 1e-12 else max(0.0, min(1.0, ((p[0]-a[0])*vx + (p[1]-a[1])*vy)/L))
        return math.hypot(p[0]-(a[0]+t*vx), p[1]-(a[1]+t*vy))
    d = (q[0]-p[0], q[1]-p[1]); e = (s[0]-r[0], s[1]-r[1])
    den = d[0]*e[1] - d[1]*e[0]
    if abs(den) > 1e-12:
        t = ((r[0]-p[0])*e[1] - (r[1]-p[1])*e[0]) / den
        u = ((r[0]-p[0])*d[1] - (r[1]-p[1])*d[0]) / den
        if 0 <= t <= 1 and 0 <= u <= 1:
            return 0.0
    return min(pt_seg(p, r, s), pt_seg(q, r, s), pt_seg(r, p, q), pt_seg(s, p, q))

def _inside(poly, pt):
    sign = None
    for i in range(len(poly)):
        a, b = poly[i], poly[(i+1) % len(poly)]
        cr = (b[0]-a[0])*(pt[1]-a[1]) - (b[1]-a[1])*(pt[0]-a[0])
        if abs(cr) < 1e-12: continue
        s = cr > 0
        if sign is None: sign = s
        elif s != sign: return False
    return True

def obb_clearance(A, B):
    """Exact clearance between two convex rectangles; 0.0 if they overlap."""
    if _inside(A, B[0]) or _inside(B, A[0]): return 0.0
    best = float('inf')
    for i in range(4):
        a1, a2 = A[i], A[(i+1) % 4]
        for j in range(4):
            b1, b2 = B[j], B[(j+1) % 4]
            d = _seg_dist(a1, a2, b1, b2)
            if d < best: best = d
            if best == 0.0: return 0.0
    return best

# ---------- trace-level gate ----------

def trace_gate(trace_path, warmup_s, decel_min=1.5, ttc_max=3.0, clearance_max=5.0,
               ego_min_speed=2.0, ego_min_dist=10.0):
    tr = json.loads(gzip.open(trace_path).read())
    hdr, ticks, met = tr['header'], tr['ticks'], tr['metrics']
    ts = ticks['t']; act = ticks['actors']
    meta = hdr['actorMetadata']
    if 'ego' not in act: return {'ok': False, 'why': 'no-ego'}

    e = act['ego']
    maxSpeed = max(e['speedMps'])
    dist = 0.0
    xs, ys = e['x'], e['y']
    for i in range(1, len(xs)):
        dist += math.hypot(xs[i]-xs[i-1], ys[i]-ys[i-1])
    c1 = (maxSpeed >= ego_min_speed) and (dist >= ego_min_dist)

    # C3/C2: true OBB clearance between ego and every other actor
    ed = meta['ego']['dims']
    best = (float('inf'), None, None)
    for aid, a in act.items():
        if aid == 'ego': continue
        ad = meta.get(aid, {}).get('dims', {'l': 1.0, 'w': 1.0})
        for i in range(len(ts)):
            if not e['present'][i] or not a['present'][i]: continue
            dx = e['x'][i]-a['x'][i]; dy = e['y'][i]-a['y'][i]
            if dx*dx + dy*dy > 400.0: continue      # >20 m apart: cannot be <=5 m clearance
            A = _corners(e['x'][i], e['y'][i], e['headingRad'][i], ed['l'], ed['w'])
            B = _corners(a['x'][i], a['y'][i], a['headingRad'][i], ad['l'], ad['w'])
            d = obb_clearance(A, B)
            if d < best[0]: best = (d, ts[i], aid)
    clearance, tstar, partner = best
    c3 = clearance <= clearance_max
    c2 = (tstar is not None) and (tstar > warmup_s + 0.5)

    rd = (met.get('requiredDecelMax') or {}).get('ego') or 0.0
    ttc = ((met.get('minTTC') or {}) or {}).get('value')
    c4 = (rd >= decel_min) or (ttc is not None and ttc <= ttc_max)

    return {'ok': bool(c1 and c2 and c3 and c4), 'C1': bool(c1), 'C2': bool(c2), 'C3': bool(c3),
            'C4': bool(c4), 'maxSpeedMps': round(maxSpeed, 3), 'distanceTravelledM': round(dist, 2),
            'obbClearanceM': None if clearance == float('inf') else round(clearance, 3),
            'tClosest': tstar, 'partner': partner, 'requiredDecelMaxEgo': round(rd, 3), 'minTTC': ttc}


def gate_batch(summary_path, warmup_s):
    """Apply the frozen gate to a uniscenarios batch summary. Returns per-cell + brief verdict."""
    S = json.load(open(summary_path))
    cells = []
    for r in S.get('results', []):
        if r.get('status') != 'ok': continue
        met = r.get('metrics') or {}
        c5 = (r.get('verdict') == 'accept' and r.get('band') == 'critical'
              and len(met.get('collisions') or []) == 0
              and len(met.get('triggerNeverFired') or []) == 0)
        tf = r.get('traceFile')
        if not c5 or not tf or not os.path.exists(tf):
            cells.append({'map': r.get('mapId'), 'site': r.get('siteId'), 'draw': r.get('drawIndex'),
                          'C5': bool(c5), 'ok': False, 'trace': tf}); continue
        g = trace_gate(tf, warmup_s)
        g.update({'map': r.get('mapId'), 'site': r.get('siteId'), 'draw': r.get('drawIndex'),
                  'C5': True, 'trace': tf})
        g['ok'] = bool(g['ok'])
        cells.append(g)
    q = [c for c in cells if c.get('ok')]
    maps = sorted({c['map'] for c in q}); sites = {(c['map'], c['site']) for c in q}
    return {'qualifying': len(q), 'maps': maps, 'sites': len(sites),
            'admitted': bool(q and len(maps) >= 2 and len(sites) >= 3),
            'cells': cells, 'traces': [c['trace'] for c in q[:8]]}
