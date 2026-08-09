"""Re-run the incursion comparison against the CORRECTED arbiter, and re-score current hybrid.py.

Also quantifies the distinction the disagreements revealed:
    engine `lateralOffsetM`   -> did the body move WITHIN its own lane/route?   (a lane change/drift)
    corrected ego-path geometry -> did the body come from outside INTO the ego's swept corridor?
                                   (a path encroachment)
A vehicle crossing a junction encroaches on the ego's path without ever leaving its own lane, so the
two legitimately differ. `challenger_enters_ego_path` is a PATH ENCROACHMENT predicate, so the
corrected geometry is the right arbiter and the engine series is a cross-check on the drift subclass.
"""
import collections, json, os, sys
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
    import gate, motion
    import arbiter2 as AR
    try:
        tr = gate.load_trace(r['trace'])
    except Exception:                                             # noqa: BLE001
        return []
    rows = []
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        g = AR.geometric_incursion(tr, aid)
        if not g or not g['decisive']:
            continue
        en = AR.engine_incursion(tr, aid)
        m = motion.facts(tr, aid)
        rows.append({'run': r['run'], 'actor': aid,
                     'truth': g['incursion'],
                     'engineUsable': bool(en and en.get('usable') and en.get('decisive')),
                     'engineSays': (en.get('incursion') if en and en.get('usable') else None),
                     'A_hybridOld': bool(m and m['entersEgoPath']),
                     'B_gated': bool(variant_B(tr, aid))})
    return rows


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')][::2]
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = [x for g in ex.map(work, ok, chunksize=16) for x in g]
    json.dump(rows, open(os.path.join(HERE, 'incursion-v2.json'), 'w'))
    n = len(rows)
    print(f'decisively-arbitrated challengers (corrected geometry): {n}')
    print(f"true incursion rate: {sum(1 for r in rows if r['truth'])/n:.3f}\n")
    both = [r for r in rows if r['engineUsable']]
    agree = sum(1 for r in both if r['engineSays'] == r['truth'])
    print(f'cross-check: where the engine series is ALSO informative (n={len(both)}), the two '
          f'measures agree {agree}/{len(both)} = {agree/max(len(both),1):.3f}')
    dis = [r for r in both if r['engineSays'] != r['truth']]
    print(f'  disagreements: {len(dis)}; of those, geometry says incursion and engine does not: '
          f"{sum(1 for r in dis if r['truth'])} (crossing traffic that stays in its own lane)\n")
    print(f"{'variant':50s} {'prec':>6s} {'recall':>7s} {'F1':>6s} {'acc':>6s}  TP/FP/FN/TN")
    for k, nm in (('A_hybridOld', 'hybrid BEFORE the fix (no longitudinal gate)'),
                  ('B_gated', 'hybrid WITH the 30 m longitudinal gate (as shipped now)')):
        tp = sum(1 for r in rows if r[k] and r['truth'])
        fp = sum(1 for r in rows if r[k] and not r['truth'])
        fn = sum(1 for r in rows if not r[k] and r['truth'])
        tn = sum(1 for r in rows if not r[k] and not r['truth'])
        p = tp / (tp + fp) if tp + fp else float('nan')
        rc = tp / (tp + fn) if tp + fn else float('nan')
        f1 = 2 * p * rc / (p + rc) if p == p and rc == rc and p + rc else float('nan')
        print(f'  {nm:48s} {p:6.3f} {rc:7.3f} {f1:6.3f} {(tp+tn)/n:6.3f}  {tp}/{fp}/{fn}/{tn}')
