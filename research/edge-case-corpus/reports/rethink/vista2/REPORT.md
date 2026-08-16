# Stream E — VistaLane: a faithful VISTA-style visual authoring harness

Status: harness frozen after pilot; main run pending. Updated at every milestone.
Owner question this stream answers: does closed-loop VISUAL authoring (the agent sees
the road, places actors by sight, watches rollouts, and plays the frozen gate as a
game) beat the compiler baseline and the text-schema freedom arm on the SAME brief
sample — on admission, on cost, or on realism/dynamism?

## 0. Session integrity

- Frozen-gate tripwire at session start: `PASS manifest-v1 1a08698e95fca4bc / v2
  3823182614e5a5ba` (`tools/gates/verify_gate_hash.py`, run 2026-08-16; also run by
  the harness preflight before every run).
- Vision assertion (in-session, gateway `127.0.0.1:4141`): `gpt-5.6-sol` effort=high
  **PASS** ("sees green", randomized colour probe); per-run preflight repeats this and
  is fatal on FAIL. Anthropic models never touch an image path.
- Branch `tg-rethink`; run outputs under `/tmp/tgr-vista-<runid>/`, never reused.

## 1. Prior-work reconciliation (lead mandate)

- `tools/tg-research/*` (instrument / openvocab / worldgen): **no overlap** with this
  stream — none of it renders scenes for an authoring agent or implements a visual
  action loop. Read `reports/tg-research/PLAN.md` for the shared framing.
- One inherited claim is directly at stake here: that prior lead wrote *"the honest
  mapping [of VISTA] is not 'make the author look at pictures'"* and re-aimed vision
  at judging only. The current owner mandate (stream E) is to test exactly that bet
  with a *faithful* harness rather than the earlier repair-loop strawman. This report
  is the test; either outcome resolves the disagreement with data.
- `research/edge-case-corpus/tools/vista/` (the previous visual attempt): its
  **render primitives are reused** (`render.py`: topology loader, pixel<->world
  transform, nearest-lane projection — proven, and the feasibility of VLM perception
  on these renders was already established there). Its harness design (numeric
  repair loop with images attached at the repair step only) is **superseded**: it
  showed the model images of a scene it never chose, at a moment it never chose, with
  no memory, no notes, no game formulation. VISTA's three pillars were absent.
- W8/W9 (merged mid-session): on the compiler surface, effort does not raise
  admission and sol/low is the production config. Consequence adopted here: the main
  arm stays `sol/high` (the paper's own Codex backend at high effort — assignment
  spec), and the pre-registered secondary cell is `sol/low` on the same briefs — the
  open question W8 cannot answer is whether effort matters once the model has real
  freedom. W8's result is surface-specific and is not treated as universal.

## 2. What was built (tools/research/vista2/)

Four modules, ~1,300 lines total, no packages/ edits:

- `vrender.py` — top-down renders from `dev-assets/<map>/topology-index.json.gz`:
  lanes coloured by type, junction surfaces, route highlight, actor OBBs with heading
  noses and per-actor speed labels, motion trails, metre grid. `semantic_at()` answers
  read_pixels from the topology index (drivable/sidewalk/shoulder/parking/junction/
  off_road + lane width/speed-limit/travel-heading) — ground truth, not colour
  sampling. Keyframe renders use one fixed view per rollout so frames are comparable.
- `vworld.py` — the scene under construction and its PORTABLE template. Placement
  projection: pixel → world → route-arc/lateral → `relative_to` (dsM/dLane/tFrac,
  metric `lateralM` off-carriageway) or ego `on_reference` pose. Calibration per
  working site from the materialized ego's `behavior.route.lanes` chain; round-trip
  error measured 0.0 m (ego spawn reprojects to its authored s exactly). Simplified
  motions compile 1:1 onto schema verbs (speed/route/nearMiss/laneOffset/changeLane/
  gap/set) and the trigger union (at/after/arrival/when) — primitives, not mechanisms;
  criticality still has to be discovered and composed by the agent. `simulate()` =
  instantiate+simulate+evaluate+frozen `tg_gate.gate_cell` at the working site;
  `emit()` = all-maps batch + gate every cell + portability. The emitted template
  contains no coordinates and no road ids (the anchor is a corridor + optional
  feature; all poses are lane-relative).
