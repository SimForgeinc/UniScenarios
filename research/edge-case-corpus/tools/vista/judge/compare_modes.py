"""compare_modes.py -- the head-to-head: does SIGHT produce BETTER scenarios, or merely MORE of them?

Reads the authoring loop's own output directories, selects the cells the FROZEN GATE ADMITTED in each
mode, runs the independent quality judge over them, and reports:

  * admission count per mode                      (how MANY)
  * quality distribution per mode                 (how GOOD)
  * quality distribution conditioned on admission (the actual research question)
  * every gate-admitted cell the judge calls boring or invalid, with the reason
  * physics-side conflict statistics per mode from conflict.py

The distinction that matters: a mode that admits twice as many scenarios of the same quality has
produced MORE. A mode whose admitted scenarios score higher has produced BETTER. Those are different
claims and this script keeps them apart, because "sight beat blindness" is only interesting if it is
the second one, or if it is the first one WITHOUT a quality drop.

Usage:
    .venv/bin/python judge/compare_modes.py \
        --sight /tmp/vista-dev-sight --blind /tmp/vista-dev-blind \
        --out /tmp/judge-headtohead --cells-per-brief 3 --workers 5
"""
import argparse, collections, glob, json, os, statistics, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE); sys.path.insert(0, os.path.dirname(_HERE))
import judge as JU
import conflict as CF
import gate as G

VERDICT_ORDER = ['high', 'acceptable', 'physically-valid-but-boring', 'intent-not-realised', 'invalid']
BAD = {'physically-valid-but-boring', 'intent-not-realised', 'invalid'}


def load_records(root):
    out = []
    for rp in sorted(glob.glob(os.path.join(root, '*', 'record.json'))):
        try:
            out.append(json.load(open(rp)))
        except Exception as ex:                                     # noqa: BLE001
            print(f'  ! unreadable {rp}: {ex!r}')
    return out


def pick_cells(rec, n):
    """Gate-PASSING cells from the record, spread across distinct (map, site) so the sample reflects
    the >=2 maps / >=3 sites spread rule rather than n draws at one site."""
    cells = [c for c in (rec.get('lastCells') or []) if c.get('pass') and c.get('traceFile')]
    seen, picked, rest = set(), [], []
    for c in cells:
        k = (c.get('mapId'), c.get('siteId'))
        (picked if k not in seen else rest).append(c)
        seen.add(k)
    return (picked + rest)[:n]


def judge_records(records, mode, out_dir, dev, n_cells, workers):
    from concurrent.futures import ThreadPoolExecutor
    jobs = []
    for rec in records:
        if not rec.get('admitted'):
            continue
        for c in pick_cells(rec, n_cells):
            jobs.append((rec, c))
    print(f'{mode}: {sum(1 for r in records if r.get("admitted"))} admitted briefs '
          f'-> {len(jobs)} gate-passing cells to judge')

    def one(job):
        rec, c = job
        tag = f"{mode}-{rec['briefId']}-{c['mapId'][:6]}-{str(c['siteId'])[:6]}"
        try:
            r = JU.judge_trace(c['traceFile'], rec['brief'], out_dir, dev,
                               instance_path=c.get('instanceFile'),
                               gate_verdict=c.get('verdict'), gate_band=c.get('band'),
                               tag=tag, keep_images=False)
        except Exception as ex:                                     # noqa: BLE001
            return {'mode': mode, 'briefId': rec['briefId'], 'error': repr(ex),
                    'trace': c['traceFile']}
        r.update({'mode': mode, 'briefId': rec['briefId'], 'category': rec.get('category'),
                  'iterations': len(rec.get('iterations') or []), 'wallClockS': rec.get('wallClockS')})
        r['gate']['pass'] = True
        try:
            ev = CF.conflict_event(JU.F.load_trace(c['traceFile']))
            r['conflict'] = {k: ev.get(k) for k in
                             ('challenger', 'contested', 'pathSeparationM', 'tCross',
                              'encroachmentGapS', 'sameEvent', 'lagS', 'geometry',
                              'challengerSpeedAtEgoArrival')}
            r['conflict']['C3b'] = CF.c3b_conflict_is_the_proximity(ev)[0]
        except Exception as ex:                                     # noqa: BLE001
            r['conflict'] = {'error': repr(ex)}
        # keep the record small
        r.pop('stage1', None); r.pop('stage2', None); r.pop('features', None)
        print(f"  {tag}: {r['verdict']:28s} {r['scores']} diff={r['difficultyMeasured']['score']}",
              flush=True)
        return r

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, jobs))


def dist(rs):
    c = collections.Counter(r.get('verdict') for r in rs if 'error' not in r)
    return {v: c.get(v, 0) for v in VERDICT_ORDER}


