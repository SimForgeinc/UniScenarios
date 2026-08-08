"""PRODUCTION HARVEST: turn verified templates into as many training-grade concrete scenarios
as they will yield.

Pipeline: admitted templates -> voting critic (intent) -> mass simulation -> frozen gate + Q1-Q8.
Simulation is effectively free (~150 concrete scenarios/second), so the run is dominated by the LLM
steps; this stage exists to amortise those over as many concrete scenarios as each template supports.
"""
import os, sys, json, glob, argparse, time      # noqa: F401
from concurrent.futures import ProcessPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import author, critic, gate, hybrid

# Prefer the independently audited mechanical validator; fall back to our own.
try:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audit2'))
    import predicates as _MECH

    def _MECH_EVAL(trace_path, parsed):
        return _MECH.evaluate_trace(trace_path, parsed)
except Exception:                                                 # noqa: BLE001
    _MECH = hybrid

    def _MECH_EVAL(trace_path, parsed):
        return hybrid.validate(trace_path, None, parsed=parsed)


def _verify(a):
    rec_path, limit, reps = a
    r = json.load(open(rec_path))
    if not r.get('admitted'):
        return None
    bs = os.path.join(r.get('evidenceDir') or '', 'batch-summary.json')
    if not os.path.exists(bs):
        return None
    try:
        g = gate.gate_batch(bs)
    except Exception as e:                                        # noqa: BLE001
        return {'briefId': r['briefId'], 'error': str(e)}
    passing = [c for c in g['cells'] if c.get('pass')]
    if not passing:
        return None
    # PRIMARY validator: exact trajectory predicates from the INDEPENDENTLY AUDITED implementation.
    # `predicates.py AND critic(enh render)` was measured at precision 1.000 / recall 0.444 on the
    # audit's true pairs, dominating `hybrid + unanimous veto` (0.857 / 0.333) on BOTH axes -- there
    # was no trade to make. `hybrid.py` is kept as the fallback when the audited module is absent.
    try:
        parsed = _MECH.parse_brief(r['brief'])
    except Exception as e:                                        # noqa: BLE001
        return {'briefId': r['briefId'], 'error': 'parse: ' + str(e)}
    seen, picks = set(), []
    for c in passing:
        k = (c['mapId'], c['siteId'])
        if k in seen:
            continue
        seen.add(k)
        picks.append(c)
        if len(picks) >= 4:
            break
    vs = []
    for c in picks:
        try:
            vs.append(_MECH_EVAL(c['traceFile'], parsed))
        except Exception:                                         # noqa: BLE001
            pass
    pres = sum(1 for v in vs if str(v.get('verdict', '')).startswith('present'))
    mech = 'present' if vs and pres > len(vs) / 2 else 'absent'
    # the audited module uses {core, secondary, notComputable}; hybrid.py uses {required, ...}
    needs_vision = bool(parsed.get('notComputable'))
    _req = parsed.get('core') or parsed.get('required') or []

    # CONJUNCTION, not a veto. The independent audit scored six configurations on a non-circular
    # tier (n=63): `predicates AND critic(enh render)` was the only one with ZERO false positives on
    # 49 negatives (precision 1.000, FP rate 0.000, 95% CI 0.000-0.073). Predicates alone run at
    # FP 0.102, which is corpus poisoning; the critic alone runs at recall 0.357.
    # For a TRAINING corpus a false positive is permanent mislabelling and a false negative merely
    # costs yield, and yield is the cheap thing here -- so we take the conjunction and accept the
    # recall cost.
    cr = {'verdict': 'n/a', 'yesFraction': None, 'whyNot': ''}
    if mech == 'present':
        cr = critic.review_cells(passing, r['brief'], limit=limit, reps=reps, workers=3)
        if cr['verdict'] != 'verified':
            mech = 'absent'
    return {'briefId': r['briefId'], 'brief': r['brief'], 'category': r.get('category'),
            'template': os.path.dirname(rec_path) + '/template.json',
            'verdict': 'verified' if mech == 'present' else 'rejected',
            'mechanical': mech, 'predicates': _req,
            'notComputable': parsed['notComputable'],
            'visionVerdict': cr['verdict'], 'yesFraction': cr.get('yesFraction'),
            'whyNot': cr.get('whyNot', '')}


