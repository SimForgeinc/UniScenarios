"""An arbiter for lane incursion that neither implementation uses: the ENGINE'S OWN lateralOffsetM.

`ticks.actors[aid].lateralOffsetM` is the simulator's per-tick lateral offset of a body from the
centreline of the lane it is referenced to. It is produced by the engine, not by hybrid.motion and
not by this audit, so it can adjudicate between them.

Definition used: a body has made a LANE INCURSION if, while co-present with the ego, its own lateral
offset moves from clearly outside a lane (|offset| >= OUT_M) to clearly inside one (|offset| <= IN_M).
The band between OUT_M and IN_M is an abstain zone and those bodies are not scored.

Verified sane on a hand-checked case: c12-crossing-guard, child_near 3.71 -> -0.53 m (incursion),
crossing_guard constant 3.97 m (no incursion), ego within +-0.85 m (stays in lane).
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

OUT_M = 2.25       # clearly outside a 3.5 m lane (half-width 1.75 plus a margin)
IN_M = 1.25        # clearly inside one


def incursion(trace, aid):
    A = trace['ticks']['actors']
    e, o = A.get('ego'), A.get(aid)
    if not e or not o or 'lateralOffsetM' not in o:
        return None
    lo = [v for v, pe, po in zip(o['lateralOffsetM'], e['present'], o['present'])
          if pe and po and v is not None]
    if len(lo) < 3:
        return None
    a = [abs(v) for v in lo]
    was_out = None
    entered = False
    for v in a:
        if v >= OUT_M:
            was_out = True
        elif v <= IN_M and was_out:
            entered = True
            break
    start_out = a[0] >= OUT_M
    ends_in = a[-1] <= IN_M
    decisive = (max(a) >= OUT_M and min(a) <= IN_M) or (max(a) < IN_M) or (min(a) > OUT_M)
    return {'incursion': entered, 'startAbsOffsetM': round(a[0], 2),
            'minAbsOffsetM': round(min(a), 2), 'maxAbsOffsetM': round(max(a), 2),
            'rangeM': round(max(a) - min(a), 2), 'startOutside': start_out,
            'endsInside': ends_in, 'decisive': bool(decisive)}
