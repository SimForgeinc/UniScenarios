"""Step 1: choose the brief set and parse every brief into a spec (text-only, no images)."""
import collections, json, os, random, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sample, briefspec

OUT = os.path.join(HERE, 'specs.json')
N_BRIEFS = 46

if __name__ == '__main__':
    pool = sample.load_pool()
    by = collections.defaultdict(list)
    for p in pool:
        by[p['briefId']].append(p)
    # stratify across taxonomy categories, prefer briefs with cells on >= 2 distinct sites
    cats = collections.defaultdict(list)
    for bid, cs in by.items():
        if len({(c['mapId'], c['siteId']) for c in cs}) >= 2:
            cats[(cs[0].get('category') or '?').split('.')[0]].append(bid)
    rng = random.Random(20260807)
    for v in cats.values():
        rng.shuffle(v)
    chosen, i = [], 0
    keys = sorted(cats)
    while len(chosen) < N_BRIEFS and any(cats[k] for k in keys):
        for k in keys:
            if cats[k] and len(chosen) < N_BRIEFS:
                chosen.append(cats[k].pop())
    print('briefs chosen:', len(chosen), flush=True)
    briefs = {b: by[b][0]['brief'] for b in chosen}
    cache = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [b for b in chosen if b not in cache]
    print('to parse:', len(todo), flush=True)

    def one(b):
        try:
            return b, briefspec.parse_brief(briefs[b])
        except Exception as e:                                     # noqa: BLE001
            return b, {'error': str(e)}

    with ThreadPoolExecutor(max_workers=8) as ex:
        for b, s in ex.map(one, todo):
            s['brief'] = briefs[b]
            s['category'] = by[b][0].get('category')
            cache[b] = s
            print('  ', b, s.get('distinctiveMechanism', s.get('error'))[:80], flush=True)
    json.dump(cache, open(OUT, 'w'), indent=1)
    print('wrote', OUT, len(cache))
