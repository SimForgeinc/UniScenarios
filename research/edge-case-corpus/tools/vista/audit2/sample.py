"""Build the audit sample: (brief, trace) pairs with independently-derived ground truth.

Three strata:
  A  MISMATCHED pairs  -- a brief whose named actor class is provably ABSENT from the trace's
                          actor+prop inventory. Ground truth = mechanism absent, BY CONSTRUCTION.
                          No model, no image, no judgement. These are the pairs that measure
                          FALSE POSITIVES, which is the number that matters.
  B  TRUE pairs        -- a brief with one of its own gate-passing cells. Ground truth from the
                          trajectory arm plus the decomposed-vision arm.
  C  TRAJECTORY-POSITIVE pairs -- true pairs whose core predicates are all decidably TRUE.

Everything is checkpointed so the expensive steps are never repeated.
"""
import collections, glob, json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mechfacts, speceval

RUNS = ['/tmp/vista-gen-blind', '/tmp/vista-gen2-blind', '/tmp/vista-gen3-blind',
        '/tmp/vista-held-sight', '/tmp/vista-held-blind', '/tmp/vista-dev2-blind',
        '/tmp/vista-critic-blind']


def load_pool():
    pool = []
    for d in RUNS:
        for p in sorted(glob.glob(d + '/*/record.json')):
            try:
                r = json.load(open(p))
            except Exception:
                continue
            for c in (r.get('lastCells') or []):
                if c.get('pass') and c.get('traceFile') and os.path.exists(c['traceFile']):
                    pool.append({'briefId': r['briefId'], 'brief': r['brief'],
                                 'category': r.get('category'), 'run': d.split('/')[-1],
                                 'mapId': c['mapId'], 'siteId': c['siteId'],
                                 'trace': c['traceFile'], 'clearanceM': c.get('clearanceM'),
                                 'closestT': c.get('closestT')})
    return pool


def inventory(facts):
    """The set of classes physically in the clip (actors that are co-present, plus props)."""
    s = set()
    for a in facts.get('actors', {}).values():
        if a.get('coPresentTicks', 0) > 0:
            s.add(a['class']); s.add(a.get('geomClass'))
    for p in facts.get('props', []):
        s.add(p['class'])
    return {x for x in s if x}


def class_absent(cls, inv):
    """Leniently: is NOTHING in the clip compatible with this class?"""
    return not (speceval.COMPAT.get(cls, {cls}) & inv)
