# Stream B — FootageLane: footage review at scale (owner mandate)

Status: **pipeline ready; calibration in progress.** Updated incrementally per contracts §8.
Branch `tg-rethink`. Gate tripwire at session start: PASS (v1 `1a08698e95fca4bc` / v2 `3823182614e5a5ba`),
command: `.venv/bin/python tools/gates/verify_gate_hash.py`.

Pre-registration: [`PREREG-v2.md`](PREREG-v2.md) — supersedes
`tools/tg-research/instrument/PREREG.md` (prior lead session; never produced a measured
result). Per-element reuse/supersede table is in the prereg. One-line summary: their
broken templates + marker metrics are REUSED verbatim (sha-pinned); their filmstrip
judge path is SUPERSEDED by `scripts/render-trace.mjs --redact --dev-assets`
(EngineLane underlay, commit `8acd6e5`) because the assignment consolidates rendering
there; their AUC ≥ 0.8 success threshold is kept unchanged.

## 1. Pipeline (tools/research/footage/)

```
cell/{instance.json,trace.json.gz,meta.json}          (contract §2, built by build_calibration.py
        |                                              or published by Streams A/C)
        v
render_cells.py  -> cell/render/{frames/*.png, rollout.mp4, render-manifest.json}
        |            node scripts/render-trace.mjs --redact --dev-assets dev-assets
        |            frame plan: 12 uniform + 6 conflict-centred times (deterministic)
        v
judge.py         -> contract-§3 verdict (blind: rubric + PNGs only; strategies spread8|burst6)
        v
calibrate.py     -> pilot (freeze strategy) -> grid {luna,sol,terra}x{low,med,high} -> AUC
```

- Renderer consumption, not a new renderer: lane/junction/crosswalk underlay and the
  `--redact` flag (suppresses actor ids + minTTC/reveal HUD text — gate metrics the
  judge must never see) were requested from and landed by EngineLane (`8acd6e5`).
  Only `t=<sim seconds>` text remains on redacted frames.
- Vision discipline: `assert_vision.py` randomized-colour probe per model per process,
  ≤3 attempts, all attempts recorded in run artifacts; fatal on exhaustion.
  Env required: `OPENAI_BASE_URL=http://127.0.0.1:4141/v1 OPENAI_API_KEY=x`
  (without it the probe correctly failed against api.openai.com — verified 401, fatal).

## 2. Dependency + smoke evidence (all commands exact)

- `sharp` resolves in-workspace (`node_modules/.pnpm/sharp@0.34.5`); `ffmpeg` at
  `/usr/bin/ffmpeg`. No local installs needed.
- Batch smoke: `node packages/cli/bin/uniscenarios.js batch examples/multiple-threat.template.json
  --map yale-street --draws 2 --out /tmp/tgr-footage-smoke` → 8 cells, 2.1 s.
- Render smoke (pre-underlay): `pnpm trace:render --instance .../draw-000.instance.json
  --trace .../draw-000.trace.json.gz --out /tmp/tgr-footage-smoke/render-000` → 4 PNG + MP4, 0.6 s.
- Contract-cell render smoke (underlay + redact):
  `.venv/bin/python tools/research/footage/render_cells.py /tmp/tgr-footage-smoke/cellsmoke
  --redact --dev-assets dev-assets` → 18 frames + rollout.mp4, 2.2 s, `redacted: true`
  in render-manifest.json.
- Judge smoke (real gateway call): `OPENAI_BASE_URL=http://127.0.0.1:4141/v1 OPENAI_API_KEY=x
  .venv/bin/python tools/research/footage/judge.py <cell> --model gpt-5.6-sol --effort low
  --strategy spread8` → valid §3 verdict (realism 6, dynamism 3, plausible true, defects [],
  4256+602 tokens, 13.6 s). Description correctly narrates ego + pedestrian + empty road.

## 3. Selection rule (declared before any measured verdict — also in PREREG-v2)

adequate(arm) := realism AUC ≥ 0.80 AND bootstrap-95% CI lower bound ≥ 0.70.
Chosen judge := cheapest adequate arm by mean total tokens/cell
(ties: latency, then lower effort, then sol<luna<terra). No adequate arm → calibration
FAILED, scaling does not run, finding reported plainly.

## 4. Calibration set (built; judging pending renderer glyph fix)

Run dir `/tmp/tgr-footage-calib1`. Commands (exact):

```
.venv/bin/python tools/research/footage/build_calibration.py --run /tmp/tgr-footage-calib1 --run-id calib1
# wave 2 (see PREREG-v2 amendment): 12 more mechanism templates, resample with same seed
rm -rf /tmp/tgr-footage-calib1/cells /tmp/tgr-footage-calib1/labels.json
.venv/bin/python tools/research/footage/build_calibration.py --run /tmp/tgr-footage-calib1 --run-id calib1 --skip-batch
.venv/bin/python tools/research/footage/render_cells.py /tmp/tgr-footage-calib1/cells --redact --dev-assets dev-assets --workers 4
```

