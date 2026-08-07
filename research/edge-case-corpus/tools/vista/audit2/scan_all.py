"""Scan every accept/critical cell across all runs: re-gate C1-C5 + independent interpenetration."""
import glob, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fastgate

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scan-all.json')


def collect():
    jobs = []
    for s in sorted(glob.glob('/tmp/vista-*/*/batch-*/batch-summary.json')):
        try:
            d = json.load(open(s))
        except Exception:
            continue
        run = s.split('/')[2]
        for r in d.get('results', []):
            tf = r.get('traceFile')
            if r.get('status') != 'ok' or not tf or not os.path.exists(tf):
                continue
            jobs.append({'run': run, 'summary': s, 'trace': tf, 'mapId': r.get('mapId'),
                         'siteId': r.get('siteId'), 'verdict': r.get('verdict'), 'band': r.get('band'),
                         'drawIndex': r.get('drawIndex')})
    # accept/critical only -- the only cells that can pass C5
    return [j for j in jobs if j['verdict'] == 'accept' and j['band'] == 'critical']


def work(j):
    try:
        f = fastgate.scan(j['trace'])
    except Exception as e:
        return {**j, 'error': str(e)}
    f.pop('perChallenger', None)
    c5 = f['collisions'] == 0 and not f['triggerNeverFired']
    f['C5'] = c5
    f['pass'] = bool(f['C1'] and f['C2'] and f['C3'] and f['C4'] and c5)
    return {**j, **f}


if __name__ == '__main__':
    jobs = collect()
    print('candidates', len(jobs), flush=True)
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, jobs, chunksize=16))
    json.dump(rows, open(OUT, 'w'))
    print('done', len(rows), round(time.time() - t0, 1), 's ->', OUT)
