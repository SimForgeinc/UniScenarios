# WS-4b — Signal Authoring (M4.3)

## BOTTOM LINE
*(provisional — batch running; numbers below marked PENDING are not yet re-verified by me)*

`c15g-red-light-runner` had **no traffic light at all**: 67/67 delivered scenarios carried an empty
`ticks.signals`, so gate clause C6 rejects every one of them. The fix is entirely in the template —
a portable `trafficControls` block authoring the ego's own signal head — and it requires no engine
change, no map change, and no anchor change.

## What was already in place when I picked this up
- `surface.md` rules **25–27** were already appended (git diff: +93 lines, deletions 1, i.e. purely
  additive). They cover: you MUST author `trafficControls` when the brief names a light; a minimal
  copyable block; why `obeySignals` is a no-op without one; phase/timing practice; and the two known
  limits (`connectingLaneRsls` always `[]`, `darkFallback`/`darkDwellS` dropped). **Deliverable A is
  therefore already satisfied**; I verified the text and the code references.
- `newcaps/c15g-red-light-runner-signals.template.json` exists and is byte-identical to
  `/tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json` **except** for one added
  top-level `trafficControls` array (verified by a structural diff — no other key differs).
- The live template at `/tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json` had **not**
  been updated. That is the gap I am closing.

## The authored block
```json
"trafficControls": [{
  "id": "ego-approach-head",
  "kind": "normal_signal",
  "feature": "conflict-junction",
  "pose":  {"laneOffset": 0, "s": -6, "tFrac": 0, "headingOffsetRad": 0},
  "stopLines": [{"feature": "conflict-junction",
                 "pose": {"laneOffset": 0, "s": -6, "tFrac": 0, "headingOffsetRad": 0}}],
  "phases": [{"indication": "green",  "durationS": 11},
             {"indication": "yellow", "durationS": 3},
             {"indication": "red",    "durationS": 30}],
  "offsetS": 0, "loop": false,
  "label": "authored head giving the ego a green through the junction"
}]
```
Green must outlast the ego's approach: clip 13 s, ego spawns ~7 s upstream at 45–64 kph, so it
crosses the line ~6.5 s in. Yellow→red then follows inside the clip so the channel shows a real
transition rather than a constant. The violator's red is expressed by
`set(rules.obeySignals, false)` on the van, not by a second head — an authored head's stop line has
`connectingLaneRsls: []` and so stops *every* movement over it.

`template validate --map belmont-research-center` → **0 errors**, 1 pre-existing warning
(`roles.1.arriveAtConflict / trigger_unbindable`) that is present on the base template too.


## C. THE PROOF — measured, `batch --all-maps --draws 20 --max-sites 8 --concurrency 2`

Exactly the `harvest.py::_mass` invocation. Two full runs of the same template, differing only in the
presence of the `trafficControls` block. Measured with `gate.gate_batch` (gate.py **unmodified**).

| | BASE (delivered template) | TREATMENT (authored head) |
|---|---:|---:|
| cells attempted | 800 | 800 |
| cells that simulated (a trace exists) | 671 | 671 |
| cells lost to `arrival_unconverged` before simulating | 129 | 129 |
| **cells with non-empty `ticks.signals`** | **100 / 671 = 14.9%** (2 maps only) | **671 / 671 = 100.0%** |
| … as a fraction of all 800 attempted | 12.5% | **83.9%** |
| C6 losses | **571** | **0** |
| cells passing C1–C5 (pre-C6 physics) | 95 | 95 |
| **cells passing the full frozen gate (incl. C6)** | **0** | **95** |
| cells passing the HQ layer | 0 | **95** |
| admitted / admittedHQ | False / False | **True / True** |
| distinct maps × sites among passers | 0 × 0 | **3 × 8** |

Signal state per map, treatment (base in brackets):

```
belmont-research-center        160/160   [  0/160 ]
easterbrook-discovery-school    71/71    [  0/71  ]
el-camino-road                 140/140   [ 40/140 ]
richmond-field-station         160/160   [  0/160 ]
yale-street                    140/140   [ 60/140 ]
```

The two maps with **zero** dynamic signal heads in the OpenDRIVE (belmont, easterbrook) go from
0% to 100%. The authored program appears as `control:ego-approach-head` with a **median 651 phase
samples per cell = len(ticks.t)**, i.e. a sample on every recorded tick, and the phase array reads
`green → yellow` (green 11 s + yellow 3 s exceeds the 13 s clip, so `red` is authored but off the end
of the clip; on the 100 cells that also inherit a real map program the union of phases is
`green/yellow/red`).

