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

**Blocking observation (filed to EngineLane):** `render-trace.mjs` keys glyphs off the
literal actor id (`ped` → red disc); real cells use ids like `vru`, so pedestrians drew
as ~4 px green boxes — invisible to any judge. Fix requested (glyph from
`trace.header.actorMetadata[id].kind`); calibration pilot deliberately NOT started on
illegible frames.

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
