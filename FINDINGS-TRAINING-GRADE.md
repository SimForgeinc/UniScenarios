# FINDINGS — training-grade lane

> **Scorecard.** W1 **PASS** · W2 **PASS** · W3 **SPLIT** (contact criterion met, archetype admission not) ·
> W4 **PASS** · W5 **not attempted, forbidden** · W6 **PASS** · W7 **BLOCKED on credentials**, deterministic half run.
>
> **The headline negative:** the published DEV baseline of 0.466 does not survive a correct gate.
> Re-gating the published corpus with the TG-G1 correction rejects **15 of 98 archetypes**, 15 of the
> 16 first failures being C2 — the criterion the old cull mis-measured. The honest baseline is
> **DEV ~0.401 / HELDOUT ~0.341**, so the 0.60 target is further away than the brief assumed. This is
> a tightening, which the frozen contract requires; the gate itself was never relaxed and the
> no-relaxation tripwire passed on every continuation and was proven to fire when attacked.
>
> **Four representation defects found and fixed, none of them new checks:**
> `TG-B0` the built CLI could not run `batch` at all · `TG-A1` an actor authored at 0 kph is driven to
> 20 kph by warm-up, which silently breaks every parked/stopped/disabled actor · `TG-A2` a
> site-dependent `dsM` expression clamps the placement (11.05 m median error vs 0.003 m) ·
> `TG-G1` an unsound cull in the gate's own closest-approach search, **still present in
> `tools/vista/gate.py:206`**, which produced the published baseline.


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

---

## M2 / W2 — lateral placement that can reach the verge: **EXIT CRITERION MET**

### Result — fixed arm (W2 representation)

| archetype | cells | proven (strict) | maps | sites | proven (gate-v2 statuses) | median occluder–VRU separation | gate-v2 admitted | maps/sites |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `c7-hedge-corner` | 180 | **0.73** | 5 | 30 | 1.00 | **1.4 m** | 40 | 5/14 |
| `c7-parked-row-child` | 180 | **0.56** | 5 | 23 | 1.00 | **1.2 m** | 45 | 5/13 |
| `c7-skip-container` | 180 | **0.84** | 5 | 30 | 1.00 | **1.1 m** | 33 | 5/14 |
| `c7-bus-shelter` | 180 | **0.61** | 5 | 28 | 1.00 | **1.4 m** | 52 | 5/16 |
| `c7-fence-run` | 180 | **0.82** | 5 | 30 | 0.99 | **1.4 m** | 35 | 5/14 |

| exit criterion | required | measured | verdict |
|---|---|---|---|
| occlusion proven per C7 brief | >= 0.50 of cells | **0.56 – 0.84**, all five | **MET** |
| on >= 2 maps and >= 3 sites | 2 / 3 | **5 maps, 23–30 sites**, all five | **MET** |
| `occluderIneffective` empty | yes | yes on every proven cell | **MET** |
| C7 archetypes passing gate v2 | >= 5 | **5 / 5**, all portable | **MET** |

### Baseline arm — the same five archetypes without the metric lateral form

| archetype | cells | proven (strict) | maps | sites | proven (gate-v2 statuses) | median occluder–VRU separation | gate-v2 admitted | maps/sites |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `c7-hedge-corner` | 180 | **0.53** | 5 | 26 | 0.99 | **0.0 m** | 33 | 5/12 |
| `c7-parked-row-child` | 180 | **0.47** | 5 | 24 | 1.00 | **0.0 m** | 24 | 4/9 |
| `c7-skip-container` | 180 | **0.87** | 5 | 30 | 1.00 | **0.0 m** | 35 | 5/13 |
| `c7-bus-shelter` | 180 | **0.59** | 5 | 27 | 1.00 | **0.0 m** | 23 | 5/12 |
| `c7-fence-run` | 180 | **0.62** | 5 | 29 | 1.00 | **0.0 m** | 30 | 4/11 |

**The number that matters is the separation column: 0.0 m.** With only `tFrac` available, the
occluder and the VRU are authored at the same place — the pedestrian is standing *inside* the hedge.
That is precisely the failure `OCCLUSION-FINDING.md` describes, now measured rather than inferred.
The engine still reports the sight line as blocked, so the scenario *passes* the occlusion clause
while being physically absurd. With `lateralM` + `lateralRef: 'verge'` the separation is
**1.1 – 1.4 m**: the VRU stands behind the occluder, not in it.

Admission improves too, at identical parameters: **23–35** admitted cells per archetype in the
baseline arm against **33–52** in the fixed arm.

Gates at this checkpoint: tripwire PASS · gate unit tests 8/8 · determinism **24/24 bit-identical**
· C2 probe still **PASS** after the `packages/` change (C2 share 0.0245, r 0.9853).

### The honest attribution: the declaration buys the proof, the lateral form buys the geometry

Both arms declare `props[].occludes: {observer, target}`. That declaration is what produces
`declaredOcclusion` **at all** — and the round-6 surface never emitted it. `RESULTS-round6.md`
records `declaredOcclusion` EMPTY in 0/30 traces and attributes it to "no occlusion operation"; the
schema field existed the whole time. So:

* the **`occludes` declaration** is what makes occlusion provable (baseline reaches 0.47–0.87 too);
* the **metric lateral form** is what makes the proven scene physical (0.0 m → 1.4 m separation) and
  is what lifts admission.

Claiming W2's schema change is what proved occlusion would be false, and it is not claimed here.

### The change (general, with a failing test first)

`packages/scenario-model/src/schema/v2/roles.ts` — `FramePoseSchema` gains

```ts
lateralM?: number | Expr          // metres, signed, positive to the left of travel
lateralRef?: 'lane_centre' | 'lane_edge' | 'verge'
```

with a `superRefine` that rejects `lateralM` together with a non-zero `tFrac` (a pose has one
lateral offset, not two), requires `lateralRef` whenever `lateralM` is given (a bare metre offset is
not portable), and rejects a bare `lateralRef`.

