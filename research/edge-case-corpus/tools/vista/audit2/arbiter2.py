"""A corrected lateral-offset measure, and a composite lane-incursion arbiter.

Two defects were found in the instruments used in the first pass of this audit, one in each:

  * `predicates.trace_facts` measured distance from a body to the ego's TRAVELLED PATH POLYLINE
    with no endpoint rejection. The polyline only spans where the ego has been, so a body BEHIND
    the ego's start (a tailgater) is far from it in the LONGITUDINAL direction, and that distance
    was being read as a lateral offset. Verified: 30 `tailgater` actors scored "excursions" of
    26-33 m while their own lane offset never moved 0.5 m. This is the same missing-longitudinal-
    gate error I diagnosed in hybrid.motion, in my own code.

  * `lane_arbiter.incursion` used the engine's `lateralOffsetM`, which is measured against the
    ACTOR'S OWN reference path. For route-bound / `relative_to` actors it is ~0 throughout even
    while the body plainly crosses the ego's lane. 37.2% of challengers have a flat series.

Neither is usable alone. This module fixes the geometry and combines the two, using each only
where it is informative, and abstaining where neither is.
"""
import math, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

FLAT_RANGE_M = 0.5      # below this the engine's own offset series carries no information
LANE_OUT_M = 2.25       # clearly outside a 3.5 m lane
LANE_IN_M = 1.25        # clearly inside one
EDGE_TOL = 1e-6


def lateral_series(trace, aid):
    """Signed lateral offset of `aid` from the ego's travelled path, per co-present tick.

    Only ticks whose foot-point lies STRICTLY INSIDE the polyline are returned. A foot-point at
    either end means the body is off the end of the ego's route, and the distance there is
    longitudinal, not lateral -- exactly the artifact that corrupted the first version.
    """
    A = trace['ticks']['actors']
    e, o = A.get('ego'), A.get(aid)
    if not e or not o:
        return None
    ep = np.asarray(e['present'], bool)
    EX, EY = np.asarray(e['x'], float)[ep], np.asarray(e['y'], float)[ep]
    if len(EX) < 3:
        return None
    op = np.asarray(o['present'], bool)
    co = ep & op
    if co.sum() < 3:
        return None
    ax, ay = np.asarray(o['x'], float)[co], np.asarray(o['y'], float)[co]
    ts = np.asarray(trace['ticks']['t'], float)[co]

    P0 = np.stack([EX[:-1], EY[:-1]], -1)
    P1 = np.stack([EX[1:], EY[1:]], -1)
    d = P1 - P0
    dd = (d * d).sum(-1)
    Q = np.stack([ax, ay], -1)
    w = Q[:, None, :] - P0[None]
    t_raw = (w * d[None]).sum(-1) / np.maximum(dd[None], 1e-12)
    t = np.clip(t_raw, 0.0, 1.0)
    proj = P0[None] + t[..., None] * d[None]
    dist = np.linalg.norm(Q[:, None, :] - proj, axis=-1)
    j = dist.argmin(1)
    k = np.arange(len(ax))
    best = dist[k, j]
    tb = t[k, j]
    nseg = len(P0)
    # interior means: not clamped at the very start of the first segment nor the end of the last
    interior = ~(((j == 0) & (tb <= EDGE_TOL)) | ((j == nseg - 1) & (tb >= 1 - EDGE_TOL)))
    # signed side
    seg = d[j]
    rel = Q - proj[k, j]
    sign = np.sign(seg[:, 0] * rel[:, 1] - seg[:, 1] * rel[:, 0])
    return {'t': ts, 'lat': best * np.where(sign == 0, 1, sign), 'abs': best,
            'interior': interior, 'fracInterior': float(interior.mean())}


def geometric_incursion(trace, aid, out_m=LANE_OUT_M, in_m=LANE_IN_M):
    """Did the body go from clearly outside the ego's lane to clearly inside it?

    Uses only interior samples, so endpoint artifacts cannot manufacture an excursion.
    """
    s = lateral_series(trace, aid)
    if s is None or s['interior'].sum() < 3:
        return None
    a = s['abs'][s['interior']]
    was_out, entered = False, False
    for v in a:
        if v >= out_m:
            was_out = True
        elif v <= in_m and was_out:
            entered = True
            break
    decisive = (a.max() >= out_m and a.min() <= in_m) or a.max() < in_m or a.min() > out_m
    return {'incursion': entered, 'minAbsM': round(float(a.min()), 3),
            'maxAbsM': round(float(a.max()), 3), 'rangeM': round(float(a.max() - a.min()), 3),
            'decisive': bool(decisive), 'nInterior': int(s['interior'].sum()),
            'fracInterior': round(s['fracInterior'], 3)}


def engine_incursion(trace, aid, out_m=LANE_OUT_M, in_m=LANE_IN_M):
    """The engine's own lateralOffsetM, used ONLY when the series actually varies."""
    A = trace['ticks']['actors']
    e, o = A.get('ego'), A.get(aid)
    if not e or not o:
        return None
    lo = [v for v, pe, po in zip(o.get('lateralOffsetM') or [], e['present'], o['present'])
          if pe and po and v is not None]
    if len(lo) < 3:
        return None
    a = np.abs(np.asarray(lo, float))
    rng = float(a.max() - a.min())
    if rng < FLAT_RANGE_M:
        return {'usable': False, 'rangeM': round(rng, 3),
                'reason': 'flat series -- route-bound actor, offset is against its OWN path'}
    was_out, entered = False, False
    for v in a:
        if v >= out_m:
            was_out = True
        elif v <= in_m and was_out:
            entered = True
            break
    decisive = (a.max() >= out_m and a.min() <= in_m) or a.max() < in_m or a.min() > out_m
    return {'usable': True, 'incursion': entered, 'rangeM': round(rng, 3),
            'minAbsM': round(float(a.min()), 3), 'maxAbsM': round(float(a.max()), 3),
            'decisive': bool(decisive)}


def arbiter(trace, aid):
    """Composite. Prefers agreement; abstains when the two informative measures disagree."""
    g = geometric_incursion(trace, aid)
    en = engine_incursion(trace, aid)
    eng_ok = bool(en and en.get('usable') and en.get('decisive'))
    geo_ok = bool(g and g.get('decisive'))
    if eng_ok and geo_ok:
        if en['incursion'] == g['incursion']:
            return {'incursion': g['incursion'], 'decisive': True, 'source': 'both agree',
                    'geom': g, 'engine': en}
        return {'incursion': None, 'decisive': False, 'source': 'DISAGREE', 'geom': g, 'engine': en}
    if eng_ok:
        return {'incursion': en['incursion'], 'decisive': True, 'source': 'engine only',
                'geom': g, 'engine': en}
    if geo_ok:
        return {'incursion': g['incursion'], 'decisive': True, 'source': 'geometry only',
                'geom': g, 'engine': en}
    return {'incursion': None, 'decisive': False, 'source': 'neither informative',
            'geom': g, 'engine': en}
