"""Post-pass: write contract meta.json for every arm (i) pair cell.

Runs after pair_arm.py completes; reads the per-cell result + frozen-gate verdict
(recomputed here — cheap, and meta must reflect the gate exactly), and stamps
CONTRACTS §2 meta into <out>/cells/<cellId>/meta.json.

Usage: make_pair_meta.py /tmp/tgr-emergent-pair1
"""
import hashlib
import json
import os
import sys

import emergent_lib as L

TPL_DIRS = ('examples', 'examples/mechanisms', 'research/edge-case-corpus/vista-corpus/templates')


def template_sha(tpl_file):
    return hashlib.sha256(open(tpl_file, 'rb').read()).hexdigest()


def main():
    out = sys.argv[1]
    report = json.load(open(os.path.join(out, 'pair-report.json')))
    shas = {name: template_sha(row['file']) for name, row in report['templates'].items()}
    cells_dir = os.path.join(out, 'cells')
    runid = report['runId']
    n = 0
    for cid in sorted(os.listdir(cells_dir)):
        d = os.path.join(cells_dir, cid)
        if not os.path.isdir(d) or os.path.exists(os.path.join(d, 'meta.json')):
            continue
        # cellId = emergent-<runid>-<tpl>.<arm>-<map>-<site8>-<draw>
        body = cid[len('emergent-%s-' % runid):]
        tpl_arm, rest = body.split('-', 1)
        tpl, arm = tpl_arm.rsplit('.', 1)
        parts = rest.rsplit('-', 2)
        map_id, site8, draw = parts[0], parts[1], int(parts[2])
        cell = {'map': map_id, 'site': site8, 'draw': 'draw-%03d' % draw,
                'instance': os.path.join(d, 'instance.json'),
                'result': os.path.join(d, 'result.json'),
                'trace': os.path.join(d, 'trace.json.gz')}
        g = L.gate_cell(cell)
        res = json.load(open(cell['result']))
        meta = {
            'cellId': cid, 'briefId': tpl, 'stream': 'emergent',
            'templateSha256': shas.get(tpl), 'arm': arm,
            'map': map_id, 'site': res.get('siteId', site8), 'draw': draw,
            'seed': res.get('paramSeed'),
            'ambientSeed': 'pairseed1' if arm != 'off' else None,
            'settleS': 20 if arm != 'off' else None,
            'gate': {'pass': bool(g.get('pass')),
                     'firstFailure': g.get('cause'),
                     'clearanceM': g.get('clearanceM'),
                     'tMinClearance': g.get('closestT')},
            'notes': 'arm(i) paired cell; arm=%s; band=%s; ambient=%s' % (
                arm, res.get('band'), (res.get('ambient') or {}).get('actorCount', 0)),
        }
        json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
        n += 1
    print(json.dumps({'metaWritten': n}))


if __name__ == '__main__':
    main()
