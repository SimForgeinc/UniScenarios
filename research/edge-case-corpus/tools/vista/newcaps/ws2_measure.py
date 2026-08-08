#!/usr/bin/env python3
"""WS-2 ambient-traffic measurement harness.

Runs the SAME `batch` invocation the corpus harvester uses, with and without
`--ambient`, then measures the five WS-2 acceptance measures from the RAW traces.

Nothing here reads a summary field as evidence for a physical claim: the
near-ego counts, the queues and the hijack analysis are all recomputed from
`ticks`, exactly like `gate.py` does.

Usage:
  python3 ws2_measure.py --out /tmp/vista-ws2/measure --templates c3-allway-stop ...
"""
import argparse, gzip, json, math, os, subprocess, sys, time

REPO = '/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista'
CLI = ['node', REPO + '/packages/cli/bin/uniscenarios.js']
TPL_DIR = REPO + '/research/edge-case-corpus/vista-corpus/templates'
GATE_DIR = REPO + '/research/edge-case-corpus/tools/vista'
sys.path.insert(0, GATE_DIR)
import gate  # noqa: E402  -- read-only; never modified by this harness

NEAR_M = 60.0
STANDSTILL_MPS = 0.5
QUEUE_MIN = 2
QUEUE_GAP_M = 18.0   # a car is "in the queue behind" another within this gap


def run_cli(args, timeout=3600):
    env = dict(os.environ, FORCE_COLOR='0', NO_COLOR='1')
    p = subprocess.run(CLI + args, capture_output=True, text=True, timeout=timeout, cwd=REPO, env=env)
    return p.returncode, p.stdout, p.stderr[-2000:]


def run_batch(tpl, out, ambient_args, draws, sites, force=False):
    args = ['batch', tpl, '--all-maps', '--draws', str(draws), '--max-sites', str(sites),
            '--out', out, '--concurrency', '2'] + list(ambient_args)
    if force:
        args.append('--force')
    t0 = time.time()
    rc, so, se = run_cli(args)
    return {'rc': rc, 'elapsedS': round(time.time() - t0, 1), 'stderr': se}


def load_trace(path):
    with gzip.open(path) as f:
        return json.loads(f.read())


def t0_index(trace):
    for i, t in enumerate(trace['ticks']['t']):
        if t >= 0:
            return i
    return None


def ambient_ids(trace):
    """The engine's own published set, with the two independent fall-backs."""
    hdr = trace['header']
    ids = set(hdr.get('ambientActorIds') or [])
    meta = hdr.get('actorMetadata') or {}
    tagged = {a for a, m in meta.items() if 'ambient' in (m.get('tags') or [])}
    prefixed = {a for a in trace['ticks']['actors'] if a.startswith('ambient:')}
    return ids, tagged, prefixed


# ------------------------------------------------------------------ M2.2 / M2.3
def t0_facts(trace):
    ticks = trace['ticks']
    i = t0_index(trace)
    if i is None:
        return None
    amb, _, _ = ambient_ids(trace)
    meta = trace['header'].get('actorMetadata') or {}
    subject = trace['header'].get('metricSubject') or 'ego'
    ego = ticks['actors'].get(subject)
    near, speeds, stopped, poses = 0, [], 0, []
    for aid in amb:
        tr = ticks['actors'].get(aid)
        if not tr or not tr['present'][i]:
            continue
        kind = (meta.get(aid) or {}).get('kind')
        v = tr['speedMps'][i]
        speeds.append(round(v, 3))
        if v < STANDSTILL_MPS:
            stopped += 1
            poses.append((tr['x'][i], tr['y'][i], tr['headingRad'][i]))
        if ego and ego['present'][i] and kind not in ('pedestrian', 'bicycle', 'animal'):
            if math.hypot(tr['x'][i] - ego['x'][i], tr['y'][i] - ego['y'][i]) <= NEAR_M:
                near += 1
    return {'ambientCount': len(amb), 'nearEgoAtT0': near, 'stoppedAtT0': stopped,
            'speedsAtT0': speeds, 'standingQueue': max_queue(poses)}


def max_queue(poses):
    """Largest chain of stopped vehicles nose-to-tail within QUEUE_GAP_M.

    A "standing queue" is not "two cars happen to be stationary somewhere on the
    map": they have to be behind one another on the same piece of road, which is
    what the heading agreement and the gap bound test.
    """
    best = 0
    for i, (x, y, h) in enumerate(poses):
        chain = 1
        used = {i}
        cx, cy, ch = x, y, h
        while True:
            nxt = None
            for j, (px, py, ph) in enumerate(poses):
                if j in used:
                    continue
                d = math.hypot(px - cx, py - cy)
                if d > QUEUE_GAP_M:
                    continue
                if abs(math.atan2(math.sin(ph - ch), math.cos(ph - ch))) > 0.4:
                    continue
                # behind: projection onto -heading is positive
                if (px - cx) * -math.cos(ch) + (py - cy) * -math.sin(ch) < 0.5:
                    continue
                if nxt is None or d < nxt[1]:
                    nxt = (j, d)
            if nxt is None:
                break
            used.add(nxt[0])
            chain += 1
            cx, cy, ch = poses[nxt[0]]
        best = max(best, chain)
    return best


