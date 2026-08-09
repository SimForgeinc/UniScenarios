"""M1.3: how many usable sites does each archetype retain after anchor tightening?

Reads templates straight from a dataset, re-runs `sites match`, and records the candidate count and
verdict split per archetype. The point of the measure is that tightening context requirements must not
quietly starve an archetype to death: >=4 sites each, or the yield has collapsed and the tightening is
not actually usable.
"""
import os, sys, json, argparse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import author


def count(template):
    rc, d, err = author.run_cli(['sites', 'match', template, '--all-maps', '--max-sites', '400'])
    if rc != 0:
        return {'error': (d or {}).get('code') or err[:200], 'sites': 0}
    ex = de = 0
    for m in d.get('maps', []):
        v = m.get('verdicts') or {}
        ex += int(v.get('exact', 0))
        de += int(v.get('degraded', 0))
    return {'sites': d.get('totalSites', 0), 'exact': ex, 'degraded': de,
            'exactFrac': round(ex / max(ex + de, 1), 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', nargs='+', required=True)
    ap.add_argument('--out', default='/tmp/vista-sitecounts.json')
    ap.add_argument('--detail', default='/tmp/vista-sitecounts-detail.json')
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()
    recs = []
    for f in a.dataset:
        recs += [json.loads(l) for l in open(f)]
    tpl = {}
    for r in recs:
        tpl.setdefault(r['archetypeId'], r['template'])
    keys = sorted(tpl)
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        res = list(ex.map(lambda k: count(tpl[k]), keys))
    detail = dict(zip(keys, res))
    simple = {k: v.get('sites', 0) for k, v in detail.items()}
    json.dump(simple, open(a.out, 'w'), indent=1)
    json.dump(detail, open(a.detail, 'w'), indent=1)
    thin = {k: v for k, v in simple.items() if v < 4}
    print(f"{'archetype':32}{'sites':>7}{'exact':>7}{'degr':>7}{'exactFrac':>11}")
    for k in keys:
        d = detail[k]
        print(f"  {k:30}{d.get('sites',0):7}{d.get('exact',0):7}{d.get('degraded',0):7}"
              f"{str(d.get('exactFrac','-')):>11}{'   <-- BELOW 4' if simple[k] < 4 else ''}")
    print(f"\narchetypes below 4 usable sites: {len(thin)} {list(thin) if thin else ''}")


if __name__ == '__main__':
    main()
