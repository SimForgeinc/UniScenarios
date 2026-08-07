"""compare_modes.py -- the head-to-head: does SIGHT produce BETTER scenarios, or merely MORE of them?

Reads the authoring loop's own output directories, selects the cells the gate ADMITTED in each mode,
runs the independent quality judge over them, and reports the two claims SEPARATELY:

    MORE    = how many briefs were admitted
    BETTER  = what fraction of the admitted cells survive an independent quality judge

Those are different claims. A mode that admits twice as many scenarios of the same quality has produced
more. A mode whose admitted scenarios score higher has produced better. "Sight beat blindness" is only
interesting if it is the second, or if it is the first WITHOUT a quality drop.

Both gates are reported side by side and labelled unambiguously:

    FROZEN GATE   the pre-registered contract, sha256 1a08698e95fca4bc (C1..C5, >=2 maps, >=3 sites).
                  This is the CONTRACTUAL head-to-head number.
    HQ GATE       the frozen gate plus the authoring lane's Q-clauses (Q1 jointChallenger,
                  Q2 egoReallyResponded, Q3 noPropOverlap, Q4 headingSane, Q5 notClipped,
                  Q6 ttcPairIsEgo). Strictly tighter. This is the number that answers the objective.

R3 (novelty) is reported twice: the rubric as specified, and with the R3 clause removed from the verdict
rules. R3 anchor 0 is literally "generic car-following", so R3 systematically demotes the whole
C1.car-following category in BOTH modes. That is a true statement about the corpus, not a mode effect,
and it is shown rather than tuned away. Everything is also broken out per taxonomy category so category
mix cannot masquerade as a mode difference.

Usage:
    .venv/bin/python judge/compare_modes.py \
        --sight /tmp/vista-dev-sight --blind /tmp/vista-dev-blind \
        --out /tmp/judge-h2h --cells-per-brief 3 --workers 5
    # add --dry-run to exercise the whole reporting path with zero LLM calls
"""
import argparse, collections, glob, json, math, os, random, statistics, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE); sys.path.insert(0, os.path.dirname(_HERE))
import judge as JU
import conflict as CF

VERDICT_ORDER = ['high', 'acceptable', 'physically-valid-but-boring', 'intent-not-realised', 'invalid']
GOOD = {'high', 'acceptable'}
BAD = {'physically-valid-but-boring', 'intent-not-realised', 'invalid'}
MIN_N_FOR_CLAIM = 12          # below this I say so instead of quoting a difference

BRIEF_CORPUS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(_HERE))),
                            'agent-authoring', 'brief-corpus.json')


# --------------------------------------------------------------------- stats
def boot_ci(xs, stat=statistics.mean, n=4000, alpha=0.05, seed=11):
    """Percentile bootstrap CI. Returned so small-n results carry their own honesty."""
    xs = list(xs)
    if len(xs) < 2:
        return (None, None)
    rng = random.Random(seed)
    s = sorted(stat([xs[rng.randrange(len(xs))] for _ in xs]) for _ in range(n))
    return (round(s[int(alpha / 2 * n)], 2), round(s[int((1 - alpha / 2) * n)], 2))


def wilson(k, n, z=1.96):
    """Wilson score interval for a proportion -- correct at small n, unlike normal approximation."""
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(max(0.0, c - h), 3), round(min(1.0, c + h), 3))


def fisher_2x2(a, b, c, d):
    """Two-sided Fisher exact p for [[a,b],[c,d]]. Stdlib only."""
    def C(n, k):
        return math.comb(n, k)
    n = a + b + c + d
    r1, r2, c1 = a + b, c + d, a + c
    def prob(x):
        return C(r1, x) * C(r2, c1 - x) / C(n, c1)
    p0 = prob(a)
    lo = max(0, c1 - r2); hi = min(r1, c1)
    return round(sum(prob(x) for x in range(lo, hi + 1) if prob(x) <= p0 + 1e-12), 4)


# --------------------------------------------------------------------- verdicts
def verdict_without_R3(s):
    """The rubric's verdict rules with the novelty clause removed. Used to expose exactly how much of
    the judgement R3 is carrying, rather than softening R3."""
    R1, R2, R3, R4, R5 = (s[k] for k in ('R1', 'R2', 'R3', 'R4', 'R5'))
    if R5 <= 1: return 'invalid'
    if R1 <= 1: return 'intent-not-realised'
    if R2 <= 1 or R4 == 0: return 'physically-valid-but-boring'
    if min(R1, R2, R4) >= 3: return 'high'
    return 'acceptable'


