"""VISTA-style visual surface: render a site, render the authored scene at t=0,
render an encounter filmstrip from a trace, and losslessly zoom any past frame.

Every image the agent ever sees is written to the run's frame store, so `inspect(frame, region)`
can re-open ANY earlier frame at full resolution (VISTA's lossless visual memory).
"""
import gzip, json, math, os
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly, Circle
from PIL import Image

import render as R

def corners(x, y, h, l, w):
    c, s = math.cos(h), math.sin(h)
    hl, hw = l/2.0, w/2.0
    return [(x + c*dx - s*dy, y + s*dx + c*dy) for dx, dy in ((hl,hw),(hl,-hw),(-hl,-hw),(-hl,hw))]

DIMS = {'car':(4.8,1.9),'suv':(4.85,1.95),'van':(5.4,2.0),'truck':(8.0,2.5),'bus':(12.0,2.55),
        'pedestrian':(0.6,0.6),'bicycle':(1.8,0.6),'motorcycle':(2.1,0.8),'prop':(1.0,1.0)}

def _ax(mapid, dev_assets, cx, cy, span, px, grid=10):
    LNS = R.topo(dev_assets, mapid)['lanes']
    fig, ax = plt.subplots(figsize=(px/100, px/100), dpi=100)
    ax.set_facecolor('#1a1a1a')
    for ln in LNS.values():
        p = ln.get('polyline') or []
        if not p: continue
        xs = [q['x'] for q in p]; ys = [q['y'] for q in p]
        if max(xs) < cx-span or min(xs) > cx+span or max(ys) < cy-span or min(ys) > cy+span: continue
        w = ln.get('representativeWidthM') or 3.5
        col = R.JUNCTION_COLOR if ln.get('isJunction') else R.LANE_COLORS.get(ln.get('laneType'), '#2e2e2e')
        ax.plot(xs, ys, color=col, linewidth=max(1.0, w*px/(2*span)*0.92), solid_capstyle='round', zorder=1)
    for g in range(-int(span), int(span)+1, grid):
        ax.axvline(cx+g, color='#fff', alpha=0.10, linewidth=0.5, zorder=0)
        ax.axhline(cy+g, color='#fff', alpha=0.10, linewidth=0.5, zorder=0)
    ax.set_xlim(cx-span, cx+span); ax.set_ylim(cy-span, cy+span)
    ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    return fig, ax

COLORS = {'ego':'#2e86de','threat':'#c0392b','other':'#e67e22','prop':'#8e44ad'}

def draw_scene(dev_assets, mapid, ego_rsl, cx, cy, span, px, boxes, out, title, ego_pl=None,
               markers=None):
    """boxes: [{'x','y','headingRad','l','w','label','role'}]"""
    fig, ax = _ax(mapid, dev_assets, cx, cy, span, px)
    if ego_pl:
        ax.plot([q['x'] for q in ego_pl], [q['y'] for q in ego_pl], color='#d8b45a',
                linewidth=1.6, zorder=3, alpha=0.9)
    for m in (markers or []):
        ax.scatter([m['x']], [m['y']], s=14, c='#d8b45a', zorder=4)
        ax.text(m['x'], m['y']+1.2, m['label'], color='#f0d090', fontsize=7, ha='center',
                va='bottom', zorder=4)
    for b in boxes:
        col = COLORS.get(b.get('role'), '#e67e22')
        cs = corners(b['x'], b['y'], b.get('headingRad', 0.0), b['l'], b['w'])
        ax.add_patch(MPoly(cs, closed=True, facecolor=col, edgecolor='white', linewidth=1.3, zorder=5))
        # heading tick
        hx = b['x'] + math.cos(b.get('headingRad',0))*b['l']*0.75
        hy = b['y'] + math.sin(b.get('headingRad',0))*b['l']*0.75
        ax.plot([b['x'], hx], [b['y'], hy], color='white', linewidth=1.0, zorder=6)
        ax.text(b['x'], b['y']-1.6, b['label'], color='white', fontsize=8, ha='center',
                va='top', zorder=7, weight='bold')
    ax.set_title(title, color='white', fontsize=9)
    fig.patch.set_facecolor('#1a1a1a'); fig.tight_layout()
    fig.savefig(out, facecolor='#1a1a1a'); plt.close(fig)
    return {'out': out, 'center': (cx, cy), 'span': span, 'px': px, 'map': mapid, 'lane': ego_rsl}

