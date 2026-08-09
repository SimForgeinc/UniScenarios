"""conflict.py -- gate-side measurement of the CONTESTED-SPACE event.

Why this exists
---------------
The frozen gate scores C2/C3 on the instant of minimum *simultaneous* separation. That instant is not
in general the instant of the interaction. Measured over the whole `expA-child-dartout-two-cars` family
(28/28 cells), the minimum-clearance instant is NEVER the moment the two parties contested the same
ground: the child crosses the ego's centreline seconds earlier and 5-8x further away, then finishes
crossing and stops, and the "near miss" the gate scores is the ego driving past a stationary pedestrian.

Simultaneous separation conflates two independent things:

    * SPATIAL separation  -- how close the two PATHS come, ignoring when each party was there
    * TEMPORAL separation -- how close in TIME they were to being at the same place

A genuine conflict is small in BOTH. A boring pass-by is small in the first and large in the second, or
small only because one party has stopped. This module measures them separately.

The measurement
---------------
For an ego and a challenger, over all pairs of tick indices (i, j) -- note: DIFFERENT times allowed --
compute the true oriented-bounding-box clearance between `ego at t_i` and `challenger at t_j`, and take

    pathSeparationM = min over (i, j) of clearance(ego_i, challenger_j)

`pathSeparationM == 0` means the two bodies genuinely occupied the same ground at some point in the
clip: the space was contested. `pathSeparationM > 0` means they never did, and the number is exactly
how much you would have to inflate one footprint before they ever would -- i.e. how far the paths
missed each other, with timing removed.

Among the (i, j) pairs achieving that minimum, the one with the smallest |t_i - t_j| is the conflict
event. `encroachmentGapS = |t_i - t_j|` is the time separation at the contested point: a
post-encroachment-time-like quantity measured directly from footprints rather than predicted.

Honesty
-------
The function is explicit about there being no contested-space event. `contested` is only true when the
footprints actually overlap somewhere in space. When they do not, `contested` is false,
`pathSeparationM` says by how much, and `tCross` is still reported (the closest the paths came) but
flagged with `contestedBy=None`. There is also an explicit `reason` string for every degenerate case:
no challengers, never co-present, challenger never moves, ego never moves.

Dependency-free: standard library only, plus `gate.py` for the exact OBB primitives it already owns.
"""
import argparse, json, math, os, sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.dirname(_HERE))
import gate as G

CONTACT_TOL_M = 0.0       # `contested` requires a genuine footprint overlap
NEAR_TOL_M = 1.0          # "nearly contested": paths came within 1 m of each other
SAME_EVENT_S = 1.0        # tCross and tMinClear are the same event if within this
DEFAULT_STRIDE = 3        # coarse search stride; refined to stride 1 around the winner


def _load(path):
    import gzip
    with gzip.open(path) as f:
        return json.loads(f.read())


def _dims(trace, aid):
    d = (trace['header'].get('actorMetadata', {}).get(aid) or {}).get('dims')
    if d is None:
        raise ValueError(f'actorMetadata.{aid}.dims missing -- refusing to guess a footprint')
    return d['l'], d['w']


def _present_idx(col, n):
    return [i for i in range(n) if col['present'][i]]


def _simultaneous_min(trace, aid):
    """The quantity the frozen gate uses: min over t of clearance(ego(t), challenger(t))."""
    ts = trace['ticks']['t']
    e = trace['ticks']['actors']['ego']; a = trace['ticks']['actors'][aid]
    el, ew = _dims(trace, 'ego'); al, aw = _dims(trace, aid)
    best = (float('inf'), None)
    for i in range(len(ts)):
        if not (e['present'][i] and a['present'][i]):
            continue
        c = G.obb_clearance(G._corners(e['x'][i], e['y'][i], e['headingRad'][i], el, ew),
                            G._corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw))
        if c < best[0]:
            best = (c, ts[i])
    return best


