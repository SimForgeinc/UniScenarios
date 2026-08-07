"""Two population-level checks on engine behaviour that bear on the gate.

R  reversing        -- several briefs require a vehicle to reverse. speedMps is unsigned, so
                       nothing in the pipeline can tell. Does ANY actor ever move backwards?
F  one-tick freezes -- Q2 thresholds a per-tick ego deceleration at 1.0 m/s^2, and the engine
                       zeroes an actor's speed in a single tick on contact. How often does a cell
                       pass Q2 on a freeze rather than on braking?
"""
import gzip, json, os, sys
import numpy as np
from concurrent.futures import ProcessPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def work(r):
    try:
        with gzip.open(r['trace']) as f:
            tr = json.loads(f.read())
    except Exception as e:                                        # noqa: BLE001
        return {'trace': r['trace'], 'error': str(e)}
    ts = np.asarray(tr['ticks']['t'], float)
    dts = np.diff(ts)
    out = {'trace': r['trace'], 'run': r['run'], 'anyReverse': False, 'maxBackM': 0.0}
    for aid, a in tr['ticks']['actors'].items():
        pr = np.asarray(a['present'], bool)
        x, y, hd = (np.asarray(a[k], float) for k in ('x', 'y', 'headingRad'))
        m = pr[:-1] & pr[1:]
        if not m.any():
            continue
        fwd = np.diff(x) * np.cos(hd[:-1]) + np.diff(y) * np.sin(hd[:-1])
        back = -fwd[m]
        tot = float(back[back > 0].sum())
        if tot > out['maxBackM']:
            out['maxBackM'] = tot
        if tot >= 0.8:
            out['anyReverse'] = True
        if aid == 'ego':
            v = np.asarray(a['speedMps'], float)
            with np.errstate(divide='ignore', invalid='ignore'):
                d = -np.diff(v) / np.where(dts > 0, dts, np.nan)
            d = d[m]
            out['egoPeakTickDecel'] = float(np.nanmax(d)) if np.isfinite(d).any() else 0.0
            # windowed 0.30 s
            t2, v2 = ts[pr], v[pr]
            k = max(2, int(round(0.30 / max(np.median(np.diff(t2)), 1e-6)))) if len(t2) > 3 else 1
            if len(t2) > k:
                dv = v2[:-k] - v2[k:]
                dt = t2[k:] - t2[:-k]
                g = dt > 0
                out['egoWindowedDecel'] = float((dv[g] / dt[g]).max()) if g.any() else 0.0
            else:
                out['egoWindowedDecel'] = 0.0
            out['egoSpeedDrop'] = float(v2.max() - v2.min()) if len(v2) else 0.0
    return out


if __name__ == '__main__':
    SC = json.load(open(os.path.join(HERE, 'scan-all.json')))
    ok = [r for r in SC if r.get('pass')]
    with ProcessPoolExecutor(max_workers=2) as ex:
        rows = list(ex.map(work, ok, chunksize=16))
    json.dump(rows, open(os.path.join(HERE, 'engine-checks.json'), 'w'))
    good = [r for r in rows if 'error' not in r]
    print('cells', len(good))
    print('cells containing ANY actor that reverses >= 0.8 m:',
          sum(1 for r in good if r['anyReverse']), '=',
          round(sum(1 for r in good if r['anyReverse']) / len(good), 4))
    mb = np.array([r['maxBackM'] for r in good])
    print('max backward travel by any actor, quantiles:', np.round(np.quantile(mb, [.5, .9, .99, 1]), 3))
    pk = np.array([r.get('egoPeakTickDecel', 0) for r in good])
    wd = np.array([r.get('egoWindowedDecel', 0) for r in good])
    dr = np.array([r.get('egoSpeedDrop', 0) for r in good])
    q2_now = (pk >= 1.0) & (dr >= 1.5)
    q2_win = (wd >= 1.0) & (dr >= 1.5)
    print(f'Q2 as written (per-tick >= 1.0 and drop >= 1.5): passes {q2_now.sum()}/{len(good)} = {q2_now.mean():.3f}')
    print(f'Q2 with a 0.30 s window instead:                  passes {q2_win.sum()}/{len(good)} = {q2_win.mean():.3f}')
    print(f'cells that pass ONLY because of the per-tick spike: {(q2_now & ~q2_win).sum()}')
    print(f'ego per-tick decel > 20 m/s^2 (a freeze, not braking): {(pk > 20).sum()} = {(pk > 20).mean():.3f}')
    print(f'ego per-tick decel > 50 m/s^2:                        {(pk > 50).sum()} = {(pk > 50).mean():.3f}')
