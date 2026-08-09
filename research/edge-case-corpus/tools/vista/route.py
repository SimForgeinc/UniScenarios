"""Site route geometry: the bridge between what the agent SEES and the portable (laneOffset, s, tFrac)
frame that the template speaks. A site is a route starting at `entryLaneRsl`; s is measured along it.
"""
import math
import render as R

def _straightest(lanes, cur_dir, cands, tail):
    best = None
    for c in cands:
        pl = (lanes.get(c) or {}).get('polyline') or []
        if len(pl) < 2: continue
        a, b = pl[0], pl[1]
        d0 = math.hypot(a['x']-tail[0], a['y']-tail[1])
        d1 = math.hypot(pl[-1]['x']-tail[0], pl[-1]['y']-tail[1])
        rev = d1 < d0
        if rev: a, b = pl[-1], pl[-2]
        ang = math.atan2(b['y']-a['y'], b['x']-a['x'])
        dh = abs(math.atan2(math.sin(ang-cur_dir), math.cos(ang-cur_dir)))
        gap = min(d0, d1)
        score = dh + gap*0.05
        if best is None or score < best[0]: best = (score, c, rev)
    return (best[1], best[2]) if best else (None, False)


def build_route(dev_assets, mapid, entry_rsl, max_len=420.0):
    lanes = R.topo(dev_assets, mapid)['lanes']
    pts, widths, rsls = [], [], []
    cur = entry_rsl; seen = set(); total = 0.0; rev = False
    while cur and cur in lanes and cur not in seen and total < max_len:
        seen.add(cur); ln = lanes[cur]
        pl = list(ln.get('polyline') or [])
        if rev: pl = pl[::-1]
        w = ln.get('representativeWidthM') or 3.5
        for q in pl:
            pts.append((q['x'], q['y'])); widths.append(w); rsls.append(cur)
        for a, b in zip(pl, pl[1:]):
            total += math.hypot(b['x']-a['x'], b['y']-a['y'])
        if len(pts) < 2: break
        cur_dir = math.atan2(pts[-1][1]-pts[-2][1], pts[-1][0]-pts[-2][0])
        cands = [c for c in (ln.get('successors') or []) if c not in seen]
        cur, rev = _straightest(lanes, cur_dir, cands, pts[-1])
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + math.hypot(b[0]-a[0], b[1]-a[1]))
    return {'pts': pts, 'acc': acc, 'widths': widths, 'rsls': rsls,
            'lengthM': acc[-1] if acc else 0.0, 'map': mapid, 'entry': entry_rsl,
            'speedLimitKph': lanes.get(entry_rsl, {}).get('speedLimitKph')}

def at_s(rt, s):
    acc = rt['acc']; pts = rt['pts']
    s = max(0.0, min(s, acc[-1]))
    i = 0
    while i+1 < len(acc) and acc[i+1] < s: i += 1
    j = min(i+1, len(pts)-1)
    seg = max(1e-9, acc[j]-acc[i]); t = (s-acc[i])/seg
    x = pts[i][0] + t*(pts[j][0]-pts[i][0]); y = pts[i][1] + t*(pts[j][1]-pts[i][1])
    h = math.atan2(pts[j][1]-pts[i][1], pts[j][0]-pts[i][0])
    return {'x': x, 'y': y, 'headingRad': h, 'widthM': rt['widths'][i], 'rsl': rt['rsls'][i]}

def project(rt, x, y):
    """World point -> (s along route, lateral metres, +ve to the LEFT of travel)."""
    best = None
    pts, acc = rt['pts'], rt['acc']
    for i in range(len(pts)-1):
        ax, ay = pts[i]; bx, by = pts[i+1]
        L2 = (bx-ax)**2 + (by-ay)**2
        if L2 < 1e-12: continue
        t = max(0.0, min(1.0, ((x-ax)*(bx-ax) + (y-ay)*(by-ay))/L2))
        qx, qy = ax + t*(bx-ax), ay + t*(by-ay)
        d = math.hypot(x-qx, y-qy)
        if best is None or d < best[0]:
            L = math.sqrt(L2)
            cross = ((bx-ax)*(y-ay) - (by-ay)*(x-ax))/L
            best = (d, acc[i] + t*L, cross, rt['widths'][i])
    if best is None: return None
    d, s, lat, w = best
    return {'s': round(s, 2), 'lateralM': round(lat, 2), 'widthM': w, 'distanceM': round(d, 2)}

def to_logical(lat_m, width_m):
    """lateral metres -> portable (laneOffset, tFrac). +laneOffset = left of the reference lane."""
    w = max(2.4, width_m)
    lo = int(round(lat_m / w))
    resid = lat_m - lo*w
    tf = max(-1.0, min(1.0, resid/(w/2.0)))
    return lo, round(tf, 3)

def from_logical(rt, s, lane_offset, t_frac):
    """Portable (laneOffset, s, tFrac) -> world point, for drawing the authored scene."""
    p = at_s(rt, s)
    w = max(2.4, p['widthM'])
    lat = lane_offset*w + t_frac*(w/2.0)
    nx, ny = -math.sin(p['headingRad']), math.cos(p['headingRad'])
    return {'x': p['x'] + nx*lat, 'y': p['y'] + ny*lat, 'headingRad': p['headingRad'], 'widthM': w}
