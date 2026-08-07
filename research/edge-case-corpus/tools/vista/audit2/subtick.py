"""Is Q8's 0.10 m threshold defensible?

The trace is sampled at dt. Between two consecutive samples the bodies move; a cell recorded
with a small positive clearance may have actually interpenetrated BETWEEN ticks. This computes,
for every near-miss cell, the sub-tick swept clearance by supersampling the poses with linear
interpolation, and asks: at what recorded clearance does the probability of a hidden contact
fall to zero?
"""
import gzip, json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastgate import _corners_v, pen_and_gap


def subtick(trace_path, factor=16, window=1.0):
    """Recompute min clearance with `factor`x temporal supersampling around the closest approach."""
    with gzip.open(trace_path) as f:
        tr = json.loads(f.read())
    hdr, ticks = tr['header'], tr['ticks']
    ts = np.asarray(ticks['t'], float)
    meta = hdr.get('actorMetadata', {})
    ego = ticks['actors'].get('ego')
    if ego is None:
        return None
    ed = meta.get('ego', {}).get('dims', {})
    el, ew = ed.get('l', 4.8), ed.get('w', 1.9)
    epr = np.asarray(ego['present'], bool)
    ex, ey = np.asarray(ego['x'], float), np.asarray(ego['y'], float)
    ehd, esp = np.asarray(ego['headingRad'], float), np.asarray(ego['speedMps'], float)

    out = {'raw': float('inf'), 'sub': float('inf'), 'relSpeedAtMin': None, 'dt': hdr.get('dt', 0.02)}
    for aid, a in ticks['actors'].items():
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        al, aw = d.get('l', 0.6), d.get('w', 0.6)
        m = epr & np.asarray(a['present'], bool)
        if not m.any():
            continue
        idx = np.where(m)[0]
        ax_, ay_ = np.asarray(a['x'], float), np.asarray(a['y'], float)
        ahd = np.asarray(a['headingRad'], float)
        asp = np.asarray(a['speedMps'], float)
        cd = np.hypot(ex[idx] - ax_[idx], ey[idx] - ay_[idx])
        near = cd <= (el + ew + al + aw + 6.0)
        if not near.any():
            continue
        sel = idx[near]
        A = _corners_v(ex[sel], ey[sel], ehd[sel], el, ew)
        B = _corners_v(ax_[sel], ay_[sel], ahd[sel], al, aw)
        pen, gap = pen_and_gap(A, B)
        raw = np.where(pen > 0, 0.0, gap)
        j = int(np.argmin(raw))
        if raw[j] < out['raw']:
            out['raw'] = float(raw[j])
            # relative velocity magnitude at that tick (finite difference, robust)
            k = sel[j]
            k2 = min(k + 1, len(ts) - 1)
            dt = max(ts[k2] - ts[k], 1e-6)
            vex, vey = (ex[k2] - ex[k]) / dt, (ey[k2] - ey[k]) / dt
            vax, vay = (ax_[k2] - ax_[k]) / dt, (ay_[k2] - ay_[k]) / dt
            out['relSpeedAtMin'] = float(math.hypot(vex - vax, vey - vay))
            out['pairDt'] = float(dt)
        # supersample the window around the closest tick
        lo = max(0, j - int(window / max(ts[1] - ts[0], 1e-6)))
        hi = min(len(sel) - 1, j + int(window / max(ts[1] - ts[0], 1e-6)))
        if hi > lo:
            seg = sel[lo:hi + 1]
            t_dense = np.linspace(ts[seg[0]], ts[seg[-1]], (len(seg) - 1) * factor + 1)
            def ip(arr):
                return np.interp(t_dense, ts[seg], arr[seg])
            def ipang(arr):
                u = np.unwrap(arr[seg])
                return np.interp(t_dense, ts[seg], u)
            Ad = _corners_v(ip(ex), ip(ey), ipang(ehd), el, ew)
            Bd = _corners_v(ip(ax_), ip(ay_), ipang(ahd), al, aw)
            pd, gd = pen_and_gap(Ad, Bd)
            rd = np.where(pd > 0, 0.0, gd)
            out['sub'] = min(out['sub'], float(rd.min()))
    for k in ('raw', 'sub'):
        if out[k] == float('inf'):
            out[k] = None
    return out
