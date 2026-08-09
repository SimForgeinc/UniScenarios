"""The FULL-CLIP TRAJECTORY TRAIL render.

Direct test of the hypothesis that lateral motion is invisible because a 6-panel sample of a 13 s
clip cannot show a drift. Here every actor's ENTIRE path is drawn as a continuous line, so a
lane incursion is a single visible shape rather than something to be inferred across panels.

Layout: one large overview panel showing complete paths with time ticks, plus three small
snapshots (start, closest approach, end) for pose context.
"""
import gzip, json, math, os, sys
os.environ.pop('MPLBACKEND', None)
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import scene as S


def render_trails(dev_assets, trace_path, out, closest_t=None, tick_s=1.0):
    with gzip.open(trace_path) as f:
        tr = json.loads(f.read())
    ts = np.asarray(tr['ticks']['t'], float)
    mapid = tr['header']['mapId']
    meta = tr['header'].get('actorMetadata', {})
    ego = tr['ticks']['actors'].get('ego')

    xs, ys = [], []
    for aid, a in tr['ticks']['actors'].items():
        pr = np.asarray(a['present'], bool)
        if pr.any():
            xs += list(np.asarray(a['x'], float)[pr])
            ys += list(np.asarray(a['y'], float)[pr])
    for pid, pm in (tr['header'].get('propMetadata') or {}).items():
        p = pm.get('pose', {})
        xs.append(p.get('x', 0.0)); ys.append(-p.get('z', 0.0))
    cx, cy = 0.5 * (max(xs) + min(xs)), 0.5 * (max(ys) + min(ys))
    span = max(12.0, max(max(xs) - cx, max(ys) - cy) * 1.12 + 5.0)

    ci = (min(range(len(ts)), key=lambda j: abs(ts[j] - closest_t))
          if closest_t is not None else len(ts) // 2)

    fig = plt.figure(figsize=(17.5, 11.0), dpi=95)
    gs = fig.add_gridspec(3, 5)
    big = fig.add_subplot(gs[:, :3])
    S._panel(big, dev_assets, mapid, [], cx, cy, span,
             'COMPLETE PATHS OVER THE WHOLE CLIP -- dots every %.0f s' % tick_s, grid_m=5)

    names = []
    for aid, a in tr['ticks']['actors'].items():
        pr = np.asarray(a['present'], bool)
        if not pr.any():
            continue
        X, Y, T = (np.asarray(a[k], float)[pr] for k in ('x', 'y')), None, ts[pr]
        X = np.asarray(a['x'], float)[pr]; Y = np.asarray(a['y'], float)[pr]
        V = np.asarray(a['speedMps'], float)[pr]
        col = S.EGO_C if aid == 'ego' else S.CHAL_C
        big.plot(X, Y, color=col, lw=3.0 if aid == 'ego' else 2.2, alpha=0.95, zorder=5,
                 solid_capstyle='round')
        step = max(1, int(tick_s / max(np.median(np.diff(T)), 1e-6)))
        big.scatter(X[::step], Y[::step], s=26, facecolors=col, edgecolors='white',
                    linewidths=0.8, zorder=6)
        for j in range(0, len(X), step):
            big.annotate(f'{T[j]:.0f}s', (X[j], Y[j]), textcoords='offset points',
                         xytext=(4, 4), color='white', fontsize=6.5, zorder=7)
        big.annotate(f"{aid}  start", (X[0], Y[0]), textcoords='offset points', xytext=(0, -13),
                     color=col, fontsize=9, ha='center', weight='bold', zorder=8,
                     bbox=dict(boxstyle='round,pad=0.15', fc='#000', ec='none', alpha=0.7))
        d = meta.get(aid, {}).get('dims', {})
        names.append(f"{aid}: {d.get('l','?')}x{d.get('w','?')} m, "
                     f"travels {np.hypot(np.diff(X), np.diff(Y)).sum():.1f} m, "
                     f"speed {V.min()*3.6:.0f}-{V.max()*3.6:.0f} km/h")
    for pid, pm in (tr['header'].get('propMetadata') or {}).items():
        p, d = pm.get('pose', {}), pm.get('dims', {})
        S._draw_actor(big, {'id': pid, 'x': p.get('x', 0.0), 'y': -p.get('z', 0.0),
                            'hd': p.get('headingRad', 0.0), 'l': d.get('l', 4.5),
                            'w': d.get('w', 1.9), 'color': S.PROP_C}, span)
        names.append(f"{pid}: {d.get('l','?')}x{d.get('w','?')} m, STATIC scenery")

    for k, (i, lab) in enumerate([(0, 'start'), (ci, 'CLOSEST APPROACH'), (len(ts) - 1, 'end')]):
        ax = fig.add_subplot(gs[k, 3:])
        b = S.boxes_from_trace(tr, i)
        e = next((q for q in b if q['id'] == 'ego'), None)
        ex, ey = (e['x'], e['y']) if e else (cx, cy)
        S._panel(ax, dev_assets, mapid, b, ex, ey, 18.0,
                 f't = {ts[i]:.2f} s  ({lab})  36 m across', grid_m=5)
        for q in b:
            ax.annotate(f"{q['speed']*3.6:.0f}", (q['x'], q['y']), textcoords='offset points',
                        xytext=(0, 9), color='#ffe680', fontsize=8, ha='center', zorder=9,
                        weight='bold', bbox=dict(boxstyle='round,pad=0.1', fc='#000', ec='none',
                                                 alpha=0.6))
    fig.suptitle('ROLLOUT AS COMPLETE TRAJECTORIES | ' + mapid
                 + ' | ego BLUE, challengers RED, props YELLOW\n' + ' | '.join(names),
                 color='white', fontsize=10)
    fig.patch.set_facecolor('#171717')
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    fig.savefig(out, facecolor='#171717')
    plt.close(fig)
    return out
