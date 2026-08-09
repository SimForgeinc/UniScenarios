"""Does USING changeLane actually produce more real incursions?

The parent's diagnosis -- that authors hand-roll `route` polylines instead of using the engine's
lateral primitive -- is confirmed by the counts. But a primitive being unused only matters if using
it works. This measures the true incursion rate (corrected arbiter, `arbiter2.py`) in the traces of
templates that DO use `changeLane`, against those that use `route[polyline]` instead.

This is a prospective test of the A/B before it lands. If the changeLane templates already show a
higher true incursion rate, the hypothesis is supported. If they do not, the A/B will disappoint.
"""
import collections, glob, json, os, sys
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import authoring_audit as AA


def template_for_run(run_dir):
    """briefId -> which lateral primitives its final template uses."""
    out = {}
    for p in sorted(glob.glob(run_dir + '/*/template.json')):
        bid = os.path.basename(os.path.dirname(p))
        try:
            t = json.load(open(p))
        except Exception:
            continue
        ints = ((t.get('choreography') or {}).get('interactions') or [])
        v = collections.Counter()
        for it in ints:
            tgt = it.get('target') or {}
            mode = tgt.get('mode') if isinstance(tgt, dict) else None
            v[f"{it.get('verb')}" + (f'[{mode}]' if mode else '')] += 1
        out[bid] = v
    return out


def work(args):
    trace, = args
    import gate
    import arbiter2 as AR
    try:
        tr = gate.load_trace(trace)
    except Exception:
        return None
    inc, dec = False, 0
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        g = AR.geometric_incursion(tr, aid)
        if g and g['decisive']:
            dec += 1
            inc = inc or g['incursion']
    return {'trace': trace, 'incursion': inc, 'nDecisive': dec}


if __name__ == '__main__':
    runs = ['/tmp/vista-gen-blind', '/tmp/vista-gen2-blind', '/tmp/vista-gen3-blind',
            '/tmp/vista-gen4-blind']
    rows = []
    for rd in runs:
        tpl = template_for_run(rd)
        for p in sorted(glob.glob(rd + '/*/record.json')):
            bid = os.path.basename(os.path.dirname(p))
            v = tpl.get(bid)
            if v is None:
                continue
            try:
                rec = json.load(open(p))
            except Exception:
                continue
            cells = [c for c in (rec.get('lastCells') or [])
                     if c.get('pass') and c.get('traceFile') and os.path.exists(c['traceFile'])]
            if not cells:
                continue
            uses_cl = sum(n for k, n in v.items() if k.startswith('changeLane'))
            uses_lo = v.get('laneOffset', 0)
            uses_rp = sum(n for k, n in v.items() if k.startswith('route'))
            rows.append({'run': rd.split('/')[-1], 'briefId': bid, 'changeLane': uses_cl,
                         'laneOffset': uses_lo, 'route': uses_rp,
                         'traces': [c['traceFile'] for c in cells[:12]]})
    jobs = [(t,) for r in rows for t in r['traces']]
    print('templates with passing cells:', len(rows), '| traces to arbitrate:', len(jobs), flush=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        res = [x for x in ex.map(work, jobs, chunksize=16) if x]
    byt = {r['trace']: r for r in res}
    for r in rows:
        got = [byt[t] for t in r['traces'] if t in byt and byt[t]['nDecisive'] > 0]
        r['nCells'] = len(got)
        r['nIncursion'] = sum(1 for g in got if g['incursion'])
        r['incursionRate'] = (r['nIncursion'] / len(got)) if got else None
    json.dump(rows, open(os.path.join(HERE, 'authoring-incursion.json'), 'w'), indent=1)

    def summarise(sel, label):
        g = [r for r in rows if sel(r) and r['nCells'] > 0]
        cells = sum(r['nCells'] for r in g)
        inc = sum(r['nIncursion'] for r in g)
        print(f'  {label:44s} templates={len(g):4d} cells={cells:5d} '
              f'trueIncursionRate={inc/cells if cells else float("nan"):.3f}')

    print('\nTRUE incursion rate (corrected arbiter) by which lateral primitive the template uses:')
    summarise(lambda r: r['changeLane'] > 0, 'uses changeLane')
    summarise(lambda r: r['changeLane'] == 0 and r['laneOffset'] > 0, 'uses laneOffset (no changeLane)')
    summarise(lambda r: r['changeLane'] == 0 and r['laneOffset'] == 0, 'uses NEITHER (route polylines only)')
    summarise(lambda r: True, 'ALL')
