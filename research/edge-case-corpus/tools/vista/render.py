"""Headless top-down site renderer for the VISTA-style visual harness.

Reads the repo's own dev-assets/<map>/topology-index.json.gz (lane polylines, widths,
lane types, junction flags) and renders a PNG the agent can actually look at.

The renderer also returns the pixel<->world transform, which is what lets the harness
convert a click/box the agent draws back into a PORTABLE logical anchor
(lane rsl, longitudinal s, lateral tFrac) rather than a baked coordinate.
"""
import gzip, json, math
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly

LANE_COLORS = {'driving':'#5a5a5a','sidewalk':'#3d4a3d','shoulder':'#4a4436','parking':'#454055'}
JUNCTION_COLOR = '#6b5a45'
_CACHE = {}

def topo(dev_assets, mapid):
    if mapid not in _CACHE:
        _CACHE[mapid] = json.loads(gzip.open(f"{dev_assets}/{mapid}/topology-index.json.gz").read())
    return _CACHE[mapid]

def station(pl, s):
    acc=[0.0]
    for a,b in zip(pl,pl[1:]): acc.append(acc[-1]+math.hypot(b['x']-a['x'],b['y']-a['y']))
    s=max(0.0,min(s,acc[-1]))
    i=min(range(len(acc)),key=lambda j:abs(acc[j]-s))
    return pl[i]['x'], pl[i]['y'], acc[-1]

def world_from_pixel(view, px_x, px_y):
    """Invert the render transform: image pixel -> world (x, y)."""
    cx,cy = view['center']; span = view['span']; px = view['px']
    return (cx - span + (px_x/px)*2*span, cy + span - (px_y/px)*2*span)

def nearest_lane(dev_assets, mapid, x, y, driving_only=True):
    """World point -> (rsl, s, lateral offset m). This is the projection that keeps output portable."""
    best=None
    for rsl,ln in topo(dev_assets,mapid)['lanes'].items():
        if driving_only and ln.get('laneType')!='driving': continue
        pl=ln.get('polyline') or []
        acc=0.0
        for a,b in zip(pl,pl[1:]):
            seg=math.hypot(b['x']-a['x'],b['y']-a['y'])
            if seg<1e-9: continue
            t=max(0.0,min(1.0,((x-a['x'])*(b['x']-a['x'])+(y-a['y'])*(b['y']-a['y']))/seg**2))
            qx,qy=a['x']+t*(b['x']-a['x']), a['y']+t*(b['y']-a['y'])
            d=math.hypot(x-qx,y-qy)
            if best is None or d<best[0]:
                w=ln.get('representativeWidthM') or 3.5
                cross=((b['x']-a['x'])*(y-a['y'])-(b['y']-a['y'])*(x-a['x']))/seg
                best=(d, rsl, acc+t*seg, cross, w)
            acc+=seg
    if best is None: return None
    d,rsl,s,cross,w = best
    return {'rsl':rsl,'s':round(s,2),'lateralM':round(cross,2),
            'tFrac':round(max(-1.0,min(1.0,cross/(w/2))),3),'distanceM':round(d,2)}

def render_site(dev_assets, mapid, rsl, s_center, span_m=90, px=1024,
                actors=None, props=None, out="/tmp/site.png", grid_m=10, title_extra=""):
    LNS=topo(dev_assets,mapid)['lanes']; L=LNS.get(rsl)
    if L is None or not L.get('polyline'): return None
    pl=L['polyline']; cx,cy,lane_len = station(pl, s_center)
    fig,ax=plt.subplots(figsize=(px/100,px/100),dpi=100); ax.set_facecolor('#1a1a1a')
    for ln in LNS.values():
        p=ln.get('polyline') or []
        if not p: continue
        xs=[q['x'] for q in p]; ys=[q['y'] for q in p]
        if max(xs)<cx-span_m or min(xs)>cx+span_m or max(ys)<cy-span_m or min(ys)>cy+span_m: continue
        w=ln.get('representativeWidthM') or 3.5
        col=JUNCTION_COLOR if ln.get('isJunction') else LANE_COLORS.get(ln.get('laneType'),'#2e2e2e')
        ax.plot(xs,ys,color=col,linewidth=max(1.0,w*px/(2*span_m)*0.92),solid_capstyle='round',zorder=1)
    ax.plot([q['x'] for q in pl],[q['y'] for q in pl],color='#d8b45a',linewidth=1.8,zorder=3,alpha=0.95)
    for a in (actors or []):
        ax.add_patch(MPoly(a['corners'],closed=True,facecolor=a.get('color','#c0392b'),
                           edgecolor='white',linewidth=1.2,zorder=5))
        ax.text(a['x'],a['y'],a['label'],color='white',fontsize=9,ha='center',va='center',zorder=6,weight='bold')
    for p in (props or []):
        ax.scatter([p['x']],[p['y']],s=40,c=p.get('color','#e67e22'),edgecolors='white',zorder=5)
    for g in range(-span_m,span_m+1,grid_m):
        ax.axvline(cx+g,color='#fff',alpha=0.10,linewidth=0.5,zorder=0)
        ax.axhline(cy+g,color='#fff',alpha=0.10,linewidth=0.5,zorder=0)
    ax.set_xlim(cx-span_m,cx+span_m); ax.set_ylim(cy-span_m,cy+span_m)
    ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(f"{mapid} | ego lane {rsl} | view {2*span_m}m across, grid {grid_m}m {title_extra}",
                 color='white',fontsize=10)
    fig.patch.set_facecolor('#1a1a1a'); fig.tight_layout(); fig.savefig(out,facecolor='#1a1a1a'); plt.close(fig)
    return {'out':out,'center':(cx,cy),'span':span_m,'px':px,'lane':rsl,'map':mapid,'laneLenM':round(lane_len,2)}