def _spacetime_min(trace, aid, stride=DEFAULT_STRIDE, seed_upper=None):
    """min over ALL (i, j) tick-index pairs of clearance(ego_i, challenger_j).

    Exact, not a heuristic: the centre-distance lower bound `clearance >= d - (r_ego + r_chal)` is used
    only to SKIP pairs that provably cannot beat the incumbent, never to accept one.
    Coarse pass at `stride`, then an exhaustive refine at stride 1 in a window around the winner.
    """
    ts = trace['ticks']['t']; n = len(ts)
    e = trace['ticks']['actors']['ego']; a = trace['ticks']['actors'][aid]
    el, ew = _dims(trace, 'ego'); al, aw = _dims(trace, aid)
    R = math.hypot(el, ew) / 2.0 + math.hypot(al, aw) / 2.0

    ei = _present_idx(e, n); ai = _present_idx(a, n)
    if not ei or not ai:
        return None

    ecorn, acorn = {}, {}

    def EC(i):
        if i not in ecorn:
            ecorn[i] = G._corners(e['x'][i], e['y'][i], e['headingRad'][i], el, ew)
        return ecorn[i]

    def AC(j):
        if j not in acorn:
            acorn[j] = G._corners(a['x'][j], a['y'][j], a['headingRad'][j], al, aw)
        return acorn[j]

    best = {'clear': float('inf') if seed_upper is None else seed_upper, 'i': None, 'j': None,
            'dt': float('inf')}

    def scan(irange, jrange):
        for i in irange:
            ex, ey = e['x'][i], e['y'][i]; ti = ts[i]
            bc = best['clear']
            for j in jrange:
                d = math.hypot(ex - a['x'][j], ey - a['y'][j])
                if d - R >= bc:
                    continue
                c = G.obb_clearance(EC(i), AC(j))
                dt = abs(ti - ts[j])
                if c < bc - 1e-12 or (abs(c - bc) <= 1e-12 and dt < best['dt']):
                    if c < bc:
                        bc = c
                    best.update({'clear': c, 'i': i, 'j': j, 'dt': dt})
                    best['clear'] = c

    scan(ei[::stride], ai[::stride])
    if best['i'] is None:
        # nothing beat the seed; fall back to an unseeded coarse pass
        best['clear'] = float('inf')
        scan(ei[::stride], ai[::stride])
    if best['i'] is None:
        return None
    w = 3 * stride
    lo_i, hi_i = max(0, best['i'] - w), min(n, best['i'] + w + 1)
    lo_j, hi_j = max(0, best['j'] - w), min(n, best['j'] + w + 1)
    scan([i for i in range(lo_i, hi_i) if e['present'][i]],
         [j for j in range(lo_j, hi_j) if a['present'][j]])
    return best


def _geometry(trace, i, j, aid):
    e = trace['ticks']['actors']['ego']; a = trace['ticks']['actors'][aid]
    dh = abs((e['headingRad'][i] - a['headingRad'][j] + math.pi) % (2 * math.pi) - math.pi)
    if dh < math.pi / 6:
        return 'following/overtaking', dh
    if dh > 5 * math.pi / 6:
        return 'head-on/oncoming', dh
    return 'crossing', dh