# ------------------------------------------------------------------------ M2.5
def hijack(trace):
    """Would the frozen gate have attributed the scenario to an ambient body?

    `gate.trace_facts` is the REAL implementation, called unmodified. To measure
    the counterfactual, the ambient tracks are deleted from a copy of the trace
    and the same function is run again; the difference IS the hijack.
    """
    amb, _, _ = ambient_ids(trace)
    unfiltered = gate.trace_facts(trace)
    if 'error' in unfiltered:
        return {'error': unfiltered['error']}
    stripped = {'header': trace['header'], 'metrics': trace.get('metrics', {}), 'events': [],
                'ticks': {**trace['ticks'],
                          'actors': {k: v for k, v in trace['ticks']['actors'].items() if k not in amb}}}
    filtered = gate.trace_facts(stripped)
    m = trace.get('metrics') or {}
    ttc_pair = ((m.get('minTTC') or {}).get('pair') or [])
    return {
        'ambientCount': len(amb),
        'unfilteredClosestWith': unfiltered['closestWith'],
        'unfilteredClearanceM': unfiltered['clearanceM'],
        'filteredClosestWith': filtered['closestWith'],
        'filteredClearanceM': filtered['clearanceM'],
        'subjectHijacked': unfiltered['closestWith'] in amb,
        'ttcPairHasAmbient': any(p in amb for p in ttc_pair),
        'requiredDecelMaxEgo': unfiltered['requiredDecelMaxEgo'],
        'unfilteredC2': unfiltered['closestT'] is not None and unfiltered['closestT'] > unfiltered['warmupSeconds'] + gate.C2_MARGIN,
        'unfilteredC3': unfiltered['clearanceM'] is not None and unfiltered['clearanceM'] <= gate.C3_CLEARANCE,
        'filteredC3': filtered['clearanceM'] is not None and filtered['clearanceM'] <= gate.C3_CLEARANCE,
    }


def measure_dir(outdir):
    s = json.load(open(outdir + '/batch-summary.json'))
    rows = []
    for r in s.get('results', []):
        if r.get('status') != 'ok' or not r.get('traceFile'):
            rows.append({'mapId': r.get('mapId'), 'siteId': r.get('siteId'), 'drawIndex': r.get('drawIndex'),
                         'band': r.get('band'), 'status': r.get('status'), 'skip': True})
            continue
        tr = load_trace(r['traceFile'])
        row = {'mapId': r['mapId'], 'siteId': r['siteId'], 'drawIndex': r['drawIndex'],
               'band': r['band'], 'verdict': r['verdict'], 'status': 'ok',
               'traceDigest': r.get('traceDigest'), 'traceFile': r['traceFile'], 'skip': False}
        row.update(t0_facts(tr) or {})
        row['hijack'] = hijack(tr)
        rows.append(row)
    return s, rows


def median(v):
    v = sorted(v)
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--templates', nargs='+', required=True)
    ap.add_argument('--draws', type=int, default=1)
    ap.add_argument('--sites', type=int, default=4)
    ap.add_argument('--ambient', nargs='*', default=['--ambient', 'city', '--ambient-radius-m', '90',
                                                     '--ambient-density', '24', '--ambient-max-actors', '40'])
    ap.add_argument('--skip-run', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    report = {'ambientArgs': a.ambient, 'draws': a.draws, 'sites': a.sites, 'templates': {}}
    for name in a.templates:
        tpl = f'{TPL_DIR}/{name}.template.json'
        off_dir, on_dir, rep_dir = f'{a.out}/{name}-off', f'{a.out}/{name}-on', f'{a.out}/{name}-rerun'
        if not a.skip_run:
            run_batch(tpl, off_dir, [], a.draws, a.sites)
            run_batch(tpl, on_dir, a.ambient, a.draws, a.sites)
            run_batch(tpl, rep_dir, a.ambient, a.draws, a.sites)
        off_s, off_rows = measure_dir(off_dir)
        on_s, on_rows = measure_dir(on_dir)
        rep_s, rep_rows = measure_dir(rep_dir)
        report['templates'][name] = {'off': off_rows, 'on': on_rows,
                                     'rerunDigests': {(r['mapId'], r['siteId'], r['drawIndex']).__str__(): r.get('traceDigest')
                                                      for r in rep_rows if not r['skip']},
                                     'offBands': off_s['criticality']['bands'],
                                     'onBands': on_s['criticality']['bands']}
        json.dump(report, open(a.out + '/ws2-measurements.json', 'w'), indent=1)
        print('done', name, flush=True)
    print('WROTE', a.out + '/ws2-measurements.json')
