"""Audit Q7: is pathSeparationM <= 2.0 m defensible, or just convenient?

Q7 asks whether the ego and the challenger contested the same ground with timing removed. The
original clause required pathSeparationM == 0. It was relaxed to <= 2.0 m on the grounds that the
median REJECTED cell missed by 0.20 m.

Two things have to be true for that relaxation to be honest:
  1. the "median rejected cell missed by 0.20 m" claim must reproduce;
  2. 2.0 m must not be so loose that it stops discriminating -- a clause that passes everything
     is not a clause.

The right way to test (2) is not to argue about the number but to measure how much of the
population each threshold admits, and whether the clause still separates cells that an
independent instrument calls good from ones it calls bad.
"""
import collections, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from concurrent.futures import ProcessPoolExecutor

OUT = os.path.join(HERE, 'q7-scan.json')


def work(r):
    import gate
    from judge.conflict import conflict_event
    try:
        tr = gate.load_trace(r['trace'])
        f = gate.trace_facts(tr)
        # Q1's joint challenger, as quality() picks it
        joint = None
        for aid, v in f['perChallenger'].items():
            if (v['clearanceM'] is not None and v['clearanceM'] <= gate.C3_CLEARANCE
                    and v['t'] is not None and v['t'] > f['warmupSeconds'] + gate.C2_MARGIN):
                if joint is None or v['clearanceM'] < f['perChallenger'][joint]['clearanceM']:
                    joint = aid
        ev = conflict_event(tr, challenger=joint)
        return {'trace': r['trace'], 'run': r['run'], 'mapId': r['mapId'], 'siteId': r['siteId'],
                'clearanceM': r['clearanceM'], 'maxPenetrationM': r.get('maxPenetrationM'),
                'joint': joint,
                'pathSeparationM': ev.get('pathSeparationM'),
                'contested': ev.get('contested'),
                'encroachmentGapS': ev.get('encroachmentGapS'),
                'geometry': ev.get('geometry'),
                'lagS': ev.get('lagS'), 'sameEvent': ev.get('sameEvent'),
                'whoArrivedFirst': ev.get('whoArrivedFirst')}
    except Exception as e:                                         # noqa: BLE001
        return {'trace': r['trace'], 'error': str(e)}


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')]
    print('gate-passing cells:', len(ok), flush=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, ok, chunksize=8))
    json.dump(rows, open(OUT, 'w'))
    good = [r for r in rows if r.get('pathSeparationM') is not None]
    ps = np.array([r['pathSeparationM'] for r in good])
    print('computed', len(good), 'of', len(rows))
    for th in (0.0, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 5.0):
        print(f'  pathSep <= {th:4.2f}: {(ps<=th).sum():5d} / {len(ps)} = {(ps<=th).mean():.3f}')
    print('quantiles', np.round(np.quantile(ps, [0, .1, .25, .5, .75, .9, 1]), 3))
