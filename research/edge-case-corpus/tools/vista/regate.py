"""Re-gate every run with ONE gate, so numbers from different points in the study are comparable."""
import os, sys, json, glob, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--roots', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = {}
    for root in a.roots:
        name = os.path.basename(root)
        rows = []
        for f in sorted(glob.glob(root + '/*/record.json')):
            r = json.load(open(f))
            best = None
            for bs in glob.glob(os.path.dirname(f) + '/batch-*/batch-summary.json'):
                try:
                    g = gate.gate_batch(bs)
                except Exception as e:                            # noqa: BLE001
                    print('  gate error', bs, e, flush=True)
                    continue
                k = (g['admitted'], g['admittedHQ'], g['passingCellsHQ'], g['passingCells'])
                if best is None or k > best[0]:
                    best = (k, g, bs)
            if best is None:
                rows.append({'briefId': r['briefId'], 'category': r.get('category'),
                             'admitted': False, 'admittedHQ': False})
                continue
            g = best[1]
            rows.append({'briefId': r['briefId'], 'category': r.get('category'),
                         'admitted': g['admitted'], 'admittedHQ': g['admittedHQ'],
                         'passingCells': g['passingCells'], 'passingCellsHQ': g['passingCellsHQ'],
                         'totalCells': g['totalCells'], 'qualityLoss': g['qualityLoss'],
                         'summary': best[2]})
        n = len(rows)
        out[name] = {'n': n,
                     'admitted': sum(1 for x in rows if x['admitted']),
                     'admittedHQ': sum(1 for x in rows if x['admittedHQ']),
                     'rate': round(sum(1 for x in rows if x['admitted']) / max(n, 1), 4),
                     'rateHQ': round(sum(1 for x in rows if x['admittedHQ']) / max(n, 1), 4),
                     'rows': rows}
        print(f"{name:24} n={n:3} frozen {out[name]['admitted']:3} = {out[name]['rate']:.3f}"
              f"   HQ {out[name]['admittedHQ']:3} = {out[name]['rateHQ']:.3f}", flush=True)
    json.dump(out, open(a.out, 'w'), indent=1)