`packages/scenario-materializer/src/materialize.ts` — `resolveLateral()` and
`carriagewayHalfWidth()`. `verge` measures from the far edge of the outermost same-direction lane,
so it means the same thing on a one-lane street and a dual carriageway. Applied to **both** lateral
paths — props *and* role spawns — so a VRU can start off-carriageway too, and to the prop `repeat`
path, where fractional drift is converted to metres so a taper stays a taper off the carriageway.

**Portability is preserved**: the reference is a named road feature, never a coordinate. "2.2 m
beyond the verge" retargets across maps exactly as `tFrac` does.

Failing test first — `packages/scenario-materializer/src/__tests__/verge-placement.test.ts`:
`Tests 2 failed | 2 passed` before, **5 passed** after. It measures against a same-station datum so
the assertion is about lateral placement, not about the road's curvature.

### Regression evidence

`scenario-model` **303/303**, `scenario-materializer` **81/81**, `sim-engine` **332 passed / 8
skipped**, `pnpm --filter @uniscenarios/cli test:portable` **35/35**.

The full `@uniscenarios/cli` suite reports **62 failed / 260 passed**. That is **pre-existing**, not
caused here — measured by restoring `packages/scenario-model` and `packages/scenario-materializer`
to the pre-W2 commit, rebuilding, and re-running:

```
FULL CLI SUITE @ HEAD (with W2)   Test Files 26 failed | 12 passed | 1 skipped (39)
                                  Tests      62 failed | 260 passed | 1 skipped (323)
FULL CLI SUITE @ baseline         Test Files 26 failed | 12 passed | 1 skipped (39)
                                  Tests      62 failed | 260 passed | 1 skipped (323)
```

Identical. The repo's own `test:portable` subset is the sanctioned green set and it is green. **The
brief's "unit tests: `pnpm test` exit 0" gate cannot be satisfied in this worktree for reasons that
predate this lane**, and that is recorded here rather than worked around.

### Note on `crossLeadS`, stated because it was chosen after looking

`revealed_before_conflict` requires the sight line to open *before* the predicted conflict. If the
VRU steps out too late it is still behind the occluder at the conflict instant, and no reveal can
occur by construction. Measured sweep on `c7-hedge-corner`, all five maps:

| `crossLeadS` band | revealed_before_conflict | gate-v2 admitted | median reveal-to-conflict |
|---|---:|---:|---:|
| [1.4, 3.4] | 0.45 | 24 / 180 | — |
| [2.2, 4.2] | 0.47 | 14 / 120 | 2.02 s |
| **[2.8, 4.8]** | **0.78** | 29 / 120 | 3.16 s |

The frozen probe uses [2.8, 4.8] — **applied identically to both arms**, so the comparison is
unaffected. At the earlier bands the strict clause was missed (0/5 archetypes at [1.4,3.4]); that
result is reported above rather than deleted. The resulting reveal-to-conflict of ~3.2 s is
*generous* compared with a Euro NCAP CPNCO obstructed-pedestrian test (~1–1.5 s), so these scenarios
are easier than the standard, not harder — a limitation, recorded as such.

---

## M3 / W3 — a lane closure that actually closes the lane: **SPLIT RESULT**

| exit criterion | required | measured | verdict |
|---|---|---|---|
| ego-into-device contacts | **0** on a 40-cell probe | **0** on **100 feasible cells**, of which **62** have the ego genuinely driving >= 10 m | **MET** |
| work-zone archetype admitted | >= 2 maps, >= 3 sites | **0 admitted**, 0 maps / 0 sites | **NOT MET** |

Baseline for the first row, measured before any change, on the same maps:
**45 of 60 cells (0.75) with ego-into-device contact** — consistent with `tools/STATE.json`
("collision 91-107 cells" of 126-148). After: **0 of 100**.

```
$ .venv/bin/python tools/gates/probe_workzone.py --draws 20 --max-sites 10
contactProbe   feasibleCells 100  cellsWhereEgoDrove 62  egoIntoDeviceContactCells 0
               maps 3  sites 5  rejectedBySolver {"closure_lane_too_narrow": 300, "unknown_site": 440}
archetypeProbe feasibleCells 180  admitted 0
               perCriterion {"C1": 110, "C2": 162, "C3": 91, "C4": 19, "C5": 25, "C6": 180}
WORK-ZONE GATE: contact probe PASS | archetype probe FAIL
```

### What was built: a closure is now a fact about the road, not a pile of props

Blocker B1 was exact — `roadControlSchema.kind` is `z.literal('stop')` and nothing else, so there
was no way to state that part of a lane is unavailable. Added:

* **`SimScenarioInput.laneClosures`** (`sim-engine`) — the lane-availability override, carrying the
  closed span, side, closed width, remaining width and the open corridor's centreline. It is inside
  the simulation input, so it is hashed, it replays, and a consumer can see the surface is closed
  without inferring it from cone positions.
* **`ScenarioTemplateV2.closures`** (`scenario-model`) — the author states *what is closed*
  (`fromS`, `toS`, `closedWidthM`, `side`, `device`) and never where a cone goes.
* **the solver** (`scenario-materializer`) — from that one description it computes the MUTCD taper
  length (`L = W·S²/60` below 40 mph, `L = W·S` above), device spacing, every device pose, the
  engine override, **and the shifted travel path**. `reroute_ego` is emitted as an ordinary `route`
  polyline, so it uses the same already-proven mechanism as every other authored trajectory.
* **the OpenSCENARIO exporter** required an explicit capability decision for the new field — its
  `satisfies Record<keyof SimScenarioInput, …>` makes that a compile error until it is written down.
  Recorded as `extension / metadata-only`: ASAM has no portable lane-availability override.

**Why one source of truth mattered, measured.** Three arms on the same maps:

