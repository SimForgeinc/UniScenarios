# WS-4b — Signal Authoring (M4.3)

## BOTTOM LINE

**M4.3 DONE. `c15g-red-light-runner` now authors its own working traffic light: signal state goes
from 100/671 simulated cells (14.9%) to 671/671 (100.0%), C6 losses from 571 to 0, and full frozen-gate
admission from 0 cells to 95 cells (95 HQ, 3 maps x 8 sites, `admitted: True`) — with the physics
unchanged.** The 95 cells that pass are cell-for-cell the same 95 that already passed C1–C5 in the
base (symmetric difference 0); 591 of 671 cells have ego travel identical to within 5 cm. So the
entire 0 → 95 swing is C6 and only C6: the fix repairs a mislabelling, it does not buy passes.
`c12g-red-pedestrian-phase` was cheap and is fixed the same way: 60/598 → **598/598** signal state,
C6 losses 538 → 0, ego travel **bit-identical on all 598 cells**. Between them that is the whole
88-scenario, 30%-of-corpus C6 hole closed at the template layer — no engine change, no map change, no
anchor change, no gate change. Gold regression re-verified **3/3 frozen, 3/3 HQ, every loss count 0**.

The ego demonstrably obeys the authored phase (flip it to red and median ego travel drops 115.80 m →
65.90 m, full halts 176 → 402 of 671, gate admission 95 → 0). **The violating van does not and cannot**:
authored stop lines are bound to `site.frame.lateralLanes[laneOffset]` only, so a head can never be
placed on the conflicting junction arm the van arrives from — a third limitation on top of the two
DIAG-signals already named.

`surface.md` rules 25–27 were already written by the previous agent; I verified them against the code,
replaced rule 25's provisional draws=4 numbers with the full harvest-setting measurements above, and
added two new bullets to rule 27 (you cannot give the violator a light + how to size phases to the
clip, with the measured 95-vs-83 tradeoff). Deliverables B, C and D are mine.

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

## D. c12g-red-pedestrian-phase — YES, cheap, and it is done
Same recipe, one difference: this template's `conflict-junction` feature is `preferred`, so binding a
stop line to it would raise `control_feature_unbound` on any site where the feature does not match.
**Omit `feature` entirely** — `buildTrafficControls` then uses offset 0, i.e. the frame origin
(`materialize.ts:2345`), which every site has. Phases sized to the 8 s clip (ego spawns at s=-35 at
45-58 kph and crosses a line at s=-20 about 1 s in):

```json
"trafficControls": [{
  "id": "ego-approach-head", "kind": "normal_signal",
  "pose": {"laneOffset": 0, "s": -20, "tFrac": 0, "headingOffsetRad": 0},
  "stopLines": [{"pose": {"laneOffset": 0, "s": -20, "tFrac": 0, "headingOffsetRad": 0}}],
  "phases": [{"indication": "green", "durationS": 6}, {"indication": "yellow", "durationS": 2},
             {"indication": "red", "durationS": 30}],
  "offsetS": 0, "loop": false
}]
```

Measured, same `--all-maps --draws 20 --max-sites 8` on both arms (598 cells simulated of 800; the
other 202 are `unknown_site`/`arrival_unconverged` in *both* arms):

| | BASE | TREATMENT |
|---|---:|---:|
| cells with signal state | 60 / 598 = 10.0% | **598 / 598 = 100.0%** |
| C6 losses | 538 | **0** |
| cells with ego travel identical to base | — | **598 / 598** |
| phases present in the trace | — | `green → yellow → red` on every cell |

**Physics is bit-identical on every single cell** (median ego travel 37.1795 m in both arms, 598/598
unchanged), because the line sits 20 m upstream of the conflict and the ego is through it on green
before the child moves. c12g additionally shows a **complete three-colour cycle** inside the clip.

Applied to `/tmp/vista-gen3-blind/c12g-red-pedestrian-phase-blind/template.json` (same discipline:
re-read immediately before writing, only `trafficControls` and one `meta.tags` entry touched).

Caveat, stated plainly: this template passes **0** cells of the frozen gate in *both* arms in this
batch — it is dominated by C5 (`evaluate` verdict, 576 losses) and `Q8_noBodyOverlap` (424), which
are pre-existing problems of the archetype and are **not** in WS-4b's scope. What the fix buys is
that its 26 delivered scenarios stop being mislabelled: they no longer fail C6.