- `vagent.py` — the VISTA loop. Minimal game prompt (the paper's shape: task, win
  condition, predict/verify instruction, notes instruction) + factual action
  reference + the gate criteria as game rules. One JSON action per turn; EVERY action
  returns PNGs. Lossless memory: every frame's source state is stored; `inspect`
  re-renders any past frame at any region/zoom; frames never expire even when old
  turns' images are pruned from the context window (only the last ~5 turns carry
  pixels — exactly VISTA's KV-cache-vs-visual-memory argument). GUIDE.md persists
  across briefs; WORKING.md per brief; both written only by the agent — no physics
  facts are pre-taught (warm-up erosion, clearance semantics, TTC demand are there to
  be DISCOVERED; that discovery is the experiment).
- `run_vista2.py` — preflight (gate tripwire + vision assert, both fatal), episode
  orchestration, per-brief metrics rows, GUIDE.md snapshots per brief, cell artifacts
  per RETHINK-CONTRACTS §2 from each episode's final emit (for FootageLane).

Action accounting (RHAE analogue): world-touching actions count against the budget
(view_site, place_actor, set_motion, simulate, emit, remove; default budget 40);
read-only looks (inspect, read_pixels) are free, as in VISTA's scoring.

## 3. Shakedown findings (run `shakedown1`, sol/high, 1 brief, budget 14)

The loop plays: the agent enumerated sites, locked one, placed actors by relative
offsets and by pixels (pixel placement projected to `dsM=25.63, tFrac=0.027`),
read pixels to disambiguate surfaces, simulated 5 times, and wrote real, discovered
engine truths into GUIDE.md unprompted — including the warmup/spawn-artifact
threshold and the placement-vs-rollout participation gap. 267 s, 218k input tokens.