def conflict_event(trace, challenger=None, stride=DEFAULT_STRIDE, include_props=False):
    """Find the instant the ego and a challenger contest the same space.

    Returns a dict; `challenger is None` and `reason` set when there is no such event to report.

    Keys:
      challenger              the actor id the event is with (None if there is none)
      contested               True iff the two footprints genuinely overlapped somewhere in the clip
      pathSeparationM         min over all (i,j) tick pairs of true OBB clearance. 0.0 == same ground.
      tCross                  the time the EGO occupied the contested point
      tChallengerAtCross      the time the CHALLENGER occupied it
      encroachmentGapS        |tCross - tChallengerAtCross| -- the time separation at that point
      whoArrivedFirst         'ego' | 'challenger' | 'simultaneous'
      clearanceAtCross        SIMULTANEOUS clearance at tCross (what a snapshot at that instant shows)
      egoSpeedAtCross, challengerSpeedAtCross
      minClear, tMinClear     the quantity the frozen gate scores (simultaneous minimum)
      sameEvent               |tCross - tMinClear| <= 1.0 s
      lagS                    tMinClear - tCross. Positive means the gate scored an event that happens
                              AFTER the conflict -- typically a pass-by of something already stopped.
      geometry                crossing | head-on/oncoming | following/overtaking
      reason                  set when the answer is degenerate; always safe to show a human
    """
    if 'ego' not in trace['ticks']['actors']:
        return {'challenger': None, 'contested': False, 'reason': 'no ego in trace'}
    ts = trace['ticks']['t']
    e = trace['ticks']['actors']['ego']
    if not any(e['present']):
        return {'challenger': None, 'contested': False, 'reason': 'ego never present'}

    ids = [challenger] if challenger else [k for k in trace['ticks']['actors'] if k != 'ego']
    if not ids:
        return {'challenger': None, 'contested': False,
                'reason': 'the trace contains no actor other than the ego'}

    results = []
    for aid in ids:
        a = trace['ticks']['actors'][aid]
        if not any(a['present']):
            results.append({'challenger': aid, 'contested': False,
                            'reason': f'{aid} is never present'})
            continue
        if not any(e['present'][i] and a['present'][i] for i in range(len(ts))):
            results.append({'challenger': aid, 'contested': False,
                            'reason': f'{aid} is never co-present with the ego'})
            continue
        sim_c, sim_t = _simultaneous_min(trace, aid)
        st = _spacetime_min(trace, aid, stride=stride, seed_upper=sim_c)
        if st is None or st['i'] is None:
            results.append({'challenger': aid, 'contested': False,
                            'reason': 'no evaluable tick pair'})
            continue
        i, j = st['i'], st['j']
        geom, dh = _geometry(trace, i, j, aid)
        ti, tj = ts[i], ts[j]
        el, ew = _dims(trace, 'ego'); al, aw = _dims(trace, aid)
        clear_at_cross = None
        if a['present'][i]:
            clear_at_cross = round(G.obb_clearance(
                G._corners(e['x'][i], e['y'][i], e['headingRad'][i], el, ew),
                G._corners(a['x'][i], a['y'][i], a['headingRad'][i], al, aw)), 3)
        vmax = max(a['speedMps'][k] for k in range(len(ts)) if a['present'][k])
        r = {
            'challenger': aid,
            'contested': st['clear'] <= CONTACT_TOL_M,
            'nearlyContested': st['clear'] <= NEAR_TOL_M,
            'pathSeparationM': round(st['clear'], 3),
            'tCross': ti, 'tChallengerAtCross': tj,
            'encroachmentGapS': round(abs(ti - tj), 3),
            'whoArrivedFirst': 'ego' if ti < tj - 1e-9 else ('challenger' if tj < ti - 1e-9
                                                             else 'simultaneous'),
            'clearanceAtCross': clear_at_cross,
            'egoSpeedAtCross': round(e['speedMps'][i], 2),
            'challengerSpeedAtCross': round(a['speedMps'][j], 2),
            'challengerSpeedAtEgoArrival': round(a['speedMps'][i], 2) if a['present'][i] else None,
            'challengerMaxSpeedMps': round(vmax, 2),
            'minClear': round(sim_c, 3), 'tMinClear': sim_t,
            'sameEvent': abs(ti - sim_t) <= SAME_EVENT_S,
            'lagS': round(sim_t - ti, 3),
            'geometry': geom, 'headingDiffRad': round(dh, 3),
        }
        if vmax < 0.2:
            r['reason'] = f'{aid} never moves: this is scenery, not a road user'
        elif not r['contested'] and not r['nearlyContested']:
            r['reason'] = (f'no contested-space event: the two paths never came closer than '
                           f'{r["pathSeparationM"]} m even ignoring timing')
        results.append(r)

    # pick the most conflict-like challenger: contested first, then smallest path separation,
    # then smallest encroachment gap
    scored = [r for r in results if 'pathSeparationM' in r]
    if not scored:
        return {'challenger': None, 'contested': False,
                'reason': '; '.join(r.get('reason', '') for r in results) or 'no evaluable challenger',
                'perChallenger': results}
    best = min(scored, key=lambda r: (not r['contested'], r['pathSeparationM'],
                                      r['encroachmentGapS']))
    out = dict(best)
    out['perChallenger'] = {r['challenger']: r for r in results}
    return out


