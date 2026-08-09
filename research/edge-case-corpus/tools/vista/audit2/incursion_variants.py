"""Isolate the cause of hybrid's entersEgoPath over-firing, and quantify the fix.

Variants, all scored against the ENGINE's own lateralOffsetM arbiter:
  A  hybrid as shipped
  B  hybrid + a LONGITUDINAL GATE: only count ticks where the challenger is within LON_GATE_M
     ahead/behind. This is the one-line change that tests H3 directly.
  C  this audit's method: distance from the body to the ego's TRAVELLED PATH POLYLINE, requiring
     an excursion of >= 2.8 m before entry. Curvature-robust and longitudinally independent.
"""
import collections, json, math, os, sys
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

LON_GATE_M = 30.0


def variant_B(trace, aid, lon_gate=LON_GATE_M, lat_m=1.2):
    import motion
    off = motion.ego_frame_offsets(trace, aid)
    pts = [p for p in off if p and abs(p[0]) <= lon_gate]
    if len(pts) < 3:
        return False
    lats = [abs(p[1]) for p in pts]
    if lats[0] <= lat_m:
        return False
    return any(v <= lat_m for v in lats)


def work(r):
    import gate, motion, lane_arbiter as LA
    import predicates as PR
    try:
        tr = gate.load_trace(r['trace'])
        F = PR.trace_facts(r['trace'])
    except Exception as e:                                        # noqa: BLE001
        return {'trace': r['trace'], 'error': str(e)}
    rows = []
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        arb = LA.incursion(tr, aid)
        if not arb or not arb['decisive']:
            continue
        m = motion.facts(tr, aid)
        b = F['bodies'].get(aid, {})
        rows.append({
            'truth': arb['incursion'],
            'A': bool(m and m['entersEgoPath']),
            'B': bool(variant_B(tr, aid)),
            'C': bool(b.get('entryExcursionM') is not None
                      and b['entryExcursionM'] >= PR.THRESHOLDS['entryExcursionM'][0]),
        })
    return {'trace': r['trace'], 'run': r['run'], 'rows': rows}


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')][::2]        # every 2nd cell: 800+ traces is plenty
    with ProcessPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(work, ok, chunksize=16))
    rows = [x for r in res if 'rows' in r for x in r['rows']]
    json.dump(rows, open(os.path.join(HERE, 'incursion-variants.json'), 'w'))
    print(f'challenger-level rows with a decisive arbiter: {len(rows)}')
    print(f"true incursion rate: {sum(1 for r in rows if r['truth'])/len(rows):.3f}\n")
    print(f"{'variant':56s} {'prec':>6s} {'recall':>7s} {'F1':>6s} {'acc':>6s}  TP/FP/FN/TN")
    names = {'A': 'A  hybrid as shipped (no longitudinal gate)',
             'B': 'B  hybrid + longitudinal gate |lon| <= 30 m  (1-line fix)',
             'C': 'C  audit: distance to the ego PATH POLYLINE, excursion >= 2.8 m'}
    for k in ('A', 'B', 'C'):
        tp = sum(1 for r in rows if r[k] and r['truth'])
        fp = sum(1 for r in rows if r[k] and not r['truth'])
        fn = sum(1 for r in rows if not r[k] and r['truth'])
        tn = sum(1 for r in rows if not r[k] and not r['truth'])
        p = tp / (tp + fp) if tp + fp else float('nan')
        rc = tp / (tp + fn) if tp + fn else float('nan')
        f1 = 2 * p * rc / (p + rc) if p == p and rc == rc and p + rc else float('nan')
        print(f'{names[k]:56s} {p:6.3f} {rc:7.3f} {f1:6.3f} {(tp+tn)/len(rows):6.3f}  {tp}/{fp}/{fn}/{tn}')
