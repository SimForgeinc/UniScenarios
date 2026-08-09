"""Fast vectorised re-gate + independent interpenetration scan over many traces.

C1-C5 reimplemented from the frozen spec in gate.py's docstring, with numpy SAT so a
few thousand traces are affordable. Cross-checked against gate.py on a sample.
"""
import gzip, json, math, os, sys
import numpy as np

C1_SPEED, C1_DIST = 2.0, 10.0
C2_MARGIN = 0.5
C3_CLEARANCE = 5.0
C4_DECEL, C4_TTC = 1.5, 3.0


def _corners_v(x, y, hd, l, w):
    """(N,4,2) corners for N poses."""
    c, s = np.cos(hd), np.sin(hd)
    hl, hw = l / 2.0, w / 2.0
    d = np.array([(hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw)])
    cx = x[:, None] + c[:, None] * d[None, :, 0] - s[:, None] * d[None, :, 1]
    cy = y[:, None] + s[:, None] * d[None, :, 0] + c[:, None] * d[None, :, 1]
    return np.stack([cx, cy], axis=-1)


def _axes_v(P):
    """(N,4,2) unit outward normals of each edge."""
    E = np.roll(P, -1, axis=1) - P
    n = np.stack([-E[..., 1], E[..., 0]], axis=-1)
    L = np.linalg.norm(n, axis=-1, keepdims=True)
    return n / np.maximum(L, 1e-12)


def pen_and_gap(A, B):
    """Vectorised over N pose pairs. Returns (penetration_depth, exact_gap).

    penetration: MTV depth in metres, 0 when disjoint.
    gap: exact polygon-polygon distance, 0 when overlapping.
    """
    N = A.shape[0]
    ax = np.concatenate([_axes_v(A), _axes_v(B)], axis=1)          # (N,8,2)
    pa = np.einsum('nkd,njd->nkj', ax, A)                          # (N,8,4)
    pb = np.einsum('nkd,njd->nkj', ax, B)
    ov = np.minimum(pa.max(-1), pb.max(-1)) - np.maximum(pa.min(-1), pb.min(-1))
    sep = (ov <= 0).any(axis=1)
    pen = np.where(sep, 0.0, ov.min(axis=1))
    # exact gap only where separated: point-to-segment both ways
    gap = np.zeros(N)
    if sep.any():
        idx = np.where(sep)[0]
        gap[idx] = _poly_dist(A[idx], B[idx])
    return pen, gap


def _pt_seg(P, S0, S1):
    """P (N,4,2) points vs segments S0,S1 (N,4,2) -> (N,4,4) distances."""
    d = S1 - S0                                                    # (N,4,2)
    dd = (d * d).sum(-1)                                           # (N,4)
    w = P[:, :, None, :] - S0[:, None, :, :]                       # (N,4,4,2)
    t = (w * d[:, None, :, :]).sum(-1) / np.maximum(dd[:, None, :], 1e-12)
    t = np.clip(t, 0.0, 1.0)
    proj = S0[:, None, :, :] + t[..., None] * d[:, None, :, :]
    return np.linalg.norm(P[:, :, None, :] - proj, axis=-1)


def _poly_dist(A, B):
    d1 = _pt_seg(A, B, np.roll(B, -1, axis=1)).reshape(A.shape[0], -1).min(1)
    d2 = _pt_seg(B, A, np.roll(A, -1, axis=1)).reshape(A.shape[0], -1).min(1)
    return np.minimum(d1, d2)


def scan(trace_path):
    with gzip.open(trace_path) as f:
        tr = json.loads(f.read())
    hdr, ticks = tr['header'], tr['ticks']
    ts = np.asarray(ticks['t'], float)
    meta = hdr.get('actorMetadata', {})
    warm = hdr.get('warmupSeconds', 0.0)
    ego = ticks['actors'].get('ego')
    if ego is None:
        return {'error': 'no ego'}
    epr = np.asarray(ego['present'], bool)
    ex, ey = np.asarray(ego['x'], float), np.asarray(ego['y'], float)
    ehd, esp = np.asarray(ego['headingRad'], float), np.asarray(ego['speedMps'], float)
    ed = meta.get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)

    max_speed = float(esp[epr].max()) if epr.any() else 0.0
    step = np.hypot(np.diff(ex), np.diff(ey))
    valid = epr[:-1] & epr[1:]
    dist = float(step[valid].sum())

    best = {'clearanceM': float('inf'), 't': None, 'with': None, 'pen': 0.0}
    per = {}
    for aid, a in ticks['actors'].items():
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        al, aw = d.get('l', 0.6), d.get('w', 0.6)
        m = epr & np.asarray(a['present'], bool)
        if not m.any():
            continue
        ax_, ay_ = np.asarray(a['x'], float)[m], np.asarray(a['y'], float)[m]
        ahd = np.asarray(a['headingRad'], float)[m]
        cd = np.hypot(ex[m] - ax_, ey[m] - ay_)
        near = cd <= (el + ew + al + aw + 2 * C3_CLEARANCE)
        if not near.any():
            per[aid] = {'clearanceM': None, 't': None, 'maxPenM': 0.0, 'nOverlapTicks': 0}
            continue
        sel = np.where(m)[0][near]
        A = _corners_v(ex[sel], ey[sel], ehd[sel], el, ew)
        B = _corners_v(ax_[near], ay_[near], ahd[near], al, aw)
        pen, gap = pen_and_gap(A, B)
        clear = np.where(pen > 0, 0.0, gap)
        j = int(np.argmin(clear))
        per[aid] = {'clearanceM': float(clear[j]), 't': float(ts[sel[j]]),
                    'maxPenM': float(pen.max()), 'nOverlapTicks': int((pen > 0).sum()),
                    'dims': [al, aw],
                    'minCentreDistM': float(cd[near].min())}
        if clear[j] < best['clearanceM']:
            best = {'clearanceM': float(clear[j]), 't': float(ts[sel[j]]), 'with': aid,
                    'pen': float(pen.max())}

    m_ = tr.get('metrics', {})
    min_ttc = (m_.get('minTTC') or {}).get('value')
    decel = (m_.get('requiredDecelMax') or {}).get('ego', 0.0) or 0.0
    cl = None if best['clearanceM'] == float('inf') else best['clearanceM']
    c1 = max_speed >= C1_SPEED and dist >= C1_DIST
    c2 = best['t'] is not None and best['t'] > warm + C2_MARGIN
    c3 = cl is not None and cl <= C3_CLEARANCE
    c4 = (decel >= C4_DECEL) or (min_ttc is not None and min_ttc <= C4_TTC)
    return {'trace': trace_path, 'maxSpeedMps': round(max_speed, 3),
            'distanceTravelledM': round(dist, 3), 'warmupSeconds': warm,
            'clearanceM': None if cl is None else round(cl, 4), 'closestT': best['t'],
            'closestWith': best['with'],
            'maxPenetrationM': round(max(v['maxPenM'] for v in per.values()), 4) if per else 0.0,
            'nOverlapTicks': max((v['nOverlapTicks'] for v in per.values()), default=0),
            'minTTC': min_ttc, 'requiredDecelMaxEgo': round(decel, 3),
            'collisions': len(m_.get('collisions') or []),
            'triggerNeverFired': list(m_.get('triggerNeverFired') or []),
            'clippedCriticality': bool(m_.get('clippedCriticality', False)),
            'minTTCPair': (m_.get('minTTC') or {}).get('pair') or [],
            'nTicks': len(ts), 'dt': hdr.get('dt', 0.02),
            'C1': c1, 'C2': c2, 'C3': c3, 'C4': c4, 'perChallenger': per}
