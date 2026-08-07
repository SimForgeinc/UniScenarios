"""The VISTA critic: a second agent that WATCHES the rendered rollout and verifies the
intended event actually occurred.

This is the sharpest use of sight in the whole harness. The authoring loop's repair step asks a
numeric question ("is the clearance small enough?"), which the trace already answers exactly and for
which an image is the wrong instrument. The critic asks a SEMANTIC question -- "did the cut-in
actually cut in? did the jaywalker cross the ego's path? is the occluder occluding?" -- which no
number in the trace answers, and which the independent evaluation lane measured as the single biggest
quality defect in the corpus (~24% of admitted scenarios do not contain the mechanism their brief names).

The critic never sees the template, the gate result, or the author's reasoning: only the brief and the
pictures. That keeps its verdict independent of the thing it is checking.
"""
import os, json

import scene, vlm

REPO = '/Users/michaelvu-simforge/Documents/Programming/UniScenarios-vista'
DEV_ASSETS = REPO + '/dev-assets'


PROMPT = """You are reviewing a simulated driving-scenario clip to decide ONE thing: does it actually
contain the event it was supposed to contain?

The clip was authored from this one-sentence brief:

    "{brief}"

The attached image is the simulated rollout: six frames in time order, each 64 m across with a 10 m
grid. The EGO (the vehicle under test) is BLUE. Other actors are RED; small ones such as pedestrians
and cyclists are ringed so you can find them. Props (parked or stationary scenery) are YELLOW.
Grey is drivable surface, brown is junction surface, green is sidewalk, purple is parking.
White arrows show which way each thing is facing. One panel is marked CLOSEST APPROACH.

Read the frames in order and work out what physically happens. Then judge ONLY this:

**Does the specific mechanism named in the brief actually occur in these frames?**

Be strict and literal about the mechanism, not about the words:
- "a vehicle cuts in" requires a vehicle to actually move ACROSS into the ego's lane ahead of it.
  A car that is simply already in the lane, or that stays in its own lane, is NOT a cut-in.
- "a pedestrian steps out from behind X" requires a pedestrian that is behind X and then enters the
  road. A pedestrian standing at the roadside the whole time is NOT a dart-out.
- "the lead brakes hard" requires a lead vehicle that is moving and then slows sharply.
- "hidden / occluded" requires something to actually be BETWEEN the ego and the hazard.
- If the brief names an actor that is not present at all in any frame, the mechanism did not occur.

It is entirely possible for a clip to contain a real, dangerous, well-formed conflict that is
NEVERTHELESS NOT the event the brief describes. That is the case you are here to catch. Do not give
credit for "something exciting happened".

Reply with ONLY this JSON object and nothing else:
{{
  "whatISee": "<2-3 sentences describing what physically happens across the frames, in order>",
  "mechanismInBrief": "<the specific physical event the brief requires, in your own words>",
  "intentRealised": true | false,
  "whyNot": "<if false, what is missing or wrong; if true, empty string>",
  "confidence": <0.0-1.0>,
  "isGenuineConflict": true | false,
  "conflictNote": "<is there a real, non-trivial hazard to the ego here at all, regardless of whether it matches the brief?>"
}}"""


def review_trace(trace_path, brief, out_png=None, closest_t=None):
    """Render the rollout and ask the critic whether the brief's mechanism actually happened."""
    png = out_png or (os.path.splitext(trace_path)[0] + '.critic.png')
    scene.render_rollout(DEV_ASSETS, trace_path, png, closest_t=closest_t)
    try:
        d, raw = vlm.ask_json(PROMPT.format(brief=brief), images=[png], max_tokens=3000)
    except Exception as e:                                        # noqa: BLE001
        return {'error': str(e), 'image': png}
    d['image'] = png
    d['trace'] = trace_path
    return d


def review_cells(cells, brief, limit=3, log=None):
    """Review up to `limit` cells, spread across distinct sites. Majority verdict wins."""
    seen, picks = set(), []
    for c in cells:
        if not c.get('traceFile'):
            continue
        key = (c.get('mapId'), c.get('siteId'))
        if key in seen:
            continue
        seen.add(key)
        picks.append(c)
        if len(picks) >= limit:
            break
    reviews = []
    for c in picks:
        r = review_trace(c['traceFile'], brief, closest_t=c.get('closestT'))
        r['mapId'], r['siteId'] = c.get('mapId'), c.get('siteId')
        reviews.append(r)
        if log:
            log(f"      critic {c.get('mapId','?')[:18]}: intent={r.get('intentRealised')} "
                f"conflict={r.get('isGenuineConflict')} {str(r.get('whyNot',''))[:90]}")
    good = [r for r in reviews if r.get('intentRealised') is True]
    bad = [r for r in reviews if r.get('intentRealised') is False]
    return {
        'n': len(reviews),
        'nIntentRealised': len(good),
        'nIntentMissing': len(bad),
        'intentRealised': len(good) > len(bad),          # majority
        'genuineConflict': sum(1 for r in reviews if r.get('isGenuineConflict') is True) > len(reviews) / 2,
        'whyNot': (bad[0].get('whyNot') if bad else ''),
        'whatISee': (bad[0].get('whatISee') if bad else (good[0].get('whatISee') if good else '')),
        'reviews': reviews,
    }
