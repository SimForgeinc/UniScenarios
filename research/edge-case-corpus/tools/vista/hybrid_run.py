"""Validate every admitted template in a run with the HYBRID validator (exact + brief-parse)."""
import os, sys, json, glob, argparse
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate, hybrid


def one(rec_path):
    r = json.load(open(rec_path))
    if not r.get('admitted'):
        return None
    bs = os.path.join(r.get('evidenceDir') or '', 'batch-summary.json')
    if not os.path.exists(bs):
        return None
    try:
        g = gate.gate_batch(bs)
    except Exception as e:                                        # noqa: BLE001
        return {'briefId': r['briefId'], 'error': str(e)}
    cells = [c for c in g['cells'] if c.get('pass') and c.get('traceFile')]
    if not cells:
        return None
    try:
        parsed = hybrid.parse_brief(r['brief'])
    except Exception as e:                                        # noqa: BLE001
        return {'briefId': r['briefId'], 'error': 'parse: ' + str(e)}
    # evaluate on up to 4 distinct sites; a template counts as realised only if the MAJORITY of its
    # sites realise it, because retargeting can break the mechanism at some sites.
    seen, picks = set(), []
    for c in cells:
        k = (c['mapId'], c['siteId'])
        if k in seen:
            continue
        seen.add(k)
        picks.append(c)
        if len(picks) >= 4:
            break
    vs = []
    for c in picks:
        try:
            vs.append(hybrid.validate(c['traceFile'], None, parsed=parsed))
        except Exception:                                         # noqa: BLE001
            pass
    if not vs:
        return {'briefId': r['briefId'], 'error': 'no evaluations'}
    pres = sum(1 for v in vs if v['verdict'].startswith('present'))
    absent = sum(1 for v in vs if v['verdict'] == 'absent')
    abst = sum(1 for v in vs if v['verdict'] == 'abstain')
    verdict = ('present' if pres > len(vs) / 2 else
               ('abstain' if abst > len(vs) / 2 else 'absent'))
    miss = {}
    for v in vs:
        for m in v.get('missing', []):
            miss[m] = miss.get(m, 0) + 1
    return {'briefId': r['briefId'], 'category': r.get('category'), 'brief': r['brief'],
            'verdict': verdict, 'nSites': len(vs), 'present': pres, 'absent': absent,
            'abstain': abst, 'missing': miss, 'predicates': parsed['required'],
            'notComputable': parsed['notComputable'],
            'evidenceDir': r.get('evidenceDir'),
            'template': os.path.dirname(rec_path) + '/template.json'}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()
    recs = sorted(glob.glob(a.root + '/*/record.json'))
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        res = [r for r in ex.map(one, recs) if r]
    ok = [r for r in res if r.get('verdict') == 'present']
    ab = [r for r in res if r.get('verdict') == 'abstain']
    no = [r for r in res if r.get('verdict') == 'absent']
    miss = {}
    for r in no:
        for k, v in (r.get('missing') or {}).items():
            miss[k] = miss.get(k, 0) + v
    for r in sorted(res, key=lambda x: str(x.get('verdict'))):
        print(f"  {r['briefId']:34} {str(r.get('verdict')):8} "
              f"{'missing=' + ','.join((r.get('missing') or {}).keys()) if r.get('missing') else ''}")
    print(f"\n== present {len(ok)} | absent {len(no)} | abstain {len(ab)}  of {len(res)} admitted ==")
    print(f"   most common missing predicate: {sorted(miss.items(), key=lambda x: -x[1])[:6]}")
    json.dump({'root': a.root, 'n': len(res), 'present': len(ok), 'absent': len(no),
               'abstain': len(ab), 'missingCounts': miss, 'rows': res}, open(a.out, 'w'), indent=1)
