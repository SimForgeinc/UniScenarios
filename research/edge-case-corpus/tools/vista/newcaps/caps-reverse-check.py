
"""Acceptance check for caps-reverse: reverse manoeuvre, measured from the trace.

Criterion: the reversing actor's displacement along its OWN heading must be more
than 3 m rear-ward, while its heading stays approximately constant (it must not
be flipped 180 degrees), and it must cross from off-corridor into a bound lane.
"""
import glob, gzip, json, math, sys

def load(path):
    with gzip.open(path) as fh:
        return json.load(fh)

def measure(path, actor='backing-car'):
    tr = load(path)
    a = tr['ticks']['actors'][actor]
    x, y, h = a['x'], a['y'], a['headingRad']
    # Signed displacement along the body's own heading, integrated per tick.
    # Negative == rear-ward, which is what reversing means.
    along, worst = 0.0, 0.0
    for i in range(1, len(x)):
        along += (x[i] - x[i - 1]) * math.cos(h[i - 1]) + (y[i] - y[i - 1]) * math.sin(h[i - 1])
        worst = min(worst, along)
    h0 = h[0]
    spread = max(abs(math.atan2(math.sin(v - h0), math.cos(v - h0))) for v in h)
    lanes = a['laneRsl']
    return {
        'rearwardM': -worst,
        'headingSpreadDeg': math.degrees(spread),
        'motionDirection': sorted(set(a['motionDirection'])),
        'laneFirst': lanes[0],
        'laneLast': lanes[-1],
        'enteredCorridor': lanes[0] is None and lanes[-1] is not None,
    }

root = sys.argv[1] if len(sys.argv) > 1 else '/tmp/caps-reverse-proof'
rows = [(p, measure(p)) for p in sorted(glob.glob(f'{root}/*/*/*.trace.json.gz'))]
passing = [r for _, r in rows
           if r['rearwardM'] > 3 and r['headingSpreadDeg'] < 15 and r['motionDirection'] == [-1]]
entered = [r for _, r in rows if r['enteredCorridor']]

print(f'cells                              {len(rows)}')
print(f'reverse >3 m, heading held <15 deg  {len(passing)}')
print(f'crossed off-corridor -> bound lane  {len(entered)}')
print(f'any body ever moved FORWARD         '
      f'{sum(1 for _, r in rows if 1 in r["motionDirection"])}')
if passing:
    print(f'rearward range                     '
          f'{min(r["rearwardM"] for r in passing):.2f} .. {max(r["rearwardM"] for r in passing):.2f} m')
    print(f'worst heading spread among those   '
          f'{max(r["headingSpreadDeg"] for r in passing):.2f} deg')
for p, r in rows[:6]:
    print(f'  {p.split("/")[-3][:26]:<26} rear={r["rearwardM"]:6.2f} m  '
          f'dHead={r["headingSpreadDeg"]:5.2f} deg  lane {r["laneFirst"]} -> {r["laneLast"]}')
assert len(passing) >= 15, f'only {len(passing)} cells reversed more than 3 m'
print('\nOK')
