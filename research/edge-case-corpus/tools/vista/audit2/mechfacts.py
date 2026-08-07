"""Deterministic mechanism facts from a raw trace.

This is the NON-CIRCULAR half of the ground truth. Nothing here looks at an image, at the brief,
or at anything the critic produces. It answers, per non-ego actor, the questions a careful human
would ask of the trajectory:

  what class of thing is it?   does it move?   does it brake?   does it turn?
  is it ahead / behind / oncoming / crossing?
  does it ENTER the ego's travelled corridor, having started outside it?
  do its and the ego's paths cross the same ground?
  is anything BETWEEN the ego and it (occlusion)?

Frame convention: trace uses (x, y); props use (x, -z). headingRad is already in the (x,y) frame.
"""
import gzip, json, math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fastgate import _corners_v, pen_and_gap

# ------------------------------------------------------------------ actor class from footprint
# Verified against the actual dims present in the corpus:
#   pedestrian .6x.6 / 1x1 markers, cyclist 1.8x.6, motorcycle 2.2x.8, car 4.8x1.9,
#   van/truck 6-9.5 x 2.2-2.5, bus 12x2.55
def classify(aid, l, w):
    """Name first, geometry second. NOTE: matching is on WORD-ISH boundaries, not raw substrings.
    The first version matched 'ped' anywhere, so `stopped-bus-0` classified as a PEDESTRIAN and a
    brief requiring a bus was scored as having none. Substring matching on semantic ids is a trap."""
    import re as _re
    n = _re.sub(r'[^a-z]+', ' ', (aid or '').lower())
    toks = set(n.split())
    n = ' ' + n + ' '

    def has(key):
        return key in toks or (' ' + key + ' ') in n or any(t.startswith(key) for t in toks)

    for key, cls in (('pedestrian', 'pedestrian'), ('walker', 'pedestrian'),
                     ('cyclist', 'cyclist'),
                     ('bicycle', 'cyclist'), ('bike', 'cyclist'), ('motorcycle', 'motorcycle'),
                     ('scooter', 'motorcycle'), ('moped', 'motorcycle'), ('bus', 'bus'),
                     ('truck', 'truck'), ('trailer', 'truck'), ('lorry', 'truck'),
                     ('van', 'van'), ('animal', 'animal'), ('deer', 'animal'), ('dog', 'animal'),
                     ('debris', 'object'), ('grate', 'object'), ('load', 'object'),
                     ('wheel', 'object'), ('ladder', 'object'), ('box', 'object'),
                     ('cone', 'object'), ('gravel', 'object'), ('pothole', 'object'),
                     ('ped', 'pedestrian'), ('child', 'pedestrian'), ('jaywalk', 'pedestrian')):
        if has(key):
            return cls, _geo_class(l, w)
    g = _geo_class(l, w)
    return g, g


def _geo_class(l, w):
    if l is None or w is None:
        return 'unknown'
    if l <= 1.2 and w <= 1.2:
        return 'pedestrian_or_object'
    if l <= 2.0 and w <= 0.9:
        return 'cyclist'
    if l <= 2.6 and w <= 1.1:
        return 'motorcycle'
    if l >= 10.0:
        return 'bus'
    if l >= 6.0:
        return 'truck'
    if l >= 3.5:
        return 'car'
    return 'small'


VEHICLE = {'car', 'van', 'truck', 'bus', 'motorcycle'}

# How far outside the ego corridor an actor must have been for its later arrival inside it to
# count as ENTERING rather than as having been there all along. 2.8 m ~= one lane width beyond
# the corridor edge, so a genuine adjacent-lane cut-in qualifies but jitter does not.
ENTRY_EXCURSION_M = 2.8


def _smooth_decel(ts, sp, pr, window_s):
    """Largest speed drop per second measured over a `window_s` window, ignoring one-tick freezes."""
    import numpy as _np
    t = ts[pr]; v = sp[pr]
    if len(t) < 3:
        return 0.0
    k = max(2, int(round(window_s / max(_np.median(_np.diff(t)), 1e-6))))
    if len(t) <= k:
        k = len(t) - 1
    dv = v[:-k] - v[k:]
    dt = t[k:] - t[:-k]
    good = dt > 0
    return float((dv[good] / dt[good]).max()) if good.any() else 0.0


def load(p):
    with gzip.open(p) as f:
        return json.loads(f.read())