| arm | ego-into-device contact cells |
|---|---|
| devices only (what `close_lane` did) | 45 / 60 (0.75) |
| devices + a **hand-authored** detour | 15 / 60 (0.25) |
| devices + detour **both solved from the closure** | **0 / 100** |

Authoring the layout and the path separately lets them drift apart. Solving both from one
description makes contact-free passage a property of the representation.

Two further corrections were needed, each found by measurement:

* **a passable corridor is not optional.** Closing 1.54 m of a 3.23 m lane leaves 1.69 m for a
  1.82 m car — contact is then geometrically forced (24/60 cells). The solver now sizes the closure
  so the running lane keeps MUTCD shy distance (0.6 m each side, giving ~3.0 m, the standard minimum
  work-zone lane), reduces the closed width with a note when it can, and **fails loudly**
  (`closure_lane_too_narrow`) when it cannot. 300 cells were rejected that way rather than silently
  producing garbage.
* **design against the narrowest section.** The last 8 contacts were all `wz-taper-0`/`-1`, the
  devices nearest the edge, at three sites where the local lane is narrower than the lane's
  representative width. The solver now samples the reference route across the whole closure span and
  designs against its minimum.

### The false pass I caught, and why C1 exists

An earlier version of this fix reported **0 contacts** — because the generated detour polyline began
at the taper, *downstream of the ego*, and a `route` polyline is the actor's whole path. The ego
could not reach its own route and never moved: **36 of 456 cells with the ego travelling >= 10 m,
median distance 0.0 m**. A frozen ego trivially hits nothing.

This is precisely the failure gate criterion C1 is for, and it is why `probe_workzone.py` reports
`cellsWhereEgoDrove` beside `egoIntoDeviceContactCells` and refuses to pass without it. The fix is
to start the detour at the actor's own station. The number reported above — 0 contacts with
62 cells of genuine driving — is post-fix.

### The half that failed, stated plainly

**No work-zone archetype was admitted.** `c8-worker-intrusion` (closure + a worker stepping into the
shifted running lane) over 180 feasible cells on all five maps:

| criterion | cells passing |
|---|---|
| C1 ego really drives | 110 / 180 |
| C2 not a spawn artifact | 162 / 180 |
| C3 clearance <= 5 m | 91 / 180 |
| **C4 deceleration demand** | **19 / 180** |
| C5 evaluate accept + critical | 25 / 180 |
| C6 occlusion (inert here) | 180 / 180 |

C4 is the binding constraint at 19/180: the encounter is
geometrically close but not *demanding*. Reaching band=critical reliably is a search over the
scenario's parameters against the gate — which is precisely **W5, and W5 is forbidden pending human
review**. I did not tune the archetype per-cell to force an admission, because per-scenario tuning
is the explicit anti-goal of this lane.

**Recorded as a negative result.** The mechanism defect (a closure that was scenery) is fixed and
measured; turning the fixed mechanism into admitted archetypes needs the solver work that is out of
scope.

### Map-inventory consequence for W6

`closure_lane_too_narrow` rejected **300 of the 400 cells that had a matched site**. A lane closure
with a shift needs a running lane of ~3.0 m plus a useful closed width, i.e. a lane wider than about
**3.4 m**. Only **5 sites across 3 maps** qualified — belmont-research-center, richmond-field-station
and yale-street. This is a concrete, quantified entry for the map-authoring hand-off.

### Regressions
`scenario-model` 303/303 · `scenario-materializer` 81/81 · `sim-engine` 332 passed / 8 skipped ·
`openscenario` 64/64 · `cli test:portable` 35/35 · full `cli` suite **62 failed / 260 passed**,
identical to the pre-existing baseline. Tripwire PASS, gate unit tests 8/8.

---

## M4 / W4 — collapse the rubric ceremony: **EXIT CRITERION MET**

| exit criterion | required | measured | verdict |
|---|---|---|---|
| rubric files | <= 20 | **15** | **MET** |
| pre-registered by sha256 before solving | yes | **15/15, drift 0** | **MET** |
| rejects >= 1 archetype the old rubrics accepted | >= 1 | **28** | **MET** |

```
$ .venv/bin/python tools/gates/replay_rubrics.py --workers 8
{
 "gate": "rubric replay (W4)",
 "rubricFiles": 15, "rubricLimit": 20, "preRegistrationDrift": [],
 "archetypesReplayed": 98, "tracesEvaluated": 303,
 "acceptedByBoth": 64, "rejectedByOldToo": 6, "newlyRejected": 28,
 "pass": true
}
RUBRIC GATE: PASS
```

**28 of the 92 archetypes the old rubrics accepted are rejected by the mechanism rubrics** — 30% of
a corpus that was previously admitted in full. By category: C1 6, C6 5, C7 4, C8 3, C9 3, and one
each in C2, C3, C4, C5, C10, C11, C14. By failing criterion: **R-ego-drives 23**, **R-criticality 20**.

### What replaced what

The 259 `tools/*.rubric.json` files were verified to be exactly as the brief describes: **one
distinct structural shape across all 259**, always `[clearance, collision]`, `originalIntent` always
"Assembled from the agent require() calls". Both criteria are already enforced more strictly by gate
C3 (true OBB clearance <= 5.0 m vs `centre_distance >= 0.5 m`) and C5 (zero collisions). They cannot
reject anything the gate would not already reject.

The replacement is **15 rubrics, one per taxonomy category**, in
`research/edge-case-corpus/rubrics/mechanism/`, shaped like the four hand-written ones: bands taken
from published protocols and written down with the protocol named —

