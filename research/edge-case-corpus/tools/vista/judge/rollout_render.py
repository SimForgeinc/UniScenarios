"""Rollout renderer for the independent quality judge.

Renders what the ego actually did, as a filmstrip the model can look at, plus a conflict close-up.
Deliberately NOT the same code path as tools/vista/render.py: that renders a *site* for the author,
this renders a *rollout* for the critic, so a bug shared between authoring and judging cannot cancel.

Frame convention (verified in GATE-AUDIT.md section 6): positions y = -z, headings NOT negated.
"""
import os, math, gzip, json, sys
os.environ.pop('MPLBACKEND', None)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly
import matplotlib.patheffects as pe

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import features as F

_TOPO = {}
LANE_COLORS = {'driving': '#606060', 'sidewalk': '#41513f', 'shoulder': '#4d4738', 'parking': '#4a4459'}
JUNCTION_COLOR = '#6f5c46'
ACTOR_COLOR = {'ego': '#3498db', 'car': '#e74c3c', 'pedestrian': '#f1c40f',
               'bicycle': '#1abc9c', 'motorcycle': '#e67e22', 'truck': '#9b59b6', 'prop': '#95a5a6'}
_OUT = [pe.withStroke(linewidth=2.0, foreground='#101010')]


def topo(dev_assets, mapid):
    if mapid not in _TOPO:
        _TOPO[mapid] = json.loads(gzip.open(f'{dev_assets}/{mapid}/topology-index.json.gz').read())
    return _TOPO[mapid]


def _lw(fig, ax, span, metres):
    """Line width in points that corresponds to `metres` on the ground in this axes."""
    bb = ax.get_position()
    ax_w_in = bb.width * fig.get_figwidth()
    return max(0.6, metres * (ax_w_in * 72.0) / (2.0 * span))


def _draw_roads(fig, ax, dev_assets, mapid, cx, cy, span):
    for ln in topo(dev_assets, mapid)['lanes'].values():
        p = ln.get('polyline') or []
        if not p: continue
        xs = [q['x'] for q in p]; ys = [q['y'] for q in p]
        if max(xs) < cx - span or min(xs) > cx + span or max(ys) < cy - span or min(ys) > cy + span:
            continue
        w = ln.get('representativeWidthM') or 3.5
        col = JUNCTION_COLOR if ln.get('isJunction') else LANE_COLORS.get(ln.get('laneType'), '#2e2e2e')
        ax.plot(xs, ys, color=col, linewidth=_lw(fig, ax, span, w) * 0.94,
                solid_capstyle='round', zorder=1)
        # thin centreline so lane count is countable
        ax.plot(xs, ys, color='#8a8a8a', linewidth=0.35, alpha=0.35, zorder=2, linestyle=(0, (6, 6)))