Result: **24 good** (28 candidates; 7 templates: oncoming-overtake 8, c7-bus-shelter-fixed 7,
c7-hedge-corner-fixed 3, right-turn-crosswalk 2, cut-in-brake 2, lead-hard-brake 1,
delivery-double-park 1) / **24 absurd** (140 candidates; c7-*-baseline 16, b2-zero-kph 5,
b1-frozen-ego 3), marker-verified per PREREG-v2. Exclusion census (good candidates):
C5 44, C4 34, C2 28, C1 16, C3 9 (from set-manifest.json). Renders: 48/48 in 22 s
(4 workers), redacted, underlay on.

**Instrument fixes forced by the first (VOID) pilot** — all three were "the judge cannot
physically see the evidence" bugs, found because pilot-v1 AUCs sat at chance (~0.50)
and the verdicts' `mechanismObserved` text said why ("no visible EGO vehicle"):

1. **Kind glyphs** (`c2af2bf`, refined by EngineLane `194fc1f`): glyphs keyed off literal
   id `ped`; real cells use `vru` etc., so pedestrians drew as ~4 px unclassed boxes.
   Now keyed off `trace.header.actorMetadata[id].kind` (single-sourced, tested).
2. **Follow-ego camera** (`5873bce`): the minTTC-pair-midpoint camera drifts off EVERY
   actor as the pair separates; frozen-ego cells rendered as empty road mid-clip
   (`minTTC` can be entirely absent). `--camera follow-ego` centres each frame on the ego.
3. **Spawn-window frames** (`5873bce`): VRU-in-occluder overlap exists only at VRU spawn;
   a conflict-centred plan never sampled it. Every non-ego actor's first-present time
   (+0.6/+1.2 s) is now in the plan, label-blind, for all cells.

Pilot v1 (72 verdicts) is VOID per PREREG-v2 amendment 3 (kept at
`pilot-verdicts-VOID-v1.jsonl`; its chance-level result measured the broken instrument,
not the judge). Rubric legend aligned to the final glyph legend and frozen before pilot v2.

### Pilot v2 (measured, `calibrate.py pilot --run /tmp/tgr-footage-calib1 --workers 12`)

12 cells (6 good / 6 absurd, stratified) × {spread8, burst6} × 3 models @ medium:

| strategy | mean realism-AUC | per-model (luna/sol/terra) | mean tokens |
|---|---|---|---|
| **spread8 (frozen)** | **0.801** | 0.750 / 0.722 / 0.931 | 5073 |
| burst6 | 0.731 | 0.694 / 0.764 / 0.736 | 3968 |

Pick per pre-registered rule (higher mean AUC): **spread8**. Grid (48 cells × 9 arms =
432 blind verdicts) launched with the frozen strategy.

### Grid result — CALIBRATION PASSED (the load-bearing table)

Commands: `calibrate.py grid --run /tmp/tgr-footage-calib1 --workers 12` (432/432 verdicts,
0 errors, 835 s wall) then `calibrate.py analyze --run /tmp/tgr-footage-calib1`.
Realism AUC (good vs absurd, Mann-Whitney; CI = 1000-draw bootstrap, seed 20260816):

| arm | realism AUC | 95% CI | dyn AUC | good μ/med | absurd μ/med | plaus G/A | defect G/A | tok/cell | lat |
|---|---|---|---|---|---|---|---|---|---|
| luna/low | 0.665 | [0.52, 0.80] | 0.688 | 6.04/6 | 5.21/6 | .96/1.00 | .17/.25 | 4636 | 7.7s |
| luna/medium | 0.801 | [0.68, 0.90] | 0.709 | 6.62/7 | 4.83/5 | .96/.88 | .17/.42 | 5130 | 16.8s |
| luna/high | 0.695 | [0.55, 0.84] | 0.694 | 6.71/7 | 5.46/6 | 1.00/.79 | .12/.50 | 7637 | 61.6s |
| sol/low | 0.763 | [0.61, 0.89] | 0.763 | 6.71/7 | 5.21/6 | .92/.96 | .21/.54 | 4601 | 7.8s |
| **sol/medium** | **0.853** | **[0.75, 0.95]** | 0.779 | 6.96/7 | 4.88/5 | .96/.83 | .17/.62 | **4934** | 14.0s |
| sol/high | 0.872 | [0.75, 0.97] | 0.859 | 7.29/8 | 4.92/5 | .96/.71 | .12/.79 | 5719 | 27.9s |
| terra/low | 0.803 | [0.68, 0.91] | 0.664 | 6.46/7 | 4.75/5 | .96/.79 | .12/.50 | 4807 | 12.0s |
| terra/medium | 0.862 | [0.75, 0.96] | 0.622 | 6.75/7 | 4.58/5 | .92/.62 | .08/.67 | 4987 | 16.0s |
| terra/high | 0.888 | [0.79, 0.96] | 0.742 | 6.67/7 | 4.25/5 | .92/.50 | .08/.54 | 5733 | 30.2s |

