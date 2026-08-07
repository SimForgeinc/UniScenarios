"""Run the authoring loop over a set of briefs, in parallel, and collect the results."""
import os, sys, json, time, argparse, traceback
from concurrent.futures import ProcessPoolExecutor, as_completed

import author, gate

CORPUS = ('/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista/'
          'research/edge-case-corpus/agent-authoring/brief-corpus.json')


def load_briefs(split=None, corpus=CORPUS):
    d = json.load(open(corpus))
    by_id = {b['id']: b for b in d['briefs']}
    if split is None:
        return d['briefs']
    ids = d['split'][split]
    return [by_id[i] for i in ids if i in by_id]


def _one(args):
    b, mode, root, max_iters = args
    outdir = f"{root}/{b['id']}-{mode}"
    try:
        r = author.author(b['id'], b['brief'], b['category'], outdir, mode=mode,
                          max_iters=max_iters, log=lambda *_: None)
    except Exception as e:                                        # noqa: BLE001
        r = {'briefId': b['id'], 'mode': mode, 'category': b['category'], 'admitted': False,
             'error': f'{type(e).__name__}: {e}', 'tb': traceback.format_exc()[-1500:],
             'outdir': outdir}
    r['outdir'] = outdir
    lg = r.get('lastGate') or {}
    print(f"[{mode}] {b['id']:26} admitted={str(r.get('admitted')):5} "
          f"HQ={str(lg.get('admittedHQ')):5} cells={lg.get('passingCells')}/{lg.get('totalCells')} "
          f"iters={len(r.get('iterations', []))} {r.get('wallClockS', 0)}s"
          + (f"  ERROR {r.get('error')}" if r.get('error') else ''), flush=True)
    return r


def run(briefs, mode, root, workers=3, max_iters=4):
    os.makedirs(root, exist_ok=True)
    jobs = [(b, mode, root, max_iters) for b in briefs]
    out = []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_one, j): j for j in jobs}
        for f in as_completed(futs):
            out.append(f.result())
    summary = {
        'mode': mode, 'root': root, 'n': len(out),
        'admitted': sum(1 for r in out if r.get('admitted')),
        'admittedHQ': sum(1 for r in out if (r.get('lastGate') or {}).get('admittedHQ')),
        'rate': round(sum(1 for r in out if r.get('admitted')) / max(1, len(out)), 4),
        'rateHQ': round(sum(1 for r in out if (r.get('lastGate') or {}).get('admittedHQ')) / max(1, len(out)), 4),
        'wallClockS': round(time.time() - t0, 1),
        'meanWallPerBriefS': round(sum(r.get('wallClockS', 0) for r in out) / max(1, len(out)), 1),
        'meanIters': round(sum(len(r.get('iterations', [])) for r in out) / max(1, len(out)), 2),
        'surfaceSha': author.SURFACE_SHA,
        'results': [{k: v for k, v in r.items() if k not in ('iterations', 'template', 'lastCells')}
                    for r in out],
    }
    json.dump(summary, open(f'{root}/SUMMARY.json', 'w'), indent=1, default=str)
    print(f"\n== {mode}: admitted {summary['admitted']}/{summary['n']} = {summary['rate']}"
          f" | HQ {summary['admittedHQ']}/{summary['n']} = {summary['rateHQ']}"
          f" | {summary['wallClockS']}s wall, {summary['meanWallPerBriefS']}s/brief mean,"
          f" {summary['meanIters']} iters ==")
    return summary


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--split', default='DEV')
    ap.add_argument('--mode', default='sight')
    ap.add_argument('--root', required=True)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--max-iters', type=int, default=4)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--corpus', default=CORPUS)
    a = ap.parse_args()
    bs = load_briefs(None if a.split == 'ALL' else a.split, a.corpus)
    if a.limit:
        bs = bs[:a.limit]
    run(bs, a.mode, a.root, a.workers, a.max_iters)