def _panel(fig, ax, trace, dev_assets, i, span, trail_from=0, annotate_pair=None, labels=True):
    ts = trace['ticks']['t']
    e = trace['ticks']['actors']['ego']
    cx, cy = e['x'][i], e['y'][i]
    ax.set_facecolor('#141414')
    ax.set_xlim(cx - span, cx + span); ax.set_ylim(cy - span, cy + span); ax.set_aspect('equal')
    _draw_roads(fig, ax, dev_assets, trace['header']['mapId'], cx, cy, span)
    tx = [e['x'][k] for k in range(0, i + 1, 5) if e['present'][k]]
    tyy = [e['y'][k] for k in range(0, i + 1, 5) if e['present'][k]]
    if tx:
        ax.plot(tx, tyy, color='#3498db', linewidth=1.1, alpha=0.6, zorder=3, linestyle=':')
    boxes = F.actor_boxes(trace, i)
    order = sorted(boxes.items(), key=lambda kv: (not kv[1]['prop'], kv[0] == 'ego'))
    for aid, b in order:
        if abs(b['x'] - cx) > span * 1.5 or abs(b['y'] - cy) > span * 1.5:
            continue
        col = ACTOR_COLOR['ego'] if aid == 'ego' else ACTOR_COLOR.get(b['kind'], '#e74c3c')
        ax.add_patch(MPoly(b['corners'], closed=True, facecolor=col,
                           edgecolor='white' if not b['prop'] else '#7f8c8d',
                           linewidth=1.1, alpha=0.45 if b['prop'] else 1.0, zorder=5))
        L = max(b['l'], 1.6)
        ax.annotate('', xy=(b['x'] + math.cos(b['hd']) * L * 0.95, b['y'] + math.sin(b['hd']) * L * 0.95),
                    xytext=(b['x'], b['y']), zorder=6,
                    arrowprops=dict(arrowstyle='-|>', color='white', lw=1.0,
                                    alpha=0.5 if b['prop'] else 0.95))
        if labels:
            lbl = 'EGO' if aid == 'ego' else aid
            txt = lbl if b['prop'] else f"{lbl} {b['v']:.1f}m/s"
            ax.text(b['x'] + 1.6, b['y'] + 1.6, txt, color='white', fontsize=6.2,
                    ha='left', va='bottom', zorder=7, weight='bold', path_effects=_OUT)
    if annotate_pair:
        a, bb = annotate_pair
        if a in boxes and bb in boxes:
            ax.plot([boxes[a]['x'], boxes[bb]['x']], [boxes[a]['y'], boxes[bb]['y']],
                    color='#e74c3c', linewidth=1.4, zorder=8)
    g = 5
    for k in range(-int(span // g) * g, int(span // g) * g + 1, g):
        ax.axvline(cx + k, color='#fff', alpha=0.06, linewidth=0.4, zorder=0)
        ax.axhline(cy + k, color='#fff', alpha=0.06, linewidth=0.4, zorder=0)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_color('#555')
    ax.set_title(f"t = {ts[i]:.2f} s   ego {e['speedMps'][i]:.1f} m/s",
                 color='#ecf0f1', fontsize=8)


def pick_indices(trace, n=6, tmin=None):
    ts = trace['ticks']['t']; N = len(ts); dt = ts[1] - ts[0]
    if tmin is None or tmin not in ts:
        return [int(round(k * (N - 1) / (n - 1))) for k in range(n)]
    ic = ts.index(tmin)
    want = [0, ic - int(3.0 / dt), ic - int(1.2 / dt), ic, ic + int(1.2 / dt), N - 1]
    idx = sorted(set(min(max(w, 0), N - 1) for w in want))
    k = 0
    while len(idx) < n and k < N:
        if k not in idx: idx.append(k); idx.sort()
        k += max(1, N // n)
    return idx[:n]


def filmstrip(trace, dev_assets, out, n=6, span=30, px=1200, tmin=None):
    """2x3 ego-centred filmstrip, anchored so the closest approach is always one of the panels."""
    idx = pick_indices(trace, n, tmin)
    fig, axes = plt.subplots(2, 3, figsize=(px / 100, px / 100 * 0.72), dpi=100)
    fig.subplots_adjust(left=.02, right=.98, top=.90, bottom=.02, wspace=.06, hspace=.12)
    for ax, i in zip(axes.ravel(), idx):
        _panel(fig, ax, trace, dev_assets, i, span)
    fig.patch.set_facecolor('#141414')
    fig.suptitle('ROLLOUT FILMSTRIP (read left-to-right, top row then bottom row)   '
                 f"map={trace['header']['mapId']}   view {2*span} m across, 5 m grid\n"
                 'BLUE = ego (vehicle under test).  dotted blue = where the ego has been.  '
                 'arrow = heading.  faded grey = static prop (scenery).',
                 color='#ecf0f1', fontsize=8.5)
    fig.savefig(out, facecolor='#141414'); plt.close(fig)
    return out, [trace['ticks']['t'][i] for i in idx]


def _nearest_index(ts, t):
    return min(range(len(ts)), key=lambda k: abs(ts[k] - t))


def closeup(trace, dev_assets, out, tmin, pair=None, span=12, px=820, clearance=None,
            label='CLOSEST APPROACH'):
    ts = trace['ticks']['t']
    i = _nearest_index(ts, tmin) if tmin is not None else len(ts) // 2
    fig, ax = plt.subplots(figsize=(px / 100, px / 100), dpi=100)
    fig.subplots_adjust(left=.03, right=.97, top=.90, bottom=.03)
    _panel(fig, ax, trace, dev_assets, i, span, annotate_pair=pair)
    extra = f'   true OBB clearance {clearance:.2f} m' if clearance is not None else ''
    ax.set_title(f'{label}   t = {ts[i]:.2f} s{extra}\nview {2*span} m across, 5 m grid',
                 color='#ecf0f1', fontsize=9)
    fig.patch.set_facecolor('#141414')
    fig.savefig(out, facecolor='#141414'); plt.close(fig)
    return out


def two_up(trace, dev_assets, out, t_a, t_b, pair=None, span=16, px=1200,
           label_a='CLOSEST APPROACH', label_b='CONTESTED SPACE'):
    """Two close-ups side by side. These are DIFFERENT MOMENTS in general: the instant of minimum
    clearance is often a post-event pass-by, while the instant the challenger was actually in the
    ego's path is earlier and further away. Showing only one of them shows the critic the wrong
    moment (see RUBRIC.md section 4)."""
    ts = trace['ticks']['t']
    fig, axes = plt.subplots(1, 2, figsize=(px / 100, px / 100 * 0.55), dpi=100)
    fig.subplots_adjust(left=.02, right=.98, top=.84, bottom=.03, wspace=.06)
    for ax, t, lab in zip(axes, (t_a, t_b), (label_a, label_b)):
        if t is None:
            ax.axis('off'); continue
        _panel(fig, ax, trace, dev_assets, _nearest_index(ts, t), span, annotate_pair=pair)
        ax.set_title(f'{lab}\nt = {t:.2f} s', color='#ecf0f1', fontsize=9)
    fig.patch.set_facecolor('#141414')
    fig.suptitle('LEFT: the moment of minimum footprint clearance.   '
                 'RIGHT: the moment the other road user was most directly in the ego\'s path.\n'
                 'If these are different moments, the near-miss and the conflict are different events.',
                 color='#ecf0f1', fontsize=8.5)
    fig.savefig(out, facecolor='#141414'); plt.close(fig)
    return out
