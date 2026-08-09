"""Run the sub-tick analysis over gate-passing cells with small positive clearance."""
import json, os, sys, time
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import subtick

def work(r):
    try:
        s = subtick.subtick(r['trace'])
    except Exception as e:
        return {**r, 'suberror': str(e)}
    return {'trace': r['trace'], 'run': r['run'], 'recorded': r['clearanceM'],
            'raw': s and s.get('raw'), 'sub': s and s.get('sub'),
            'relSpeed': s and s.get('relSpeedAtMin'), 'dt': s and s.get('dt')}

if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass') and r.get('clearanceM') is not None
          and 0.0 < r['clearanceM'] <= 2.0]
    print('cells with 0 < clearance <= 2.0 m:', len(ok), flush=True)
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, ok, chunksize=8))
    json.dump(rows, open(os.path.join(HERE, 'subtick.json'), 'w'))
    print('done', len(rows), round(time.time() - t0, 1), 's')