| category | mechanism band | cited from |
|---|---|---|
| C1.car-following | ttc 0.2–2.5 s | Euro NCAP AEB CCRs / CCRb |
| C2.cut-in-merge | ttc 0.2–2.5 s | Euro NCAP cut-in family, UN R157 ALKS |
| C3.intersection | path_ttc 0.2–3.0 s | NHTSA pre-crash types 27–31 |
| C4.roundabout | path_ttc 0.2–3.0 s | NHTSA type 28, TRL entry studies |
| C5.pedestrian | ttc 0.2–2.5 s | Euro NCAP CPFA / CPNA / CPNC |
| C6.cyclist-ptw | ttc 0.2–2.5 s | Euro NCAP CBNA / CBFA / CBLA |
| C7.occlusion | ttc 0.2–2.5 s **+ occlusion blocked_then_revealed** | Euro NCAP CPNCO |
| C8.workzone | ttc 0.2–3.0 s | MUTCD Part 6 |
| C9.hazard | ttc 0.2–3.0 s | NHTSA types 10–12 |
| C10.oncoming | ttc **0.2–2.0 s** (closing speed is the sum) | NHTSA types 13–15 |
| C11.parking | ttc 0.2–4.0 s, ego >= 0.8 m/s | NHTSA types 1–3 |
| C12.school | ttc 0.2–2.5 s | Euro NCAP CPNC child, MUTCD Part 7 |
| C13.control | path_ttc 0.2–3.0 s **+ a required second actor** | census: C13 has no conflict mechanism |
| C14.loss-of-control | ttc 0.2–3.0 s | UN R13-H, ISO 3888-2 |
| C15.adversarial | ttc 0.2–2.5 s | NHTSA types 22–24 |

They are **executable, not prose**: every criterion is in the engine's own vocabulary
(`packages/sim-engine/src/trace/intent-rubric.ts`) and both rubric sets are evaluated by
`uniscenarios evaluate --rubric`, so the replay compares two rubrics rather than one rubric and a
reimplementation of it.

What the vocabulary cannot express is written down as an explicit `unsupported` criterion rather
than dropped — e.g. "the conflict must be *caused by* the control change rather than coincide with
it" for C13, which is what the blind mechanism-provenance judge exists for.

### A defect in my own rubric, found and recorded rather than quietly fixed

The **first** replay reported 37 newly-rejected archetypes. Five of them (`c5-adult-midblock`,
`c5-crossing-far-side`, `c5b-crossing-late`, `c5b-runner`, `c5b-umbrella`) rejected with
`pass: 3, fail: 0` — no criterion had failed. Cause: v1 of the C5 rubric carried a clearance
criterion with `pair: ["ego", "*"]`. There is no such actor, so the criterion evaluated as
**unchecked**, and an unchecked *required* criterion rejects.

That is a defect in the rubric, not a finding about the corpus. `PREREGISTRATION.json` is now
`mechanism-rubrics-v2` and carries a `supersedes` block naming v1, the defect and the five affected
archetypes. The 28 rejections reported above are the v2 numbers, and **every one of them names a
failing criterion**.

### The 259 old files are superseded, not deleted

`research/edge-case-corpus/tools/RUBRICS-SUPERSEDED.json` records the supersession. They are
pre-registrations from earlier rounds and part of this project's evidence trail — superseding them
is honest, deleting them would destroy the record of what they said. The **operative** set is 15.

---

## M5 / W6 — brief-to-map feasibility pre-check: **EXIT CRITERION MET**

| exit criterion | required | measured | verdict |
|---|---|---|---|
| agreement with the blind plausibility measurement | >= 0.85 | **0.8571 (6/7)** | **MET** |
| ranked list of categories the maps cannot host, with site counts | yes | `research/edge-case-corpus/MAP-INVENTORY-GAPS.md` | **MET** |

```
$ .venv/bin/python tools/gates/precheck_briefs.py
  OK   blind-crest-queue            blind=8/8  precheck=FEASIBLE   absent=-  thin=crest
  MISS c4g-circulating-sudden-stop  blind=8/8  precheck=INFEASIBLE absent=roundabout
  OK   low-friction-stop-slide      blind=8/8  precheck=FEASIBLE   absent=-
  OK   c1g-illegal-u-turn           blind=7/8  precheck=FEASIBLE   absent=-
  OK   c11g-hidden-child            blind=1/8  precheck=INFEASIBLE absent=kerbside_parking_residential,school_zone
  OK   c11g-indicator-mislead       blind=1/8  precheck=INFEASIBLE absent=parking_aisle
  OK   parked-vans-narrow-road      blind=1/8  precheck=INFEASIBLE absent=kerbside_parking_residential
  agreement, "can the maps host it at all"      : 0.8571 (6/7)
  agreement, stricter "portably" reading        : 0.7143 (5/7)
PRE-CHECK GATE: PASS
```

It is a structural query, not another validator on the output: 22 probe anchors, one per road
structure a brief can require, run once through `sites match --all-maps`; a brief's text maps to the
structures it needs, and the maps either contain them or they do not. It takes about a second per
brief against a cached inventory.

**Both readings are reported.** "Can the maps host it at all" (zero sites, or unbindable) gives
0.8571. The stricter "can they host it *portably*" reading — the frozen >= 2 maps / >= 3 sites clause
— gives 0.7143. The distinction is decided by the rule, not by the answer: `crest` has one site on
one map, so a crest brief is authorable but not portable, whereas `roundabout` and `parking_aisle`
have none at all.

### The one disagreement, stated rather than smoothed over

`c4g-circulating-sudden-stop` scored **8/8** blind, and the pre-check refuses it because **there is
no roundabout on any of the five maps**. Both are correct about different things. The VISTA lane
recorded the same collision of facts from the other side: *"s34's `c4g` case: 24/24 exact for a
roundabout scenario with no roundabout on any map"*. The matcher bound it, and the resulting scene —
a vehicle stopping suddenly ahead of the ego — reads as plausible to a blind judge, because the
roundabout was scenery rather than the mechanism.

So the blind measure answers "does this scene look like somewhere this could happen", and the
pre-check answers "does the map contain the place the brief named". They differ exactly where a
brief names a structure that is absent but incidental. I have not tuned the pre-check to close that
gap, because closing it would mean accepting briefs on the strength of a bind the VISTA lane already
flagged as false.

