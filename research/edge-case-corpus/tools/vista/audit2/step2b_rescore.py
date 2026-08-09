"""Step 2b: re-score the ALREADY-RUN pairs with the corrected classifier.

The pair identities must not change -- the critic and vision runs are keyed to them. This
recomputes the facts and the trajectory verdicts in place, and RE-VALIDATES stratum A: a
misclassified actor could make a 'constructed negative' not actually negative, which would be
the single most damaging error possible in this audit.
"""
import collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mechfacts, sample, speceval

if __name__ == '__main__':
    old = json.load(open(os.path.join(HERE, 'pairs.v1.json')))
    specs = json.load(open(os.path.join(HERE, 'specs.json')))
    pairs = old['pairs']
    facts = {}
    for p in pairs:
        if p['trace'] not in facts:
            facts[p['trace']] = mechfacts.facts(p['trace'])
    print('facts recomputed for', len(facts), 'traces', flush=True)

    bad = []
    for p in pairs:
        f = facts[p['trace']]
        spec = specs[p['briefId']]
        p['traj'] = speceval.evaluate(spec, f)
        p['inventory'] = sorted(sample.inventory(f))
        if p['stratum'] == 'A_mismatch':
            named = spec.get('namedActorClasses') or []
            inv = set(p['inventory'])
            still = [c for c in named if sample.class_absent(c, inv)]
            p['missingClasses'] = still
            p['gtBasis'] = ('construction: brief names %s, clip contains %s' % (still, p['inventory']))
            if not still:
                bad.append(p['id'])
                p['stratumValid'] = False
            else:
                p['stratumValid'] = True
    print('stratum A pairs INVALIDATED by the classifier fix:', len(bad))
    for b in bad:
        print('   ', b)
    json.dump({'pairs': pairs, 'facts': facts}, open(os.path.join(HERE, 'pairs.json'), 'w'), indent=1)
    B = [p for p in pairs if p['stratum'] == 'B_true']
    A = [p for p in pairs if p['stratum'] == 'A_mismatch']
    print('TRUE  pairs traj:', dict(collections.Counter(p['traj']['verdict'] for p in B)))
    print('MISMATCH traj  :', dict(collections.Counter(p['traj']['verdict'] for p in A)))
