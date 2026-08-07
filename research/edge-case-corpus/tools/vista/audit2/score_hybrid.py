"""Score the parent's hybrid.py against this audit's ground truth.

hybrid.py and motion.py are imported UNMODIFIED from the vista dir, so this measures the shipped
validator and not a paraphrase. parse_brief is cached per briefId: it is one text-only LLM call and
is deterministic input to the mechanical part, so caching it does not change what is measured.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
VISTA = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, VISTA)
import hybrid

PARSED = os.path.join(HERE, 'hybrid-parsed.json')
OUT = os.path.join(HERE, 'hybrid-verdicts.json')

if __name__ == '__main__':
    GT = json.load(open(os.path.join(HERE, 'ground-truth.json')))
    briefs = {}
    for p in GT:
        briefs[p['briefId']] = p['brief']
    cache = json.load(open(PARSED)) if os.path.exists(PARSED) else {}
    todo = [b for b in briefs if b not in cache]
    print('briefs to parse (text-only):', len(todo), flush=True)

    def one(b):
        try:
            return b, hybrid.parse_brief(briefs[b])
        except Exception as e:                                    # noqa: BLE001
            return b, {'error': str(e), 'required': [], 'notComputable': [], 'central': ''}

    if todo:
        with ThreadPoolExecutor(max_workers=8) as ex:
            for b, d in ex.map(one, todo):
                cache[b] = d
        json.dump(cache, open(PARSED, 'w'), indent=1)

    out = {}
    for p in GT:
        parsed = cache[p['briefId']]
        try:
            r = hybrid.validate(p['trace'], p['brief'], parsed=parsed)
        except Exception as e:                                    # noqa: BLE001
            r = {'verdict': 'error', 'reason': str(e), 'perPredicate': [], 'missing': []}
        out[p['id']] = {'verdict': r['verdict'], 'reason': r.get('reason', '')[:300],
                        'missing': r.get('missing', []),
                        'required': parsed.get('required', []),
                        'notComputable': parsed.get('notComputable', []),
                        'central': parsed.get('central', ''),
                        'perPredicate': r.get('perPredicate', [])}
    json.dump(out, open(OUT, 'w'), indent=1)
    import collections
    print('verdicts:', dict(collections.Counter(v['verdict'] for v in out.values())))
    print('wrote', OUT)