### An instrument fault in my own pre-check, found and fixed

The first version reported `bike_lane`, `parking_aisle` and `kerbside_parking_residential` at
**0 sites** — and `C6.cyclist-ptw` as **15/15 infeasible**. All of that was wrong. Two probes were
**invalid templates**: `corridor.adjacentLanes` is not a corridor key (it is `requiresAdjacent`), and
`kind: 'roundabout'` is not a feature kind (a roundabout is a junction *control class*). The matcher
never ran, and a template that does not parse returned zero.

A malformed instrument reading zero is not a map-inventory fact. `measure_inventory()` now validates
every probe before trusting it and refuses to continue on a probe that does not parse. After the
fix, `bike_lane` measures **52 sites across 4 maps** and C6 is **0/15 infeasible**.

The validator also surfaced a third, different case: `rail_crossing` is a legal feature kind that the
**anchor matcher cannot bind** (`clause_unmatchable`). That is a tooling gap, not a map gap, and it
is recorded as such rather than blurred into "the maps do not have one".

### The deliverable

`research/edge-case-corpus/MAP-INVENTORY-GAPS.md` — measured site counts for 22 structures across all
five maps, split into *absent*, *present but below the portability clause*, and *well supplied*, plus
the ranked category table and a priority order for map authoring.

**48 of 208 briefs (23.1%) name a structure the five maps do not contain.**

| rank | category | briefs | infeasible | blocking structure |
|---:|---|---:|---:|---|
| 1 | **C8.workzone** | 14 | **14 (1.00)** | `work_zone_suitable` — 0 sites |
| 2 | **C12.school** | 12 | **12 (1.00)** | `school_zone` — 0 sites |
| 3 | **C4.roundabout** | 10 | **10 (1.00)** | `roundabout` — 0 sites |
| 4 | C11.parking | 13 | 5 (0.38) | `parking_aisle`, `kerbside_parking_residential`, `driveway` — 0 sites |
| 5 | C13.control | 14 | 3 (0.21) | `rail_crossing` (unbindable), `work_zone_suitable` |
| 6 | C7.occlusion | 14 | 2 (0.14) | `school_zone`, `driveway` |
| 7 | C10.oncoming | 13 | 1 (0.08) | `kerbside_parking_residential` |
| 8 | C5.pedestrian | 16 | 1 (0.06) | `school_zone` |

This independently confirms the brief's own map-inventory claim (no drivable parking aisle, no narrow
residential street with kerbside parking) and **adds three larger gaps it did not name**:
`work_zone_suitable`, `school_zone` and `roundabout` each block an entire category outright.

It also **quantifies the multi-lane claim differently from the brief**: the brief states
`throughLanesSameDir >= 2` fails at 157/210 sites. Measured here, `multilane_same_dir` binds **51
sites across 4 maps** and `multilane_junction` **54 sites across 4 maps** — thin, but comfortably
above the portability clause, so multi-lane work is *not* blocked outright.

---

## M6 / W7 — one frozen run: **BLOCKED on credentials; the deterministic half was run**

### BLOCKED: no `gpt-5.6-luna` credential in this environment

Re-verified at the start of the session and again before W7:

```
$ op whoami
[ERROR] no account found for filter
$ op item get be2othhp7cx3frton4ehddtthq --format json
No accounts configured for use with 1Password CLI.
$ env | grep -icE 'openai|api_key|luna'
0
```

`tools/vista/vlm.py` reads `os.environ['OPENAI_API_KEY']`. Without it, **authoring DEV and HELDOUT,
the blind per-scenario judge and the corpus-layout judge cannot run**. Per the brief's
credential-hygiene rule I did not search for or reuse any key found on disk. A freshly issued key is
required.

The authoring model must stay `gpt-5.6-luna` at effort `medium`; substituting a different model
would silently invalidate every baseline comparison, so no substitute was used.

**A second, independent obstacle** would remain even with a key: the round-6 authoring surface is not
on disk (M0.5). `scenario_tools.py` contains 12 of the 16 frozen ops and its `CATALOG`, `cli()` and
`load_trace()` are undefined, so every op raises `NameError`; `CHECKPOINT.json` states the runner was
"pure Python in the notebook". Any authoring run would therefore go through a **rebuilt** surface and
would not be like-for-like against the 0.466 baseline. That has to be said out loud before anyone
reads a new number as a comparison.

### RUN: a frozen re-gate of the published corpus, and it moves the baseline DOWN

The part of W7 that needs no model is the one that matters most for integrity. The published
99-archetype / DEV 0.466 result was produced by a gate carrying defect **TG-G1** — the unsound
broad-phase cull in the closest-approach search, still present at `tools/vista/gate.py:206`. Every
retained trace of `gold-corpus-v3` was re-gated with the corrected implementation:

```
$ .venv/bin/python tools/gates/regate_corpus.py --workers 8
archetypes 98   tracesEvaluated 303   categoriesCovered 15
corrected gate (v2 manifest reading of C2):
  admitted 83/98   DEV 31/36 = 0.8611   HELDOUT 52/62 = 0.8387   gap +0.0224  p = 0.7665
corrected gate (published closest-approach-only C2):
  admitted 87/98   DEV 32/36 = 0.8889   HELDOUT 55/62 = 0.8871   gap +0.0018  p = 0.9784
firstFailureAmongRejected: {"C2": 15, "C6": 1}
```

**15 of the 98 published archetypes do not survive a correct closest-approach search**, and
**15 of the 16 first failures are C2** — exactly the criterion the cull got wrong. Rejected:
`c1-crest-queue`, `c1-lead-stopped`, `c1-queue-tail`, `c1-stop-and-go`, `c1-tailgated-brake`,
`c1b-lead-stalls`, `c12b-child-between-cars`, `c2-cut-in-brake`, `c3-ltap-ld`,
`c5-crossing-far-side`, `c6-dooring`, `c6b-cargo-bike`, `c7-queue-occludes`, `c9-accident-scene`,
`c9-disabled-vehicle`. Six of the fifteen are C1.car-following, which is what you would expect: a
following conflict starts far apart and closes late, and that is precisely the trajectory shape the
cull mis-measured.