Harness defects found and fixed (mechanism-level, never per-brief):
1. **Catalog-id silent death**: short ids ("sedan") pass `template validate` (known
   footgun #7: the CLI is not wired to `isKnownPropCatalogId`) and materialize as
   `static_object`-class actors that die in simulation while showing up at t=0.
   The harness now normalizes short ids and rejects unknown ones with candidates.
2. Motion-argument crashes → clean in-game errors (missing speedKph, bad triggers).
3. Site ordering made deterministic (matcher tie-break is not).
4. CLI exit code 2 (findings) treated as success when the artifact exists — the
   documented CLI contract.

## 4. Pre-registered run design

- Pilot: 3 DEV briefs OUTSIDE the frozen sample (`c1-lead-stopped`, `c5b-runner`,
  `c7b-van-hides-ped`), budget 40, sol/high. Purpose: harness defects only. The
  harness is then frozen by sha256 and never edited during the main run; per-brief
  tuning is prohibited and impossible through the harness surface.
- Main run: ALL 50 briefs of `tools/research/shared/briefs-sample.json` (30 DEV +
  20 owner-list; the exact sample FreeformLane's arms use), sol/high, budget 40,
  fresh GUIDE.md at run start (so cross-brief learning is measured within the run,
  uncontaminated by pilot).
- Secondary cell (owner sweep directive, budget permitting): sol/low on the same 50,
  fresh GUIDE.md — the "does effort matter under real freedom" cell.
- Metrics per brief (from raw traces / transcripts, no summary fields): admitted
  under the frozen gate incl. portability; counted actions (RHAE analogue); turns;
  simulate/emit counts; wall seconds; tokens in/out/reasoning; GUIDE.md snapshot
  diffs; dynamism census (`tools/research/shared/dynamism_census.py`, sha256
  `e22b25d73930804f...`) over emitted cells; cell artifacts for FootageLane's judge.
- Headline observables declared in advance:
  1. admission vs the compiler baseline and FreeformLane's text-schema arm on the
     same sample;
  2. cost multiple vs both arms (tokens and wall);
  3. does the agent discover the C2 warm-up trap in GUIDE.md without being told;
  4. census + footage-judge deltas on admitted cells.
- Falsifiers (verbatim intent): if the visual agent cannot beat the text-schema arm
  on admission OR on realism/dynamism, or burns >5x cost for parity, that is the
  answer to the owner's question and will be stated plainly.

## 5. Results

### 5.1 Pilot (run `pilot1`, sol/high, budget 40) — harness frozen

Command: `.venv/bin/python tools/research/vista2/run_vista2.py --run-id pilot1
--briefs c1-lead-stopped,c5b-runner,c7b-van-hides-ped --model gpt-5.6-sol
--effort high --budget 40 --wall-cap 3600`

**Harness frozen by sha256 `c8ac279cdd26f45b8a393f6be58a4808361987a729e8d74a7839f0254cbe6327`**
(printed by the run preflight; over vrender.py+vworld.py+vagent.py+run_vista2.py;
unchanged for the main run — verified equal before launch).

| brief | admitted | actions | turns | sims | emits | wall s | tok in | tok out | portability |
|---|---|---|---|---|---|---|---|---|---|
| c1-lead-stopped | **YES** | 20 | 20 | 7 | 1 | 315 | 256k | 9.4k | 5 maps / 10 sites |
| c5b-runner | no (C4 demand) | 40 | 42 | 10 | 1 | 671 | 772k | 23.7k | 0 / 0 |
| c7b-van-hides-ped (occlusion, C6 armed) | **YES** | 40 | 45 | 11 | 1 | 674 | 947k | 19.8k | 2 maps / 6 sites |

- Zero harness errors, zero protocol errors across all three episodes (grep over
  transcripts).
- **Headline observable #3 answered on brief 1**: GUIDE.md, written by the agent
  unprompted after observing warmup drift in the renders: *"A vehicle merely placed
  at 0 km/h may move during the 2 s warmup; an at:0 speed interaction stops it at
  rollout start."* It also discovered and recorded the collision-avoidance
  preemption pattern (*"set rules.collisionAvoidance=false at t=0, apply explicit
  TTC-triggered braking, then restore when that braking ends"*), that `static:true`
  props are excluded from TTC/clearance evaluation, and that `cross_path` at t=0 can
  complete during warmup. None of these facts appear in the prompt.
- Emitted-template portability audit: zero coordinates, zero road/lane ids
  (`grep -cE '"(x|y|z)":|rsl|siteId'` = 0 on the winning templates); roles are
  `on_reference`/`relative_to`, anchors corridor+features only.
- Cell artifacts: 88 cells in contract layout at `/tmp/tgr-vista-pilot1/cells/`
  (announced to FootageLane).
- c5b-runner is a clean game loss, not a harness defect: the agent got C1/C2/C3 and
  C5 passing but never generated C4 demand (ego braked too gently) before the budget
  ran out; its single emit at action 40 passed nowhere.

### 5.2 Main run (run `main1`, sol/high, ALL 50 shared-sample briefs)

Command: `run_vista2.py --run-id main1 --briefs sample --model gpt-5.6-sol --effort
high --budget 40 --wall-cap 2400`. Harness sha256 `c8ac279cdd26f45b…` (= frozen pilot
sha, printed by preflight). Fresh GUIDE.md at run start. Sequential episodes (GUIDE
persistence IS the measured cross-brief learning). 6h07m, zero episode errors, zero
protocol failures. Full per-brief table: `metrics-main1.jsonl` (committed beside this
report); numbers below from `analyze.py /tmp/tgr-vista-main1 --census`.

**Headline: 27/50 admitted (0.54) under the frozen gate including portability —
DEV 18/30 (0.60), owner-list 9/20 (0.45; but see the defect below: 11 of the 20
were unwinnable by harness bug, and the agent won ALL 9 unaffected owner briefs.)**

| aggregate | value |
|---|---|
| briefs / admitted | 50 / 27 (0.54) |
| tokens in / out / reasoning | 55.48M / 736k / 420k |
| wall | 6h07m total; mean 440 s/brief; admitted-brief mean 351 s |
| actions | mean 30.2/brief; admitted-brief mean 22.7 (median 20); total-actions-per-admitted 55.9 |
| engine passes | 234 simulates, 154 emit batches |
| cells produced (final emits) | 1,086 (contract §2 layout, `/tmp/tgr-vista-main1/cells/`) |

Per-category (admitted/briefs): C1 2/2, C2 1/2, C3 1/3, C4 1/1, C5 2/2, C6 2/2,
C7 0/2, C8 2/2, C9 2/2, C10 0/2, C11 0/2, C12 0/2, C13 2/2, C14 2/2, C15 1/2;
owner: adversarial 1/3, control-anomalies 1/3, erratic 2/3, map-divergence 2/3,
negotiation 0/2, occlusion-visibility 1/2, sudden-hazards 1/2, weather 1/2.

**The learning curve is real and visible.** First briefs: 40 actions, 600-750 s,
repeated experiments. After GUIDE.md matured: `c6b-cargo-bike` admitted in 8 actions
/ 95 s, `c1b-multi-brake` 10/136 s, `c3b-late-yield` 11/160 s,
`owner-…-snowbanks` 10/100 s, `owner-…-fog` 10/141 s. The mechanism is exactly
VISTA's: durable notes + immediate visual verification of a first-try plan.

**Genuine category unlock — constructed features.** `c8-taper-merge` and
`c8-construction-junction` (compiler: 0 sites map-wide, category written off as map
inventory) were admitted portably by BUILDING the work zone: four
`construction.channelizer_drum` props placed visually as a taper (dsM/tFrac
80/-0.95 → 104/-0.7 in the anchor frame) plus a pickup cut-in that moves traffic
inward ahead of the ego. Rows of the owner list that were "unhostable by map
inventory" are partially constructible after all — by an agent that can see.

**Provenance honesty (correcting my own mid-run note).** The two C13.control
admissions are NOT signal-mechanism scenarios. The agent systematically probed
signal-phase keys (GUIDE.md records ten rejected owner-scope spellings), concluded
they were unusable from its action surface, and won with a braking-lead mechanism
instead. Census over all 1,086 emitted cells: `signalPhaseChanges = 0`. The frozen
gate certifies criticality+portability, not mechanism provenance — the visual arm
has the same provenance gap the compiler corpus has (34.8% in W7). FootageLane's
judge on my cells is the instrument that will quantify mine.

**Post-freeze harness defect, disclosed and quantified.** Anchor ids were derived
from brief ids; 11 owner-list briefs have ids long enough that the anchor id
exceeded the schema's 64-char bound — `template validate` rejected EVERY emit, so
those 11 episodes were mathematically unwinnable (they also tripped a
simulate-without-site crash path, wasting further actions). The 9 owner briefs with
short ids went **9/9 admitted**. All 30 DEV briefs were unaffected. Fixed as
harness v2 (`b08de7d453e6a944…`), agent surface unchanged (bounded anchor id +
crash→game-message); main1 results above stand AS MEASURED under v1; a labeled
supplementary run of exactly the 11 sabotaged briefs (v2, sol/high, seeded with
main1's final GUIDE) is reported in §5.3.

**Dynamism census** (frozen shared implementation sha256 `e22b25d73930804f…`,
n=1,086 cells): actorCount mean 2.25 (max 4); interactingPairs 1.24; hardBrakeEvents
in 86.4% of cells; swerveEvents in 16.8%; laneChangesExecuted in 5.0%;
signalPhaseChanges 0; ambientCount 0 (ambient traffic is not in the action set —
a deliberate scope cut, and an honest limitation vs EmergentLane's arm).
Per-cell rows: `census-per-cell.json` in the run dir.

**Visual confabulation (falsifier-side evidence).** GUIDE.md also contains a wrong
"discovery": the agent interpreted renderer texture as brief-specific weather
("Snow-covered lane markings … rollout views showed irregular accumulation covering
nearly all painted lines"). The renderer draws no lane paint and no weather. The
perception channel that finds real spatial defects also invites over-reading;
judged-realism claims from this arm must be externally validated (FootageLane).

### 5.3 Supplementary run: the 11 defect-affected owner briefs (harness v2)

Command: `run_vista2.py --run-id main2ownerfix --briefs <the 11 ids> --model
gpt-5.6-sol --effort high --budget 40 --guide /tmp/tgr-vista-main1/GUIDE.md`
(continuation of main1's learning trajectory, labeled; harness v2
`b08de7d453e6a944…`). 57 min, 10.4M input tokens.

**9/11 admitted.** Mean 19 actions per admitted brief; `newly-painted-lanes` in 10
actions / 87 s at 4 maps / 10 sites. Losses: `human-intentionally-confusing-an-av`
(C4 demand never achieved) and `blind-crest-of-hill` (2 maps / 2 sites — one site
short of portability; crest occlusion exists on too few mapped corridors).

**Corrected owner-list picture: 18/20 admitted** (9/9 unaffected in main1 + 9/11
here). Rows the compiler pipeline never reached — police manually directing traffic,
double-parked negotiation, texting drift, freeway-shoulder reversing, snow-altered
geometry — admitted portably. Combined sample admission, honestly labeled
(39 briefs under v1 + 11 under v2): **36/50 = 0.72**.


### 5.4 Effort cell: sol/low, same 50 briefs

(pending — relaunch under harness v2 after §5.3)
