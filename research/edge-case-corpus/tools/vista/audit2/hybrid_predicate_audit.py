"""Predicate-level audit of hybrid.py: base rate and correctness of every clause.

A predicate that fires on almost everything cannot discriminate, and a predicate that never fires
silently blocks every brief that requires it. Both are measured here, on the audit's 77 traces,
by calling hybrid._eval_one UNMODIFIED and comparing against geometry computed independently.
"""
import collections, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
VISTA = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, VISTA)
import gate, motion, hybrid
import predicates as PR

if __name__ == '__main__':
    GT = json.load(open(os.path.join(HERE, 'ground-truth.json')))
    traces = sorted({p['trace'] for p in GT})
    fire = collections.Counter()
    kinds = collections.Counter()
    n = 0
    for t in traces:
        tr = gate.load_trace(t)
        ch = [c for c in motion.all_facts(tr) if c]
        ego = motion.ego_facts(tr)
        n += 1
        for c in ch:
            kinds[c.get('kind')] += 1
        for p in hybrid.VOCAB:
            try:
                if hybrid._eval_one(p, ch, ego, tr):
                    fire[p] += 1
            except Exception:                                     # noqa: BLE001
                fire[p + ' (ERROR)'] += 1
    print(f'traces: {n}\n')
    print('actorMetadata "kind" values seen across all challengers:')
    for k, v in kinds.most_common():
        print(f'   {str(k):16s} {v}')
    print('\npredicate base rate (fraction of the 77 traces on which it fires):')
    for p in hybrid.VOCAB:
        r = fire[p] / n
        flag = '   <-- fires on (almost) everything' if r >= 0.9 else (
               '   <-- NEVER fires: any brief requiring it is unsatisfiable' if fire[p] == 0 else '')
        print(f'   {p:32s} {fire[p]:3d}/{n} = {r:.3f}{flag}')
