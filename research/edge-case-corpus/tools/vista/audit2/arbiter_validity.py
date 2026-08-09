"""Is `lateralOffsetM` a valid arbiter? The parent says no for route-bound actors.

Claim to test: lateralOffsetM is measured against the ACTOR'S OWN path, so a `relative_to` /
route-bound challenger reads ~0 for the whole clip even while it plainly crosses into the ego's
lane. If true, my arbiter mislabels those as decisive NO-INCURSION, which would inflate the false
positive count of BOTH implementations I scored -- mine included.

Degeneracy test, per challenger:
  DEGENERATE  the offset never leaves a narrow band around a constant (range < RANGE_MIN), so it
              carries no information about lateral movement
  USABLE      the offset actually varies
Then: among DEGENERATE actors, how many nevertheless moved a long way relative to the ego's path
(measured geometrically)? Those are the actors the arbiter silently got wrong.
"""
import collections, json, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

RANGE_MIN = 0.5      # below this the offset series is flat and tells us nothing


def work(r):
    import gate
    import predicates as PR
    try:
        tr = gate.load_trace(r['trace'])
        F = PR.trace_facts(r['trace'])
    except Exception as e:                                        # noqa: BLE001
        return []
    A = tr['ticks']['actors']
    e = A.get('ego')
    if not e:
        return []
    out = []
    for aid, o in A.items():
        if aid == 'ego':
            continue
        lo = [v for v, pe, po in zip(o.get('lateralOffsetM') or [], e['present'], o['present'])
              if pe and po and v is not None]
        lanes = {l for l, p in zip(o.get('laneRsl') or [], o['present']) if p and l}
        b = F['bodies'].get(aid, {})
        if len(lo) < 3:
            out.append({'trace': r['trace'], 'actor': aid, 'nOffset': len(lo),
                        'noOffsetData': True, 'laneNone': not lanes,
                        'geomExcursionM': b.get('entryExcursionM'),
                        'geomMinLatM': b.get('minLateralOffsetM'),
                        'geomTravelM': b.get('movedM')})
            continue
        a = np.abs(np.asarray(lo, float))
        out.append({'trace': r['trace'], 'actor': aid, 'nOffset': len(lo),
                    'noOffsetData': False,
                    'absMin': round(float(a.min()), 3), 'absMax': round(float(a.max()), 3),
                    'range': round(float(a.max() - a.min()), 3),
                    'laneNone': not lanes, 'nLanes': len(lanes),
                    'geomExcursionM': b.get('entryExcursionM'),
                    'geomMinLatM': b.get('minLateralOffsetM'),
                    'geomTravelM': b.get('movedM'),
                    'geomLatSpanM': (None if b.get('minLateralOffsetM') is None
                                     or b.get('entryExcursionM') is None
                                     else round(b['entryExcursionM'] - b['minLateralOffsetM'], 3))})
    return out


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')][::2]
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = [x for g in ex.map(work, ok, chunksize=16) for x in g]
    json.dump(rows, open(os.path.join(HERE, 'arbiter-validity.json'), 'w'))
    n = len(rows)
    nod = sum(1 for r in rows if r['noOffsetData'])
    have = [r for r in rows if not r['noOffsetData']]
    flat = [r for r in have if r['range'] < RANGE_MIN]
    print(f'challenger rows: {n}')
    print(f'  no usable lateralOffsetM series at all : {nod} = {nod/n:.3f}')
    print(f'  flat series (range < {RANGE_MIN} m)          : {len(flat)} = {len(flat)/n:.3f}')
    print(f'  laneRsl entirely None                  : {sum(1 for r in rows if r["laneNone"])} = '
          f'{sum(1 for r in rows if r["laneNone"])/n:.3f}')
    # of the FLAT ones, how many actually moved a lot relative to the EGO'S path?
    moved = [r for r in flat if (r.get('geomExcursionM') or 0) >= 2.8]
    print(f'\n  of the {len(flat)} FLAT actors, {len(moved)} nevertheless entered the ego corridor')
    print(f'  from >= 2.8 m out, measured geometrically = {len(moved)/max(len(flat),1):.3f}')
    print('  ^ these are the ones my arbiter scored as decisive NO-INCURSION and got WRONG.')
    ex_ = [r for r in moved[:8]]
    for r in ex_:
        print(f"     {r['actor'][:26]:26s} offsetRange={r['range']:.3f} absMin={r['absMin']:.2f} "
              f"geomExcursion={r['geomExcursionM']} geomMinLat={r['geomMinLatM']} travel={r['geomTravelM']}")
