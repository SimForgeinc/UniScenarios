"""Parse a BRIEF (text only -- the clip is never shown) into a closed-vocabulary mechanism spec.

This is deliberately a DIFFERENT job from the critic's. The critic is asked one fused
question ("is the mechanism there?") while looking at a picture. Here the model only reads
English and emits predicates; the predicates are then evaluated against the trajectory by
code. The model never sees a rendering, so it cannot be wrong in the same way the critic is.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import llm

VOCAB = """
ACTOR CLASSES: pedestrian, cyclist, motorcycle, car, van, truck, bus, animal, object
  ("object" = debris, a detached wheel, a dropped load, a grate, gravel, a fallen ladder ...)

PREDICATES (each takes an actor class, and refers to the ego vehicle under test):
  PRESENT(cls)                 an actor of this class exists in the clip at all
  ENTERS_EGO_PATH(cls)         it starts clearly OUTSIDE the ego's travelled corridor and later
                               moves INTO it (cut-in, dart-out, swerve-in, encroachment, drift-in)
  CROSSES_EGO_PATH(cls)        its path and the ego's path contest the same ground (crossing,
                               jaywalking across, turning across)
  AHEAD_OF_EGO(cls)            it is in front of the ego (a lead vehicle, an obstacle ahead)
  BEHIND_EGO(cls)              it is behind the ego (a tailgater, a following vehicle)
  ONCOMING(cls)                it travels roughly opposite to the ego
  DECELERATES_HARD(cls)        it is moving and then slows sharply (brake-check, hard stop)
  STARTS_STATIONARY_THEN_MOVES(cls)  it is stopped/parked and then pulls out or sets off
  MOVES_THEN_STOPS(cls)        it is moving and then comes to rest and stays there
  TURNS(cls)                   it changes heading by 45 degrees or more (a turn manoeuvre)
  OCCLUDED_BY(cls, occluder)   an occluder body is physically BETWEEN the ego and this actor
                               for part of the clip before they meet
"""

PROMPT = """You are translating a one-sentence driving-scenario brief into a formal, checkable
specification. You are NOT judging any video or image -- you only read English.

BRIEF:
    "{brief}"

Available vocabulary:
""" + VOCAB + """

Decide what a simulated clip would have to CONTAIN for this brief to be honestly realised, and
express it as predicates from the list above. Rules:

- List only what is genuinely REQUIRED. If the brief says a wheel "rolls across the centreline into
  the ego lane", then ENTERS_EGO_PATH(object) is required; the pothole that caused it is scenery
  and is NOT required.
- Split the requirement into `core` (without this the brief is simply not realised -- the thing
  that makes this scenario the scenario it is) and `secondary` (supporting detail; a clip missing
  only these is a weakened but arguably still-correct realisation).
- Put AT MOST 3 predicates in `core`. Prefer the single most distinctive one.
- If the brief names a specific actor class, PRESENT(cls) for that class is always core.
- `egoResponse` is what the ego must do: "brake" | "swerve" | "either" | "none".

Reply with ONLY this JSON:
{{
  "core": [["PREDICATE", "class", "optional_occluder_class_or_null"], ...],
  "secondary": [["PREDICATE", "class", null], ...],
  "namedActorClasses": ["..."],
  "egoResponse": "brake|swerve|either|none",
  "distinctiveMechanism": "<one clause: the single physical thing that must happen>",
  "notes": "<anything ambiguous about the brief>"
}}"""


def parse_brief(brief):
    d, raw = llm.ask_json(PROMPT.format(brief=brief), max_tokens=3000)
    return d
