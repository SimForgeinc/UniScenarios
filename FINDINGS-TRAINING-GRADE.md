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
