# Stream C — EmergentLane: ambient traffic and emergent conflict

Agent: EmergentLane (omp Fable), branch `tg-rethink`. Updated incrementally per contract §8.
Session start: `python tools/gates/verify_gate_hash.py` → PASS (v1 `1a08698e95fca4bc` / v2 `3823182614e5a5ba`).

## 0. Prior-tooling reconciliation (lead mandate, 2026-08-16)

Prior stream C ("worldgen", dead lead session) left committed tooling in `tools/tg-research/worldgen/`
(PREREG.md → M5, commits e6a6b4f…6a399bf) and a report brief in
`research/edge-case-corpus/reports/tg-research/streams/C-worldgen.md`. Decisions:

| asset | decision | reason |
|---|---|---|
| `PREREG.md` M3 mining thresholds + taxonomy | **REUSE verbatim** (`mine.py`) | pre-registered before any measured run; re-registering would be thresholds-shopping |
| `m1-diversity.json` (M1 GO: J_spawn 0.043) | **REUSE as committed evidence** | committed at c3ab4c0, seed axis is not degenerate; my sweep does not repeat M1 |
| `templates/world-{corridor,junction}.template.json` | **REUSE with a feasibility fix** | measured: 30 s clip is `runway_insufficient` on yale-street junction sites (needs 398.2 m, site provides 235.9 m); my variant shortens the clip and slows the ego (§2) |
| `sweep_m2.py` | **SUPERSEDE** (my driver) | it shells the CLI and cannot set `aggressiveness`/`vehicleMix` — the CLI never exposes them; my driver calls `runCell` programmatically (§1) which is the whole point of the aggressive/heterogeneous arm |
| `promote.py`/`recast.py` M4 re-cast route | **SUPERSEDE as primary, keep as fallback** | new promotion route discovered: TAG-STRIP (§3) preserves the organically-emerged trajectory exactly at zero authoring cost; re-cast re-introduces the authored path and is retained only for ambient↔ambient events (ego not a participant) |
| `promote.py` perturbation arm (structural-fail demo) | **REUSE** (re-measured here) | honest demonstration that a raw world-run can never pass the frozen gate (§1 fact 2) |
| `label_and_judge.py`, `novelty.py` | REUSE if M5-time permits | no disagreement, just sequencing |

W8/W9 inheritance noted: default cheap authoring/judging model is now `gpt-5.6-sol/low`;
this stream's instruments are deterministic, LLM only at the labelling edge.

## 1. The ambient-enablement recipe (undocumented territory, now documented)

### CLI surface (the only documented-by-code path)

```
node packages/cli/bin/uniscenarios.js batch <template.json> \
  --map <mapId>|--maps a,b|--all-maps --draws N --out <dir> \
  --ambient off|light|moderate|city|heavy \
  [--ambient-density <veh/km, 0-80>] [--ambient-max-actors <0-128>] \
  [--ambient-radius-m <25-2000>] [--ambient-seed <string>] \
  [--ambient-settle <0-300 s>]
```

- `--ambient` absent → empty road, **byte-identical artifacts to pre-ambient builds** (`main.ts:143-146`).
  Any `--ambient-*` override without `--ambient` is a hard CLI error, not a silent no-op.
- Preset densities (veh/km eligible lane): light 3, moderate 8, city 8, heavy 16 (`ambient/traffic.ts:207-214`).
  City preset additionally defaults pedestrianShare 0.06, cyclistShare 0.02, aggressiveness 0.25,
  speedVariance 0.10, maxActors 32, radiusM 275, exclusionRadiusM 16.
- `--ambient-settle` defaults to **20 s** when `--ambient` is on (`main.ts:117`): an ambient-ONLY
  prologue before t=−warmup that produces standing queues; part of the replay key
  (`profileHash+settle20`), i.e. same seed settled 0 s vs 20 s are different worlds by design.
- Profile fields **not** reachable from the CLI: `aggressiveness`, `speedVariance`, `vehicleMix`,
  `pedestrianShare`, `cyclistShare`, `flows`. They are reachable programmatically:
  `import { runCell } from 'packages/cli/dist/index.js'` — `CellOptions.ambient` takes the full
  `AmbientTrafficProfile`. My harvest driver uses this (`tools/research/emergent/`).

### Demonstrated (smoke, 2026-08-16)

