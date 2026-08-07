"""Step 2: assemble the pair set and compute trajectory facts + trajectory-arm ground truth."""
import collections, json, os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mechfacts, sample, speceval

OUT = os.path.join(HERE, 'pairs.json')

if __name__ == '__main__':
    specs = json.load(open(os.path.join(HERE, 'specs.json')))
    pool = sample.load_pool()
    by = collections.defaultdict(list)
    for p in pool:
        by[p['briefId']].append(p)
    rng = random.Random(4242)

    # one cell per chosen brief: prefer a NON-interpenetrating cell so the pair is not
    # confounded by the Q8 defect, and prefer the site with the smallest clearance otherwise.
    scan = {r['trace']: r for r in json.load(open(os.path.join(HERE, 'scan-all.json')))}
    chosen = {}
    for bid in specs:
        cs = sorted(by[bid], key=lambda c: (scan.get(c['trace'], {}).get('maxPenetrationM', 9) > 0,
                                            c.get('clearanceM') if c.get('clearanceM') is not None else 9))
        chosen[bid] = cs[0]

    facts = {}
    for bid, c in chosen.items():
        facts[c['trace']] = mechfacts.facts(c['trace'])
    print('facts computed for', len(facts), 'traces', flush=True)

    pairs = []
    # ---- stratum B: TRUE pairs
    for bid, c in chosen.items():
        f = facts[c['trace']]
        ev = speceval.evaluate(specs[bid], f)
        evs = speceval.evaluate(specs[bid], f, speceval.STRICT)
        pairs.append({'id': f'B:{bid}', 'stratum': 'B_true', 'briefId': bid,
                      'brief': specs[bid]['brief'], 'category': specs[bid].get('category'),
                      'trace': c['trace'], 'mapId': c['mapId'], 'siteId': c['siteId'],
                      'closestT': c.get('closestT'), 'clearanceM': c.get('clearanceM'),
                      'traj': ev, 'trajStrict': evs,
                      'inventory': sorted(sample.inventory(f))})

    # ---- stratum A: MISMATCHED pairs, ground truth ABSENT by construction
    bids = sorted(specs)
    used = set()
    for bid in bids:
        named = specs[bid].get('namedActorClasses') or []
        if not named:
            continue
        cand = []
        for obid in bids:
            if obid == bid:
                continue
            t = chosen[obid]['trace']
            inv = sample.inventory(facts[t])
            missing = [c for c in named if sample.class_absent(c, inv)]
            if missing and t not in used:
                cand.append((obid, t, missing, inv))
        if not cand:
            continue
        rng.shuffle(cand)
        obid, t, missing, inv = cand[0]
        used.add(t)
        ev = speceval.evaluate(specs[bid], facts[t])
        pairs.append({'id': f'A:{bid}~{obid}', 'stratum': 'A_mismatch', 'briefId': bid,
                      'brief': specs[bid]['brief'], 'category': specs[bid].get('category'),
                      'trace': t, 'donorBriefId': obid,
                      'mapId': chosen[obid]['mapId'], 'siteId': chosen[obid]['siteId'],
                      'closestT': chosen[obid].get('closestT'),
                      'clearanceM': chosen[obid].get('clearanceM'),
                      'missingClasses': missing, 'inventory': sorted(inv),
                      'gt': 'absent', 'gtBasis': 'construction: brief names %s, clip contains %s'
                                                 % (missing, sorted(inv)),
                      'traj': ev})
    json.dump({'pairs': pairs, 'facts': facts}, open(OUT, 'w'), indent=1)
    n = collections.Counter(p['stratum'] for p in pairs)
    print('pairs:', dict(n), '-> ', OUT)
    tv = collections.Counter(p['traj']['verdict'] for p in pairs if p['stratum'] == 'B_true')
    print('trajectory verdict on TRUE pairs:', dict(tv))
    av = collections.Counter(p['traj']['verdict'] for p in pairs if p['stratum'] == 'A_mismatch')
    print('trajectory verdict on MISMATCH pairs (should be ~all absent):', dict(av))