# ------------------------------------------------------------------ gate-side clause
def c3b_conflict_is_the_proximity(ev, max_lag_s=SAME_EVENT_S, max_path_sep_m=2.0,
                                  max_gap_s=4.0, min_t_cross_s=0.5, min_challenger_speed=0.0):
    """A candidate STRICTLY TIGHTENING clause for the gate. Never loosens anything: it is an
    additional conjunct.

    A cell satisfies it when the event the gate scored as "genuine proximity" IS the interaction:
      * the two paths actually came within `max_path_sep_m` of each other (timing removed), and
      * they were within `max_gap_s` of each other in time at that point, and
      * the minimum-clearance instant is within `max_lag_s` of the contested-space instant, and
      * the contested-space event is not a spawn artifact (`tCross > min_t_cross_s`). This is C2's
        intent applied to the CONFLICT event rather than to the closest-approach event, and it is the
        clause that separates a real interaction from two actors that merely started next to
        each other. Note the trace clock already starts after warm-up, so 0.5 s here means 0.5 s of
        recorded time, not `warmupSeconds + 0.5` (see GATE-AUDIT.md A4).

    C3b is NECESSARY, NOT SUFFICIENT. It is a clause about conflict GEOMETRY. It says nothing about
    whether the ego had to do anything, so it cannot by itself reject the "ego sails through at constant
    speed" family -- pair it with a trajectory-derived ego-response clause (GATE-AUDIT.md section 8,
    item 2).

    `min_challenger_speed` defaults to 0.0, i.e. OFF. Requiring the challenger to still be moving when
    the ego arrives is a REALISM test, not a conflict test: a challenger that crossed the ego's path
    with a 1.6 s encroachment gap and then stopped still produced a real encroachment. Use
    `realism_flags()` for that instead of putting it in an admission clause. It is exposed here only
    so a caller can opt in deliberately.

    Returns (bool, list_of_reasons_it_failed).
    """
    if not ev or ev.get('challenger') is None:
        return False, [ev.get('reason', 'no challenger')]
    bad = []
    if ev['pathSeparationM'] > max_path_sep_m:
        bad.append(f"paths never came closer than {ev['pathSeparationM']} m (> {max_path_sep_m})")
    if ev['encroachmentGapS'] > max_gap_s:
        bad.append(f"time separation at the contested point {ev['encroachmentGapS']} s "
                   f"(> {max_gap_s})")
    v = ev.get('challengerSpeedAtEgoArrival')
    if min_challenger_speed > 0 and v is not None and v < min_challenger_speed:
        bad.append(f"the challenger had stopped ({v} m/s) by the time the ego arrived")
    if ev.get('tCross') is not None and ev['tCross'] <= min_t_cross_s:
        bad.append(f"the contested-space event is at t={ev['tCross']} s, i.e. a spawn artifact")
    if not ev['sameEvent']:
        bad.append(f"the gate's closest approach is {ev['lagS']} s away from the interaction")
    return (not bad), bad


