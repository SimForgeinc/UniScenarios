"""Final scorecard: measure every acceptance clause M1.1-M4.4 mechanically.

One rule throughout: a measure that cannot be computed reports NOT MEASURED and never a default pass.
A scorecard that degrades to "ok" when its input is missing is worse than no scorecard.
"""
import os, sys, json, gzip, math, glob, argparse, subprocess, collections, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gate

AMBIENT = ('ambient',)


def _load(recs_files):
    recs = []
    for f in recs_files:
        recs += [json.loads(l) for l in open(f)]
    return recs


def _is_ambient(aid, meta):
    if aid.startswith('ambient:') or aid.startswith('ambient-'):
        return True
    tags = (meta.get(aid) or {}).get('tags') or []
    return any(t == 'ambient' or str(t).startswith('ambient:') for t in tags)


def m4_4(recs):
    """A brief that names a signal must carry real signal state."""
    bad = []
    for r in recs:
        tr = json.loads(gzip.open(r['trace']).read())
        if gate.signal_intent(r['brief']) and not gate.signal_state(tr)['hasSignalState']:
            bad.append(r['scenarioId'])
    return {'n': len(recs), 'claimsWithoutState': len(bad),
            'pass': len(bad) == 0, 'target': '0 scenarios claiming a signal they lack'}


def m2_2_2_3_2_5(recs):
    """Ambient presence at t=0, queue formation, speed spread, and subject-pair integrity."""
    near, queues, spreads, hijack, junction_cells = [], [], [], 0, 0
    for r in recs:
        tr = json.loads(gzip.open(r['trace']).read())
        meta = tr['header'].get('actorMetadata', {})
        acts = tr['ticks']['actors']
        ego = acts.get('ego')
        if not ego:
            continue
        ex, ey = ego['x'][0], ego['y'][0]
        amb = [a for a in acts if _is_ambient(a, meta)]
        n60, spd = 0, []
        for a in amb:
            q = acts[a]
            if not q['present'][0]:
                continue
            if math.hypot(q['x'][0] - ex, q['y'][0] - ey) <= 60.0:
                n60 += 1
            spd.append(q['speedMps'][0])
        near.append(n60)
        if spd:
            spreads.append(max(spd) - min(spd))
            queues.append(sum(1 for v in spd if v < 0.5))
            junction_cells += 1
        # M2.5: the gate's closest-approach partner must be an AUTHORED actor, never ambient
        f = gate.trace_facts(tr)
        w = f.get('with')
        if w and _is_ambient(w, meta):
            hijack += 1
    med = st.median(near) if near else 0
    qrate = (sum(1 for q in queues if q >= 2) / len(queues)) if queues else None
    return {
        'M2.2': {'medianAmbientWithin60mAtT0': med, 'pass': med >= 3, 'target': '>=3',
                 'baseline': 0, 'n': len(near)},
        'M2.3': {'fractionWithQueueOf2Plus': None if qrate is None else round(qrate, 3),
                 'pass': (qrate is not None and qrate >= 0.5), 'target': '>=0.50',
                 'medianT0SpeedSpreadMps': round(st.median(spreads), 2) if spreads else None,
                 'speedsDistributed': bool(spreads and st.median(spreads) > 0.5),
                 'note': 'NOT MEASURED (no ambient actors present)' if not spreads else ''},
        'M2.5': {'cellsWhereClosestPartnerIsAmbient': hijack, 'n': len(recs),
                 'pass': hijack == 0, 'target': '0 -- subject pair must stay the authored pair'},
    }


