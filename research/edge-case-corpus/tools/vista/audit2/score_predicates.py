"""Score predicates.py as a FILTER against the audit ground truth, and against the critic."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import predicates as PR
import scoring as SCO

if __name__ == '__main__':
    GT = json.load(open(os.path.join(HERE, 'ground-truth.json')))
    specs = json.load(open(os.path.join(HERE, 'specs.json')))
    out = {}
    for p in GT:
        spec = specs[p['briefId']]
        r = PR.evaluate_trace(p['trace'], spec)
        out[p['id']] = {'verdict': r['verdict'], 'reason': r['reason'][:400],
                        'nCoreTrue': r['nCoreTrue'], 'nCoreFalse': r['nCoreFalse'],
                        'nCoreAbstain': r['nCoreAbstain']}
    json.dump(out, open(os.path.join(HERE, 'predicates-verdicts.json'), 'w'), indent=1)
    import collections
    print('verdicts:', dict(collections.Counter(v['verdict'] for v in out.values())))
    # As a filter: accept only 'present'. 'abstain' is NOT an accept -- it is a referral.
    s = SCO.score(GT, {k: {'verdict': v['verdict']} for k, v in out.items()},
                  positive=('present',), name='predicates.py (accept only decisive PRESENT)')
    SCO.show(s)
    json.dump(s, open(os.path.join(HERE, 'score-predicates.json'), 'w'), indent=1, default=str)
    # how much does it abstain, i.e. how much work is left for the vision critic?
    ab = [p for p in GT if out[p['id']]['verdict'] == 'abstain']
    print(f"\nabstains on {len(ab)}/{len(GT)} = {len(ab)/len(GT):.3f} -- these are the ONLY cases")
    print("that need a vision critic at all.")
    print('  of the abstains, GT:', dict(collections.Counter(p['gt'] for p in ab)))
