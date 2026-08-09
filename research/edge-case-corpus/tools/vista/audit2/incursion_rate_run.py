"""Measure the TRUE lateral-incursion rate of any run, with the corrected arbiter.

    python incursion_rate_run.py /tmp/vista-gen4-blind [/tmp/vista-gen3-blind ...]

Reports, per run: the true incursion rate over gate-passing cells, and the split into the two
failure modes that decide whether a lateral-primitive fix can help --
  TARGETING  the challenger moved sideways but stopped short of the ego's corridor
  PLACEMENT  the challenger was already in the ego's corridor from the start and never moved
This is the measurement the auditor was asked to run on the changeLane A/B.
"""
import collections, glob, json, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

MOVED_LAT_M = 1.0
IN_M = 1.25
LEAD_NAMES = ('lead', 'ahead', 'front', 'queue', 'slow')


def cells_of(run_dir):
    out = []
    for p in sorted(glob.glob(run_dir + '/*/record.json')):
        try:
            rec = json.load(open(p))
        except Exception:
            continue
        for c in (rec.get('lastCells') or []):
            if c.get('pass') and c.get('traceFile') and os.path.exists(c['traceFile']):
                out.append({'trace': c['traceFile'], 'briefId': rec.get('briefId'),
                            'category': rec.get('category')})
    return out


def work(r):
    import gate
    import arbiter2 as AR
    try:
        tr = gate.load_trace(r['trace'])
    except Exception:
        return None
    best = None
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        g = AR.geometric_incursion(tr, aid)
        if not g or not g['decisive']:
            continue
        if best is None or g['minAbsM'] < best[1]['minAbsM']:
            best = (aid, g)
    if best is None:
        return None
    aid, g = best
    if g['incursion']:
        cls = 'incursion'
    elif g['rangeM'] < MOVED_LAT_M:
        cls = ('lead_vehicle' if (g['minAbsM'] <= IN_M
                                  and any(k in aid.lower() for k in LEAD_NAMES))
               else ('placement_defect' if g['minAbsM'] <= IN_M else 'static_outside'))
    else:
        cls = 'targeting_defect'
    return {**r, 'actor': aid, 'class': cls, 'minAbsM': g['minAbsM'], 'rangeM': g['rangeM']}


def measure(run_dir, workers=2):
    cs = cells_of(run_dir)
    if not cs:
        return None
    with ProcessPoolExecutor(max_workers=workers) as ex:
        rows = [x for x in ex.map(work, cs, chunksize=16) if x]
    if not rows:
        return None
    n = len(rows)
    c = collections.Counter(r['class'] for r in rows)
    k = c['incursion']
    z = 1.96
    p = k / n
    d = 1 + z * z / n
    ctr = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return {'run': os.path.basename(run_dir.rstrip('/')), 'nCells': n,
            'trueIncursionRate': round(p, 4), 'ci95': (round(max(0, ctr - h), 4),
                                                       round(min(1, ctr + h), 4)),
            'counts': dict(c), 'rows': rows}


if __name__ == '__main__':
    runs = sys.argv[1:] or ['/tmp/vista-gen2-blind', '/tmp/vista-gen3-blind', '/tmp/vista-gen4-blind']
    out = []
    for rd in runs:
        m = measure(rd)
        if not m:
            print(f'{rd}: no gate-passing cells yet')
            continue
        out.append({k: v for k, v in m.items() if k != 'rows'})
        c, n = m['counts'], m['nCells']
        print(f"\n{m['run']}  n={n}")
        print(f"  TRUE incursion rate      {m['trueIncursionRate']:.3f}  95% CI {m['ci95']}")
        for k2, lab in (('targeting_defect', 'moved sideways, stopped short  (TARGETING)'),
                        ('placement_defect', 'spawned already in ego lane    (PLACEMENT)'),
                        ('lead_vehicle', 'legitimate lead vehicle'),
                        ('static_outside', 'never moved, stayed outside')):
            print(f"  {lab:44s} {c.get(k2,0):5d}  {c.get(k2,0)/n:.3f}")
    json.dump(out, open(os.path.join(HERE, 'incursion-rate-by-run.json'), 'w'), indent=1)