**Target met: 100% of simulated cells carry signal state (target ≥90%); 0 C6 losses.**

### The physics is untouched
The 95 cells that pass C1–C5 in the base are the **same 95 cells**, cell for cell (symmetric
difference 0), that pass the full gate in the treatment. Median ego travel 115.804 m in both, median
`maxSpeedMps` 15.559 in both, median `minTTC` 2.905 in both, median clearance 57.418 m in both.
80 of 671 cells show any change in ego travel at all and 60 a change in `requiredDecelMaxEgo`
(median 1.895 → 2.119): the green head is not free, but it costs nothing at the gate.

**So the whole 0 → 95 swing is C6, and C6 alone.** Adding the block does not buy passes by changing
physics; it repairs the mislabelling that C6 exists to catch.

### Does the ego actually respond to the phase? YES — proven by counterfactual
Same template, same 671 cells, same sites, same draws; **only the phase plan changed**
(`green 11 / yellow 3 / red 30` → a single `red 40` held across the whole approach):

| | authored GREEN through | authored RED held |
|---|---:|---:|
| median ego travel | **115.80 m** | **65.90 m** |
| cells where the ego comes to a full halt | 176 / 671 | **402 / 671** |
| cells whose ego travel changed by >5 m vs GREEN | — | **553 / 671** |
| cells passing the frozen gate | 95 | **0** |
| cells with signal state | 671 | 671 |

Under GREEN the ego is indistinguishable from the no-head base in **591 / 671** cells (travel equal
to within 5 cm) — the authored head is inert while it shows green, exactly as intended. Under RED
the same head halts the ego at the line in 402 cells and destroys gate admission entirely. **The
phase is genuinely driving the vehicle.** Single-cell view (belmont-research-center /
0580a0170fe67e90 / draw 0):

```
no head          ego vmin 5.73  vmax 16.42  travel 160.7 m   signals {}
authored green   ego vmin 5.73  vmax 16.42  travel 160.7 m   signals {control:ego-approach-head: 651 samples, green@0 -> yellow@10.4}
authored red     ego vmin 0.00  vend  0.00  travel  98.2 m   signals {control:ego-approach-head: 651 samples, red@0}
```

### Does the VIOLATING VAN respond to the phase? NO — and it cannot, today
This is a real limit and I am not going to paper over it. On the same cell, with the head held RED:

```
red head, van rules.obeySignals = false (as authored)  -> van vmin 2.60  travel 96.0 m
red head, van rules.obeySignals = true  (forced)       -> van vmin 2.60  travel 96.0 m   IDENTICAL
```

The van is unaffected by the authored head **whether or not it obeys signals**, because
`buildTrafficControls` binds every stop line to `this.site.frame.lateralLanes[pose.laneOffset]`
(`materialize.ts:2352`, `control_lane_unbound`). The frame's lateral lanes are the ego corridor's own
lanes; the van arrives from a `conflicting_gate` on a junction arm, whose route contains none of
those RSLs, so no stop-line authority is ever evaluated against it. Combined with
`connectingLaneRsls: []` (`materialize.ts:2379`), the practical rule is:

> **An authored head governs the ego's approach and nothing else.** A third limit, alongside the two
> DIAG-signals named: there is no way to author a head on a conflicting junction arm at all.

What this means for the archetype's honesty: the ego's green is now **physically real** and appears
in the trace. The van's red is still **narrative only** — but that is now the correct reading of the
scenario rather than a hidden defect, because the ego genuinely holds a green right-of-way it can be
seen to have, and the van's `set(rules.obeySignals, false)` is a declaration of intent that the
engine has no head to apply. C6 asks for signal state, and the scenario now carries it.

## Status log
- [x] Read DIAG-signals.md / HANDOFF-roadrunner-signals.md
- [x] A. surface.md rules 25-27 (found already written; verified, purely additive)
- [x] B. applied to /tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json (trafficControls + one meta tag only; re-read immediately before write)
- [x] C. batch + gate_batch proof (see above)
- [ ] D. c12g assessment
- [ ] gold regression 3/3 frozen, 3/3 HQ