- **Adequate arms** (AUC ≥ 0.80 ∧ CI-lo ≥ 0.70): sol/medium, sol/high, terra/medium,
  terra/high. **Chosen judge: `gpt-5.6-sol / medium / spread8`** (cheapest adequate,
  4934 tok/cell — rule declared in PREREG-v2 before any verdict).
- **Effort DOES buy judge discrimination** (contrast W8's authoring result): low→medium
  is +0.09-0.14 AUC on every model; medium→high adds +0.02-0.03 for sol/terra at ~15%
  more tokens and ~2× latency, and **hurts luna** (0.80→0.70). The W8 "effort buys
  nothing" finding is authoring-surface-specific, not universal.
- **Score distributions overlap in the 6-7 band** (chosen arm: good sorted
  [4,4,5,5,6,6,7×7,8×11], absurd [1,2,3,3,3,4,4,4,4,5,5,5,5,6×8,7,7,7]); Youden-J
  threshold 7 → tp 18 fn 6 fp 3 tn 21 (J = 0.625). The instrument RANKS reliably but a
  hard per-cell accept/reject cut costs ~12% error each way.
- **Per-broken-class (chosen arm)**: frozen-ego caught decisively (mean realism 2.0);
  zero-kph 4.6; the five c7 VRU-in-occluder baselines are the weak class (5.2-6.3;
  worst hedge-corner 6.3 — after the VRU emerges, the scene looks normal; the overlap
  moment is 1-2 frames). Defect-flag rate on absurd: 0.62 (sol/medium).
- **Inter-model agreement** (Spearman on realism, 48 common cells): sol~terra
  0.72 (medium) / 0.83 (high); luna~sol 0.44-0.55; luna~terra 0.52-0.56. Not chance —
  falsifier "agreement near chance" is CLEARED; luna is the outlier judge.
- Vision preflight: all 3 models PASS in-session (randomized colours; terra passed on a
  green probe first try). visionAsserted=true on all 432 verdicts; judgeErrors 0.

### Falsifier verdicts (plan §3B), stated plainly

1. *"Judge cannot separate calibration classes"* — **FALSIFIED** (calibration PASSED):
   4 of 9 arms adequate; best CI-lo 0.79. Footage review is NOT ceremony on this render.
2. *"Inter-model agreement near chance"* — **FALSIFIED** for sol~terra (ρ 0.72-0.83);
   PARTIAL for luna (ρ ~0.5 with others and weakest AUCs — do not use luna as sole judge).
3. *"Verdicts uncorrelated with deterministic absurdity markers"* — **MIXED**: strong on
   frozen-ego/zero-kph (kinetic markers), weak on VRU-in-occluder (geometric overlap,
   1-2 frame visibility). What the render lacks for that class: an explicit overlap cue —
   options: outline flash on OBB intersection (deterministic, label-blind), higher fps
   burst at spawn, or 3D tier. Filed for EngineLane consideration; NOT added mid-run.

## 5. Scaled run (judging blocked on calibration PASS; cells regenerated)

```
.venv/bin/python tools/research/footage/scale_run.py w7 --run /tmp/tgr-footage-scale1 --calib /tmp/tgr-footage-calib1 --rows 24
```

W7-luna DEV decision-replay regeneration (no LLM: committed final decision dicts through
the frozen `author_llm.COMPILERS`): 24 rows sampled stratified by (admitted, category)
seed 20260816 → **170 cells** (12 admitted rows → 103 cells incl. 28 gate-PASS; 12
rejected rows; per-cell first-failure census C5 46 / C4 31 / C3 29 / C2 21 / C1 15).
Two rows produced 0 ok cells (c7b-truck-hides-oncoming, c8-construction-junction —
site-infeasible on regen). Sibling roots from FreeformLane/EmergentLane will be added
via `scale_run.py roots --roots <dir>` as announced over hub; frozen judge + strategy;
inter-model agreement measured on every 3rd cell with all three models.

## Cost ledger (updated per stage)

| stage | calls | tokens in/out | wall |
|---|---|---|---|
| smoke | 1 judge + 1 probe | 4256/602 (+probe) | 15.7 s |