# --------------------------------------------------------------------- io
def load_records(root):
    out = []
    for rp in sorted(glob.glob(os.path.join(root, '*', 'record.json'))):
        try:
            out.append(json.load(open(rp)))
        except Exception as ex:                                     # noqa: BLE001
            print(f'  ! unreadable {rp}: {ex!r}')
    return out


def brief_meta():
    try:
        bc = json.load(open(BRIEF_CORPUS))
    except Exception:                                               # noqa: BLE001
        return {}, set(), set()
    meta = {b['id']: b for b in bc['briefs']}
    return meta, set(bc['split']['DEV']), set(bc['split']['HELDOUT'])


def pick_cells(rec, n):
    """Gate-PASSING cells, spread across distinct (map, site) so the sample reflects the
    >=2 maps / >=3 sites spread rule rather than n draws at a single site."""
    cells = [c for c in (rec.get('lastCells') or []) if c.get('pass') and c.get('traceFile')]
    seen, first, rest = set(), [], []
    for c in cells:
        k = (c.get('mapId'), c.get('siteId'))
        (rest if k in seen else first).append(c)
        seen.add(k)
    return (first + rest)[:n]


def admitted_frozen(rec):
    return bool(rec.get('admitted')) or bool((rec.get('lastGate') or {}).get('admitted'))


def admitted_hq(rec):
    return bool((rec.get('lastGate') or {}).get('admittedHQ'))


# --------------------------------------------------------------------- judging
def judge_records(records, mode, out_dir, dev, n_cells, workers, dry_run=False):
    from concurrent.futures import ThreadPoolExecutor
    meta, _, _ = brief_meta()
    jobs = [(rec, c) for rec in records if admitted_frozen(rec) for c in pick_cells(rec, n_cells)]
    print(f'{mode}: {sum(1 for r in records if admitted_frozen(r))} briefs admitted by the FROZEN gate '
          f'({sum(1 for r in records if admitted_hq(r))} by the HQ gate) -> {len(jobs)} cells to judge')

    def one(job):
        rec, c = job
        tag = f"{mode}-{rec['briefId']}-{str(c.get('mapId'))[:6]}-{str(c.get('siteId'))[:6]}"
        base = {'mode': mode, 'briefId': rec['briefId'], 'brief': rec.get('brief'),
                'category': rec.get('category') or meta.get(rec['briefId'], {}).get('category'),
                'iterations': len(rec.get('iterations') or []),
                'wallClockS': rec.get('wallClockS'),
                'admittedFrozen': admitted_frozen(rec), 'admittedHQ': admitted_hq(rec),
                'trace': c['traceFile'], 'mapId': c.get('mapId'), 'siteId': c.get('siteId')}
        try:
            ev = CF.conflict_event(JU.F.load_trace(c['traceFile']))
            base['conflict'] = {k: ev.get(k) for k in
                                ('challenger', 'contested', 'pathSeparationM', 'tCross',
                                 'encroachmentGapS', 'sameEvent', 'lagS', 'geometry',
                                 'challengerSpeedAtEgoArrival', 'reason')}
            base['conflict']['C3b'] = CF.c3b_conflict_is_the_proximity(ev)[0]
        except Exception as ex:                                     # noqa: BLE001
            base['conflict'] = {'error': repr(ex)}
        if dry_run:
            base.update({'verdict': 'DRY', 'scores': {k: 0 for k in ('R1','R2','R3','R4','R5')},
                         'difficultyMeasured': {'score': 0.0}, 'mechanicalFlags': [],
                         'capsApplied': [], 'oneLine': ''})
            return base
        try:
            r = JU.judge_trace(c['traceFile'], rec['brief'], out_dir, dev,
                               instance_path=c.get('instanceFile'),
                               gate_verdict=c.get('verdict'), gate_band=c.get('band'),
                               tag=tag, keep_images=False)
        except Exception as ex:                                     # noqa: BLE001
            base['error'] = repr(ex)
            return base
        r.pop('stage1', None); r.pop('stage2', None); r.pop('features', None)
        r.update(base)
        r['verdictNoR3'] = verdict_without_R3(r['scores'])
        print(f"  {tag}: {r['verdict']:28s} {r['scores']} "
              f"diff={r['difficultyMeasured']['score']}", flush=True)
        return r

    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, jobs))