def _mass(a):
    ent, sites, draws, outroot, ambient = a
    out = f"{outroot}/{ent['briefId']}"
    # Ambient traffic is opt-in per run. It must be passed HERE, on the batch path, because that is
    # the only path the corpus pipeline uses -- `debug --provider sumo` runs a separate comparison and
    # never puts a background road user into ticks.actors.
    amb = ['--ambient', ambient] if ambient and ambient != 'off' else []
    rc, bd, err = author.run_cli(['batch', ent['template'], '--all-maps', '--draws', str(draws),
                                  '--max-sites', str(sites), '--out', out, '--concurrency', '2'] + amb)
    if not bd.get('results'):
        return {**ent, 'cells': 0, 'trainingGrade': 0, 'error': (err or '')[:200]}
    g = gate.gate_batch(out + '/batch-summary.json')
    keep = [{'traceFile': c['traceFile'], 'instanceFile': c.get('instanceFile'),
             'mapId': c['mapId'], 'siteId': c['siteId'], 'clearanceM': c['clearanceM'],
             'minTTC': c['minTTC'], 'closestT': c['closestT'],
             'egoPeakDecelMps2': c.get('egoPeakDecelMps2')}
            for c in g['cells'] if c.get('passHQ')]
    # Near-duplicates inflate the corpus without adding information: one template produced 302
    # 'training-grade' cells that collapsed to 134 distinct behaviours, and 310 across the run
    # collapsed to 61. Only the DISTINCT count is meaningful as training data.
    distinct = gate.deduplicate(keep)
    return {**ent, 'cells': g['totalCells'], 'frozenPass': g['passingCells'],
            'trainingGrade': len(keep), 'distinct': len(distinct),
            'nSites': g['nSitesHQ'], 'nMaps': g['nMapsHQ'],
            'qualityLoss': g['qualityLoss'], 'scenarios': distinct,
            'allScenarios': keep, 'outDir': out}


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--roots', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sites', type=int, default=8)
    ap.add_argument('--draws', type=int, default=20)
    ap.add_argument('--reps', type=int, default=3)
    ap.add_argument('--limit', type=int, default=2)
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--accept-uncertain', action='store_true')
    ap.add_argument('--ambient', default='off',
                    help="ambient traffic preset passed to `batch` (off|light|moderate|city|heavy)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    recs = [f for r in a.roots for f in sorted(glob.glob(r + '/*/record.json'))]

    t0 = time.time()
    verified = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for fu in as_completed([ex.submit(_verify, (f, a.limit, a.reps)) for f in recs]):
            v = fu.result()
            if not v or v.get('error'):
                continue
            verified.append(v)
            print(f"  verify {v['briefId']:28} {v['verdict']:9} ({v['yesFraction']})", flush=True)
    t_verify = time.time() - t0
    ok = [v for v in verified if v['verdict'] == 'verified'
          or (a.accept_uncertain and v['verdict'] == 'uncertain')]
    print(f"\n{len(ok)} templates cleared intent verification of {len(verified)} admitted "
          f"({t_verify:.0f}s)\n", flush=True)

    t1 = time.time()
    out_rows = []
    with ProcessPoolExecutor(max_workers=a.workers) as ex:
        for fu in as_completed([ex.submit(_mass, (v, a.sites, a.draws, a.out, a.ambient)) for v in ok]):
            r = fu.result()
            out_rows.append(r)
            print(f"  harvest {r['briefId']:28} {r['trainingGrade']:4} training-grade "
                  f"of {r['cells']} simulated", flush=True)
    t_mass = time.time() - t1
    total = sum(r['trainingGrade'] for r in out_rows)
    distinct = sum(r.get('distinct', 0) for r in out_rows)
    sim = sum(r['cells'] for r in out_rows)
    summary = {'templatesAdmitted': len(verified), 'templatesVerified': len(ok),
               'simulatedCells': sim, 'trainingGradeScenarios': total,
               'distinctScenarios': distinct,
               'perVerifiedTemplateDistinct': round(distinct / max(len(ok), 1), 1),
               'verifySeconds': round(t_verify, 1), 'harvestSeconds': round(t_mass, 1),
               'perTemplate': round(total / max(len(ok), 1), 1),
               'rows': sorted(out_rows, key=lambda r: -r['trainingGrade'])}
    json.dump(summary, open(a.out + '/HARVEST.json', 'w'), indent=1)
    print(f"\n== {distinct} DISTINCT training-grade scenarios ({total} before dedup) from "
          f"{len(ok)} verified templates, {sim} simulated "
          f"| verify {t_verify:.0f}s + harvest {t_mass:.0f}s ==")
