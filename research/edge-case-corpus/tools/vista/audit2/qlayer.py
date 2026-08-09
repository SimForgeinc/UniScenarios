"""Full Q1..Q8 evaluation over every gate-passing cell, so each clause's marginal bite is known
and so the population 'cells rejected ONLY by Q7' can be isolated -- which is the population the
2.0 m relaxation was actually argued about."""
import json, os, sys
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
OUT = os.path.join(HERE, 'qlayer.json')

QK = ('Q1_jointChallenger', 'Q2_egoReallyResponded', 'Q3_noPropOverlap', 'Q4_headingSane',
      'Q5_notClipped', 'Q6_ttcPairIsEgo', 'Q7_contestedSpace', 'Q8_noBodyOverlap')


def work(r):
    import gate
    try:
        g = gate.gate_cell(r['trace'], 'accept', 'critical')
    except Exception as e:                                         # noqa: BLE001
        return {'trace': r['trace'], 'error': str(e)}
    out = {'trace': r['trace'], 'run': r['run'], 'mapId': r['mapId'], 'siteId': r['siteId'],
           'pass': g.get('pass'), 'highQuality': g.get('highQuality'),
           'clearanceM': g.get('clearanceM'), 'minTTC': g.get('minTTC'),
           'egoPeakDecelMps2': g.get('egoPeakDecelMps2'),
           'egoSpeedDropMps': g.get('egoSpeedDropMps'),
           'pathSeparationM': g.get('pathSeparationM'),
           'encroachmentGapS': g.get('encroachmentGapS'),
           'Q1_challenger': g.get('Q1_challenger'), 'closestT': g.get('closestT')}
    for k in QK:
        out[k] = g.get(k)
    return out


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')]
    print('gate-passing cells:', len(ok), flush=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, ok, chunksize=8))
    json.dump(rows, open(OUT, 'w'))
    good = [r for r in rows if 'error' not in r]
    print('ok', len(good))
    for k in QK:
        n = sum(1 for r in good if r.get(k) is False)
        print(f'  {k:24s} fails {n:5d} / {len(good)} = {n/len(good):.3f}')
    hq = sum(1 for r in good if r.get('highQuality'))
    print(f'  highQuality: {hq}/{len(good)} = {hq/len(good):.3f}')
    only7 = [r for r in good if r.get('Q7_contestedSpace') is False
             and all(r.get(k) is not False for k in QK if k != 'Q7_contestedSpace')]
    print('cells rejected by Q7 ALONE:', len(only7))
