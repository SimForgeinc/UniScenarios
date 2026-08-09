"""Why does hybrid's `challenger_enters_ego_path` miss?

Three candidate causes, tested against an arbiter that neither implementation uses: the trace's own
per-tick `laneRsl` lane identifier. "The challenger ended up in a lane the ego also drove in, having
started in a different one" is readable straight out of the data with no geometry at all.

  H1  the `started_outside` gate reads the FIRST co-present tick only. A challenger that begins
      near the ego's heading line -- e.g. far ahead in the same lane on a curve -- can never
      qualify, no matter what it does afterwards.
  H2  INCURSION_LATERAL_M = 1.2 m is measured to the challenger's CENTRE. Two 1.9 m vehicles in
      adjacent 3.5 m lanes are 3.5 m apart; to reach 1.2 m the challenger must come more than
      halfway into the ego's lane, which is well past "entered".
  H3  ego-frame lateral offset at the SAME tick confounds curvature with lateral movement: a
      challenger 50 m ahead on a curving road has a large |lat| purely because the road bends.
"""
import collections, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
VISTA = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, VISTA)
import gate, motion
import predicates as PR
import numpy as np


def lane_arbiter(trace, aid):
    """Independent: did the challenger occupy a lane the ego occupies, having started elsewhere?

    laneRsl is 'roadId:section:laneIndex'; the sign of laneIndex encodes direction of travel, so a
    strict match means the same lane in the same direction -- a genuine lane-share, not a crossing.
    """
    A = trace['ticks']['actors']
    e, o = A.get('ego'), A.get(aid)
    if not e or not o:
        return None
    ego_lanes = {l for l, p in zip(e['laneRsl'], e['present']) if p and l}
    seq = [l for l, p in zip(o['laneRsl'], o['present']) if p and l]
    if not seq or not ego_lanes:
        return None
    shared = [l in ego_lanes for l in seq]
    if not any(shared):
        return {'sharesEgoLane': False, 'entersEgoLane': False, 'startedElsewhere': None}
    first = shared.index(True)
    return {'sharesEgoLane': True,
            'entersEgoLane': bool(first > 0 and not shared[0]),
            'startedElsewhere': bool(not shared[0]),
            'fracShared': round(sum(shared) / len(shared), 3)}


def compare(trace_path):
    tr = gate.load_trace(trace_path)
    F = PR.trace_facts(trace_path)
    out = []
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        m = motion.facts(tr, aid)
        if not m:
            continue
        mine = F['bodies'].get(aid, {})
        arb = lane_arbiter(tr, aid)
        # what does the ego-frame lateral offset look like at the START vs at its minimum?
        off = [p for p in motion.ego_frame_offsets(tr, aid) if p]
        lat0 = off[0][1] if off else None
        lon0 = off[0][0] if off else None
        out.append({
            'trace': trace_path, 'actor': aid, 'kind': m.get('kind'),
            'hybrid_entersEgoPath': m['entersEgoPath'],
            'hybrid_startedOutside': (abs(lat0) > motion.INCURSION_LATERAL_M) if lat0 is not None else None,
            'hybrid_startLateralM': None if lat0 is None else round(lat0, 2),
            'hybrid_startLonM': None if lon0 is None else round(lon0, 2),
            'hybrid_minAbsLateralM': m['minAbsLateralM'],
            'audit_entryExcursionM': mine.get('entryExcursionM'),
            'audit_minLateralOffsetM': mine.get('minLateralOffsetM'),
            'audit_corridorHalfWidthM': mine.get('corridorHalfWidthM'),
            'audit_entersCorridor': (mine.get('entryExcursionM') is not None
                                     and mine['entryExcursionM'] >= PR.THRESHOLDS['entryExcursionM'][0]),
            'audit_everInside': mine.get('everInsideCorridor'),
            'laneArbiter': arb,
        })
    return out
