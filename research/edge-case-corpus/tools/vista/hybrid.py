"""HYBRID VALIDATOR: mechanical where the trace is exact, vision only where it is not.

The independent audit measured the vision-only critic at precision 0.545 / recall 0.333 -- statistically
indistinguishable from accepting everything (base rate 0.409, Fisher p=0.31). Its failures were
perceptual, not linguistic: lane-incursion recall 0.500 and hard-decel recall 0.440, on facts the trace
settles to the millimetre.

So the architecture here inverts the labour:
  1. an LLM reads ONLY THE BRIEF TEXT (no image) and selects predicates from a CLOSED vocabulary;
  2. code evaluates those predicates against the trace geometry, exactly;
  3. the vision critic is consulted only for the residue that is genuinely not computable
     (occlusion, "unexpectedly", intent), and only as a veto.
A predicate the vocabulary cannot express is reported as `abstain`, never guessed.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gate, motion, vlm

# ---- the closed vocabulary. Each maps to an exact test over trace geometry. ----
VOCAB = {
    'challenger_enters_ego_path': 'some non-ego actor starts outside the ego path and moves into it',
    'challenger_crosses_ego_path': 'a non-ego actor crosses from one side of the ego path to the other',
    'challenger_brakes_hard':      'a non-ego actor decelerates at >= 2.5 m/s^2 sustained',
    'challenger_stops_in_path':    'a non-ego actor comes to a stop within the ego path',
    'challenger_is_ahead':         'the challenger starts ahead of the ego',
    'challenger_is_behind':        'the challenger starts behind the ego',
    'challenger_alongside':        'the challenger stays within 25 m longitudinally for most of the clip',
    'challenger_changes_lane':     'a non-ego actor changes lane',
    'challenger_turns':            'a non-ego actor changes heading by >= 45 degrees',
    'challenger_oncoming':         'a non-ego actor approaches from the opposite direction',
    'challenger_is_vehicle':       'a car, truck, bus, van or motorcycle is the moving challenger',
    'challenger_is_pedestrian':    'a pedestrian is present',
    'challenger_is_cyclist':       'a bicycle or scooter is present',
    'challenger_is_large_vehicle': 'a truck, bus or van is present',
    'ego_brakes_hard':             'the ego decelerates at >= 2.5 m/s^2 sustained',
    'ego_stops':                   'the ego comes to a stop',
    'multiple_challengers':        'two or more MOVING non-ego actors are present',
    'static_obstacle_present':     'at least one parked/stationary object or vehicle is placed on or '
                                   'beside the road (these are PROPS, not challengers)',
}
NOT_COMPUTABLE = {
    'hidden_until_late': 'whether a sight line was blocked then revealed',
    'unexpected_or_erratic': 'whether behaviour reads as unexpected',
    'door_opens': 'whether a door opened',
    'object_on_road': 'whether a static object lies in the carriageway',
}

PARSE_PROMPT = """You are converting a one-sentence driving-scenario brief into a checklist of
mechanically verifiable facts. You are NOT judging any simulation; you only read the sentence.

BRIEF: "{brief}"

Choose every predicate below that MUST be true for this brief to have been realised. Choose only what
the sentence actually requires - do not add plausible extras, and do not include the ego's reaction
unless the brief states it.

IMPORTANT DISTINCTION. A "challenger" is a MOVING road user that participates in the conflict. Parked
cars, stopped scenery, cones, barriers and other furniture are PROPS, and they are counted by
`static_obstacle_present`, NOT by `multiple_challengers`. "A child runs out from between two parked
vans" has exactly ONE challenger (the child) and a static obstacle (the vans).

ALWAYS BIND THE ACTOR TYPE. If the brief names what kind of road user causes the problem - a car, van,
truck, bus, motorcycle, cyclist, scooter or person - you MUST include the matching predicate
(challenger_is_vehicle, challenger_is_cyclist, challenger_is_pedestrian, challenger_is_large_vehicle).
A clip that performs the right manoeuvre with the WRONG KIND of road user has not realised the brief.

COMPUTABLE PREDICATES:
{vocab}

If the brief's central mechanism is one of these, which cannot be computed from trajectories, list it
under "notComputable" instead:
{notcomp}

