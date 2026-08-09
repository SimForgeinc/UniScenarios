"""Run THE CRITIC UNDER AUDIT against each pair, unmodified.

critic.PROMPT is imported verbatim from ../critic.py so this measures the real instrument and not
a paraphrase of it. The only thing changed is that the image is supplied rather than re-rendered,
so the same pixels can be reused across conditions and so alternative renderings can be swapped in
for the render experiment.
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import critic as CRITIC
import llm

RD = os.path.join(HERE, 'renders')
ACCEPT_AT, REJECT_AT = CRITIC.ACCEPT_AT, CRITIC.REJECT_AT


def one_review(image, brief):
    try:
        d, _raw = llm.ask_json(CRITIC.PROMPT.format(brief=brief), images=[image], max_tokens=6000)
        return d
    except Exception as e:                                         # noqa: BLE001
        return {'error': str(e)}


def review(image, brief, reps=6, workers=6):
    with ThreadPoolExecutor(max_workers=workers) as ex:
        rs = list(ex.map(lambda _: one_review(image, brief), range(reps)))
    votes = [r.get('intentRealised') for r in rs if r.get('intentRealised') is not None]
    yes = sum(1 for v in votes if v is True)
    frac = yes / len(votes) if votes else 0.0
    verdict = ('verified' if frac >= ACCEPT_AT else
               'rejected' if frac <= REJECT_AT else 'uncertain')
    conf = [r.get('isGenuineConflict') for r in rs if r.get('isGenuineConflict') is not None]
    return {'n': len(votes), 'nYes': yes, 'yesFraction': round(frac, 4), 'verdict': verdict,
            'genuineConflictFrac': round(sum(1 for c in conf if c) / len(conf), 3) if conf else None,
            'whyNot': next((r.get('whyNot') for r in rs if r.get('intentRealised') is False), ''),
            'whatISee': next((r.get('whatISee') for r in rs if r.get('whatISee')), ''),
            'reviews': rs}


def pid(p):
    return p['id'].replace('/', '_').replace(':', '__').replace('~', '--')


if __name__ == '__main__':
    mode = os.environ.get('AUDIT_MODE', 'base')
    reps = int(os.environ.get('AUDIT_REPS', '6'))
    out = os.environ.get('AUDIT_OUT', os.path.join(HERE, f'critic-{mode}.json'))
    pairs = json.load(open(os.path.join(HERE, 'pairs.json')))['pairs']
    only = os.environ.get('AUDIT_ONLY')
    if only:
        keep = set(json.load(open(only)))
        pairs = [p for p in pairs if p['id'] in keep]
    cache = json.load(open(out)) if os.path.exists(out) else {}
    todo = [p for p in pairs if p['id'] not in cache]
    print(f'mode={mode} reps={reps} pairs={len(pairs)} todo={len(todo)} -> {out}', flush=True)

    def job(p):
        img = os.path.join(RD, f'{pid(p)}.{mode}.png')
        return p['id'], review(img, p['brief'], reps=reps, workers=reps)

    t0, done = time.time(), 0
    with ThreadPoolExecutor(max_workers=3) as ex:
        for k, r in ex.map(job, todo):
            cache[k] = r
            done += 1
            if done % 5 == 0:
                json.dump(cache, open(out, 'w'), indent=1)
                print(f'  {done}/{len(todo)} {time.time()-t0:.0f}s', flush=True)
    json.dump(cache, open(out, 'w'), indent=1)
    import collections
    print('verdicts:', dict(collections.Counter(v['verdict'] for v in cache.values())))
    print('wrote', out)
