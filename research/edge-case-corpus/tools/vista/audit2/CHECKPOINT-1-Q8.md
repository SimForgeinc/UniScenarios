# CHECKPOINT 1 — Q8 / interpenetration, verified independently

Instruments: `audit2/obb_indep.py` (from-scratch SAT + polygon distance, does NOT import gate.py),
`audit2/fastgate.py` (numpy re-implementation of C1-C5). fastgate cross-checked against gate.py on
150 random traces: **111/111 exact agreement in the decision-relevant regime (clearance <= 5 m)**,
gate.py never under-reports. Scanned all 3390 accept/critical cells across 13 runs
(`audit2/scan-all.json`, `audit2/scan_all.py`).

## 1. Your interpenetration finding is CONFIRMED, and understated

el-camino-road/10e7aead286038ac draw-000, ego vs `slowLead`, both 4.8 x 1.9 m:
- min OBB clearance 0.0 at t=5.66 (centre distance 4.4531 m -- your figure, reproduced exactly)
- it gets far worse: at **t=7.30 the centres are 0.883 m apart**
- Monte-Carlo (400k samples, independent of SAT): **62.5% of the ego footprint is inside the lead
  footprint** -- 5.70 m^2 of overlap
- sustained **268 ticks = 5.36 s** of continuous interpenetration
- `metrics.collisions == []`, verdict accept, band critical

## 2. Rate: your "39/65 in that batch" did not reproduce, the global rate is worse

That specific batch (c1-ccrm-blind/batch-final) has only **5** C1-C5-passing cells, 2 of which
interpenetrate -- not 39/65. Wherever 39/65 came from, it is not that batch. But the population rate
is the real story:

| | n | |
|---|---|---|
| accept/critical cells scanned | 3390 | |
| pass frozen gate C1-C5 | 1642 | |
| ...of which TRUE OBB interpenetration | **482** | **29.4%** |
| ...of which clearance < 0.10 m (Q8 as written) | 518 | 31.5% |

Per run it ranges 0.108 (vista-critic-blind) to **0.457** (vista-gen-blind). Median penetration depth
among overlapping cells is **1.449 m**; the max is 1.900 m, which is exactly the vehicle width --
i.e. total lateral interpenetration. Median duration 43 ticks (0.86 s).

**Q8 is not a nicety. It removes ~30% of everything the frozen gate admits.**

## 3. ROOT CAUSE: the engine's collision detector misses half of all interpenetrations

Cross-tab over the 3390 accept/critical cells:

| | true OBB overlap | no overlap |
|---|---|---|
| `metrics.collisions` > 0 | 565 | 61 |
| `metrics.collisions` == 0 | **576** | 2188 |

- The engine **misses 576/1141 = 50.5%** of true interpenetrations, at median depth 1.6 m.
- It also reports 61 collisions where the OBBs never overlap (different body model, or a bug).

The detector is alive (626 non-zero across the sample) but is roughly a coin flip. **C5's
"0 collisions" clause therefore carries almost no information about contact**, which is exactly why
Q8 had to exist. This is an engine bug worth filing separately from the gate.

## 4. Is 0.10 m the right threshold? Partly justified, but NOT for the reason one would assume

I tested the obvious a-priori justification -- that dt=0.02 s sampling could hide a contact between
ticks. Median relative closing speed at closest approach is 5.1 m/s, so v_rel*dt = 0.102 m (p90
0.29 m), which *predicts* a threshold of about 0.10-0.29 m.

**That prediction is wrong.** I re-computed the closest approach with 16x temporal supersampling
(linear pose interpolation, unwrapped headings) on all 667 gate-passing cells with
0 < clearance <= 2.0 m (`audit2/subtick.py`, `audit2/subtick.json`):

- **0 of 667 cells revealed a hidden sub-tick contact.**
- Median (recorded - supersampled) clearance drop: **0.000 m**; worst band median 0.002 m.

The closest approach is a smooth quadratic minimum, so linear per-tick travel wildly overestimates
the error. **dt=0.02 s is already adequate. Discretisation does not justify any margin.**

### What the distribution actually says
Clearance among the 1642 gate-passing cells:

| band | n | |
|---|---|---|
| exactly 0.0 (overlap) | **482** | 29.4% |
| (0, 0.05) | 21 | 1.3% |
| [0.05, 0.10) | 15 | 0.9% |
| [0.10, 0.20) | 38 | 2.3% |
| [0.20, 0.30) | 24 | 1.5% |

The mass at exactly 0.0 is a **distinct population**, ~13x the local density of the continuum
(~36 cells per 0.1 m band). There is **no natural gap** anywhere in (0, 0.3) -- the density is flat.

**Verdict on the threshold: 0.10 m is defensible but arbitrary, and it is doing very little work.**
Rejecting only true overlap (threshold at 0+) captures **482/518 = 93%** of Q8's effect. The extra
0.10 m buys 36 cells (2.2% of gate-passing) on no principled basis. Moving to 0.20 m would cost a
further 38 on equally no basis. My recommendation: **keep 0.10 m, but state it as a rendering/realism
convention ("bodies within 10 cm are visually indistinguishable from contact"), not as a physics or
sampling argument** -- because the sampling argument is measurably false.
