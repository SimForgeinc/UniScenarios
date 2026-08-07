"""How often do authored scenarios ACTUALLY contain a lateral incursion?

Uses the engine's own per-tick `lateralOffsetM`, so the answer depends on neither hybrid.motion nor
this audit's geometry. Run over every gate-passing cell.
"""
import collections, json, os, sys
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))


def work(r):
    import gate, motion, lane_arbiter as LA
    try:
        tr = gate.load_trace(r['trace'])
    except Exception as e:                                        # noqa: BLE001
        return {'trace': r['trace'], 'error': str(e)}
    any_arb = any_hy = False
    n_dec = 0
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        a = LA.incursion(tr, aid)
        m = motion.facts(tr, aid)
        if a and a['decisive']:
            n_dec += 1
            any_arb = any_arb or a['incursion']
        if m and m['entersEgoPath']:
            any_hy = True
    return {'trace': r['trace'], 'run': r['run'], 'arbiterIncursion': any_arb,
            'hybridEntersEgoPath': any_hy, 'nDecisive': n_dec}


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')]
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, ok, chunksize=16))
    json.dump(rows, open(os.path.join(HERE, 'incursion-rate.json'), 'w'))
    good = [r for r in rows if 'error' not in r and r['nDecisive'] > 0]
    n = len(good)
    a = sum(1 for r in good if r['arbiterIncursion'])
    h = sum(1 for r in good if r['hybridEntersEgoPath'])
    print(f'gate-passing cells with a decisive arbiter: {n}')
    print(f'  cells that TRULY contain a lateral incursion (engine lateralOffsetM): {a} = {a/n:.3f}')
    print(f'  cells where hybrid entersEgoPath fires:                               {h} = {h/n:.3f}')
    tab = collections.Counter((r['hybridEntersEgoPath'], r['arbiterIncursion']) for r in good)
    tp, fp, fn, tn = tab[(True, True)], tab[(True, False)], tab[(False, True)], tab[(False, False)]
    print(f'  hybrid vs arbiter at CELL level: TP={tp} FP={fp} FN={fn} TN={tn}'
          f'  precision={tp/(tp+fp) if tp+fp else float("nan"):.3f}'
          f' recall={tp/(tp+fn) if tp+fn else float("nan"):.3f}')
    print('\nper run (true incursion rate):')
    for run in sorted({r['run'] for r in good}):
        g = [r for r in good if r['run'] == run]
        if len(g) >= 20:
            print(f'  {run:22s} n={len(g):4d} true={sum(1 for r in g if r["arbiterIncursion"])/len(g):.3f}'
                  f'  hybridFires={sum(1 for r in g if r["hybridEntersEgoPath"])/len(g):.3f}')
