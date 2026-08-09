"""Step 4: run the vision arm of the ground truth over every pair (on the ENHANCED render)."""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import visionarm

OUT = os.path.join(HERE, 'vision-gt.json')
RD = os.path.join(HERE, 'renders')
MODE = os.environ.get('AUDIT_MODE', 'enh')


def pid(p):
    return p['id'].replace('/', '_').replace(':', '__').replace('~', '--')


if __name__ == '__main__':
    pairs = json.load(open(os.path.join(HERE, 'pairs.json')))['pairs']
    out = os.environ.get('AUDIT_OUT', OUT)
    cache = json.load(open(out)) if os.path.exists(out) else {}
    todo = [p for p in pairs if p['id'] not in cache]
    print('pairs', len(pairs), 'todo', len(todo), 'mode', MODE, flush=True)

    def one(p):
        img = os.path.join(RD, f'{pid(p)}.{MODE}.png')
        try:
            r = visionarm.vision_gt(img, p['brief'], reps=3)
        except Exception as e:                                     # noqa: BLE001
            r = {'verdict': 'error', 'error': str(e)}
        return p['id'], r

    t0 = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=5) as ex:
        for k, r in ex.map(one, todo):
            cache[k] = r
            done += 1
            if done % 5 == 0:
                json.dump(cache, open(out, 'w'), indent=1)
                print(f'  {done}/{len(todo)}  {time.time()-t0:.0f}s', flush=True)
    json.dump(cache, open(out, 'w'), indent=1)
    import collections
    print('verdicts:', dict(collections.Counter(v['verdict'] for v in cache.values())))
    print('wrote', out)