def report(sight_recs, blind_recs, sj, bj, out_dir):
    L = []

    def p(s=''):
        print(s); L.append(s)

    def block(name, recs, js):
        adm = [r for r in recs if r.get('admitted')]
        ok = [r for r in js if 'error' not in r]
        p(f'### {name}')
        p(f'  briefs attempted            {len(recs)}')
        p(f'  briefs ADMITTED by the gate {len(adm)}  '
          f'({len(adm)/max(len(recs),1):.3f})')
        p(f'  cells judged                {len(ok)}   (errors {len(js)-len(ok)})')
        d = dist(js)
        for k, v in d.items():
            p(f'    {k:30s} {v:3d}  {v/max(len(ok),1):.3f}')
        p(f'  cells the gate admitted that the judge rejects: '
          f'{sum(v for k,v in d.items() if k in BAD)}/{len(ok)} '
          f'({sum(v for k,v in d.items() if k in BAD)/max(len(ok),1):.3f})')
        if ok:
            for dim in ('R1', 'R2', 'R3', 'R4', 'R5'):
                vals = [r['scores'][dim] for r in ok]
                p(f'    mean {dim} {statistics.mean(vals):.2f}')
            p(f'    mean measured difficulty {statistics.mean(r["difficultyMeasured"]["score"] for r in ok):.1f}')
            it = [r['iterations'] for r in ok if r.get('iterations')]
            wc = [r['wallClockS'] for r in recs if r.get('admitted') and r.get('wallClockS')]
            if it: p(f'    mean authoring iterations (admitted) {statistics.mean(it):.2f}')
            if wc: p(f'    mean wall clock per admitted brief   {statistics.mean(wc):.1f} s')
            cf = [r.get('conflict', {}) for r in ok if isinstance(r.get('conflict'), dict)]
            ct = [c for c in cf if c.get('contested') is not None]
            if ct:
                p(f'    contested-space (paths actually overlap) '
                  f'{sum(1 for c in ct if c["contested"])}/{len(ct)}')
                gaps = [c['encroachmentGapS'] for c in ct if c.get('encroachmentGapS') is not None]
                if gaps:
                    p(f'    encroachment gap median {statistics.median(gaps):.2f} s')
                p(f'    C3b (conflict IS the proximity) '
                  f'{sum(1 for c in ct if c.get("C3b"))}/{len(ct)}')
        p()

    p('# HEAD-TO-HEAD: sight vs blind, judged independently')
    p()
    block('SIGHT', sight_recs, sj)
    block('BLIND', blind_recs, bj)

    sok, bok = [r for r in sj if 'error' not in r], [r for r in bj if 'error' not in r]
    sadm = sum(1 for r in sight_recs if r.get('admitted'))
    badm = sum(1 for r in blind_recs if r.get('admitted'))
    p('### The question: better, or merely more?')
    p(f'  admission   sight {sadm}/{len(sight_recs)} vs blind {badm}/{len(blind_recs)}')
    if sok and bok:
        sgood = sum(1 for r in sok if r['verdict'] in ('high', 'acceptable')) / len(sok)
        bgood = sum(1 for r in bok if r['verdict'] in ('high', 'acceptable')) / len(bok)
        p(f'  quality of ADMITTED cells (high or acceptable): '
          f'sight {sgood:.3f} vs blind {bgood:.3f}')
        p(f'  "high" rate: '
          f'sight {sum(1 for r in sok if r["verdict"]=="high")/len(sok):.3f} vs '
          f'blind {sum(1 for r in bok if r["verdict"]=="high")/len(bok):.3f}')
        p(f'  mean measured difficulty: '
          f'sight {statistics.mean(r["difficultyMeasured"]["score"] for r in sok):.1f} vs '
          f'blind {statistics.mean(r["difficultyMeasured"]["score"] for r in bok):.1f}')
        # effective yield: admitted briefs x fraction of their cells that survive the judge
        p(f'  QUALITY-ADJUSTED YIELD (admitted briefs x fraction of cells judged high/acceptable):')
        p(f'    sight {sadm} x {sgood:.3f} = {sadm*sgood:.2f}')
        p(f'    blind {badm} x {bgood:.3f} = {badm*bgood:.2f}')
    p()

    p('### Gate admitted, judge rejects')
    any_bad = False
    for r in sok + bok:
        if r['verdict'] in BAD:
            any_bad = True
            p(f"  [{r['mode']}] {r['briefId']} ({r.get('category')})  -> {r['verdict']}  "
              f"{r['scores']}")
            p(f"      brief : {r['brief']}")
            p(f"      why   : {r['oneLine']}")
            if r.get('mechanicalFlags'):
                p(f"      flags : {', '.join(r['mechanicalFlags'])}")
            if r.get('capsApplied'):
                p(f"      caps  : {r['capsApplied']}")
            p(f"      trace : {r['trace']}")
    if not any_bad:
        p('  none')
    p()

    os.makedirs(out_dir, exist_ok=True)
    open(os.path.join(out_dir, 'HEAD-TO-HEAD.md'), 'w').write('\n'.join(L))
    json.dump({'sight': sj, 'blind': bj,
               'sightRecords': [{k: v for k, v in r.items() if k not in ('iterations', 'template')}
                                for r in sight_recs],
               'blindRecords': [{k: v for k, v in r.items() if k not in ('iterations', 'template')}
                                for r in blind_recs]},
              open(os.path.join(out_dir, 'head-to-head.json'), 'w'), indent=1, default=str)
    print(f"\nwrote {out_dir}/HEAD-TO-HEAD.md and head-to-head.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sight', required=True)
    ap.add_argument('--blind', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cells-per-brief', type=int, default=3)
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--dev-assets', default=None)
    a = ap.parse_args()
    dev = a.dev_assets or JU._default_dev_assets()
    S, B = load_records(a.sight), load_records(a.blind)
    os.makedirs(a.out, exist_ok=True)
    sj = judge_records(S, 'sight', a.out, dev, a.cells_per_brief, a.workers)
    bj = judge_records(B, 'blind', a.out, dev, a.cells_per_brief, a.workers)
    report(S, B, sj, bj, a.out)


if __name__ == '__main__':
    main()
