"""Convert a user-supplied list of edge-case topics into buildable one-sentence briefs."""
import os, sys, json, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlm

PROMPT = """You are turning short edge-case TOPICS into buildable driving-scenario briefs for an
autonomous-vehicle test corpus. Each brief is ONE sentence describing a specific dangerous situation.

THE SIMULATOR'S HARD LIMITS (measured, not guessed):
- It moves road users and changes their rules. It has NO mechanical-failure model: nothing can burst a
  tyre, jackknife, shed a load in flight, lose traction on a grate, or run out of control mechanically.
- NO VEHICLE CAN REVERSE (1 body in 1642 moved >0.8 m backwards).
- Available road users: car, truck, bus, van, motorcycle, bicycle, pedestrian, scooter, animal, plus
  static props (parked/stopped vehicles and objects).
- Available rule changes: stop yielding, ignore signals, ignore other road users, aggression, slow
  reaction, open a door, indicators/hazards/brake lights, a marshal's stop paddle or hand gesture.
- World: weather, rain, fog, ROAD FRICTION (a single global scalar), and traffic-signal phases.
- 87.8% of road sections have ONE lane per direction, so "cut in from the adjacent lane" usually has
  no adjacent lane. Incursions should come from the OPPOSING direction, a side road or junction arm,
  a driveway, the verge/sidewalk, or a parking row.
- There are NO rail crossings, school-zone markings or work-zone markings as map features, and no
  forecourts, car parks, drive-thrus or off-road areas. Only ordinary streets and junctions.
- There is NO sensor model, so nothing about cameras, exposure, HD-map mismatch or perception failure
  can be represented.

YOUR TASK for each topic below: write the brief that best preserves the topic's DANGER using only what
exists. Reframe freely toward what an outside observer would SEE. Examples of good reframing:
  "mattress falls off a truck"      -> debris already lying in the lane, revealed late
  "driver backs out of a driveway"  -> a car stopped protruding across the lane from a driveway
  "black ice"                       -> reduced road friction with a vehicle sliding through a stop
  "snowbanks narrow the road"       -> parked vehicles narrowing the carriageway to one usable lane
If a topic CANNOT be preserved at all (it is purely about sensors, markings, map data or weather
physics that do not exist), set "buildable": false and say why in one clause.

Each buildable brief must: name a specific observable event; force the ego to brake hard or pass within
a couple of metres; and be survivable.

TOPICS:
{topics}

Reply with ONLY a JSON array, one object per topic, in the same order:
[{{"topic":"<verbatim topic>","id":"<short-kebab-id>","category":"<one of: C1.car-following,
C2.cut-in-merge, C3.intersection, C4.roundabout, C5.pedestrian, C6.cyclist-ptw, C7.occlusion,
C8.workzone, C9.hazard, C10.oncoming, C11.parking, C12.school, C13.control, C14.loss-of-control,
C15.adversarial>","brief":"<one sentence>","buildable":true,"reframed":"<how, or empty>"}}]"""


def convert(topics, chunk=12):
    out = []
    for i in range(0, len(topics), chunk):
        part = topics[i:i + chunk]
        txt = '\n'.join(f'{j+1}. {t}' for j, t in enumerate(part))
        d, _ = vlm.ask_json(PROMPT.format(topics=txt), max_tokens=6000)
        if isinstance(d, dict):
            d = d.get('briefs') or d.get('items') or []
        out.extend(d)
        print(f'  converted {min(i+chunk, len(topics))}/{len(topics)}', flush=True)
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--infile', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    topics = [l.strip() for l in open(a.infile) if l.strip()]
    rows = convert(topics)
    seen = set()
    briefs = []
    for r in rows:
        if not r.get('buildable') or not r.get('brief'):
            continue
        bid = (r.get('id') or '').strip().lower().replace(' ', '-')
        while bid in seen or not bid:
            bid = (bid or 'topic') + 'x'
        seen.add(bid)
        briefs.append({'id': bid, 'category': r.get('category', 'C9.hazard'),
                       'brief': r['brief'], 'topic': r.get('topic'), 'reframed': r.get('reframed', '')})
    json.dump({'briefs': briefs, 'split': {'GEN': [b['id'] for b in briefs]},
               'excluded': [r for r in rows if not r.get('buildable')]},
              open(a.out, 'w'), indent=1)
    print(f'\n{len(briefs)} buildable briefs, {len(rows)-len(briefs)} excluded -> {a.out}')
