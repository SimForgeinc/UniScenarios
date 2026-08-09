"""Is the critic unreliable, or do scenarios genuinely differ between sites?
  TEST-RETEST: same trace, same prompt, twice  -> disagreement = the CRITIC is noisy
  CROSS-SITE : two sites of one template        -> disagreement = the TEMPLATE retargets inconsistently
"""
import os, sys, json, glob, argparse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import critic, gate


def cells_for(entry, n=2):
    ed = entry.get('evidenceDir')
    bs = os.path.join(ed or '', 'batch-summary.json')
    if not ed or not os.path.exists(bs):
        return []
    try:
        g = gate.gate_batch(bs)
    except Exception:                                             # noqa: BLE001
        return []
    seen, out = set(), []
    for c in g['cells']:
        if not c.get('pass') or not c.get('traceFile'):
            continue
        k = (c.get('mapId'), c.get('siteId'))
        if k in seen:
            continue
        seen.add(k)
        out.append(c)
        if len(out) >= n:
            break
    return out


def _rev(a):
    c, brief, tag = a
    r = critic.review_trace(c['traceFile'], brief,
                            out_png=f"/tmp/retest-{tag}.png", closest_t=c.get('closestT'))
    return {'tag': tag, 'intent': r.get('intentRealised'), 'conf': r.get('confidence'),
            'site': c.get('siteId'), 'why': (r.get('whyNot') or '')[:80]}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--corpus', required=True)
    ap.add_argument('--n', type=int, default=12)
    ap.add_argument('--reps', type=int, default=3)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    C = json.load(open(a.corpus))
    picks = [e for e in C['scenarios'] if e.get('nReviewed')][:a.n]
    jobs, meta = [], []
    for i, e in enumerate(picks):
        cs = cells_for(e, 2)
        if not cs:
            continue
        for rep in range(a.reps):                     # same cell, repeated -> critic noise
            jobs.append((cs[0], e['brief'], f"{i}-c0-r{rep}"))
        if len(cs) > 1:
            jobs.append((cs[1], e['brief'], f"{i}-c1-r0"))   # second site -> template variance
        meta.append({'i': i, 'briefId': e['briefId'], 'nCells': len(cs)})
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(_rev, jobs))
    by = {}
    for r in res:
        by.setdefault(r['tag'], r)
    out = []
    for m in meta:
        i = m['i']
        reps = [by[f"{i}-c0-r{k}"]['intent'] for k in range(a.reps) if f"{i}-c0-r{k}" in by]
        other = by.get(f"{i}-c1-r0", {}).get('intent')
        out.append({**m, 'sameCellVerdicts': reps,
                    'sameCellStable': len(set(reps)) == 1 if reps else None,
                    'otherSiteVerdict': other,
                    'crossSiteAgrees': (other == reps[0]) if (reps and other is not None) else None})
        print(f"  {m['briefId']:26} same-cell {reps} stable={len(set(reps))==1 if reps else None}"
              f"  other-site={other}", flush=True)
    stab = [o for o in out if o['sameCellStable'] is not None]
    cross = [o for o in out if o['crossSiteAgrees'] is not None]
    summ = {'n': len(out),
            'testRetestStable': sum(1 for o in stab if o['sameCellStable']),
            'testRetestN': len(stab),
            'crossSiteAgree': sum(1 for o in cross if o['crossSiteAgrees']),
            'crossSiteN': len(cross), 'rows': out}
    print(f"\nTEST-RETEST (same trace, {a.reps}x): {summ['testRetestStable']}/{summ['testRetestN']} stable")
    print(f"CROSS-SITE  (two sites, 1x each):    {summ['crossSiteAgree']}/{summ['crossSiteN']} agree")
    json.dump(summ, open(a.out, 'w'), indent=1)