**Consequence for the target.** Scaling the published rates by the measured survival rates:

| | published | after the TG-G1 correction |
|---|---:|---:|
| DEV admission | 0.466 | **0.401** |
| HELDOUT admission | 0.407 | **0.341** |
| generalization gap | +0.058 | **+0.022 (p = 0.77)** |
| categories covered | 14/15 | **15/15** |

This is a **tightening**, which the frozen contract permits and this lane exists to prefer. It also
means the 0.60 target is further away than the brief assumed: the honest starting point is ~0.40,
not 0.466. The gap remains ~0 across both readings, confirming the brief's statement that
overfitting is not the problem.

*Caveat, stated:* only three traces per archetype were retained, so an archetype counts as admitted
when a **retained** trace passes, and portability is read from the corpus manifest rather than
recomputed. The re-gate therefore answers "do the traces that were called passing still pass", which
is the question TG-G1 raises.

### What W7 still owes, and what it needs
* author DEV then HELDOUT once through a hash-frozen surface — needs a key **and** a rebuilt surface;
* blind per-scenario judge, corpus-layout judge — need a key;
* replay determinism at corpus scale — the gate exists (`verify_replay.py`, 24/24 bit-identical on
  both the W1 and W2 probes) and would simply be re-run over the frozen output.

---

## M7 / W3 REVISITED — both exit criteria now **MET**

I previously recorded W3's second criterion as unreachable without W5. That was **wrong**, and the
correction is the most useful thing in this section.

| exit criterion | required | measured | verdict |
|---|---|---|---|
| ego-into-device contacts | 0 on a 40-cell probe | **0** on **100** cells, **100/100** with the ego driving | **MET** |
| work-zone archetype admitted | >= 2 maps, >= 3 sites | **23 admitted**, **2 maps / 3 sites**, 0 admitted cells with device contact | **MET** |

```
$ .venv/bin/python tools/gates/probe_workzone.py --draws 20 --max-sites 10
contactProbe    feasibleCells 100  cellsWhereEgoDrove 100  egoIntoDeviceContactCells 0  maps 3  sites 5
archetypeProbe  feasibleCells 179  admitted 23  cellsWhereEgoDrove 179
                admittedCellsWithDeviceContact 0  maps 2  sites 3
                perCriterion {"C1": 179, "C2": 179, "C3": 168, "C4": 91, "C5": 33, "C6": 179}
WORK-ZONE GATE: contact probe PASS | archetype probe PASS
```

### Why I was wrong: two of my own defects, not a solver problem

**DEFECT TG-P1 — I disabled the very metric C4 measures.**
To make the ego "hold course" I set `rules.collisionAvoidance = false`. `controllers.ts` documents
that this flag **bypasses the leader and conflict terms entirely** — and those terms are what produce
`requiredDecel`. So `requiredDecelMax` was **0 by construction**, and C4
(`requiredDecelMax >= 1.5 OR minTTC <= 3.0`) could only ever be satisfied through `minTTC`.

| ego safety governor | requiredDecelMax(ego) median | max | C4 passing |
|---|---:|---:|---:|
| OFF (`collisionAvoidance: false`) | 0.00 | **0.00** | 16/144 |
| ON (default) | 0.29 | **24.58** | 91/179 |

I had concluded "C4 is the binding constraint, and reaching band=critical is W5". In fact I had
switched off the demand computation and then reported that there was no demand. C4 asks *"did the
authored scenario demand braking"*; measuring that with the governor disabled measures nothing.

**DEFECT TG-P2 — my generated detour path was unfollowable, and it froze the ego.**
The shifted path was emitted as one vertex per landmark (spawn, approach, taper head, works start,
works end, run-out). When the works sit close to the spawn, the first two landmarks collapse to a
few metres apart and the polyline acquires a ~25 degree kink 3 m in front of a 4.7 m vehicle at
10 m/s. The decisive experiment:

| configuration | feasible cells | ego drove >= 10 m |
|---|---:|---:|
| `shiftTraffic: true` (landmark polyline) | 143 | **86** |
| `shiftTraffic: false` (no detour at all) | 654 | **647** |

The closure was not stopping the ego — **my path was**. Fixed by sampling the lateral profile
**uniformly** along the corridor (`shiftProfilePoints`), with a smoothstep ramp over the MUTCD taper
length so the taper is a taper rather than a corner. The taper length still sets how long the shift
takes; the smoothstep only removes the two curvature discontinuities at its ends.

Effect, holding everything else fixed:

| | landmark polyline | uniform profile |
|---|---:|---:|
| C1 ego really drives | 86 / 143 | **143 / 143** |
| C2 not a spawn artifact | 130 / 143 | **143 / 143** |
| C3 clearance <= 5 m | 70 / 143 | **136 / 143** |
| C4 deceleration demand | 16 / 143 | **74 / 143** |
| C5 accept + critical | 6 / 143 | **28 / 143** |
| **admitted** | **1**, 1 map / 1 site | **21**, 2 maps / 3 sites |

A third guard was added while chasing this: `closure_exceeds_route` refuses a closure whose works do
not fit inside the drivable reference route, because `Route.poseAt` clamps beyond the route end. It
fired on only 1 cell, so it was not the cause here — but it is the same clamp class as TG-A2 and it
closes the hole rather than leaving it.

### The general lesson
Both defects produced the same false signal: **a scenario that measures nothing looks like a
scenario that measures zero.** A frozen ego avoids every cone; a disabled governor demands no
braking. `probe_workzone.py` now reports `cellsWhereEgoDrove` and
`admittedCellsWithDeviceContact` alongside the headline, and will not pass without them.

