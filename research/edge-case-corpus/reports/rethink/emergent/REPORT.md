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
   `harness:evidence-mismatch`, never as physics. **RESOLVED**: EngineLane landed the
   materializer-side fix (b511f7c, regression test `evidence-join-control-repair.test.ts`);
   repro cell now `evidenceOk=true`. Every measured arm below runs on the fixed build; the only
   old-build artifacts (12 harvest pilot cells) were deleted and re-run.
5. **Programmatic ≡ CLI equivalence (measured).** `runCell` with
   `ambient:{preset:'heavy',maxActors:48,seed:'h1'}, ambientSettleSeconds:20` reproduces the CLI
   cell (`--ambient heavy --ambient-max-actors 48 --ambient-seed h1`) **bit-for-bit**: identical
   `inputHash` `16a5d138…` and `traceDigest` `6156d010…` (emergent-junction-straight ×
   yale-street/0123925723ddef80). Commands in `/tmp/tgr-emergent-equiv`, recorded here because the
   whole harvest rests on it. This double-run is also a first determinism datapoint.

## 2. Arm (i) — paired ambient on/off on gate-passing templates

Design (running): template screen → ≥15 gate-passing templates → paired runs, identical cell seeds
(cellSeed is a hash of template×site×draw coordinates — ambient does not enter it), at
light(3)/city(8)/heavy(16) veh/km vs off. Measures: frozen-gate survival + first-failure census
(+ separate `harness:evidence-mismatch` bucket), replay determinism (decompressed byte-compare of
re-run traces), dynamism census delta (shared `dynamism_census.py`, pending FreeformLane),
cell artifacts per contract §2 for FootageLane.

**Template screen (done).** Screen = batch `--maps belmont-research-center,el-camino-road[,yale-street]
--max-sites 2 --draws 2`, frozen gate per cell, template passes with ≥1 passing cell.
Commands: `tools/research/emergent/screen_templates.py --out /tmp/tgr-emergent-screen1` (core pool)
and `--out /tmp/tgr-emergent-screen2 --pool extend --maps …,yale-street` (vista-corpus pool).
- core pool (examples/ + examples/mechanisms/): **4/38** templates pass — these curated mechanism
  templates are site-tuned and mostly die C2/C5 on generic screen sites.
- vista-corpus pool: **44/60** pass (screen2/screen.json).
Selected 18 for the paired arm, spanning C1/C2/C3/C5/C6/C7/C8/C11/C12/C14:
c1-stop-and-go, c1-lead-hard-brake, c11-aisle-conflict, c11-backing-out, c12-school-dropoff,
c14-third-party-spin, c2-exit-across, c2-merge-gap-collapse, c2-ramp-merge, c2-weave,
c3-left-hook-ptw, c3-red-light-late, c5-reversing-ped, c5-adult-midblock, c6-cbna,
c7-crest-occludes, c7-bus-occludes-cyclist, c8-night-zone.
Note: the shared briefs sample (CONTRACTS §5) governs brief-authoring arms; arm (i) is a
template re-run design per RETHINK-PLAN §3C ("N admitted W7 templates re-run with ambient
on/off"), so it draws from the W7 template family, not the briefs sample.

Main run: 18 templates × {off, light, city, heavy}, `--ambient-seed pairseed1`, settle 20 s (CLI
default). First 2 templates at 3 maps × ≤3 sites × 3 draws with per-arm determinism re-runs
(`pair_arm.py … --max-sites 3 --draws 3 --rerun 9`, report `pair-report-stage1.json`); measured at
~38 min/template that projected to 11 h, so the remaining 16 ran at `--max-sites 2 --draws 2
--skip-determinism` (report `pair-report.json`). Both stages on the fixed build, gated per cell by
the frozen gate. Dynamism census: shared `tools/research/shared/dynamism_census.py` frozen at
sha256 `e22b25d73930804f08145db344a7f8751e2d2fbf3c8f25dba5de8975682f43c5`.

### Results (964 cells, 241 gated pairs per arm)

**Gate survival (headline):**

| arm | density veh/km | passed/cells | rate |
|---|---|---|---|
| off | 0 | 96/249 | **38.6%** |
| light | 3 | 89/249 | **35.7%** |
| city | 8 | 80/249 | **32.1%** |
| heavy | 16 | 79/249 | **31.7%** |

(249 = gated cells incl. no-trace errors; census rows = 241 cells/arm with traces. Aggregation:
`python - <<merge stage1+stage2 pair-report jsons>>`, table in session log; per-template rows in
`pair-report*.json`.)

Ambient costs the gate 3–7 pp of survival — **no collapse** (falsifier "C5 rejects everything from
ambient contacts": FALSE). Death-census movement off→heavy: `C5:collision-with-ambient` appears at
17/20/20 cells (light/city/heavy; 6.8–8.0% of cells); `C5:trigger-never-fired` appears at city (8)
— ambient-perturbed dynamics make scripted `when` triggers miss; C4 *drops* slightly under ambient
(50→41/44/43) because traffic pressure creates genuine decel demand in cells that were C4-dead when
empty. Ambient RESCUES some templates outright: c1-lead-hard-brake off 5/27 → 9/27 every ambient
arm; c7-crest-occludes off 4/12 → light 7/12; c5-reversing-ped 8/12 → 9/12 (light/city).
Direction is template-dependent and non-monotonic in density (c1-stop-and-go: 15/12/6/11).

**Replay determinism: PASS.** 36/36 re-run traces byte-identical after decompression (9 per arm ×
4 arms on c1-stop-and-go at 3 maps; `determinism` rows in `pair-report-stage1.json`), plus the
CLI≡programmatic double-run (§1 fact 5) with identical traceDigest. Falsifier "ambient breaks
replay determinism": FALSE.

**Dynamism census delta (off → light/city/heavy, per-cell means, 241 cells/arm,
`census-delta.json`):**

| metric | off | light | city | heavy |
|---|---|---|---|---|
| actorsMoving | 1.74 | 10.93 | 20.69 | 26.89 |
| interactingPairs (TTC<5s) | 1.12 | 20.74 | 56.08 | 90.96 |
| hardBrakeEvents | 1.67 | 7.39 | 13.63 | 15.46 |
| swerveEvents | 0.05 | 0.33 | 0.89 | 0.94 |
| laneChangesExecuted | 0.07 | 0.08 | 0.10 | 0.07 |
| authoredEventsFired | 2.74 | 2.75 | 2.76 | 2.73 |
| speedVarianceEgoPath | 15.75 | 15.90 | 15.95 | 16.01 |

The world comes alive (interaction density up ~80×, hard braking up ~9×) while authored
choreography still fires identically (authoredEventsFired flat) and the ego's own speed profile is
barely touched. Lane changes stay flat — ambient routes don't lane-change; that is an engine
vocabulary gap worth naming for EngineLane, not a census artifact.

**Footage judge (FootageLane, sol/medium, n=111–117/arm on the first 456 cells):** dynamism judged
UP decisively in every ambient arm (Δ +1.9…+2.2; e.g. 96 up / 4 down at city); realism judged UP at
light (Δ +0.31, sign-test p=0.007), flat at city/heavy with plausibility sliding 0.69→0.52 —
the "identical sedans" monotony effect is real but shows as *no gain past light*, not a penalty.
Falsifier "footage judge scores ambient scenes less realistic": FALSE (light arm is judged MORE
realistic; details in FootageLane REPORT §5).

**Cell artifacts:** 964 contract-§2 cell dirs at `/tmp/tgr-emergent-pair1/cells/` (announced;
FootageLane judged 456, second round in flight).



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
