"""Render what the scenario ACTUALLY looks like, so the authoring agent can see its own mistakes.

Two entry points:
  render_instance_t0 -- the authored initial state, straight from the instance file (pre-simulation)
  render_rollout     -- a contact sheet of the simulated rollout, including the closest-approach frame

Frame convention (verified): instance files use (x, z); trace and topology use (x, y) with y == -z.
"""
import os, gzip, json, math
os.environ.pop('MPLBACKEND', None)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

LANE_COLORS = {'driving': '#5f5f5f', 'sidewalk': '#33513a', 'shoulder': '#4a4436', 'parking': '#463f59'}
JUNCTION_COLOR = '#6d5336'          # distinct from PROP yellow
EGO_C, CHAL_C, PROP_C = '#3aa0ff', '#e5453a', '#ffd23f'
_TOPO = {}


def topo(dev_assets, mapid):
    if mapid not in _TOPO:
        with gzip.open(f'{dev_assets}/{mapid}/topology-index.json.gz') as f:
            _TOPO[mapid] = json.loads(f.read())
    return _TOPO[mapid]


def corners(x, y, hd, l, w):
    c, s = math.cos(hd), math.sin(hd)
    hl, hw = l / 2.0, w / 2.0
    return [(x + c * dx - s * dy, y + s * dx + c * dy)
            for dx, dy in ((hl, hw), (hl, -hw), (-hl, -hw), (-hl, hw))]


def _pts_per_m(ax, span):
    """Points per metre for the drawn axes, so lane widths are TRUE METRES on the page."""
    bb = ax.get_window_extent()
    inches = bb.width / ax.figure.dpi
    return (inches * 72.0) / (2.0 * span)


def _draw_roads(ax, dev_assets, mapid, cx, cy, span):
    """Lanes drawn at their real width, so drivable surface is visible as surface."""
    ppm = _pts_per_m(ax, span)
    for ln in topo(dev_assets, mapid)['lanes'].values():
        p = ln.get('polyline') or []
        if len(p) < 2:
            continue
        xs = [q['x'] for q in p]; ys = [q['y'] for q in p]
        if max(xs) < cx - span or min(xs) > cx + span or max(ys) < cy - span or min(ys) > cy + span:
            continue
        w = ln.get('representativeWidthM') or 3.5
        col = JUNCTION_COLOR if ln.get('isJunction') else LANE_COLORS.get(ln.get('laneType'), '#2e2e2e')
        # the surface itself
        ax.plot(xs, ys, color=col, linewidth=max(0.6, w * ppm), solid_capstyle='round',
                solid_joinstyle='round', zorder=1)
        # a faint centreline so lane identity and direction stay legible on wide surfaces
        ax.plot(xs, ys, color='#ffffff', alpha=0.13, linewidth=0.5, zorder=2)


def _draw_actor(ax, b, span, label=True):
    """Actors at true size, but never smaller than legible: a 0.6 m pedestrian gets a halo."""
    ppm = _pts_per_m(ax, span)
    if max(b['l'], b['w']) * ppm < 7.0:       # too small to see -> ring it
        ax.scatter([b['x']], [b['y']], s=110, facecolors='none', edgecolors=b['color'],
                   linewidths=1.6, zorder=6, clip_on=True)
    ax.add_patch(MPoly(corners(b['x'], b['y'], b['hd'], b['l'], b['w']), closed=True,
                       facecolor=b['color'], edgecolor='white', linewidth=1.0, zorder=5,
                       alpha=0.97, clip_on=True))
    n = max(2.5, b['l'] * 0.85)
    ax.arrow(b['x'], b['y'], n * math.cos(b['hd']), n * math.sin(b['hd']),
             head_width=1.1, head_length=1.1, fc='white', ec='white', zorder=7,
             length_includes_head=True, clip_on=True)
    if label:
        ax.annotate(b['id'], (b['x'], b['y']), textcoords='offset points', xytext=(0, -11),
                    color='white', fontsize=7.5, ha='center', va='top', zorder=8,
                    weight='bold', annotation_clip=True,
                    bbox=dict(boxstyle='round,pad=0.12', fc='#000000', ec='none', alpha=0.55))


