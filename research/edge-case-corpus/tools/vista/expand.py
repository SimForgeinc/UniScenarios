"""Test whether non-admitted templates were actually FAILURES or just UNDER-SAMPLED.

Re-runs each non-admitted template over a much larger site x draw matrix and re-gates it.
No model calls, no re-authoring: the template is exactly what the loop produced.
"""
import os, sys, json, glob, argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import author, gate


def _one(a):
    tpl, out, sites, draws = a
    bid = os.path.basename(os.path.dirname(tpl))
    rc, bd, err = author.run_cli(['batch', tpl, '--all-maps', '--draws', str(draws),
                                  '--max-sites', str(sites), '--out', out, '--concurrency', '2'])
    if not bd.get('results'):
        return {'brief': bid, 'admitted': False, 'error': (json.dumps(bd)[:200] or err[:200])}
    g = gate.gate_batch(out + '/batch-summary.json')
    return {'brief': bid, 'admitted': g['admitted'], 'admittedHQ': g['admittedHQ'],
            'passingCells': g['passingCells'], 'passingCellsHQ': g['passingCellsHQ'],
            'totalCells': g['totalCells'], 'nMaps': g['nMaps'], 'nSites': g['nSites'],
            'lossCounts': g['lossCounts'], 'out': out}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sites', type=int, default=10)
    ap.add_argument('--draws', type=int, default=3)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--only-failed', action='store_true')
    a = ap.parse_args()
    jobs = []
    for f in sorted(glob.glob(a.root + '/*/record.json')):
        r = json.load(open(f))
        if a.only_failed and r.get('admitted'):
            continue
        tpl = os.path.dirname(f) + '/template.json'
        if not os.path.exists(tpl):
            continue
        jobs.append((tpl, a.out + '/' + r['briefId'], a.sites, a.draws))
    os.makedirs(a.out, exist_ok=True)
    res = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for fu in as_completed([ex.submit(_one, j) for j in jobs]):
            r = fu.result()
            res.append(r)
            print(f"{r['brief']:34} admitted={str(r.get('admitted')):5} HQ={str(r.get('admittedHQ')):5} "
                  f"cells={r.get('passingCells')}/{r.get('totalCells')} maps={r.get('nMaps')} "
                  f"sites={r.get('nSites')}", flush=True)
    n = len(res)
    rec = sum(1 for r in res if r.get('admitted'))
    print(f"\n== RECOVERED BY WIDER SAMPLING: {rec}/{n} previously-failed templates now admit ==")
    json.dump({'root': a.root, 'sites': a.sites, 'draws': a.draws, 'n': n, 'recovered': rec,
               'results': res}, open(a.out + '/EXPANSION.json', 'w'), indent=1)