def filmstrip(dev_assets, trace_path, out, n=6, px=420, span=42):
    """Render n frames of the encounter, centred on the ego, side by side."""
    tr = json.loads(gzip.open(trace_path).read())
    hdr, ticks = tr['header'], tr['ticks']
    ts = ticks['t']; act = ticks['actors']; meta = hdr['actorMetadata']; mapid = hdr['mapId']
    e = act['ego']
    # centre the strip on the closest-approach tick
    best_i, best_d = 0, 1e9
    for aid, a in act.items():
        if aid == 'ego': continue
        for i in range(len(ts)):
            d = math.hypot(e['x'][i]-a['x'][i], e['y'][i]-a['y'][i])
            if d < best_d: best_d, best_i = d, i
    lo = max(0, best_i - int(2.5/ (ts[1]-ts[0]) ) )
    hi = min(len(ts)-1, best_i + int(1.5/(ts[1]-ts[0])))
    idxs = [0] + [int(lo + k*(hi-lo)/(n-2)) for k in range(n-1)]
    tiles = []
    props = hdr.get('propMetadata') or {}
    for k, i in enumerate(idxs):
        cx, cy = e['x'][i], e['y'][i]
        fig, ax = _ax(mapid, dev_assets, cx, cy, span, px, grid=10)
        for pid, p in props.items():
            pp = p.get('pose') or {}
            pxx, pyy = pp.get('x'), pp.get('z')
            if pxx is None: continue
            dm = p.get('dims') or {'l':1,'w':1}
            cs = corners(pxx, -pyy if pyy is not None and abs(pyy) > 1e4 else pyy,
                         pp.get('headingRad',0), dm['l'], dm['w'])
            ax.add_patch(MPoly(cs, closed=True, facecolor='#8e44ad', edgecolor='white',
                               linewidth=0.8, alpha=0.85, zorder=4))
        for aid, a in act.items():
            if not a['present'][i]: continue
            dm = meta.get(aid, {}).get('dims', {'l':1,'w':1})
            cs = corners(a['x'][i], a['y'][i], a['headingRad'][i], dm['l'], dm['w'])
            col = COLORS['ego'] if aid == 'ego' else COLORS['threat']
            ax.add_patch(MPoly(cs, closed=True, facecolor=col, edgecolor='white', linewidth=1.2, zorder=5))
            ax.text(a['x'][i], a['y'][i]-1.4, f"{aid} {a['speedMps'][i]:.1f}m/s", color='white',
                    fontsize=6.5, ha='center', va='top', zorder=6)
        ax.set_title(f"t={ts[i]:.2f}s", color='white', fontsize=8)
        fig.patch.set_facecolor('#1a1a1a'); fig.tight_layout()
        tp = f"{out}.tile{k}.png"; fig.savefig(tp, facecolor='#1a1a1a'); plt.close(fig)
        tiles.append(tp)
    ims = [Image.open(t) for t in tiles]
    W = sum(i.width for i in ims); H = max(i.height for i in ims)
    sheet = Image.new('RGB', (W, H), (26,26,26)); x = 0
    for im in ims: sheet.paste(im, (x,0)); x += im.width
    sheet.save(out)
    for t in tiles: os.remove(t)
    return {'out': out, 'tiles': len(ims), 'ts': [round(ts[i],2) for i in idxs]}

def zoom(frame_png, region, out, upscale=2):
    """Lossless re-view of a stored frame: region = (x0,y0,x1,y1) in pixels of that frame."""
    im = Image.open(frame_png)
    x0, y0, x1, y1 = [int(v) for v in region]
    x0 = max(0, min(x0, im.width-2)); x1 = max(x0+2, min(x1, im.width))
    y0 = max(0, min(y0, im.height-2)); y1 = max(y0+2, min(y1, im.height))
    c = im.crop((x0, y0, x1, y1))
    c = c.resize((c.width*upscale, c.height*upscale), Image.LANCZOS)
    c.save(out)
    return {'out': out, 'region': [x0,y0,x1,y1], 'size': [c.width, c.height]}
