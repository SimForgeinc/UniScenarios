# FINDINGS — training-grade lane

Incremental log. Every number below is command output, not prose. Negatives are recorded as
findings, not hidden.

Worktree `/Users/michaelvu-simforge/Documents/Programming/UniScenarios-training-grade`,
branch `training-grade-lane`. Baseline to beat: DEV admission **0.466** (gate v2), 89 archetypes.

---

## M0 — autonomous gates written, and a blocking build defect found and fixed

### M0.1 The six gates exist under `tools/gates/`

| gate | file | status |
|---|---|---|
| no-relaxation tripwire | `verify_gate_hash.py` | **PASS** |
| determinism | `verify_replay.py` | **PASS** (6/6 bit-identical smoke) |
| typecheck | `pnpm --filter @uniscenarios/cli typecheck` | **exit 0** |
| unit tests | `pnpm --filter @uniscenarios/cli exec vitest run` | see M0.2 |
| C2 probe | `probe_c2.py` | W1 |
| occlusion probe | `probe_occlusion.py` | W2 |

`tg_gate.py` implements the frozen gate; `probe_lib.py` is shared probe plumbing. Every metric is
read from the raw trace. The only summary fields consumed are `verdict`/`band`, which *are* the
`evaluate` outputs C5 is defined over, plus cell coordinates and the trace path.

### M0.2 The gate-hash tripwire, and proof that it fires

Hashing convention, reverse-engineered and confirmed against **both** frozen manifests:

```
sha256(json.dumps({k: v for k, v in gate.items() if k != 'sha256'}, sort_keys=True))
```

```
$ .venv/bin/python tools/gates/verify_gate_hash.py
PASS manifest-v1                                  1a08698e95fca4bc (declared 1a08698e95fca4bc)
PASS manifest-v2                                  3823182614e5a5ba (declared 3823182614e5a5ba)
PASS C1 maxSpeedMps                               manifest 2.000 vs impl 2.000
PASS C1 distance                                  manifest 10.000 vs impl 10.000
PASS C2 margin                                    manifest 0.500 vs impl 0.500
PASS C3 clearance                                 manifest 5.000 vs impl 5.000
PASS C4 decel                                     manifest 1.500 vs impl 1.500
PASS C4 ttc                                       manifest 3.000 vs impl 3.000
PASS C6 statuses                                  ('revealed_before_conflict', 'blocked_at_conflict')
PASS portability >=2 maps/>=3 sites               2 maps / 3 sites
PASS C3 uses true OBB clearance, not minDistance  obb_clearance present: True
GATE-HASH TRIPWIRE: PASS -- frozen gate v1 1a08698e95fca4bc / v2 3823182614e5a5ba unchanged
EXIT=0
```

A tripwire that never fires is the W4 ceremony failure mode, so it was attacked in a throwaway copy
(the real worktree was never mutated):

* **relax the code** `C3_CLEARANCE 5.0 -> 8.0` → `FAIL (1) C3 clearance: implementation 8.000 !=
  pre-registered 5.000`, exit 1.
* **tamper the manifest** `C3 <= 5.0 m -> <= 9.0 m`, leaving the `sha256` field untouched →
  `FAIL (2) v2 sha256 5feef6bfc2bc4787 != frozen 3823182614e5a5ba -- THE GATE CHANGED`, exit 1.

Both vectors are caught, independently. Manifest integrity alone would have missed the first.

### M0.3 DEFECT TG-B0 — the built CLI could not run `batch` at all (fixed)

Minimal reproduction, before any of my changes:

```
$ node packages/cli/bin/uniscenarios.js batch <template> --map yale-street --draws 2 --out /tmp/...
{"code":"internal_error","reason":"Error: Cannot find module
 '.../packages/cli/batch-worker.mjs'"}
0 files written
```

**Cause.** `bin/uniscenarios.js` imports `../dist/main.js`. `commands/batch.ts` spawned its worker
with `new URL('../batch-worker.mjs', import.meta.url)`, correct for the source layout
(`src/commands/` → `src/batch-worker.mjs`) and wrong for the bundled layout, where tsup collapses
everything into `dist/main.js` so `../` resolves to `packages/cli/`. tsup also never copied the
`.mjs` shims, and `--clean` wipes `dist/` every build. `uniscenarios batch` is the core loop of this
lane, so nothing downstream could run. This is the same class as defect F4 in `ALGORITHM.md`.

