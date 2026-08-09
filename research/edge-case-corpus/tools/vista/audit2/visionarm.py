"""The VISION arm of the ground truth: perception and judgement DELIBERATELY SEPARATED.

The critic asks one fused question while holding the brief in mind, which is exactly the setup that
produces confirmation: it is told what to look for and then asked whether it sees it. This arm
breaks that in two.

  V1  PERCEPTION, BRIEF-BLIND. The model is shown the frames and never told what the clip is
      supposed to contain. It reports an inventory and a trajectory description per actor.
  V2  ENTAILMENT, IMAGE-BLIND. A separate call is given only V1's text and the brief, and asked
      whether that description entails the brief's mechanism. It cannot see the picture, so it
      cannot "find" something V1 did not report.

Neither step can be led by the other. V1 is repeated `reps` times because perception is the noisy
part; each V1 gets its own V2 and the results are pooled.
"""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import llm

V1 = """These frames are a top-down view of a simulated driving clip, in time order. The vehicle
under test is BLUE and labelled `ego`. Other moving actors are RED (small ones such as pedestrians
and cyclists are ringed so you can find them). YELLOW objects are static scenery. Grey is road
surface, brown is junction surface, green is sidewalk. White arrows show facing direction. Each
actor is labelled with its id.

Describe what you SEE. Do not speculate about the purpose of the clip and do not guess what it was
meant to demonstrate. Report only what the frames show.

For EVERY actor and object other than the ego, answer:
  - its id and what kind of thing it appears to be (car, van, truck, bus, motorcycle, cyclist,
    pedestrian, animal, small object/debris, static scenery)
  - does it MOVE during the clip, or does it stay put?
  - where is it relative to the ego: ahead of it, behind it, in the same lane, in an adjacent
    lane, on the opposite side of the road, on the sidewalk, in a side road?
  - does its position relative to the ego's lane CHANGE? Specifically: does it start outside the
    lane the ego is driving in and later move INTO that lane? Does it cross in front of the ego?
  - does it slow down sharply at any point?
  - is any other object physically BETWEEN the ego and it at any time?

Also say what the EGO does: does it keep speed, slow down, stop, or steer around something?

Reply with ONLY this JSON:
{
  "actors": [
    {"id": "...", "kind": "...", "moves": true|false, "positionRelToEgo": "...",
     "entersEgoLane": true|false|"unclear", "crossesInFrontOfEgo": true|false|"unclear",
     "slowsSharply": true|false|"unclear", "occludedBy": "<id or none>",
     "trajectory": "<one sentence>"}
  ],
  "egoBehaviour": "<one sentence>",
  "summary": "<2-3 sentences on what physically happens, in time order>",
  "legibility": "<can you actually make out what is happening, or are things too small / too
                  ambiguous to tell? be honest>"
}"""

V2 = """Below is a factual description of a simulated driving clip, written by an observer who was
NOT told what the clip was supposed to contain. You cannot see the clip yourself. Your only job is
to decide whether the description ENTAILS that a particular event occurred.

DESCRIPTION:
{desc}

The clip was authored from this brief:
    "{brief}"

Question: does the description above establish that the specific physical mechanism named in the
brief actually occurred?

Be strict and literal about the MECHANISM, not the words:
- "a vehicle cuts in" needs a vehicle that starts outside the ego's lane and moves INTO it ahead
  of the ego. One already in the lane, or one that stays in its own lane, is NOT a cut-in.
- "a pedestrian steps out from behind X" needs a pedestrian that was behind X and then enters the
  road. A pedestrian standing at the roadside throughout is NOT a dart-out.
- "the lead brakes hard" needs a lead vehicle that is moving and then slows sharply.
- "hidden/occluded" needs something actually BETWEEN the ego and the hazard.
- If the brief names an actor that the description does not report at all, the mechanism did not
  occur.

If the description is too vague or the observer said the clip was illegible, answer "unclear"
rather than guessing.

Reply with ONLY this JSON:
{{
  "mechanismRequired": "<the physical event the brief requires, in your own words>",
  "supportedByDescription": true | false | "unclear",
  "evidence": "<the specific sentence(s) in the description that settle it>",
  "confidence": <0.0-1.0>
}}"""


def perceive(image, reps=3, workers=3):
    def one(_):
        try:
            d, _raw = llm.ask_json(V1, images=[image], max_tokens=6000)
            return d
        except Exception as e:                                     # noqa: BLE001
            return {'error': str(e)}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(one, range(reps)))


def entail(desc, brief):
    try:
        d, _raw = llm.ask_json(V2.format(desc=json.dumps(desc, indent=1)[:12000], brief=brief),
                               max_tokens=3000)
        return d
    except Exception as e:                                         # noqa: BLE001
        return {'error': str(e)}


def vision_gt(image, brief, reps=3):
    percs = perceive(image, reps=reps)
    outs = []
    with ThreadPoolExecutor(max_workers=reps) as ex:
        ents = list(ex.map(lambda p: entail(p, brief), percs))
    for p, e in zip(percs, ents):
        outs.append({'perception': p, 'entailment': e})
    votes = [o['entailment'].get('supportedByDescription') for o in outs]
    yes = sum(1 for v in votes if v is True)
    no = sum(1 for v in votes if v is False)
    unc = sum(1 for v in votes if v not in (True, False))
    n = len(votes)
    verdict = ('present' if yes >= 2 and yes > no else
               'absent' if no >= 2 and no > yes else 'unclear')
    return {'verdict': verdict, 'yes': yes, 'no': no, 'unclear': unc, 'n': n, 'runs': outs}