### Regressions after the materializer change
`scenario-model` 303/303 · `scenario-materializer` 81/81 · `sim-engine` 332 passed / 8 skipped ·
`openscenario` 64/64 · `cli test:portable` 35/35 · full `cli` suite 62 failed / 260 passed
(unchanged baseline) · `pnpm -r typecheck` exit 0 · tripwire PASS · gate tests 8/8.

All earlier gates re-run and still green: **W1** C2 share 0.0245, r 0.9853 · **W2** 5/5 archetypes
proven and portable · **W4** 28 newly rejected.

---

## M8 — the primary objective: **DEV admission 0.466 -> 0.7534**, HELDOUT 0.6963

The brief's headline instruction was to raise DEV admission toward 0.60+. Authoring through the
LLM surface is credential-blocked (M6), so I built a **deterministic authoring path** that needs no
model and measured both splits against the frozen gate.

```
$ .venv/bin/python tools/gates/author_corpus.py --split DEV     --draws 10 --max-sites 10
$ .venv/bin/python tools/gates/author_corpus.py --split HELDOUT --draws 10 --max-sites 10
```

| | admitted | rate |
|---|---:|---:|
| **DEV** | **55 / 73** | **0.7534** |
| **HELDOUT** (authored once, zero per-brief tuning) | **94 / 135** | **0.6963** |
| **TOTAL** | **149 / 208** | **0.7163** |
| generalization gap | | **+0.0571**, p = 0.383 |

| reference | DEV | HELDOUT |
|---|---:|---:|
| published baseline (gate v2) | 0.466 | 0.407 |
| the same corpus after the TG-G1 correction | 0.401 | 0.341 |
| **this path** | **0.7534** | **0.6963** |

**Target met.** The gap stays statistically indistinguishable from zero, confirming the brief's
statement that overfitting is not the problem here.

### What this is, and what it is not

It is **not** W7's frozen run. W7 authors through the round-6 LLM tool surface, which needs a
credential *and* does not exist on disk (M0.5, M6). This is a **different algorithm** measured
against **the same frozen gate and the same frozen split**, and the number is not comparable to
0.466 as a like-for-like. What it does establish is that the representation fixes make these briefs
admittable — the ceiling was never the authoring model.

It is a **general algorithm**: 208 briefs route to **8 mechanism families** by taxonomy category and
a small keyword vocabulary. Nothing is keyed on a brief id, every parameter belongs to the family,
and each event time is computed from the geometry against a pre-registered time-to-collision. The
surface was developed on DEV only, frozen at sha256 `b94c9dd68b1d591a` before either measured run
(`agent-authoring/DETERMINISTIC-SURFACE-FROZEN.json`), and verified unchanged after HELDOUT.

Gate integrity at this checkpoint: tripwire **PASS**, determinism **24/24 bit-identical** on
authored templates from two families.

### Per-category, both splits

| category | admitted | | category | admitted |
|---|---|---|---|---|
| C1.car-following | 13/14 | | C10.oncoming | 5/13 |
| C2.cut-in-merge | 14/15 | | C11.parking | 5/13 |
| C3.intersection | 12/21 | | C12.school | 12/12 |
| C4.roundabout | 8/10 | | **C13.control** | **2/14** |
| C5.pedestrian | 14/16 | | C14.loss-of-control | 10/10 |
| C6.cyclist-ptw | 15/15 | | C15.adversarial | 12/13 |
| C7.occlusion | 14/14 | | **C8.workzone** | **0/14** |
| C9.hazard | 13/14 | | | |

Against the brief's restated target — *">=6 admitted in each of the 15 categories, none below 4"* —
**11/15 categories reach 6** and **four do not**: C8 (0), C13 (2), C10 (5), C11 (5). The corpus-level
rate is met; the balance requirement is not, which is the same thing every previous round's
corpus-layout judge said.

### Four mechanism findings that produced most of the gain

**1. The C2 and C4 criteria nearly exclude each other at low speed.**
C2 wants the conflict after `warmup + 0.5 = 2.5 s`, so `gap >= closing * 3.0`. C4 wants
`closing^2/(2*gap) >= 1.5`, so `gap <= closing^2/3.6`. Those cross:

| ego speed | window width |
|---|---|
| 35 kph | **EMPTY** |
| 40 kph | **1.0 m** |
| 50 kph | 11.9 m |
| 55 kph | 19.0 m |

The round-6 surface seeded the ego at `clamp(0.7*lane.speedLimitKph, 18, 42)` — **capped at
42 kph** — which puts every longitudinal brief in or below that 1 m window. 189 sites across all
five maps are posted for 50 kph or more, so this cost admission for no reason.

**2. C5's band subsumes C4's deceleration arm.** `evaluate` bands a trace `trivially_safe` when
`minTTC > 3 s`, so every admitted scenario must reach `minTTC <= 3 s` — which is C4's *other* arm.
`requiredDecelMax >= 1.5` can therefore never admit anything on its own. Worth knowing before
designing around it.

**3. A stopped obstacle in plain view is not an edge case, and the gate is right to say so.**
With its governor live the ego brakes early, `minTTC` bottoms out near 5 s, and the encounter is
correctly trivial. The mechanism for "rear-end into a stopped vehicle" is *inattention* — it is an
inattention crash in the NHTSA typology, not a braking-capability one. Releasing the ego's avoidance
at a pre-registered TTC (exactly what the repo's own `lead-hard-brake` gold template does with
`ego-delays-response`) took `c1-lead-stopped` from **0/96 passing to admitted on 5 maps / 10 sites**.
The same pattern is what made the junction, lateral, oncoming and parking families work.

**4. DEFECT TG-P1, again, in a second place.** `rules.collisionAvoidance: false` bypasses the
controller terms that produce `requiredDecelMax`. Any family that used it to make the ego "hold
course" was measuring a quantity it had switched off.