**Discipline.** Failing test first: `packages/cli/src/__tests__/batch-worker-resolution.test.ts`
→ `Tests 1 failed | 1 passed`, on the assertion that a resolvable shim exists beside the bundled
entry point.

**General fix** (not a per-command patch):
* `packages/cli/src/worker-shim.ts` — `workerShimUrl(name, from)` probes `../name` then `./name` and
  returns whichever exists, so it is correct in *any* layout and fails loudly naming both candidates.
* both `.mjs` shims now detect a built `*-impl.js` beside them and import it directly, else register
  `tsx` and import the `.ts` — one file valid in both layouts.
* `packages/cli/package.json` build adds the two worker impls as tsup entries and runs
  `scripts/copy-worker-shims.mjs`.
* applied to `batch` **and** `catalog batch`, which had the identical bug.

After: `Tests 2 passed (2)`; the same batch command writes 19 files (6 cells) in 1.99 s;
`pnpm -r build` succeeds; `pnpm --filter @uniscenarios/cli typecheck` exits 0.

### M0.4 Footgun 10 verified empirically, not assumed

Throwaway edit to `packages/cli/src/main.ts`, reverted afterwards (`git diff --stat` clean):

```
--- BEFORE build --- "summary":"the five dev maps, their artifacts and catalog revisions"
--- AFTER  build --- "summary":"TGPROBE the five dev maps, their artifacts and catalog revisions"
```

Confirmed: **every edit under `packages/` needs a build before it reaches the CLI.**

---

## M0.5 NEGATIVE FINDING — the round-6 authoring harness is not on disk

This reshapes W7 and is recorded before any work depends on it.

`agent-authoring/TOOL-SURFACE-FROZEN.json` freezes 16 ops at tooldoc sha256 `acd3b247746af7ab`.
`research/edge-case-corpus/tools/scenario_tools.py` is byte-identical in this worktree and in MAIN
(`b5e69bbd98e20210…`) and contains **12** of them. AST analysis:

```
DEFINED: ScenarioBuilder ToolError _add_interaction _add_param _close_lane _explain_failure
         _find_sites _mutcd_taper_len _place_actor _place_prop _require _simulate _use_site
         _validate _write
UNDEFINED FREE NAMES: CATALOG, cli, load_trace, ...
```

Missing entirely: `solve`, `preregister`, `catalog_search`, `narrow_lane`, `reroute_ego`,
`shift_ego_alignment`. `CATALOG`, `cli()` and `load_trace()` are undefined, so **every** op raises
`NameError` when called — the module imports only because Python binds free names lazily.
`round6/results.json` records solved params (`initialGapM`, `arrivalTtc`, `conflictLeadM`) that the
on-disk `place_actor` cannot even express: its non-conflicting branch hard-codes `s: -12`.

`agent-authoring/CHECKPOINT.json` says it plainly: *"the runner is pure Python **in the notebook**;
re-create ScenarioBuilder + TOOLDOC from …"*. That notebook state is gone.

**Consequence, stated honestly.** W7 as literally written — re-author DEV and HELDOUT through *the
round-6 surface* — is not reproducible, because that surface does not exist. Any authoring run I
perform is through a **rebuilt** surface and is therefore not a like-for-like comparison against the
0.466 baseline. W1–W3 and W6 are unaffected: their exit criteria are deterministic engine probes
that need no authoring LLM at all, and measuring a representation change on a fixed probe with
authoring held constant is *stronger* evidence than re-authoring, not weaker.

## M0.6 BLOCKER — no `gpt-5.6-luna` credential in this environment

Re-verified in the first cell, as instructed. The handoff states vault item
`be2othhp7cx3frton4ehddtthq` preflighted HTTP 200. In this shell it does not resolve:

```
$ op item get be2othhp7cx3frton4ehddtthq --format json
No accounts configured for use with 1Password CLI.
$ op whoami
[ERROR] no account found for filter
$ env | grep -iE 'openai|anthropic|api_key|luna'      # (empty)
```

