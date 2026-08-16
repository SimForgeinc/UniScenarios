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

### 5.2 Main run (sol/high, 50 shared-sample briefs)

(running — hub process `vista2-main`, output `/tmp/tgr-vista-main1/`)