def _panel(ax, dev_assets, mapid, boxes, cx, cy, span, title, grid_m=10):
    ax.set_facecolor('#171717')
    # fix the extent + aspect BEFORE measuring points-per-metre, or lane widths are wrong
    ax.set_xlim(cx - span, cx + span); ax.set_ylim(cy - span, cy + span)
    ax.set_aspect('equal')
    ax.figure.canvas.draw()
    _draw_roads(ax, dev_assets, mapid, cx, cy, span)
    for b in boxes:
        _draw_actor(ax, b, span)
    g = int(grid_m)
    k = int(span // g) + 1
    for i in range(-k, k + 1):
        ax.axvline(cx + i * g, color='#fff', alpha=0.08, lw=0.5, zorder=0)
        ax.axhline(cy + i * g, color='#fff', alpha=0.08, lw=0.5, zorder=0)
    ax.set_xlim(cx - span, cx + span); ax.set_ylim(cy - span, cy + span)
    ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(title, color='white', fontsize=9)


def boxes_from_instance(inst):
    """Authored initial state -> drawable boxes (converts z -> y)."""
    out = []
    for a in inst['input']['actors']:
        p = a['initial']['pose']; d = a.get('dims', {})
        out.append({'id': a['id'], 'x': p['x'], 'y': -p['z'], 'hd': p['headingRad'],
                    'l': d.get('l', 4.5), 'w': d.get('w', 1.9),
                    'color': EGO_C if a['id'] == 'ego' else CHAL_C,
                    'speed': a['initial'].get('speedMps', 0.0)})
    for pr in inst['input'].get('props', []) or []:
        p = pr.get('pose', {}); d = pr.get('dims', {})
        out.append({'id': pr.get('id', 'prop'), 'x': p.get('x', 0), 'y': -p.get('z', 0),
                    'hd': p.get('headingRad', 0.0), 'l': d.get('l', 4.5), 'w': d.get('w', 1.9),
                    'color': PROP_C, 'speed': 0.0})
    return out


def boxes_from_trace(trace, i):
    meta = trace['header'].get('actorMetadata', {})
    out = []
    for aid, a in trace['ticks']['actors'].items():
        if not a['present'][i]:
            continue
        d = meta.get(aid, {}).get('dims', {})
        out.append({'id': aid, 'x': a['x'][i], 'y': a['y'][i], 'hd': a['headingRad'][i],
                    'l': d.get('l', 4.5), 'w': d.get('w', 1.9),
                    'color': EGO_C if aid == 'ego' else CHAL_C, 'speed': a['speedMps'][i]})
    for pid, pm in (trace['header'].get('propMetadata', {}) or {}).items():
        p = pm.get('pose', {}); d = pm.get('dims', {})
        out.append({'id': pid, 'x': p.get('x', 0), 'y': -p.get('z', 0), 'hd': p.get('headingRad', 0.0),
                    'l': d.get('l', 4.5), 'w': d.get('w', 1.9), 'color': PROP_C, 'speed': 0.0})
    return out


def render_instance_t0(dev_assets, instance_path, out, span_m=38):
    inst = json.load(open(instance_path))
    mapid = inst['input']['mapId']
    boxes = boxes_from_instance(inst)
    ego = next(b for b in boxes if b['id'] == 'ego')
    fig, ax = plt.subplots(figsize=(9, 9), dpi=110)
    sp = ', '.join(f"{b['id']} {b['speed']*3.6:.0f}kph" for b in boxes if b['speed'] > 0.05)
    _panel(ax, dev_assets, mapid, boxes, ego['x'], ego['y'], span_m,
           f"AUTHORED INITIAL STATE (pre-warmup) | {mapid} | grid 10 m | {sp}")
    fig.patch.set_facecolor('#171717'); fig.tight_layout()
    fig.savefig(out, facecolor='#171717'); plt.close(fig)
    return out


def render_rollout(dev_assets, trace_path, out, closest_t=None, n=6, span_m=32):
    """Contact sheet of the rollout. Always includes t=0 and the closest-approach frame."""
    with gzip.open(trace_path) as f:
        trace = json.loads(f.read())
    ts = trace['ticks']['t']
    mapid = trace['header']['mapId']
    picks = [0.0] + [ts[-1] * k / (n - 2) for k in range(1, n - 1)]
    if closest_t is not None:
        picks.append(closest_t)
    picks = sorted(set(round(min(max(p, 0.0), ts[-1]), 2) for p in picks))[:n]
    idx = [min(range(len(ts)), key=lambda j: abs(ts[j] - p)) for p in picks]
    cols = 3; rows = (len(idx) + cols - 1) // cols
    fig, axs = plt.subplots(rows, cols, figsize=(5.0 * cols, 5.0 * rows), dpi=95)
    axs = axs.ravel() if hasattr(axs, 'ravel') else [axs]
    for k, i in enumerate(idx):
        b = boxes_from_trace(trace, i)
        ego = next((q for q in b if q['id'] == 'ego'), None)
        cx, cy = (ego['x'], ego['y']) if ego else (b[0]['x'], b[0]['y'])
        tag = '  <-- CLOSEST APPROACH' if closest_t is not None and abs(ts[i] - closest_t) < 1e-6 else ''
        spd = f"ego {ego['speed']*3.6:.0f} kph" if ego else ''
        _panel(axs[k], dev_assets, mapid, b, cx, cy, span_m, f"t = {ts[i]:.2f} s | {spd}{tag}")
    for k in range(len(idx), len(axs)):
        axs[k].axis('off')
    fig.suptitle(f"ROLLOUT | {mapid} | each panel {2*span_m} m across, grid 10 m, ego is BLUE, "
                 f"challengers RED, props ORANGE", color='white', fontsize=11)
    fig.patch.set_facecolor('#171717'); fig.tight_layout()
    fig.savefig(out, facecolor='#171717'); plt.close(fig)
    return out
