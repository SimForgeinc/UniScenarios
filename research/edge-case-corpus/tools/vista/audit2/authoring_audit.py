"""Independently verify the authoring diagnosis: is `changeLane` really unused?

The claim: across generated-brief templates, `changeLane` appears 12 times in 1176 interactions
(1%) while hand-rolled `route` polylines appear 217 times, and that is why only ~35% of cells
contain a real lateral incursion.

Counted here from the templates on disk, with no reference to the parent's count. Also asks the
question the raw count cannot: do templates that DO use changeLane actually produce more
incursions? A primitive being unused only matters if using it works.
"""
import collections, glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def walk(o, out, path=''):
    """Collect every dict that looks like an interaction/action, keyed by its kind."""
    if isinstance(o, dict):
        for k in ('kind', 'type', 'action'):
            v = o.get(k)
            if isinstance(v, str):
                out[v] += 1
        for k, v in o.items():
            walk(v, out, path + '/' + k)
    elif isinstance(o, list):
        for v in o:
            walk(v, out, path)


def template_paths():
    seen, paths = set(), []
    for pat in ('/tmp/vista-*/*/template.json', '/tmp/vista-corpus/templates/*.template.json'):
        for p in sorted(glob.glob(pat)):
            rp = os.path.realpath(p)
            if rp not in seen:
                seen.add(rp)
                paths.append(p)
    return paths


def count(paths=None, generated_only=True):
    paths = paths or template_paths()
    kinds = collections.Counter()
    per_template = {}
    n_t = 0
    for p in paths:
        # "generated brief" templates are the c<N>g-* family
        base = os.path.basename(os.path.dirname(p)) if p.endswith('/template.json') else os.path.basename(p)
        if generated_only and 'g-' not in base:
            continue
        try:
            t = json.load(open(p))
        except Exception:
            continue
        c = collections.Counter()
        walk(t, c)
        kinds.update(c)
        per_template[p] = c
        n_t += 1
    return kinds, per_template, n_t


def count_verbs(paths=None, generated_only=True):
    """Count `choreography.interactions[].verb` -- the actual behaviour primitives."""
    import collections, json, os
    paths = paths or template_paths()
    verbs = collections.Counter()
    per_t = {}
    n_t = 0
    n_int = 0
    for p in paths:
        base = (os.path.basename(os.path.dirname(p)) if p.endswith('/template.json')
                else os.path.basename(p))
        if generated_only and 'g-' not in base:
            continue
        try:
            t = json.load(open(p))
        except Exception:
            continue
        ints = ((t.get('choreography') or {}).get('interactions') or [])
        c = collections.Counter()
        for it in ints:
            v = it.get('verb')
            tgt = it.get('target') or {}
            mode = tgt.get('mode') if isinstance(tgt, dict) else None
            key = f'{v}' + (f'[{mode}]' if mode else '')
            c[key] += 1
            verbs[key] += 1
            n_int += 1
        per_t[p] = c
        n_t += 1
    return verbs, per_t, n_t, n_int