```
batch tools/tg-research/worldgen/templates/world-junction.template.json \
  --map yale-street --draws 1 --max-sites 2 --out /tmp/tgr-emergent-smoke1/on --ambient city
```
→ 2 cells, ambient actorCount 20/24, `nearSubjectAtT0` 0–2, `stoppedAtT0` 6–7 (queues exist),
trace `header.ambientActorIds` populated; ambient-off run of the same cells: 5.1 s wall,
ambient-on: 14.2 s wall (≈2.8×; the 20 s settle is ambient-only integration).

### Structural facts that shape both arms (source-verified)

1. **Ambient actors are ordinary physical bodies but never metric subjects.** Engine tags them
   (`tags:['ambient']`, engine.ts:468); metric pairs touching an ambient id are `ambient-excluded`
   (monitored-pairs.ts:61-65) so `minTTC`/`requiredDecel` never see them; the frozen gate skips
   `header.ambientActorIds` in C2/C3 (tg_gate.py:126-130) and C5 ignores ambient↔ambient collisions
   but **counts ego↔ambient and authored↔ambient contacts** (tg_gate.py:180-181).
   ⇒ a raw ambient world-run can NEVER pass the frozen gate (clearance=None → C3 fail): promotion is
   mandatory, not optional. Matches prior PREREG M4; demonstrated below (§3, perturbation arm).
2. **Ambient traffic changes authored dynamics too.** With ≥1 ambient actor, ALL road-kind actors
   (ego included) switch to seeded naturalistic driver profiles — desiredSpeedFactor, headway,
   reaction time 0.4–0.8 s, startDelay 0.25–0.65 s (engine.ts:683-703). Ambient-on is NOT
   authored-dynamics + background; arm (i) measures the consequence instead of assuming superposition.
3. **The authored corridor is reserved.** Candidates whose spawn or in-clip route touches any lane of
   an authored `lanePath` are rejected (traffic.ts:378-397, 452-480) ⇒ ambient can never become the
   ego's leader in its own lane; organic conflicts are crossing/merging geometry, at junctions.
   `allowAuthoredCorridor:true` exists programmatically for deliberate contact seeking.
4. **Evidence-join defect found (reported to EngineLane, cc Main).** On some signalized sites the
   engine's `resolveOverlappingControlLanes` repairs the input AFTER the materializer stamped
   `inputHash` → `trace_input_hash_mismatch` → verdict reject → C5 dead. Deterministic repro:
   world-junction × yale-street site `02331c12992a78c2` × `--ambient city`; repair
   `{controlId: signal:1432, 76:0:-1 → 320:0:-1, 1.0 m}`; hash of control-resolved input equals the
   trace header hash exactly. Until EngineLane lands the fix, such cells are tallied as death cause
   `harness:evidence-mismatch`, never as physics. EngineLane confirmed materializer-side fix queued.

## 2. Arm (i) — paired ambient on/off on gate-passing templates

Design (running): template screen → ≥15 gate-passing templates → paired runs, identical cell seeds
(cellSeed is a hash of template×site×draw coordinates — ambient does not enter it), at
light(3)/city(8)/heavy(16) veh/km vs off. Measures: frozen-gate survival + first-failure census
(+ separate `harness:evidence-mismatch` bucket), replay determinism (decompressed byte-compare of
re-run traces), dynamism census delta (shared `dynamism_census.py`, pending FreeformLane),
cell artifacts per contract §2 for FootageLane.

*(results pending)*

## 3. Arm (ii) — emergent harvest (no scripted challenger)

Design (running): feasibility-fixed junction/merge world templates; programmatic sweep via `runCell`
with custom profiles (aggressiveness 0.25→0.8, heterogeneous vehicleMix, density 8→32, maxActors→64,
seeds ≥50/config); mine with pre-registered `mine.py`; promote ego-involved events by **tag-strip**:
remove `'ambient'` from the counterpart's `tags` in the instance input, re-simulate the SAME input
otherwise, evaluate, then gate with the frozen gate. The promoted run is a new deterministic world
(the pair becomes mutually visible to conflict logic and metrics); yield is counted on the PROMOTED
cell's gate verdict, cost on the full pipeline (world-runs + promotion re-runs).

*(results pending)*

## 4. Bonus probe — signal blackout

*(pending; only if time permits after arms (i)/(ii))*

## Falsifier verdicts (RETHINK-PLAN §3C)

*(to be stated plainly at close; ledger below updated as evidence lands)*

- ambient breaks replay determinism: **pending**
- gate C5 rejects everything from ambient contacts: **pending**
- harvest yield ≈0 / only trivial rear-ends: **pending**
- footage judge scores ambient less realistic: **owned by FootageLane on my artifacts; pending**