`op` 2.32.1 is installed; `~/.config/op/config` has `"accounts": null`. No `OPENAI_API_KEY` is set.
`tools/vista/vlm.py` reads `os.environ['OPENAI_API_KEY']`, so every authoring/judge call would fail.

Per the brief's credential-hygiene rule I have **not** searched for or reused any key found on disk.
**A freshly issued key is required for W7 and for the blind judge.** W1–W4 and W6 do not need it and
proceed now.

---

## M1 / W1 — warm-up compensation: **EXIT CRITERION MET**

### Result

| exit criterion | required | baseline arm | fixed arm | verdict |
|---|---|---|---|---|
| C2 share of gate failures | < 0.10 (from 0.293) | 0.4497 | **0.0245** | **MET** |
| requested-vs-realised t=0 gap, Pearson r | > 0.90 | 0.9472 | **0.9853** | **MET** |
| median abs gap error | — | 15.556 m | **0.002 m** | ~7800x better |
| gate pass rate on the probe | — | 0.050 (10/200) | **0.180 (36/200)** | 3.4x |

```
$ .venv/bin/python tools/gates/probe_c2.py --arm both --draws 4 --cells 200
--- baseline ---
  strict (v2 manifest) : passed 10/200 (0.050) share={"C2": 0.5316, "C3": 0.0579, "C4": 0.0053, "C5": 0.4053}
  published (baseline) : passed 11/200 (0.055) share={"C2": 0.4497, "C3": 0.1058, "C4": 0.0317, "C5": 0.4127}
  C2 share of failures (published reading, vs 29.3% baseline): 0.4497
  requested-vs-realised gap: r=0.9472  n=200  medianAbsErr=15.556 m
--- fixed ---
  strict (v2 manifest) : passed 36/200 (0.180) share={"C2": 0.4695, "C3": 0.4817, "C4": 0.0305, "C5": 0.0183}
  published (baseline) : passed 37/200 (0.185) share={"C2": 0.0245, "C3": 0.8589, "C4": 0.0552, "C5": 0.0613}
  C2 share of failures (published reading, vs 29.3% baseline): 0.0245
  requested-vs-realised gap: r=0.9853  n=200  medianAbsErr=0.002 m
C2 PROBE GATE: PASS
```

The binding constraint moved from **C2 (spawn artifact, 0.45)** to **C3 (clearance, 0.86)**. That is
the correct place for it: C3 asks "is this actually close?", a solver's job, whereas C2 was rejecting
scenarios for an arithmetic error made before the simulation started.

Gates at this checkpoint: tripwire PASS · gate unit tests 8/8 PASS · determinism **24/24
bit-identical** · `pnpm --filter @uniscenarios/cli typecheck` exit 0.

### The probe (frozen, `tools/gates/probes/`)
Three challenger families spanning the C2-dominant categories — a **stopped obstacle**, a **slow
cyclist**, a **slower lead** — over all five maps, 200 cells, balanced round-robin. The ego closes
and brakes at a pre-registered TTC computed from the *requested* gap. **The two arms are identical
except for the representation under test**; the shared design was fixed before either arm was run
and can show either outcome.

### Three distinct causes, separated by measurement

**(1) Warm-up erosion — confirmed exactly; `D1-RESOLVED.json` is right.**
Trace `t = 0` is the state after `warmupSeconds`. Sweeping warm-up on one fixed site:

| warmupSeconds | realised loss |
|---|---|
| 0 | **0.00 m** (6/6 cells, max err 0.07 m) |
| 1 | 10.61 m |
| 2 | 18.25 m |

With a genuinely moving challenger (cyclist at 4.167 m/s) the law is exact: measured loss
**15.00, 15.01, 14.97, 14.98, 15.04, 14.97, 15.00, 15.04, 14.97** m against a prediction of
`warmup*(v_ego - v_chal)` = **15.00** m — 9/9. Placement itself is exact, so the "hard ceiling near
16-18 m" in `DEFECT-D1-relative-dsM.json` is **refuted**: at warm-up 0 a requested 39.0 m arrives at
39.0 m.

**(2) DEFECT TG-A1 — `initialSpeedKph: 0` does not produce a stationary actor.**
A vehicle authored at 0 kph is driven by its lane-following controller during warm-up and is at
**5.555 m/s (20 kph) at t = 0**, accelerating to 17.5 m/s and covering 79.7 m over the clip. The
instance is correct (`initial.speedMps: 0.000`); warm-up overrides it.

