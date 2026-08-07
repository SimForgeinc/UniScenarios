"""WHY do authored incursions fail? Two rival mechanisms, separated.

  COMMANDING failure -- the challenger never moves laterally at all. The author did not actually
                        instruct a lateral manoeuvre (or the trigger never fired). Using a proper
                        lateral primitive WOULD fix this.
  TARGETING failure  -- the challenger does move laterally, substantially, but stops short of the
                        ego's corridor: it aims at the wrong place. `changeLane[toRole]`, which is
                        site-independent, WOULD fix this.
  Neither            -- it moved and arrived: a real incursion.

Measured with the corrected ego-path geometry (endpoint-rejected), over every gate-passing cell of
the generated-brief runs, restricted to the challenger that comes closest to the ego's path.
"""
import collections, glob, json, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

MOVED_LAT_M = 1.0     # a lateral excursion this big counts as "it did move sideways"
IN_M = 1.25


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
        cls = 'never_moved_laterally'
    else:
        cls = 'moved_but_stopped_short'
    return {'trace': r['trace'], 'run': r['run'], 'actor': aid, 'class': cls,
            'lateralRangeM': g['rangeM'], 'minAbsM': g['minAbsM'], 'maxAbsM': g['maxAbsM']}


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass') and r['run'].startswith('vista-gen')]
    print('gate-passing cells in the generated-brief runs:', len(ok), flush=True)
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = [x for x in ex.map(work, ok, chunksize=16) if x]
    json.dump(rows, open(os.path.join(HERE, 'incursion-failure-modes.json'), 'w'), indent=1)
    c = collections.Counter(r['class'] for r in rows)
    n = len(rows)
    print(f'\nclassified cells: {n}')
    for k in ('incursion', 'moved_but_stopped_short', 'never_moved_laterally'):
        print(f'  {k:26s} {c[k]:5d}  {c[k]/n:.3f}')
    short = [r for r in rows if r['class'] == 'moved_but_stopped_short']
    if short:
        m = np.array([r['minAbsM'] for r in short])
        rg = np.array([r['lateralRangeM'] for r in short])
        print(f'\n  of the {len(short)} that MOVED BUT STOPPED SHORT:')
        print(f'    closest they got to the ego path: median {np.median(m):.2f} m, '
              f'p25 {np.quantile(m,.25):.2f}, p75 {np.quantile(m,.75):.2f}')
        print(f'    how far they travelled sideways : median {np.median(rg):.2f} m')
        for th in (1.5, 2.0, 2.5, 3.0):
            print(f'    would have counted if the corridor were {th:.1f} m: '
                  f'{(m<=th).sum():4d} = {(m<=th).mean():.3f} of them')
    nm = [r for r in rows if r['class'] == 'never_moved_laterally']
    if nm:
        m2 = np.array([r['minAbsM'] for r in nm])
        print(f'\n  of the {len(nm)} that NEVER MOVED LATERALLY:')
        print(f'    their fixed distance from the ego path: median {np.median(m2):.2f} m')
        print(f'    already inside the corridor all along (<= {IN_M} m): '
              f'{(m2<=IN_M).sum()} = {(m2<=IN_M).mean():.3f}')
