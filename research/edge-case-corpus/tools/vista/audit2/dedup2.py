"""Recompute the harvest dedup directly, and run the within/between test."""
import collections, glob, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

PROBE = ['closestT', 'pathSeparationM', 'encroachmentGapS', 'egoSpeedDropMps', 'egoPeakDecelMps2',
         'clearanceM', 'minTTC']


def harvest_cells(summary):
    import gate
    g = gate.gate_batch(summary)
    out = []
    for c in g['cells']:
        if not c.get('passHQ'):
            continue
        out.append({k: c.get(k) for k in
                    ('mapId', 'siteId', 'traceFile', 'clearanceM', 'minTTC', 'closestT',
                     'egoPeakDecelMps2', 'egoSpeedDropMps', 'pathSeparationM',
                     'encroachmentGapS', 'Q1_challenger')})
    return out, g


def within_between(cells, sigfn):
    """For each probe quantity: spread WITHIN a signature group vs spread BETWEEN groups."""
    groups = collections.defaultdict(list)
    for c in cells:
        groups[sigfn(c)].append(c)
    res = {}
    for k in PROBE:
        vals = [c.get(k) for c in cells if c.get(k) is not None]
        if len(vals) < 8:
            continue
        overall = float(np.std(vals))
        wsd = []
        for g in groups.values():
            v = [c.get(k) for c in g if c.get(k) is not None]
            if len(v) >= 2:
                wsd.append(float(np.std(v)))
        res[k] = {'overallSD': round(overall, 4),
                  'meanWithinGroupSD': round(float(np.mean(wsd)), 4) if wsd else None,
                  'nGroupsWithPair': len(wsd),
                  'ratio': round(float(np.mean(wsd)) / overall, 3) if wsd and overall > 1e-9 else None}
    return res, groups