def _pt_to_polyline(px, py, X, Y):
    """Min distance from points (M,) to polyline (N,) plus the arclength at the foot."""
    A = np.stack([X[:-1], Y[:-1]], -1)
    B = np.stack([X[1:], Y[1:]], -1)
    d = B - A
    dd = (d * d).sum(-1)
    P = np.stack([px, py], -1)
    w = P[:, None, :] - A[None, :, :]
    t = np.clip((w * d[None]).sum(-1) / np.maximum(dd[None], 1e-12), 0, 1)
    proj = A[None] + t[..., None] * d[None]
    dist = np.linalg.norm(P[:, None, :] - proj, axis=-1)
    j = dist.argmin(1)
    seglen = np.sqrt(dd)
    s0 = np.concatenate([[0], np.cumsum(seglen)])
    return dist[np.arange(len(px)), j], s0[j] + t[np.arange(len(px)), j] * seglen[j]


def facts(trace_path, corridor_half_w=1.75):
    tr = load(trace_path)
    hdr, ticks = tr['header'], tr['ticks']
    ts = np.asarray(ticks['t'], float)
    meta = hdr.get('actorMetadata', {})
    ego = ticks['actors'].get('ego')
    if ego is None:
        return {'error': 'no ego'}
    epr = np.asarray(ego['present'], bool)
    ex, ey = np.asarray(ego['x'], float), np.asarray(ego['y'], float)
    ehd, esp = np.asarray(ego['headingRad'], float), np.asarray(ego['speedMps'], float)
    ed = meta.get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)
    EX, EY = ex[epr], ey[epr]

    ego_peak_decel = 0.0
    dts = np.diff(ts)
    with np.errstate(divide='ignore', invalid='ignore'):
        dv = np.diff(esp) / np.where(dts > 0, dts, np.nan)
    m = epr[:-1] & epr[1:]
    if m.any():
        ego_peak_decel = float(np.nanmax(-dv[m])) if np.isfinite(dv[m]).any() else 0.0

    props = []
    for pid, pm in (hdr.get('propMetadata') or {}).items():
        p, d = pm.get('pose', {}), pm.get('dims', {})
        px, py = p.get('x', 0.0), -p.get('z', 0.0)
        pr = {'id': pid, 'x': px, 'y': py, 'hd': p.get('headingRad', 0.0),
              'l': d.get('l', 4.5), 'w': d.get('w', 1.9), 'collidable': pm.get('collidable'),
              'class': classify(pid, d.get('l'), d.get('w'))[0]}
        # a prop is scenery, but it still has a geometric relation to the ego's path, and briefs
        # routinely make the prop the hazard ("a work-zone obstruction ahead"). Ignoring props in
        # everything except PRESENT was an instrument bug in the first version of this audit.
        if len(EX) > 1:
            lat, _ = _pt_to_polyline(np.array([px]), np.array([py]), EX, EY)
            pr['lateralOffsetFromEgoPathM'] = round(float(lat[0]), 2)
            pr['insideEgoCorridor'] = bool(lat[0] <= corridor_half_w + pr['w'] / 2.0)
            fwd = ((px - ex[epr]) * np.cos(ehd[epr]) + (py - ey[epr]) * np.sin(ehd[epr]))
            pr['fracTimeAheadOfEgo'] = round(float((fwd > 0).mean()), 2)
            pr['minCentreDistM'] = round(float(np.hypot(px - EX, py - EY).min()), 2)
        pr['isStatic'] = True
        pr['maxSpeedMps'] = 0.0
        pr['entersEgoCorridor'] = False
        props.append(pr)

    out = {'trace': trace_path, 'mapId': hdr.get('mapId'), 'clipSeconds': hdr.get('clipSeconds'),
           'dt': hdr.get('dt', 0.02), 'warmupSeconds': hdr.get('warmupSeconds', 0.0),
           'egoDims': [el, ew], 'egoMaxSpeedMps': round(float(esp[epr].max()), 2) if epr.any() else 0.0,
           'egoMinSpeedMps': round(float(esp[epr].min()), 2) if epr.any() else 0.0,
           'egoPeakDecelMps2': round(ego_peak_decel, 2),
           'egoDistanceM': round(float(np.hypot(np.diff(ex), np.diff(ey))[m].sum()), 1),
           'props': props, 'actors': {}}

    for aid, a in ticks['actors'].items():
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        al, aw = d.get('l'), d.get('w')
        cls, geo = classify(aid, al, aw)
        apr = np.asarray(a['present'], bool)
        ax, ay = np.asarray(a['x'], float), np.asarray(a['y'], float)
        ahd, asp = np.asarray(a['headingRad'], float), np.asarray(a['speedMps'], float)
        co = epr & apr
        f = {'id': aid, 'dims': [al, aw], 'class': cls, 'geomClass': geo,
             'nameGeomAgree': cls == geo or (cls in ('pedestrian', 'object', 'animal')
                                             and geo == 'pedestrian_or_object'),
             'presentFrac': round(float(apr.mean()), 3),
             'coPresentTicks': int(co.sum())}
        if not apr.any():
            f['neverPresent'] = True
            out['actors'][aid] = f
            continue
        sp = asp[apr]
        f['maxSpeedMps'] = round(float(sp.max()), 2)
        f['minSpeedMps'] = round(float(sp.min()), 2)
        f['meanSpeedMps'] = round(float(sp.mean()), 2)
        f['isStatic'] = bool(sp.max() < 0.3)
        f['distanceM'] = round(float(np.hypot(np.diff(ax), np.diff(ay))[apr[:-1] & apr[1:]].sum()), 1)
        # deceleration
        mm = apr[:-1] & apr[1:]
        pk, tpk = 0.0, None
        if mm.any():
            with np.errstate(divide='ignore', invalid='ignore'):
                dva = np.diff(asp) / np.where(dts > 0, dts, np.nan)
            v = -dva[mm]
            if np.isfinite(v).any():
                k = int(np.nanargmax(v)); pk = float(np.nanmax(v))
                tpk = float(ts[np.where(mm)[0][k]])
        f['peakDecelMps2'] = round(pk, 2)
        f['tPeakDecel'] = tpk
        # SMOOTHED deceleration over a 0.30 s window. The per-tick figure is unusable: the engine
        # freezes an actor's speed to exactly 0 in a single tick on contact, which reads as
        # 100+ m/s^2 and would let any such cell claim "it braked hard".
        f['peakDecelSmoothMps2'] = round(_smooth_decel(ts, asp, apr, 0.30), 2)
        f['oneTickFreeze'] = bool(pk > 20.0)
        f['stationaryThenMoves'] = bool(sp[:max(1, len(sp)//10)].max() < 0.3 and sp.max() > 1.5)
        f['movesThenStops'] = bool(sp[:max(1, len(sp)//5)].max() > 2.0 and sp[-max(1, len(sp)//10):].max() < 0.3)
        # turning
        hu = np.unwrap(ahd[apr])
        f['headingChangeDeg'] = round(float(np.degrees(hu.max() - hu.min())), 1)
        f['netHeadingChangeDeg'] = round(float(np.degrees(hu[-1] - hu[0])), 1)
        f['turns'] = bool(abs(f['netHeadingChangeDeg']) >= 45.0)
        if not co.any():
            f['neverCoPresent'] = True
            out['actors'][aid] = f
            continue
        # --- relation to the EGO'S TRAVELLED CORRIDOR (its actual path polyline)
        lat, s_at = _pt_to_polyline(ax[apr], ay[apr], EX, EY)
        f['minLateralOffsetFromEgoPathM'] = round(float(lat.min()), 2)
        f['maxLateralOffsetFromEgoPathM'] = round(float(lat.max()), 2)
        f['startLateralOffsetM'] = round(float(lat[0]), 2)
        f['endLateralOffsetM'] = round(float(lat[-1]), 2)
        inside = lat <= corridor_half_w + (aw or 0.6) / 2.0
        f['everInsideEgoCorridor'] = bool(inside.any())
        # ENTERS: was clearly outside at some point BEFORE first being inside. `entryExcursionM`
        # is the raw evidence -- how far outside the corridor it had been -- so the threshold can
        # be moved afterwards without recomputing anything.
        f['entersEgoCorridor'] = False
        f['tEntersCorridor'] = None
        f['entryExcursionM'] = None
        if inside.any():
            first = int(np.argmax(inside))
            tsp = ts[apr]
            if first > 0:
                f['entryExcursionM'] = round(float(lat[:first].max()), 2)
                if lat[:first].max() >= ENTRY_EXCURSION_M:
                    f['entersEgoCorridor'] = True
                    f['tEntersCorridor'] = float(tsp[first])
            f['lateralOffsetBeforeEntryM'] = f['entryExcursionM']
        # --- relative geometry at closest approach (simultaneous)
        idx = np.where(co)[0]
        cd = np.hypot(ex[idx] - ax[idx], ey[idx] - ay[idx])
        k = int(np.argmin(cd))
        i = idx[k]
        f['minCentreDistM'] = round(float(cd[k]), 2)
        f['tMinCentreDist'] = float(ts[i])
        # bearing of actor in ego frame: +x forward
        dx, dy = ax[i] - ex[i], ay[i] - ey[i]
        c, s = math.cos(-ehd[i]), math.sin(-ehd[i])
        fx, fy = c * dx - s * dy, s * dx + c * dy
        f['bearingAtMin'] = {'forwardM': round(float(fx), 2), 'leftM': round(float(fy), 2)}
        f['aheadOfEgoAtMin'] = bool(fx > 0)
        dh = (ahd[i] - ehd[i] + math.pi) % (2 * math.pi) - math.pi
        f['relHeadingAtMinDeg'] = round(float(math.degrees(dh)), 1)
        ad = abs(math.degrees(dh))
        f['geometry'] = ('same-direction' if ad < 45 else
                         'oncoming' if ad > 135 else 'crossing')
        # ahead-of-ego for the whole clip? (lead vehicle test)
        fxs = ((ax[idx] - ex[idx]) * np.cos(ehd[idx]) + (ay[idx] - ey[idx]) * np.sin(ehd[idx]))
        f['fracTimeAheadOfEgo'] = round(float((fxs > 0).mean()), 2)
        f['fracTimeBehindEgo'] = round(float((fxs < 0).mean()), 2)
        # --- path crossing with timing REMOVED: does the actor's path cross the ego's path?
        alat, _ = _pt_to_polyline(ax[apr], ay[apr], EX, EY)
        f['pathMinSeparationM'] = round(float(alat.min() - (el + (al or 0.6)) * 0.0), 2)
        # true space-time-decoupled OBB separation, subsampled
        f['pathSeparationOBBM'] = _path_sep_obb(ex, ey, ehd, epr, el, ew,
                                                ax, ay, ahd, apr, al or 0.6, aw or 0.6)
        # --- occlusion: is any OTHER body between ego and this actor before closest approach?
        f['occludedByAtSomeTime'] = _occluders(tr, ex, ey, ahd, ax, ay, epr, apr, aid, i, props, meta, ticks)
        out['actors'][aid] = f
    return out


def _path_sep_obb(ex, ey, ehd, epr, el, ew, ax, ay, ahd, apr, al, aw, stride=6):
    ei = np.where(epr)[0][::stride]
    ai = np.where(apr)[0][::stride]
    if len(ei) == 0 or len(ai) == 0:
        return None
    E = np.stack([ex[ei], ey[ei]], -1)
    A = np.stack([ax[ai], ay[ai]], -1)
    D = np.linalg.norm(E[:, None, :] - A[None, :, :], axis=-1)
    cut = (el + ew + al + aw)
    ii, jj = np.where(D <= cut)
    if len(ii) == 0:
        return round(float(D.min() - (el + al) / 2.0), 2)
    P = _corners_v(ex[ei[ii]], ey[ei[ii]], ehd[ei[ii]], el, ew)
    Q = _corners_v(ax[ai[jj]], ay[ai[jj]], ahd[ai[jj]], al, aw)
    pen, gap = pen_and_gap(P, Q)
    return round(float(np.where(pen > 0, 0.0, gap).min()), 3)


def _occluders(tr, ex, ey, ahd, ax, ay, epr, apr, aid, i, props, meta, ticks):
    """Which bodies intersect the ego->actor sightline, sampled over the clip before closest approach."""
    from fastgate import _corners_v as CV
    hits = {}
    co = np.where(epr & apr)[0]
    co = co[co <= i][::5]
    if len(co) == 0:
        return []
    others = []
    for oid, o in ticks['actors'].items():
        if oid in ('ego', aid):
            continue
        d = meta.get(oid, {}).get('dims', {})
        others.append((oid, np.asarray(o['x'], float), np.asarray(o['y'], float),
                       np.asarray(o['headingRad'], float), np.asarray(o['present'], bool),
                       d.get('l', 4.5), d.get('w', 1.9)))
    for k in co:
        P0 = np.array([ex[k], ey[k]]); P1 = np.array([ax[k], ay[k]])
        for oid, ox, oy, ohd, opr, ol, ow in others:
            if not opr[k]:
                continue
            if _seg_hits_box(P0, P1, ox[k], oy[k], ohd[k], ol, ow):
                hits[oid] = hits.get(oid, 0) + 1
        for p in props:
            if _seg_hits_box(P0, P1, p['x'], p['y'], p['hd'], p['l'], p['w']):
                hits[p['id']] = hits.get(p['id'], 0) + 1
    return [{'id': k, 'nSamples': v} for k, v in sorted(hits.items(), key=lambda z: -z[1])]


def _seg_hits_box(P0, P1, cx, cy, hd, l, w):
    c, s = math.cos(-hd), math.sin(-hd)
    def loc(P):
        dx, dy = P[0] - cx, P[1] - cy
        return np.array([c * dx - s * dy, s * dx + c * dy])
    a, b = loc(P0), loc(P1)
    hl, hw = l / 2.0, w / 2.0
    # Liang-Barsky against the axis-aligned box in the body frame
    d = b - a
    t0, t1 = 0.0, 1.0
    for p, q in ((-d[0], a[0] + hl), (d[0], hl - a[0]), (-d[1], a[1] + hw), (d[1], hw - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return False
        else:
            r = q / p
            if p < 0:
                t0 = max(t0, r)
            else:
                t1 = min(t1, r)
            if t0 > t1:
                return False
    return True