Reply with ONLY this JSON:
{{"required": ["<predicate>", ...], "notComputable": ["<name>", ...], "central": "<the ONE predicate or
notComputable name that IS the scenario, or empty>"}}"""


def parse_brief(brief):
    p = PARSE_PROMPT.format(
        brief=brief,
        vocab='\n'.join(f'  {k}: {v}' for k, v in VOCAB.items()),
        notcomp='\n'.join(f'  {k}: {v}' for k, v in NOT_COMPUTABLE.items()))
    d, _ = vlm.ask_json(p, max_tokens=1500)
    req = [x for x in (d.get('required') or []) if x in VOCAB]
    nc = [x for x in (d.get('notComputable') or []) if x in NOT_COMPUTABLE]
    return {'required': req, 'notComputable': nc, 'central': d.get('central') or ''}


def _eval_one(pred, ch, ego, trace):
    """Exact evaluation of one predicate. Returns True/False."""
    any_ = lambda f: any(f(c) for c in ch if c)
    if pred == 'challenger_enters_ego_path':
        vs = [motion.lane_incursion(trace, c['actor']) for c in ch if c]
        return True if any(v is True for v in vs) else (False if any(v is False for v in vs) else None)
    if pred == 'challenger_crosses_ego_path':
        vs = [(motion.lane_incursion(trace, c['actor']) is True) and (c['lateralRangeM'] or 0) >= 3.0
              for c in ch if c]
        return any(vs)
    if pred == 'challenger_brakes_hard':
        return any_(lambda c: c['brakesHard'])
    if pred == 'challenger_stops_in_path':
        return any_(lambda c: c['stops'] and (c['minAbsLateralM'] is not None
                                              and c['minAbsLateralM'] <= motion.INCURSION_LATERAL_M))
    if pred == 'challenger_is_ahead':
        return any_(lambda c: c['aheadAtStart'])
    if pred == 'challenger_is_behind':
        return any_(lambda c: c['aheadAtStart'] is False)
    if pred == 'challenger_alongside':
        return any_(lambda c: (c['coTravelFrac'] or 0) >= 0.5)
    if pred == 'challenger_changes_lane':
        return any_(lambda c: c['changesLane'])
    if pred == 'challenger_turns':
        return any_(lambda c: (c['headingChangeDeg'] or 0) >= 45.0)
    if pred == 'challenger_oncoming':
        # It must actually be coming the OTHER WAY. The first version never checked relative
        # heading at all and fired on 22 actors of which 16 were travelling the same direction
        # (precision 0.136) -- an ordinary lead vehicle satisfied every condition.
        return any_(lambda c: c['moves'] and c.get('relHeadingDeg') is not None
                    and c['relHeadingDeg'] >= 120.0)
    if pred == 'challenger_is_vehicle':
        return any_(lambda c: c['kind'] in ('car', 'truck', 'bus', 'van', 'motorcycle') and c['moves'])
    if pred == 'challenger_is_pedestrian':
        return any_(lambda c: c['kind'] == 'pedestrian')
    if pred == 'challenger_is_cyclist':
        return any_(lambda c: c['kind'] in ('bicycle', 'scooter'))
    if pred == 'challenger_is_large_vehicle':
        return any_(lambda c: c['kind'] in ('truck', 'bus', 'van'))
    if pred == 'ego_brakes_hard':
        return ego['peakDecelMps2'] >= motion.HARD_DECEL_MPS2
    if pred == 'ego_stops':
        return ego['stops']
    if pred == 'multiple_challengers':
        return len([c for c in ch if c and c['moves']]) >= 2
    if pred == 'static_obstacle_present':
        return len(trace['header'].get('propMetadata') or {}) >= 1
    return None


def evaluate(trace, parsed):
    ch = [c for c in motion.all_facts(trace) if c]
    ego = motion.ego_facts(trace)
    per = []
    for p in parsed['required']:
        per.append({'predicate': p, 'holds': _eval_one(p, ch, ego, trace)})
    missing = [p['predicate'] for p in per if p['holds'] is False]
    if not per and parsed['notComputable']:
        return {'verdict': 'abstain', 'perPredicate': per, 'missing': [],
                'reason': 'the brief\'s mechanism is not computable from trajectories: '
                          + ', '.join(parsed['notComputable'])}
    if not per:
        return {'verdict': 'abstain', 'perPredicate': per, 'missing': [],
                'reason': 'no computable predicate was selected for this brief'}
    # a verdict resting only on near-tautologies is not evidence of anything
    if not discriminating([p['predicate'] for p in per]):
        return {'verdict': 'abstain', 'perPredicate': per, 'missing': [],
                'reason': 'only near-tautological predicates were selected ('
                          + ', '.join(p['predicate'] for p in per) + '); nothing discriminating'}
    if missing:
        return {'verdict': 'absent', 'perPredicate': per, 'missing': missing,
                'reason': 'required and not observed: ' + ', '.join(missing)}
    v = 'present' if not parsed['notComputable'] else 'present_needs_vision'
    return {'verdict': v, 'perPredicate': per, 'missing': [],
            'reason': 'all computable requirements hold'
                      + ('; still needs vision for ' + ', '.join(parsed['notComputable'])
                         if parsed['notComputable'] else '')}


def validate(trace_path, brief, parsed=None):
    trace = gate.load_trace(trace_path)
    parsed = parsed or parse_brief(brief)
    r = evaluate(trace, parsed)
    r['parsed'] = parsed
    return r

# Predicates that are nearly always true carry no evidence. Measured base rates over 45 clips:
# challenger_is_ahead 1.000, ego_brakes_hard 0.889, static_obstacle_present 0.644. One template was
# admitted on `static_obstacle_present` ALONE. A `central` predicate with a base rate above this is
# refused, and the brief is treated as having no discriminating computable requirement.
TAUTOLOGY_BASE_RATE = {
    'challenger_is_ahead': 1.000,
    'ego_brakes_hard': 0.889,
    'static_obstacle_present': 0.644,
    'challenger_is_vehicle': 0.62,
}
TAUTOLOGY_MAX = 0.60


def discriminating(preds):
    """The subset of predicates that actually carry evidence."""
    return [p for p in preds if TAUTOLOGY_BASE_RATE.get(p, 0.0) <= TAUTOLOGY_MAX]