This silently destroys every *parked / stopped / disabled* actor — the mechanism behind C9, C11, C7
and C8, four of the five categories with the highest C2 loss. It also explains the residual 5.1 m in
the erosion arithmetic: the "stationary" car creeps ~5.1 m during warm-up, so the loss reads 18.25 m
where `warmup*v_ego` predicts 23.33 m.

The fix is a **representation change, not a check**: `actor.static: true`. Verified — the challenger
then holds **0.000 m/s** at every tick and the erosion law becomes exact (loss 23.33, 23.33, 23.28
against a prediction of 23.33).

**(3) DEFECT TG-A2 — a site-dependent `dsM` expression clamps the placement.**
Writing the compensation as an expression over `lane.speedLimitKph` re-triggers the hazard
documented at `materialize.ts:665-680`: the structural pass cannot evaluate a site-dependent
expression, evaluates it as 0, builds the lane chain too short, and `projectPoint` then clamps.
Controlled comparison — **same map, same sites, same draws** — differing only in whether the
compensation term is site-dependent:

| compensation form | n | median err | p90 | max | frac err > 1 m | challenger placed BEHIND ego |
|---|---|---|---|---|---|---|
| site-dependent (`lane.speedLimitKph`) | 108 | **11.051 m** | 49.29 | 91.70 | 0.83 | 15 |
| constant | 108 | **0.003 m** | 0.155 | 2.67 | 0.01 | **0** |

This reconciles the two competing D1 accounts: the warm-up arithmetic of `D1-RESOLVED.json` is
correct, *and* the clamp of `DEFECT-D1-relative-dsM.json` is real — but the clamp is triggered by
**site-dependence in the expression, not by the magnitude of `dsM`**. The round-6 surface seeded its
ego at `s = "0 - (clamp(0.7*lane.speedLimitKph,18,42))/3.6*8"` — a site-dependent expression, i.e.
exactly this hazard, on every brief it authored.

**General authoring rule — the W1 deliverable:** *keep `dsM` free of site-dependent terms. Resolve
the warm-up compensation to a constant or a parameter default, never to an expression over `lane.*`.*

### DEFECT TG-G1 — an unsound cull in the gate's own closest-approach search (fixed)

Found while diagnosing the probe; it invalidated my own first two probe runs. The broad-phase cull
read

```python
if centreDist > er + ar + C3_CLEARANCE + 1.0 and best < inf: continue
```

Once *any* clearance was recorded, every later distant tick was skipped, so a trajectory that starts
far apart and closes later keeps its **t = 0** value forever. Measured on a real probe cell: reported
`clearance 39.80 m at t = 0` where the truth was `8.03 m at t = 18.0 s` — wrong on C2 (when) and C3
(how close) at once. Correct cull, now in `tg_gate.py`:

```python
if centre - (er + ar) >= loc['clearanceM']: continue   # provable lower bound; cannot improve
```

Effect on the pilot: median closest-approach time went from `0.00 s` to `17.98 s`. Regression tests
in `tools/gates/test_tg_gate.py` (8/8) pin both directions — a closing trajectory *and* a genuinely
receding one — so the fix cannot silently become a loosening.

**The same unsound cull is present in `research/edge-case-corpus/tools/vista/gate.py:206`**, which
produced the published C2 census and the 0.466 baseline. I have not modified that file — it belongs
to another lane — but any number derived from it should be treated as suspect until re-measured.
Reported, not silently corrected.

### Honest caveat: C2 has two readings, and both are reported
The v2 manifest text says "the closest-approach **and** minTTC events must occur at
`t > warmupSeconds + 0.5`". The brief's own section 3.1, `LANE-CONTRACT.md`, and the
`tools/vista/gate.py` implementation that produced the 29.3% figure all test the **closest-approach
event only**. Under the strict manifest reading the fixed arm still shows a C2 share of **0.4695**,
because `minTTC` legitimately occurs *before* the ego brakes in an approach-then-brake encounter.
Admission (`gate_cell.pass`) uses the **strict** reading — tightening, never loosening. The exit
criterion above is quoted against the **published** reading, because that is what 29.3% was measured
with; quoting the other would not be comparing like with like.
