"""Measure the VLM's PERCEPTION against facts the trajectory settles exactly.

The critic's question ("is the mechanism there?") has no ground truth without judgement. But three
of the sub-questions the brief-blind perception step answers DO have exact answers in the trace:

    moves            -- did this actor travel more than 2 m?
    entersEgoLane    -- did it start outside the ego's corridor and end up inside it?
    slowsSharply     -- did it decelerate >= 2 m/s^2 over 0.30 s while moving?

So the perception step can be scored directly, per actor, with no circularity and no human. If it
is unreliable HERE, no amount of prompt engineering on top of it can make the fused judgement
reliable, because the fused judgement is a strictly harder question asked of the same eyes.
"""
import collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

MOVE_M = 2.0
DECEL = 2.0
ENTRY_M = 2.8


def truth_for(actor):
    """Exact answers, or None where the trace does not settle it decisively."""
    t = {}
    d = actor.get('distanceM')
    t['moves'] = None if d is None else (True if d >= MOVE_M else (False if d <= 0.5 else None))
    exc = actor.get('entryExcursionM')
    minlat = actor.get('minLateralOffsetFromEgoPathM')
    halfw = 1.75 + (actor.get('dims') or [0, 0.6])[1] / 2.0
    if exc is not None and exc >= ENTRY_M:
        t['entersEgoLane'] = True
    elif minlat is not None and minlat > halfw + 1.0:
        t['entersEgoLane'] = False
    elif exc is not None and exc <= 1.5:
        t['entersEgoLane'] = False
    else:
        t['entersEgoLane'] = None
    dc = actor.get('peakDecelSmoothMps2')
    vm = actor.get('maxSpeedMps') or 0.0
    if dc is None:
        t['slowsSharply'] = None
    elif dc >= DECEL and vm >= 3.0:
        t['slowsSharply'] = True
    elif dc <= 1.0 or vm < 1.0:
        t['slowsSharply'] = False
    else:
        t['slowsSharply'] = None
    return t


def score(pairs, facts, vision, key='enh'):
    """Per-field confusion of the perception step against the trajectory."""
    cm = {k: collections.Counter() for k in ('moves', 'entersEgoLane', 'slowsSharply')}
    misses = []
    for p in pairs:
        f = facts.get(p['trace'])
        if not f:
            continue
        v = vision.get(p['id'])
        if not v:
            continue
        for run in v['runs']:
            for a in (run['perception'] or {}).get('actors', []) or []:
                aid = a.get('id')
                fa = f['actors'].get(aid)
                if fa is None:
                    continue
                truth = truth_for(fa)
                for k in cm:
                    tv = truth[k]
                    cv = a.get(k)
                    if tv is None or cv not in (True, False):
                        continue
                    cm[k][(tv, cv)] += 1
                    if tv != cv:
                        misses.append({'pair': p['id'], 'actor': aid, 'field': k,
                                       'truth': tv, 'claimed': cv,
                                       'dist': fa.get('distanceM'),
                                       'entryExc': fa.get('entryExcursionM'),
                                       'minLat': fa.get('minLateralOffsetFromEgoPathM'),
                                       'decel': fa.get('peakDecelSmoothMps2'),
                                       'dims': fa.get('dims'), 'class': fa.get('class')})
    return cm, misses
