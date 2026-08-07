"""Independent cross-check of gate.obb_clearance.

Three mutually independent implementations:
  A) gate.obb_clearance            -- vertex-to-edge min, SAT overlap  (the one under audit)
  B) seg_seg_clearance             -- segment-to-segment min over all edge pairs, winding-number overlap
  C) sampled_clearance             -- dense boundary sampling, brute force (slow, ground-truth-ish)
  D) qp_clearance                  -- scipy convex QP: min ||p-q|| s.t. p in conv(A), q in conv(B)
"""
import math, itertools, random, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gate as G
import numpy as np

def corners(x, y, hd, l, w):
    return G._corners(x, y, hd, l, w)

# ---------- B ----------
def _seg_seg(p1, p2, q1, q2):
    def d_pt_seg(p, a, b):
        return G._seg_dist(p, a, b)
    def ccw(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    d1, d2 = ccw(q1, q2, p1), ccw(q1, q2, p2)
    d3, d4 = ccw(p1, p2, q1), ccw(p1, p2, q2)
    if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
        return 0.0
    return min(d_pt_seg(p1, q1, q2), d_pt_seg(p2, q1, q2),
               d_pt_seg(q1, p1, p2), d_pt_seg(q2, p1, p2))

def _pt_in_poly(p, poly):
    x, y = p; inside = False; n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin: inside = not inside
    return inside

def seg_seg_clearance(A, B):
    if _pt_in_poly(A[0], B) or _pt_in_poly(B[0], A):
        return 0.0
    best = float('inf')
    for i in range(len(A)):
        for j in range(len(B)):
            d = _seg_seg(A[i], A[(i+1) % len(A)], B[j], B[(j+1) % len(B)])
            if d < best: best = d
    return best

# ---------- C ----------
def sampled_clearance(A, B, n=400):
    def bnd(P):
        pts = []
        for i in range(len(P)):
            a = np.array(P[i]); b = np.array(P[(i+1) % len(P)])
            for t in np.linspace(0, 1, n, endpoint=False):
                pts.append(a + t*(b-a))
        return np.array(pts)
    pa, pb = bnd(A), bnd(B)
    d = np.sqrt(((pa[:, None, :] - pb[None, :, :])**2).sum(-1))
    dmin = d.min()
    if _pt_in_poly(A[0], B) or _pt_in_poly(B[0], A):
        return 0.0
    return float(dmin)

# ---------- D ----------
def _hull(pts):
    pts = sorted(set((round(p[0], 12), round(p[1], 12)) for p in pts))
    if len(pts) <= 2: return pts
    def half(ps):
        out = []
        for p in ps:
            while len(out) >= 2 and ((out[-1][0]-out[-2][0])*(p[1]-out[-2][1])
                                     - (out[-1][1]-out[-2][1])*(p[0]-out[-2][0])) <= 0:
                out.pop()
            out.append(p)
        return out
    lo = half(pts); up = half(pts[::-1])
    return lo[:-1] + up[:-1]

def qp_clearance(A, B):
    """Exact via the Minkowski difference: clearance = dist(origin, conv(A (-) B)).
    Completely independent formulation from A (vertex-edge) and B (segment-segment)."""
    md = _hull([(a[0]-b[0], a[1]-b[1]) for a in A for b in B])
    if len(md) < 3:
        return min(math.hypot(*p) for p in md)
    if _pt_in_poly((0.0, 0.0), md):
        return 0.0
    return min(G._seg_dist((0.0, 0.0), md[i], md[(i+1) % len(md)]) for i in range(len(md)))

CASES = []
def case(name, a, b): CASES.append((name, a, b))

CAR = (4.8, 1.9); PED = (0.6, 0.6); TRUCK = (12.0, 2.6)
case("far-apart-parallel",      corners(0,0,0,*CAR),        corners(50,0,0,*CAR))
case("touching-nose-to-tail",   corners(0,0,0,*CAR),        corners(4.8,0,0,*CAR))
case("overlapping-identical",   corners(0,0,0,*CAR),        corners(0,0,0,*CAR))
case("overlapping-partial",     corners(0,0,0,*CAR),        corners(2.0,0.5,0.3,*CAR))
case("ped-vs-car-3m-lateral",   corners(0,0,0,*CAR),        corners(0,0.95+0.3+3.0,0,*PED))
case("ped-vs-car-side-exact1m", corners(0,0,0,*CAR),        corners(0,0.95+0.3+1.0,0,*PED))
case("corner-to-corner-45",     corners(0,0,0,*CAR),        corners(6,3,math.pi/4,*CAR))
case("perp-t-bone-gap",         corners(0,0,0,*CAR),        corners(5.0,0,math.pi/2,*CAR))
case("truck-vs-ped-tight",      corners(0,0,0.4,*TRUCK),    corners(3,4,0,*PED))
case("degenerate-zero-dims",    corners(0,0,0,0.0,0.0),     corners(3,4,0,0.0,0.0))
case("edge-edge-parallel-1m",   corners(0,0,0,*CAR),        corners(0,1.9+1.0,0,*CAR))
case("nested-ped-inside-car",   corners(0,0,0,*CAR),        corners(0.5,0.2,0.7,*PED))
case("touching-corner-exact",   corners(0,0,0,*CAR),        corners(2.4+0.3,0.95+0.3,0,*PED))

random.seed(7)
for k in range(40):
    a = corners(random.uniform(-10,10), random.uniform(-10,10), random.uniform(0,6.28), *CAR)
    b = corners(random.uniform(-10,10), random.uniform(-10,10), random.uniform(0,6.28),
                *(CAR if k % 2 else PED))
    case(f"random-{k}", a, b)

if __name__ == "__main__":
    print(f"{'case':28s} {'A(gate)':>10s} {'B(segseg)':>10s} {'C(sampled)':>11s} {'D(qp)':>10s} {'maxdiff':>10s}")
    worst = 0.0; rows = []
    for name, a, b in CASES:
        va = G.obb_clearance(a, b)
        vb = seg_seg_clearance(a, b)
        vc = sampled_clearance(a, b)
        vd = qp_clearance(a, b)
        md = max(abs(va-vb), abs(va-vd))
        worst = max(worst, md)
        rows.append((name, va, vb, vc, vd, md))
        if not name.startswith("random") or md > 1e-6:
            print(f"{name:28s} {va:10.6f} {vb:10.6f} {vc:11.6f} {vd:10.6f} {md:10.2e}")
    print(f"\nWORST |A-B| / |A-D| over {len(CASES)} cases: {worst:.3e}")