# --------------------------------------------------------------------- report
def dist(rs, key='verdict'):
    c = collections.Counter(r.get(key) for r in rs)
    return {v: c.get(v, 0) for v in VERDICT_ORDER}


def report(S, B, sj, bj, out_dir, n_cells):
    L = []

    def p(s=''):
        print(s); L.append(s)

    meta, DEV, HELD = brief_meta()
    sok = [r for r in sj if 'error' not in r]
    bok = [r for r in bj if 'error' not in r]

    p('# HEAD-TO-HEAD: sight vs blind, judged independently')
    p()
    if any(r.get('verdict') == 'DRY' for r in sok + bok):
        p('> **DRY RUN -- NO LLM CALLS WERE MADE. All rubric numbers below are placeholder zeros and')
        p('> must not be read as results. Only the admission counts and the conflict.py physics are real.**')
        p()
    p('Gates, labelled unambiguously:')
    p('  FROZEN GATE = the pre-registered contract (sha256 1a08698e95fca4bc): C1..C5, >=2 maps,')
    p('                >=3 distinct sites. THIS IS THE CONTRACTUAL HEAD-TO-HEAD NUMBER.')
    p('  HQ GATE     = frozen gate AND the authoring lane\'s Q1..Q6 quality clauses. Strictly tighter.')
    p('  JUDGE       = this lane\'s independent rubric (RUBRIC.md), applied to cells the frozen gate')
    p('                already admitted. It never loosens anything; it only removes.')
    p()

    # ---------------- admission
    p('## 1. MORE -- admission')
    p()
    p(f"{'mode':7s} {'briefs':>7s} {'FROZEN adm':>11s} {'rate':>7s} {'95% CI':>16s} "
      f"{'HQ adm':>7s} {'rate':>7s} {'95% CI':>16s}")
    adm = {}
    for name, recs in (('sight', S), ('blind', B)):
        n = len(recs)
        af = sum(1 for r in recs if admitted_frozen(r))
        ah = sum(1 for r in recs if admitted_hq(r))
        adm[name] = (n, af, ah)
        p(f"{name:7s} {n:7d} {af:11d} {af/max(n,1):7.3f} {str(wilson(af,n)):>16s} "
          f"{ah:7d} {ah/max(n,1):7.3f} {str(wilson(ah,n)):>16s}")
    (ns, afs, ahs), (nb, afb, ahb) = adm['sight'], adm['blind']
    if ns and nb:
        p()
        p(f"  FROZEN gate, sight vs blind admission: Fisher exact p = "
          f"{fisher_2x2(afs, ns-afs, afb, nb-afb)}")
        p(f"  HQ gate,     sight vs blind admission: Fisher exact p = "
          f"{fisher_2x2(ahs, ns-ahs, ahb, nb-ahb)}")
        p(f"  Lane-1 blind baseline for reference: DEV 0.312 (29-31 admitted of 92).")
    p()

    # ---------------- quality
    p('## 2. BETTER -- quality of the cells the FROZEN gate admitted')
    p()
    for name, js in (('sight', sok), ('blind', bok)):
        d = dist(js)
        nb_ = len(js)
        p(f'### {name}  ({nb_} cells judged, up to {n_cells} per admitted brief)')
        for k in VERDICT_ORDER:
            p(f'    {k:30s} {d[k]:3d}   {d[k]/max(nb_,1):.3f}')
        g = sum(d[k] for k in GOOD)
        rej = sum(d[k] for k in BAD)
        p(f'    -> good (high|acceptable)      {g:3d}   {g/max(nb_,1):.3f}  CI {wilson(g, nb_)}')
        p(f'    -> gate admitted, judge rejects {rej:3d}   {rej/max(nb_,1):.3f}')
        if js:
            for dim in ('R1', 'R2', 'R3', 'R4', 'R5'):
                v = [r['scores'][dim] for r in js]
                p(f'    mean {dim} {statistics.mean(v):.2f}  CI {boot_ci(v)}')
        p()
    if sok and bok:
        gs = sum(1 for r in sok if r['verdict'] in GOOD)
        gb = sum(1 for r in bok if r['verdict'] in GOOD)
        p(f"  quality difference, Fisher exact p = "
          f"{fisher_2x2(gs, len(sok)-gs, gb, len(bok)-gb)}")
    p()

    p('## 3. The same, with the R3 (novelty) clause REMOVED from the verdict rules')
    p('   R3 anchor 0 is literally "generic car-following", so R3 demotes that whole category in BOTH')
    p('   modes. This block shows how much of the verdict R3 is carrying. It is NOT a softened rubric;')
    p('   the rubric of record is section 2.')
    p()
    for name, js in (('sight', sok), ('blind', bok)):
        d = dist(js, 'verdictNoR3')
        n_ = len(js)
        g = sum(d[k] for k in GOOD)
        p(f"  {name:6s} good {g:3d}/{n_:<3d} = {g/max(n_,1):.3f}   " +
          '  '.join(f'{k.split("-")[0]}:{d[k]}' for k in VERDICT_ORDER))
    p()

    # ---------------- per category
    p('## 4. Per category -- so category mix cannot masquerade as a mode effect')
    p()
    cats = sorted({r.get('category') for r in sok + bok if r.get('category')})
    p(f"{'category':28s} {'sight n':>7s} {'good':>5s} {'rate':>6s} {'diff':>6s} | "
      f"{'blind n':>7s} {'good':>5s} {'rate':>6s} {'diff':>6s}")
    for c in cats:
        row = [f'{c:28s}']
        for js in (sok, bok):
            sel = [r for r in js if r.get('category') == c]
            g = sum(1 for r in sel if r['verdict'] in GOOD)
            dv = statistics.mean([r['difficultyMeasured']['score'] for r in sel]) if sel else float('nan')
            row.append(f"{len(sel):7d} {g:5d} {(g/len(sel) if sel else float('nan')):6.2f} {dv:6.1f}")
        p(row[0] + row[1] + ' | ' + row[2])
    p()

    # ---------------- difficulty
    p('## 5. Measured difficulty (trajectory-derived; the authoring surface cannot reach it)')
    p()
    for name, js in (('sight', sok), ('blind', bok)):
        v = sorted(r['difficultyMeasured']['score'] for r in js)
        if not v:
            p(f'  {name}: no cells'); continue
        p(f"  {name:6s} n={len(v):3d}  mean {statistics.mean(v):5.1f}  "
          f"median {statistics.median(v):5.1f}  sd "
          f"{(statistics.stdev(v) if len(v)>1 else 0):5.1f}  "
          f"min {v[0]:.1f}  max {v[-1]:.1f}  95% CI (bootstrap) {boot_ci(v)}")
        p(f"         per-cell: {[round(x,1) for x in v]}")
    if sok and bok:
        sv = [r['difficultyMeasured']['score'] for r in sok]
        bv = [r['difficultyMeasured']['score'] for r in bok]
        d = statistics.mean(sv) - statistics.mean(bv)
        # bootstrap the difference directly
        rng = random.Random(23)
        diffs = sorted(statistics.mean([sv[rng.randrange(len(sv))] for _ in sv]) -
                       statistics.mean([bv[rng.randrange(len(bv))] for _ in bv]) for _ in range(4000))
        ci = (round(diffs[100], 2), round(diffs[3900], 2))
        p()
        p(f'  difference (sight - blind): {d:+.1f}, 95% bootstrap CI {ci}')
        if min(len(sv), len(bv)) < MIN_N_FOR_CLAIM:
            p(f'  ** n is too small to support this as a claim ** '
              f'(sight n={len(sv)}, blind n={len(bv)}, threshold {MIN_N_FOR_CLAIM}). '
              f'Quote it as descriptive, not inferential.')
        elif ci[0] <= 0 <= ci[1]:
            p('  ** the CI spans zero: this is NOT evidence of a difficulty difference. **')
        else:
            p('  the CI excludes zero.')
    p()

    # ---------------- the headline
    p('## 6. Better, or merely more?')
    p()
    if sok and bok:
        sg = sum(1 for r in sok if r['verdict'] in GOOD) / len(sok)
        bg = sum(1 for r in bok if r['verdict'] in GOOD) / len(bok)
        p(f'  MORE   : frozen-gate admission  sight {afs}/{ns} = {afs/max(ns,1):.3f}   '
          f'blind {afb}/{nb} = {afb/max(nb,1):.3f}')
        p(f'           HQ-gate admission      sight {ahs}/{ns} = {ahs/max(ns,1):.3f}   '
          f'blind {ahb}/{nb} = {ahb/max(nb,1):.3f}')
        p(f'  BETTER : judged good | admitted sight {sg:.3f}   blind {bg:.3f}')
        p(f'  QUALITY-ADJUSTED YIELD (admitted briefs x good rate, frozen gate):')
        p(f'           sight {afs} x {sg:.3f} = {afs*sg:.2f}')
        p(f'           blind {afb} x {bg:.3f} = {afb*bg:.2f}')
        p()
        if abs(sg - bg) < 0.10:
            p('  READ: quality per admitted cell is comparable between modes. Any advantage is in')
            p('        QUANTITY, not quality -- sight produced MORE, not BETTER.')
        elif sg > bg:
            p('  READ: sight admitted cells score higher AND (see above) may admit more.')
        else:
            p('  READ: sight admits more but its admitted cells score LOWER -- a quality/quantity')
            p('        trade, which is the failure mode this judge exists to detect.')
    p()

    # ---------------- rejects and flags
    p('## 7. Every cell the FROZEN gate admitted that the judge rejects')
    p()
    bad = [r for r in sok + bok if r['verdict'] in BAD]
    if not bad:
        p('  none')
    for r in sorted(bad, key=lambda x: (x['mode'], x['briefId'])):
        p(f"  [{r['mode']}] {r['briefId']} ({r.get('category')})  -> {r['verdict']}   {r['scores']}"
          f"   HQ-admitted={r.get('admittedHQ')}")
        p(f"      brief : {r.get('brief')}")
        p(f"      why   : {r.get('oneLine')}")
        if r.get('mechanicalFlags'): p(f"      flags : {', '.join(r['mechanicalFlags'])}")
        if r.get('capsApplied'):     p(f"      caps  : {r['capsApplied']}")
        cf = r.get('conflict') or {}
        p(f"      phys  : contested={cf.get('contested')} pathSep={cf.get('pathSeparationM')} m "
          f"gap={cf.get('encroachmentGapS')} s C3b={cf.get('C3b')}")
        p(f"      trace : {r['trace']}")
    p()

    p('## 8. Physics-side flags across all judged cells')
    p()
    fl = collections.Counter()
    for r in sok + bok:
        for f in r.get('mechanicalFlags', []):
            fl[(r['mode'], f)] += 1
    ncs = collections.Counter()
    for r in sok + bok:
        cf = r.get('conflict') or {}
        if cf.get('contested') is False:
            ncs[r['mode']] += 1
    for (m, f), c in sorted(fl.items()):
        p(f'  {m:6s} {f:34s} {c}')
    p()
    p(f"  NO contested-space event (paths never overlapped) despite passing the FROZEN gate: "
      f"sight {ncs.get('sight',0)}, blind {ncs.get('blind',0)}, "
      f"total {sum(ncs.values())}/{len(sok)+len(bok)}")
    if sum(ncs.values()) >= 3:
        p('  -> above the "couple of cells" threshold: NO_CONTESTED_SPACE is worth adding as a Q-clause.')
    else:
        p('  -> at or below a couple of cells: not yet evidence for a new Q-clause.')
    p()

    os.makedirs(out_dir, exist_ok=True)
    open(os.path.join(out_dir, 'HEAD-TO-HEAD.md'), 'w').write('\n'.join(L))
    json.dump({'sight': sj, 'blind': bj,
               'sightRecords': [{k: v for k, v in r.items() if k not in ('iterations', 'template')}
                                for r in S],
               'blindRecords': [{k: v for k, v in r.items() if k not in ('iterations', 'template')}
                                for r in B]},
              open(os.path.join(out_dir, 'head-to-head.json'), 'w'), indent=1, default=str)
    print(f"\nwrote {out_dir}/HEAD-TO-HEAD.md and head-to-head.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sight', required=True)
    ap.add_argument('--blind', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cells-per-brief', type=int, default=3)
    ap.add_argument('--workers', type=int, default=5)
    ap.add_argument('--dev-assets', default=None)
    ap.add_argument('--dry-run', action='store_true',
                    help='exercise the whole reporting path with zero LLM calls')
    a = ap.parse_args()
    dev = a.dev_assets or JU._default_dev_assets()
    S, B = load_records(a.sight), load_records(a.blind)
    os.makedirs(a.out, exist_ok=True)
    sj = judge_records(S, 'sight', a.out, dev, a.cells_per_brief, a.workers, a.dry_run)
    bj = judge_records(B, 'blind', a.out, dev, a.cells_per_brief, a.workers, a.dry_run)
    report(S, B, sj, bj, a.out, a.cells_per_brief)


if __name__ == '__main__':
    main()