## Phase-timing tradeoff, measured (why green 11 / yellow 3 / red 30 and not a full cycle)
The 13 s clip cannot show all three colours *and* keep the ego on green through the conflict. Both
variants measured over the same 671 cells:

| c15g phase plan | phases in the trace | gate passes | sites | cells identical to base |
|---|---|---:|---:|---:|
| **green 11 / yellow 3 / red 30 (shipped)** | `green → yellow` | **95** | 8 | 591 / 671 |
| green 9 / yellow 3 / red 30 | `green → yellow → red` | 83 | 7 | 479 / 671 |

Pulling yellow 2 s earlier catches slower egos at the line and costs 12 cells and a site. C6 only
requires signal *state*, so the shipped plan takes the 12 cells. (c12g's 8 s clip happens to fit a
whole `green → yellow → red` cycle for free, and does.)

## Limits of authored heads (three, not two)
1. `stopLines[].connectingLaneRsls` is hard-coded `[]` (`materialize.ts:2379`) — a head stops **every**
   movement over its line; a protected-turn-only head is inexpressible.
2. `darkFallback` / `darkDwellS` are parsed (`traffic-controls.ts:64,66`) and never copied onto the
   `SignalProgram` (`materialize.ts:2380-2390`) — an `off` phase always falls back to all-way-stop
   with a 1 s dwell. Do not build a blackout scenario on them.
3. **NEW (this measure).** Every stop line is projected onto `site.frame.lateralLanes[pose.laneOffset]`
   (`materialize.ts:2352`). Those are the ego corridor's own lanes, so **an authored head cannot be
   placed on a conflicting junction arm at all** — a violator arriving through a `conflicting_gate`
   can never be governed by one, whatever its `rules.obeySignals` says. Verified directly: red head,
   van forced `obeySignals: true`, van travel 96.0 m — identical to `obeySignals: false`.

## Files
- `/tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json` — **patched** (trafficControls +
  one `meta.tags` entry; nothing else. Re-read immediately before write, so a concurrent ANCHOR edit
  by `ws1b-placefit-2` is preserved. Post-write structural diff confirmed exactly two changed keys.)
  `template validate --map belmont-research-center` → ok, 0 errors.
- `/tmp/vista-gen3-blind/c12g-red-pedestrian-phase-blind/template.json` — **patched**, same discipline.
  (Its `template validate` reports 1 error, `runway_insufficient` on one belmont site — **pre-existing**,
  identical on the unpatched base.)
- `newcaps/c15g-red-light-runner-signals.template.json`, `newcaps/c12g-red-pedestrian-phase-signals.template.json`
  — in-repo copies of the patched templates.
- `newcaps/ws4b-apply-signal-block.py` — idempotent, concurrency-safe patcher (re-reads before write,
  mutates only `trafficControls` and `meta.tags`).
- Batch artefacts: `/tmp/ws4b/batch-{base,treat,redhold,green9,c12-base,c12-treat}/`,
  probe traces `/tmp/ws4b/t{0,1}.trace.json`, `/tmp/ws4b/t{2-redhold,3-redhold-vanobeys}.trace.json`,
  probe script `/tmp/ws4b/probe.py`.

## Constraints honoured
- **No gate clause loosened.** `gate.py` untouched by me (`git diff` shows only the previous agent's
  C6 addition). Every number above comes from `gate.gate_batch` as-is.
- **No golden re-baselined.** `/tmp/vista-final-reg/batch-summary.json` re-gated: `passingCells 3/3`,
  `passingCellsHQ 3/3`, `admitted True`, `admittedHQ True`, all C1–C6 losses 0, all Q1–Q8 losses 0,
  `signalIntent False` (C6 correctly inert on the gold brief).
- Nothing written under `/Users/maikyon/...`.

## Status log
- [x] Read DIAG-signals.md / HANDOFF-roadrunner-signals.md
- [x] A. surface.md rules 25-27 verified and extended (+28/-5 lines: real harvest-setting numbers in rule 25, two new limit/tradeoff bullets in rule 27)
- [x] B. applied to /tmp/vista-gen3-blind/c15g-red-light-runner-blind/template.json (trafficControls + one meta tag only; re-read immediately before write)
- [x] C. batch + gate_batch proof (see above)
- [x] D. c12g assessment — fixed, see above
- [x] gold regression VERIFIED unchanged: `gate.gate_batch('/tmp/vista-final-reg/batch-summary.json')` -> passingCells 3/3, passingCellsHQ 3/3, admitted True, admittedHQ True, all lossCounts 0, all qualityLoss 0, signalIntent False (C6 inert on the gold, as designed)