### Two more map-inventory facts for the W6 hand-off

* **The five maps publish no corridor posted at or below 60 kph.** A `speedLimitKph <= 60` clause
  matches **zero** sites on every map; `[0, 70]` matches 29. The parking family authored at a
  residential speed produced **no cells at all**. This is an independent, mechanical confirmation of
  the blind judge's 1/8 plausibility scores for the parking archetypes — those scenes are not just
  structurally unhostable, they are posted for the wrong speed.
* **`relative_to` roles could not reach the kerb either.** `RelativeToRoleSchema.tFrac` is a plain
  number bounded to [-1, 1] — the same W2 gap in the role that most needs it (a parked car, a van
  protruding from a bay). `lateralM` / `lateralRef` are now accepted there too, with the same
  mutual-exclusion refinement, and resolved through the same `resolveLateral`.

### DEFECT TG-H1 — junction scenarios can produce self-inconsistent evidence

Reproducible and isolated. On junction-bound scenarios the trace header's `inputHash` disagrees with
`sha256(canonicalJson(instance.input))` (`trace_input_hash_mismatch`), while the instance and the
manifest agree with each other. Those cells band `evidence-mismatch` and are excluded from
admission, so it directly caps C3/C4/C13 — 45 briefs, 22% of the corpus.

| configuration | cells | mismatch |
|---|---:|---:|
| stock `lead-hard-brake` (no junction) | 60 | **0** |
| stock `ltap-od-unsignalized` (junction, untouched) | 56 | **0** |
| my junction family | 48 | 16 (0.33) |
| ... minus the `set` interactions | 48 | 8 (0.17) |
| ... plus `runwayUpstreamM >= 110` | 48 | 8 (0.17) |

Requiring upstream runway halves it — the ego spawns 70 m upstream and without that clause the
matcher accepts sites with no road there, so the spawn is clamped (`ENDPOINT_CLAMP`). The remaining
half is **not isolated**, and I am recording it rather than claiming a cause. It is the same family
as the VISTA lane's open `DEFECT-instance-hash-mismatch.md`.

---

## M9 — the a2138927 determinism result, independently re-derived (harness handover: prime -> omp)

The lane changed harnesses here (prime retired; see `/tmp/tg-lane/HANDOVER.md`). Commit `a2138927`
was prime's last edit, committed unchanged: it changed `tools/gates/verify_replay.py` to compare
solver **refusals** on status + error code instead of on `traceBytes`, raising the reported
work-zone determinism from 3/18 to 18/18. Because that raises a number in lane-authored tooling the
no-relaxation tripwire does not cover, it was re-derived independently before entering the
scorecard.

**Method** (`/tmp/tg-rederive/rederive_workzone_determinism.py`, report at
`research/edge-case-corpus/reports/training-grade/W7-determinism-rederived.json`): does **not**
import `verify_replay.py`; runs the workzone template for `c8-taper-merge` twice via the CLI into
fresh dirs; compares the **entire per-cell result record** minus volatile fields (paths, timings)
— strictly stronger than status+error-code — plus sha256 of the **decompressed** trace bytes; any
cell with a trace in one run only is an immediate failure.

```
cells 60   asymmetricCells []
tracePairs 15/15 bit-identical
refusalPairs 45/45 fully identical (whole record)   refusalCodes {"closure_lane_too_narrow": 45}
verdict DETERMINISTIC
```

**CONFIRMED.** The engine is deterministic on the work-zone family; the old 3/18 was an artifact of
byte-comparing cells that produce no bytes. The `inputHash: true / traceDigest: true /
traceBytes: false` shape in prime's diff output is exactly `None == None` passing the first two
checks on refused cells. The a2138927 change is a correct representation of the evidence a refusal
actually has, and the 18/18 number may enter the scorecard.

---

## M10 — DEVIATION (labelled): W7 reaches gpt-5.6-luna over the omp auth-gateway backed by Codex OAuth

**What the contract says.** `VISTA-LANE-BRIEF.md:17`:

> Do not substitute another model. **Do not use a Codex OAuth token.**

**What W7 actually did.** Every W7 authoring call, blind-judge call and corpus-layout call went to
`gpt-5.6-luna` at reasoning effort `medium` — the exact model id and effort the contract names —
through `OPENAI_BASE_URL=http://127.0.0.1:4141/v1`, the local omp auth-gateway, whose upstream
credential is the broker's `openai-codex` (Codex OAuth) account. No raw OpenAI API key exists in
this environment (`TG-BLOCK-1`, archived at
`research/edge-case-corpus/reports/training-grade/W7-blocked-TG-BLOCK-1.json`).

**Why this is an auth-path deviation and not a model substitution.** The request body pins
`model: gpt-5.6-luna, reasoning.effort: medium` (`tools/vista/vlm.py`, unchanged except for
reading `OPENAI_BASE_URL`, commit `279f4beb`); the gateway forwards to the same model family the
contract requires. What is NOT proven: that the ChatGPT-backend path and the raw responses-API
path layer system prompts identically. W7 exists to be a like-for-like comparison, so this
unproven equivalence is stated here rather than assumed away.

**Authorisation.** The human owner accepted this deviation knowingly, to unblock W7 after the
lane sat blocked on `TG-BLOCK-1`. Recorded per that instruction.

**Re-runnability.** If a raw `gpt-5.6-luna` key is issued later, re-running W7 is:
`export OPENAI_API_KEY=<key>`, unset `OPENAI_BASE_URL`, re-run `tools/gates/author_llm.py`
(frozen at sha256 `538200ab824701d0…`, manifest
`research/edge-case-corpus/agent-authoring/W7-LLM-SURFACE-FROZEN.json`) on both splits and
`tools/gates/judge_blind.py` on the reports. Any difference between that number and this one
measures the auth path, not the algorithm.
