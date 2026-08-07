"""Run the critic over an already-collected corpus to produce the INTENT-VERIFIED subset."""
import os, sys, json, glob, argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import critic, gate


def _one(a):
    entry, limit = a
    ed = entry.get('evidenceDir')
    if not ed or not os.path.isdir(ed):
        return {**entry, 'criticError': 'no evidence dir'}
    bs = os.path.join(ed, 'batch-summary.json')
    if not os.path.exists(bs):
        return {**entry, 'criticError': 'no batch summary'}
    try:
        g = gate.gate_batch(bs)
    except Exception as e:                                        # noqa: BLE001
        return {**entry, 'criticError': f'gate: {e}'}
    passing = [c for c in g['cells'] if c.get('pass')]
    if not passing:
        return {**entry, 'criticError': 'no passing cells'}
    cr = critic.review_cells(passing, entry['brief'], limit=limit, reps=3, workers=3)
    return {**entry, 'intentRealised': cr['intentRealised'], 'verdict': cr['verdict'],
            'yesFraction': cr['yesFraction'], 'uncertain': cr['uncertain'],
            'unanimous': cr['unanimous'],
            'nIntentRealised': cr['nIntentRealised'], 'nReviewed': cr['n'],
            'genuineConflict': cr['genuineConflict'], 'whyNot': cr['whyNot'],
            'whatISee': cr['whatISee']}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=2)
    ap.add_argument('--workers', type=int, default=5)
    a = ap.parse_args()
    C = json.load(open(a.corpus))
    jobs = [(e, a.limit) for e in C['scenarios']]
    res = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for f in as_completed([ex.submit(_one, j) for j in jobs]):
            r = f.result()
            res.append(r)
            print(f"{r['briefId']:26} intent={str(r.get('intentRealised')):5} "
                  f"({r.get('nIntentRealised')}/{r.get('nReviewed')}) HQ={r.get('admittedHQ')} "
                  f"{str(r.get('whyNot') or r.get('criticError') or '')[:70]}", flush=True)
    ok = [r for r in res if r.get('verdict') == 'verified']
    unc = [r for r in res if r.get('verdict') == 'uncertain']
    rej = [r for r in res if r.get('verdict') == 'rejected']
    okhq = [r for r in ok if r.get('admittedHQ')]
    out = {'n': len(res), 'intentRealised': len(ok), 'uncertain': len(unc), 'rejected': len(rej),
           'intentRealisedAndHQ': len(okhq),
           'rate': round(len(ok) / max(len(res), 1), 4),
           'unanimousFrac': round(sum(1 for r in res if r.get('unanimous')) / max(len(res), 1), 3),
           'categories': sorted({r['category'] for r in ok}),
           'scenarios': sorted(res, key=lambda r: r['briefId'])}
    json.dump(out, open(a.out, 'w'), indent=1)
    print(f"\n== verified {len(ok)} | uncertain {len(unc)} | rejected {len(rej)}  of {len(res)}"
          f" | verified AND high-quality {len(okhq)} | unanimous {out['unanimousFrac']:.3f} ==")
