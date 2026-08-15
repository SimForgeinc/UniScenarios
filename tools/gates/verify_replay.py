#!/usr/bin/env python3
"""DETERMINISM GATE. Same inputs must give the same trace, bit for bit.

Runs one batch TWICE into two unique output dirs and compares, per cell:
  * `inputHash`   -- the instance is identical
  * `traceDigest` -- the engine's own digest of the trace
  * sha256 of the decompressed trace bytes -- computed here, independent of any engine field

The third check exists because the first two are engine-reported. This project has twice been
burned by trusting a summary field; the integrity gate is the one layer that found corruption every
other layer passed.

Usage:  verify_replay.py --template T [--map M | --maps a,b | --all-maps] [--draws N] [--max-sites K]
        verify_replay.py --corpus DIR      # re-verify stored evidence in place (no re-run)
Exit 0 when 100% of compared cells are bit-identical.
"""
import argparse, gzip, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import probe_lib as P                                                      # noqa: E402


def trace_sha(path):
    with gzip.open(path) as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--template')
    ap.add_argument('--map'); ap.add_argument('--maps'); ap.add_argument('--all-maps', action='store_true')
    ap.add_argument('--draws', type=int, default=2)
    ap.add_argument('--max-sites', type=int, default=4)
    ap.add_argument('--concurrency', type=int, default=6)
    ap.add_argument('--out', help='write the report here')
    a = ap.parse_args()

    if not a.template:
        print('verify_replay: --template is required'); return 2
    maps = None if a.all_maps else ([a.map] if a.map else (a.maps.split(',') if a.maps else ['yale-street']))

    runs = []
    for i in (1, 2):
        d = P.unique_outdir('replay-%d' % i)
        s = P.run_batch(a.template, d, maps=maps, draws=a.draws, max_sites=a.max_sites,
                        concurrency=a.concurrency)
        runs.append(s)
        print('run %d: %d cells -> %s' % (i, len(s.get('results', [])), d))

    idx = [{('%s/%s/%s' % (r['mapId'], r['siteId'], r['drawIndex'])): r for r in s.get('results', [])}
           for s in runs]
    keys = sorted(set(idx[0]) & set(idx[1]))
    only = sorted(set(idx[0]) ^ set(idx[1]))

    same, diffs = 0, []
    for k in keys:
        A, B = idx[0][k], idx[1][k]
        checks = {'inputHash': A.get('inputHash') == B.get('inputHash'),
                  'traceDigest': A.get('traceDigest') == B.get('traceDigest')}
        ta, tb = A.get('traceFile'), B.get('traceFile')
        checks['traceBytes'] = bool(ta and tb and os.path.exists(ta) and os.path.exists(tb)
                                    and trace_sha(ta) == trace_sha(tb))
        if all(checks.values()):
            same += 1
        else:
            diffs.append({'cell': k, 'checks': checks})

    rep = {'gate': 'determinism', 'template': a.template, 'maps': maps, 'draws': a.draws,
           'comparedCells': len(keys), 'bitIdentical': same,
           'rate': round(same / len(keys), 4) if keys else 0.0,
           'cellsInOnlyOneRun': only[:10], 'diffs': diffs[:10],
           'pass': bool(keys) and same == len(keys) and not only}
    print(json.dumps({k: v for k, v in rep.items() if k != 'diffs'}, indent=1))
    if diffs:
        print('DIFFS:', json.dumps(diffs[:5], indent=1))
    if a.out:
        json.dump(rep, open(a.out, 'w'), indent=1)
    print('\nDETERMINISM GATE: %s -- %d/%d bit-identical'
          % ('PASS' if rep['pass'] else 'FAIL', same, len(keys)))
    return 0 if rep['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