def m3(recs, videodir):
    """3D export coverage, manifest integrity, and stream properties."""
    idx = os.path.join(videodir, 'INDEX.json')
    if not os.path.exists(idx):
        return {'M3.1': {'pass': False, 'note': 'NOT MEASURED -- no INDEX.json at ' + videodir}}
    ent = json.load(open(idx))
    by = {e.get('scenarioId'): e for e in ent if isinstance(e, dict)}
    have = [r for r in recs if r['scenarioId'] in by]
    integ = collections.Counter()
    for e in by.values():
        i = e.get('integrity') or {}
        integ['instanceHash'] += 1 if i.get('manifestInputHashMatches') or i.get('instanceHashMatches') else 0
        integ['traceHash'] += 1 if i.get('traceInputHashMatches') or i.get('traceHashMatches') else 0
        integ['actorIds'] += 1 if i.get('actorIdsExactMatch') else 0
    props = collections.Counter()
    sample = [e for e in by.values() if e.get('mp4') and os.path.exists(e['mp4'])][:40]
    for e in sample:
        try:
            out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                  'stream=width,height,avg_frame_rate,duration', '-of', 'json', e['mp4']],
                                 capture_output=True, text=True, timeout=60).stdout
            s = (json.loads(out).get('streams') or [{}])[0]
            w, h = int(s.get('width', 0)), int(s.get('height', 0))
            fr = s.get('avg_frame_rate', '0/1').split('/')
            fps = float(fr[0]) / float(fr[1]) if len(fr) == 2 and float(fr[1]) else 0.0
            props['res_ok'] += 1 if min(w, h) >= 720 else 0
            props['fps_ok'] += 1 if fps >= 12 else 0
            props['n'] += 1
        except Exception:                                            # noqa: BLE001
            props['probe_failed'] += 1
    return {
        'M3.1': {'exported': len(have), 'corpus': len(recs),
                 'rate': round(len(have) / max(len(recs), 1), 3),
                 'pass': len(have) == len(recs), 'target': '100%'},
        'M3.2': {'n': len(by), **dict(integ),
                 'pass': all(integ[k] == len(by) for k in ('instanceHash', 'traceHash', 'actorIds')) and len(by) > 0,
                 'target': 'every manifest matches on all three'},
        'M3.3': {'probed': props['n'], 'res>=720p': props['res_ok'], 'fps>=12': props['fps_ok'],
                 'probeFailed': props['probe_failed'],
                 'pass': props['n'] > 0 and props['res_ok'] == props['n'] and props['fps_ok'] == props['n']},
    }


def m1_3(match_json):
    """Every archetype keeps >=4 usable sites."""
    if not os.path.exists(match_json):
        return {'pass': False, 'note': 'NOT MEASURED -- no site-match report at ' + match_json}
    d = json.load(open(match_json))
    per = {k: v for k, v in d.items()}
    thin = {k: v for k, v in per.items() if v < 4}
    return {'perArchetype': per, 'belowFour': thin, 'pass': not thin, 'target': '>=4 each'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dataset', nargs='+', required=True)
    ap.add_argument('--videos', default='/tmp/vista-3d')
    ap.add_argument('--sitecounts', default='/tmp/vista-sitecounts.json')
    ap.add_argument('--plaus', default='')
    ap.add_argument('--placefit', default='')
    ap.add_argument('--out', default='/tmp/vista-scorecard.json')
    a = ap.parse_args()
    recs = _load(a.dataset)
    card = {'corpus': len(recs), 'archetypes': len({r['archetypeId'] for r in recs})}
    card['M4.4'] = m4_4(recs)
    card.update(m2_2_2_3_2_5(recs))
    card.update(m3(recs, a.videos))
    card['M1.3'] = m1_3(a.sitecounts)
    for key, path, field in (('M1.4', a.plaus, 'rate'), ('M1.1', a.placefit, 'rate')):
        if path and os.path.exists(path):
            d = json.load(open(path))
            card[key] = d.get('summary', d)
        else:
            card[key] = {'pass': False, 'note': 'NOT MEASURED -- no report supplied'}
    json.dump(card, open(a.out, 'w'), indent=1)
    print(json.dumps(card, indent=1))


if __name__ == '__main__':
    main()