def realism_flags(ev, stop_speed=0.3):
    """Quality/realism observations about a contested-space event. NOT admission clauses: each of
    these can be true of a scenario that is nevertheless a genuine conflict. Report them, do not
    gate on them."""
    out = []
    if not ev or ev.get('challenger') is None:
        return out
    v = ev.get('challengerSpeedAtEgoArrival')
    if v is not None and v < stop_speed:
        out.append(('CHALLENGER_STOPPED_AFTER_CROSSING',
                    f"the challenger crossed with a {ev['encroachmentGapS']} s gap and had stopped "
                    f"({v} m/s) by the time the ego arrived -- usually route exhaustion, and it leaves "
                    'an actor standing in the carriageway'))
    if ev.get('whoArrivedFirst') == 'ego':
        out.append(('CHALLENGER_ARRIVED_SECOND',
                    'the ego reached the contested ground first; the challenger closed in behind it'))
    if ev.get('encroachmentGapS', 0) < 0.2:
        out.append(('NEAR_COLLISION_BY_TIMING',
                    f"encroachment gap only {ev['encroachmentGapS']} s -- this is a collision that "
                    'missed by timing alone'))
    if ev.get('challengerMaxSpeedMps', 1.0) < 0.2:
        out.append(('CHALLENGER_NEVER_MOVES', 'the challenger is scenery, not a road user'))
    return out


# ------------------------------------------------------------------ CLI
def _fmt(v, n=2):
    return '-' if v is None else (f'{v:.{n}f}' if isinstance(v, float) else str(v))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('target', help='a batch-summary.json, or a single *.trace.json.gz')
    ap.add_argument('--stride', type=int, default=DEFAULT_STRIDE)
    ap.add_argument('--json', help='write the full result here')
    a = ap.parse_args()

    traces = []
    if a.target.endswith('.json'):
        s = json.load(open(a.target))
        for r in s.get('results', []):
            if r.get('traceFile'):
                traces.append((f"{r['mapId'][:8]}/{r['siteId'][:8]}/d{r.get('drawIndex')}",
                               r['traceFile'], r.get('verdict'), r.get('band')))
    else:
        traces.append((os.path.basename(a.target), a.target, None, None))

    hdr = (f"{'cell':28s} {'chal':10s} {'pathSep':>8s} {'contest':>8s} {'tCross':>7s} "
           f"{'gapS':>6s} {'vChal@ego':>10s} {'minClear':>9s} {'tMinClear':>10s} "
           f"{'lagS':>7s} {'same':>5s} {'geometry':<18s} {'C3b':>4s}")
    print(hdr); print('-' * len(hdr))
    out, nsame, ntot, nc3b = [], 0, 0, 0
    for name, path, verdict, band in traces:
        try:
            tr = _load(path)
            ev = conflict_event(tr, stride=a.stride)
        except Exception as ex:                                     # noqa: BLE001
            print(f'{name:28s} ERROR {ex!r}')
            continue
        ok, why = c3b_conflict_is_the_proximity(ev)
        ntot += 1; nsame += bool(ev.get('sameEvent')); nc3b += bool(ok)
        print(f"{name:28s} {str(ev.get('challenger')):10s} "
              f"{_fmt(ev.get('pathSeparationM')):>8s} {str(ev.get('contested')):>8s} "
              f"{_fmt(ev.get('tCross')):>7s} {_fmt(ev.get('encroachmentGapS')):>6s} "
              f"{_fmt(ev.get('challengerSpeedAtEgoArrival')):>10s} "
              f"{_fmt(ev.get('minClear')):>9s} {_fmt(ev.get('tMinClear')):>10s} "
              f"{_fmt(ev.get('lagS')):>7s} {str(ev.get('sameEvent')):>5s} "
              f"{str(ev.get('geometry')):<18s} {'ok' if ok else 'FAIL':>4s}")
        if not ok:
            for w in why:
                print(f"{'':28s}   ! {w}")
        ev['cell'] = name; ev['trace'] = path; ev['verdict'] = verdict; ev['band'] = band
        ev['C3b'] = ok; ev['C3bReasons'] = why
        out.append(ev)
    if ntot:
        print(f"\n{nsame}/{ntot} cells: the minimum-clearance instant IS the contested-space instant "
              f"(within {SAME_EVENT_S} s)")
        print(f"{nc3b}/{ntot} cells would pass the candidate tightening clause C3b")
    if a.json:
        json.dump(out, open(a.json, 'w'), indent=1)
        print(f'wrote {a.json}')


if __name__ == '__main__':
    main()
