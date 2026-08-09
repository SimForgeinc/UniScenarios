"""Two extra deterministic tests needed to adjudicate specific briefs.

reverses()      -- speedMps in the trace is UNSIGNED, so "the car reverses" is not directly
                   readable. It is recoverable from the sign of the displacement projected onto
                   the heading: a body moving backwards has displacement anti-parallel to its
                   own facing.
behind_actor()  -- "a pedestrian walks behind a reversing VEHICLE" is a relation between two
                   non-ego actors, which nothing else in this audit computes.
"""
import gzip, json, math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def load(p):
    with gzip.open(p) as f:
        return json.loads(f.read())


def reverses(trace_path, aid, min_back_m=0.8):
    tr = load(trace_path)
    a = tr['ticks']['actors'].get(aid)
    if a is None:
        return None
    pr = np.asarray(a['present'], bool)
    x, y, hd = (np.asarray(a[k], float) for k in ('x', 'y', 'headingRad'))
    m = pr[:-1] & pr[1:]
    dx, dy = np.diff(x), np.diff(y)
    # projection of each step onto the body's own forward axis
    fwd = dx * np.cos(hd[:-1]) + dy * np.sin(hd[:-1])
    back = -fwd[m]
    back = back[back > 0]
    return {'totalBackwardM': round(float(back.sum()), 3),
            'maxSingleStepBackM': round(float(back.max()), 4) if len(back) else 0.0,
            'reverses': bool(back.sum() >= min_back_m),
            'totalForwardM': round(float(fwd[m][fwd[m] > 0].sum()), 3)}


def behind_actor(trace_path, who, target, max_range_m=12.0):
    """Is `who` ever positioned behind `target` (in target's own frame, x < 0) and close?"""
    tr = load(trace_path)
    A = tr['ticks']['actors'].get(who)
    Bb = tr['ticks']['actors'].get(target)
    if A is None or Bb is None:
        return None
    m = np.asarray(A['present'], bool) & np.asarray(Bb['present'], bool)
    if not m.any():
        return {'everBehind': False, 'reason': 'never co-present'}
    ax, ay = np.asarray(A['x'], float)[m], np.asarray(A['y'], float)[m]
    bx, by = np.asarray(Bb['x'], float)[m], np.asarray(Bb['y'], float)[m]
    bh = np.asarray(Bb['headingRad'], float)[m]
    dx, dy = ax - bx, ay - by
    f = dx * np.cos(bh) + dy * np.sin(bh)
    lat = -dx * np.sin(bh) + dy * np.cos(bh)
    d = np.hypot(dx, dy)
    beh = (f < 0) & (d <= max_range_m) & (np.abs(lat) <= 4.0)
    return {'everBehind': bool(beh.any()),
            'minDistWhileBehindM': round(float(d[beh].min()), 2) if beh.any() else None,
            'fracTicksBehind': round(float(beh.mean()), 3),
            'minCentreDistM': round(float(d.min()), 2)}
