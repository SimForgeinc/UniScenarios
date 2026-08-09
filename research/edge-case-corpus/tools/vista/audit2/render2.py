"""An alternative rollout rendering, to test whether the CONTACT SHEET is the limiting factor.

Differences from scene.render_rollout:
  * 9 frames instead of 6, so a brief manoeuvre is not skipped over
  * auto-zoom: the span is chosen to fit the ego and its nearest challenger, floor 16 m half-span,
    instead of a fixed 32 m half-span that renders a pedestrian as 2 pixels
  * MOTION TRAILS: each actor's path over the preceding 2 s is drawn, so a lateral movement is
    visible in a SINGLE panel rather than having to be inferred across panels
  * per-actor speed labels in km/h
  * a persistent legend naming every actor, so "is there a pedestrian at all" is answerable
"""
import gzip, json, math, os
os.environ.pop('MPLBACKEND', None)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly
import numpy as np
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import scene as S


def _trail(ax, X, Y, color, lw=1.4):
    if len(X) > 1:
        ax.plot(X, Y, color=color, lw=lw, alpha=0.75, zorder=4, solid_capstyle='round')


def render_rollout2(dev_assets, trace_path, out, closest_t=None, n=9, span_m=None,
                    trail_s=2.5, label_speed=True, world_fixed=False):
    """world_fixed=True pins every panel to the SAME world point (the closest approach) instead of
    following the ego. Ego-centred panels make a parked car appear to slide backwards and a car
    keeping station appear motionless, which is exactly the confusion the critic has to resolve."""
    with gzip.open(trace_path) as f:
        tr = json.loads(f.read())
    ts = tr['ticks']['t']
    mapid = tr['header']['mapId']
    meta = tr['header'].get('actorMetadata', {})
    ego = tr['ticks']['actors'].get('ego')

    picks = [0.0] + [ts[-1] * k / (n - 2) for k in range(1, n - 1)]
    if closest_t is not None:
        picks.append(closest_t)
    picks = sorted(set(round(min(max(p, 0.0), ts[-1]), 2) for p in picks))[:n]
    idx = [min(range(len(ts)), key=lambda j: abs(ts[j] - p)) for p in picks]

    # PER-FRAME auto-zoom. Taking the max over frames (the first version of this) let one distant
    # frame widen every panel, which made the "zoomed" render WIDER than the one it was meant to
    # improve on. Each panel is now scaled to its own frame.
    def frame_span(i):
        if span_m is not None:
            return span_m
        if not ego or not ego['present'][i]:
            return 20.0
        d = [math.hypot(ego['x'][i] - a['x'][i], ego['y'][i] - a['y'][i])
             for aid, a in tr['ticks']['actors'].items() if aid != 'ego' and a['present'][i]]
        return float(min(max(12.0, (min(d) * 1.3 + 7.0) if d else 20.0), 34.0))

    dt = tr['header'].get('dt', 0.02)
    ktrail = max(1, int(trail_s / max(dt, 1e-6)))

    # world-fixed framing: centre on the closest-approach location and widen enough to hold the
    # whole span of the action, so absolute motion is readable
    wcx = wcy = 0.0
    wspan = 34.0
    if world_fixed:
        ci = idx[len(idx) // 2]
        if closest_t is not None:
            ci = min(range(len(ts)), key=lambda j: abs(ts[j] - closest_t))
        if ego and ego['present'][ci]:
            wcx, wcy = ego['x'][ci], ego['y'][ci]
        xs, ys = [], []
        for i in idx:
            for aid, a in tr['ticks']['actors'].items():
                if a['present'][i]:
                    xs.append(a['x'][i]); ys.append(a['y'][i])
        if xs:
            # centre on the centroid of the action, not the ego, and CAP HARD. An earlier version
            # sized the window to hold every frame's actors and produced a 114 m panel in which a
            # pedestrian's real 3 m step across the kerb was invisible -- it read as stationary.
            # A world-fixed view that is too wide is worse than an ego-centred one.
            wcx, wcy = 0.5 * (max(xs) + min(xs)), 0.5 * (max(ys) + min(ys))
            wspan = min(max(14.0, max(max(xs) - wcx, max(ys) - wcy) * 1.1 + 4.0), 38.0)

    names = []
    for aid in tr['ticks']['actors']:
        if aid == 'ego':
            continue
        d = meta.get(aid, {}).get('dims', {})
        names.append(f"{aid} ({d.get('l','?')}x{d.get('w','?')} m, RED)")
    for pid, pm in (tr['header'].get('propMetadata') or {}).items():
        d = pm.get('dims', {})
        names.append(f"{pid} ({d.get('l','?')}x{d.get('w','?')} m, YELLOW, static)")

    cols = 3
    rows = (len(idx) + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(5.2 * cols, 5.2 * rows), dpi=95)
    axs = axs.ravel() if hasattr(axs, 'ravel') else [axs]
    for k, i in enumerate(idx):
        b = S.boxes_from_trace(tr, i)
        e = next((q for q in b if q['id'] == 'ego'), None)
        cx, cy = (e['x'], e['y']) if e else (b[0]['x'], b[0]['y'])
        tag = '  <-- CLOSEST APPROACH' if closest_t is not None and abs(ts[i] - closest_t) < 1e-6 else ''
        sp = frame_span(i)
        if world_fixed:
            cx, cy = wcx, wcy
            sp = wspan
        ttl = f"t = {ts[i]:.2f} s | {2*sp:.0f} m across{tag}"
        ax = axs[k]
        S._panel(ax, dev_assets, mapid, b, cx, cy, sp, ttl, grid_m=5)
        lo = max(0, i - ktrail)
        for aid, a in tr['ticks']['actors'].items():
            sl = [j for j in range(lo, i + 1) if a['present'][j]]
            if len(sl) > 1:
                _trail(ax, [a['x'][j] for j in sl], [a['y'][j] for j in sl],
                       S.EGO_C if aid == 'ego' else S.CHAL_C)
        if label_speed:
            for q in b:
                ax.annotate(f"{q['speed']*3.6:.0f}", (q['x'], q['y']), textcoords='offset points',
                            xytext=(0, 9), color='#ffe680', fontsize=7.5, ha='center', va='bottom',
                            zorder=9, weight='bold', annotation_clip=True,
                            bbox=dict(boxstyle='round,pad=0.1', fc='#000000', ec='none', alpha=0.6))
    for k in range(len(idx), len(axs)):
        axs[k].axis('off')
    frame_note = ('ALL PANELS SHARE ONE FIXED WORLD VIEW -- what moves on the page really moves'
                  if world_fixed else
                  'panels follow the ego, so the background slides; trails show true motion')
    fig.suptitle(f"ROLLOUT | {len(idx)} frames | motion trails {trail_s:.1f} s | numbers are "
                 f"speeds in km/h | grid 5 m | {mapid}\n{frame_note} | ego BLUE, challengers RED, "
                 f"props YELLOW (static scenery)\nactors: "
                 + ('; '.join(names) if names else 'none'), color='white', fontsize=10)
    fig.patch.set_facecolor('#171717')
    fig.tight_layout(rect=[0, 0, 1, 0.95])
    fig.savefig(out, facecolor='#171717')
    plt.close(fig)
    return out
