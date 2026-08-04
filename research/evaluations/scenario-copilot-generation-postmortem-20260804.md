# Scenario Copilot generation research postmortem

**Date:** 2026-08-04
**Decision:** No-go for scenario authoring in the current representation and validation stack.

> **Decisive result:** The product owner watched and read most of the saved scenarios and judged them broadly nonsensical, incoherent, and dramatically below acceptable quality. This human review overrides the automated `strict success` and `Matches request` labels. Those labels measured a limited mechanical and assertion-based contract; they did not measure whether a scenario was sensible or useful. None of the evaluated approaches is currently suitable for autonomous or assisted scenario authoring.

This is a candid record of what was built, measured, learned, and invalidated. It does not rewrite the raw artifacts. The original measurements remain in the linked JSON, CSV, and evaluation reports.

## Objective and scope

The research question was whether natural-language models could create editable, map-bound traffic scenarios that:

1. represented a user's requested edge case;
2. used the current OpenDRIVE map correctly;
3. survived trusted materialization into the UniScenarios schema;
4. completed the canonical 20-second simulator run; and
5. were useful enough to open and continue authoring in the Studio.

The work began with a fixed 10-case edge-case corpus on Richmond Field Station, then expanded to a frozen 20-case corpus. The larger corpus added relative pedestrian triggers, occlusion between parked vehicles, synchronized near misses, emergency yielding, delayed signal turns, rear-gap merges, bus-occluded cyclists, sequential lane-change/braking, and a second negative control. The two negative controls requested unsupported or contradictory behavior and were intended to test rejection rather than generation.

The experiments were research evaluations, not production deployment tests. They used one generated candidate per case and one run per condition.

## Methods evaluated

Seven generation architectures were implemented or adapted:

- **Direct LLM:** one-pass generation of a typed native intent/draft, followed by bounded schema repair when needed.
- **Structured + retrieval:** a staged, clean-room Chat2Scenic-inspired pipeline that decomposed the prompt and used retrieved examples before producing a native draft.
- **Upstream Chat2Scenic:** a pinned research adapter around the published repository, with its generated intent constrained at a trusted map/materialization boundary.
- **Iterative text simulation agent:** up to four model iterations using canonical simulator and validator feedback without an image.
- **Iterative vision simulation agent:** the same loop with a deterministic 640×640 bird's-eye image showing map context, actor footprints, paths, time annotations, and predicted conflict areas.
- **Relative goal optimizer:** deterministic search around typed relative-distance, time-to-collision, merge, and near-miss goals.
- **Verified template search:** parameter search over a small set of known runnable scenario templates.

The high-effort matrix used `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-5.6-terra` for the direct comparison. Architecture comparisons primarily used Luna; the strongest automated iterative method was rerun with Terra. Exact model IDs were requested with high reasoning effort and no model substitution. The earlier 10-case comparison and its inspection rerun used Luna with reasoning effort omitted, matching that original configuration.

## Map, OpenDRIVE, and saved-result work

All controlled generation runs used `richmond-field-station`. A shared trusted-slot builder bound generated actors to known map placements and routes. The upstream research adapter loaded the raw Richmond OpenDRIVE through Scenic 3.1.0, then compiled and sampled a constrained scene before native materialization.

Important map limitations remained:

- Binding to a trusted slot established a legal-looking starting reference, not a coherent causal scene layout.
- Coarse site selection could place individually valid actors in combinations that did not support the requested interaction.
- Some Richmond lanes were narrower than Scenic's default CARLA actor footprint; footprint containment was disabled at trusted lane-center points while native lane binding remained authoritative.
- Yale was excluded because its canonical raw OpenDRIVE did not parse cleanly in Scenic 3.1.0. No canonical map was modified to make the benchmark pass.
- The native simulator and bird's-eye evidence were two-dimensional. They could not judge visual occlusion, model shape, sight lines, realistic elevation, or whether a scene read correctly from a driver's perspective.

The research pipeline was extended to retain exact native drafts, compressed canonical traces, event summaries, map identity, scenario schema version, result hashes, semantic assertions, and deterministic bird's-eye evidence. The Generations UI then exposed only exact draft-backed records that could be reopened without another model call. Compatibility checks prevented opening a draft on the wrong map/schema, and generated actor elevations were later grounded to the actual map surface.

These were useful reproducibility and inspection improvements. They did not improve the semantic quality of the generated scenarios themselves.

## Quantitative results

### Original 10-case comparison

The first 30-run comparison produced 9 automated strict successes and 27 full 20-second simulations:

| Method | Strict success | Full 20s | API calls | Tokens | Median generation |
|---|---:|---:|---:|---:|---:|
| Structured + retrieval | 2/10 | 8/10 | 10 | 12,362 | 5.0 s |
| Direct LLM | 4/10 | 9/10 | 10 | 29,422 | 7.2 s |
| Upstream Chat2Scenic | 3/10 | 10/10 | 82 | 234,943 | 51.2 s |

Scenic compile and sample time was only 277 ms at the median. The upstream latency and cost came primarily from its multi-call model workflow, not Scenic execution.

### Saved-result inspection rerun

The separate 30-run inspection rerun retained 29 drafts and 26 complete traces. It recorded 13 automated strict successes, 103 API calls, and 286,220 tokens. The rerun was conducted to create inspectable evidence and must not replace the original timing comparison; parallel load and a different run date affect latency.

### Controlled 20-case, high-effort matrix

The controlled matrix comprised 160 runs, 216 API calls, and 948,757 tokens. It recorded 67 automated strict successes, 93 full simulations, 10 correct negative-control rejections, 6 false acceptances, and 57 pipeline failures.

| Method | Model | Strict | Correct rejects | False accepts | Full sim | Calls | Tokens | Median generation |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Direct LLM | Luna | 12/20 | 0 | 2 | 17 | 24 | 100,655 | 14.6 s |
| Direct LLM | Sol | 11/20 | 0 | 2 | 18 | 22 | 90,292 | 21.2 s |
| Direct LLM | Terra | 11/20 | 0 | 2 | 18 | 22 | 68,959 | 8.4 s |
| Iterative text | Luna | 9/20 | 2 | 0 | 9 | 52 | 297,716 | 88.0 s |
| Iterative text | Terra | 11/20 | 2 | 0 | 11 | 49 | 177,134 | 32.7 s |
| Iterative vision | Luna | 7/20 | 2 | 0 | 7 | 19 | 112,416 | 25.9 s |
| Relative optimizer | Luna | 3/20 | 2 | 0 | 3 | 18 | 95,696 | 26.3 s |
| Template search | Luna | 3/20 | 2 | 0 | 10 | 10 | 5,889 | 3.8 s |

Before human review, Direct Luna appeared to have the highest positive-case coverage, Direct Terra appeared the most efficient one-pass model, and iterative-text Terra appeared the safest automated combination because it rejected both negative controls. Those are accurate descriptions of the automated measurements only. They are not product-quality rankings.

## What each gate actually proved

The main evaluation error was treating four different claims as though they were progressively stronger versions of the same quality signal.

| Gate | What it proved | What it did not prove |
|---|---|---|
| Schema/native validity | The document had supported fields and could be materialized. | The actors, routes, actions, or timings made sense together. |
| Full 20-second simulation | The canonical engine advanced the document for 20 seconds without a fatal pipeline error. | Requested actions occurred, outcomes were reached, motion looked plausible, or the scene was useful. |
| Automated semantic assertions | A small set of expected fields, actor classes, action types, or trigger forms was present. | Causality, geometry, clearance, occlusion, signal compliance, interaction success, or narrative coherence. |
| Human scenario quality | An expert could understand the scene, observe the intended edge case, and accept it as an authoring starting point. | This was not encoded in the automated benchmark and ultimately failed. |

`Strict success` meant the first three gates passed. It never meant human acceptance. The UI's `Matches request` badge inherited that same mistake and overstated the evidence.

## Human review and known false positives

The product owner inspected most saved scenarios in the Generations UI and found them extremely poor and often nonsensical. This was not a small quality gap or a matter of choosing Luna, Sol, Terra, or a different prompting architecture. The outputs were not close to usable scenario drafts.

Concrete automated false positives included:

- **Child occluded by two parked vehicles / iterative-text Terra:** labeled an automated semantic success, but both child relative triggers were skipped during the saved simulation.
- **Merge after rear-gap acceptance / iterative-text Terra:** labeled a success, but the merge trigger was skipped.
- **Sequential lane change then brake / iterative-text Terra and iterative vision:** the lane change was rejected and aborted; the later braking action still fired.
- **Adjacent-lane cut-in / multiple methods:** the requested lane change was rejected and aborted, despite several rows satisfying the shallow cut-in assertions.
- **Synchronized conflict-point near miss / iterative-text Terra:** its relative trigger fired, but the trace also recorded road-departure prevention. Passing the assertion did not establish a coherent near miss.
- **Lead vehicle hard braking / Direct LLM inspection rerun:** completed 20 seconds but omitted the required explicit stop.
- **Deliberately impossible flying/teleporting request / all original methods:** each method generated a road-driving approximation instead of rejecting the unsupported request.
- **Distance-triggered emergency yield / template search:** completed 20 seconds using a mismatched gridlock template with no emergency actor and no relative yield action.

These examples show why simulation completion and field-presence assertions were misleading. Several scenarios that looked strongest in aggregate tables failed at their defining action when the event traces or playback were examined.

## Likely causes

### Evaluation weaknesses

- Assertions were shallow. They mostly checked actor/action presence and coarse timing rather than whether the intended event happened.
- There was no general causal or outcome validator. The harness did not require “trigger fired,” “lane change completed,” “clearance reached,” “occluder blocked line of sight,” or “signal phase caused the intended response.”
- Skipped, rejected, aborted, or road-departure-prevented actions did not automatically invalidate every relevant semantic assertion.
- The single two-dimensional simulator could verify deterministic execution but not visual intelligibility or three-dimensional occlusion.
- A single run and seed per condition provided no estimate of stochastic reliability.

### Representation and control weaknesses

- The action and trigger vocabulary was too limited for the requested behaviors. The system often approximated a semantic goal with an available action that did not produce the intended result.
- Relative triggers existed, but their placement and feasibility were not jointly solved. A syntactically correct trigger could never become true.
- Lane-change, signal, occlusion, yielding, near-miss, and sequential-action semantics lacked strong completion contracts.
- Trusted map slots were safe inputs, but they were too coarse to guarantee compatible relative geometry, conflict points, sight lines, or gaps.

### Generation-method weaknesses

- LLMs frequently hallucinated semantics: a plausible title and explanation concealed mismatched routes, actions, or outcomes.
- Iterative text feedback optimized against the same incomplete validators, so it could converge on passing the test rather than producing a good scene.
- The deterministic bird's-eye image did not improve the outcome. Vision Luna produced fewer automated strict successes than iterative text and still lacked the driver's visual perspective and a useful image-grounded objective.
- The relative optimizer could only search within an inadequate goal/action representation; it could not repair missing capabilities.
- Template search was cheap and mechanically robust, but sparse templates often matched the wrong semantics.
- The upstream Chat2Scenic workflow was expensive and did not overcome map adaptation or semantic grounding failures.
- Changing among Luna, Sol, and Terra affected latency, token use, and automated coverage, but did not solve scenario coherence.

## Implementation and evaluation issues found during the work

The experiment also exposed infrastructure defects, which were fixed without changing the raw historical results:

- Map and model contracts were tightened so runs used the requested canonical map and exact requested model without silent substitution.
- Direct-generation schema repair and safe validation errors were made explicit instead of silently accepting malformed drafts.
- Scenic compile time and sample time were measured separately.
- An initial upstream inspection attempt failed because the pinned Scenic Python environment was absent. The failed attempt was preserved, the environment was corrected, and the canonical rerun remained separate.
- Saved results were made inspectable: exact drafts, traces, hashes, semantic evidence, and deterministic bird's-eye images were persisted.
- The history loader was changed to discover all experiment artifacts while avoiding duplicate rows from consolidated indexes.
- Draft opening was constrained by scenario schema, source map, and map hash where available.
- Generated actors initially opened at a generic elevation. Saved and new generated drafts now sample the map surface without changing their two-dimensional simulation identity.
- Draftless failures were kept in research artifacts and excluded from the authoring gallery rather than being presented as reopenable scenarios.

These fixes increased safety, reproducibility, and observability. They do not rescue the generation-quality result.

## Decision and recommendations

### Immediate decision

Stop treating any current provider or model as a scenario-authoring solution. Do not continue broad model/provider sweeps against the current benchmark: the validator and representation are the bottleneck, and another model ranking would optimize a misleading score.

Until a trustworthy objective validator exists, use an LLM only to produce a typed, reviewable intent. Do not let it claim a finished or request-matching scenario merely because a document materializes and runs.

### Required next research baseline

1. Build a small hand-authored gold set with exact actor poses, routes, triggers, signal states, expected event sequence, tolerances, and rendered reference videos.
2. Define an expert rubric covering prompt fidelity, causal correctness, safety relevance, visual coherence, map appropriateness, editability, and whether the scenario is worth continuing to author.
3. Make event causality executable: required triggers must fire; requested maneuvers must complete; forbidden aborts/skips must fail; target clearance, TTC, collision, occlusion, yielding, and signal outcomes must be measured.
4. Improve the representation before generation: first-class relative triggers, conflict-point constraints, occlusion geometry, signal-phase dependencies, lane-change completion, and sequential action contracts.
5. Use a deterministic planner/optimizer to solve map placement and action parameters. The LLM should select typed goals and explain assumptions, not invent continuous geometry or claim success.
6. Require a blind human acceptance gate on held-out prompts. Automated metrics may screen candidates, but a method is not viable until experts accept its outputs without knowing the provider.
7. Re-baseline all methods only after the representation and validators change. Preserve the current corpus as a regression set, not as a product-quality benchmark.

## What remains valuable

The negative product result does not make the engineering work valueless. The project now has:

- isolated provider boundaries that keep credentials and raw model behavior out of browser code and committed artifacts;
- exact model/effort accounting, API-call counts, token counts, and latency comparisons;
- reproducible canonical 20-second traces with event summaries and hashes;
- deterministic bird's-eye evidence for iteration and debugging;
- a frozen prompt corpus with explicit negative controls;
- safe map/schema compatibility checks for saved drafts;
- an experiment registry and gallery for zero-model-call inspection; and
- evidence that mechanical simulation is fast relative to generation and is not the primary bottleneck.

This infrastructure is a useful foundation for evaluating a better representation and objective validator. It is not evidence that the current generated scenarios are good.

## Limitations and licensing

- Each condition used one generation per case and one seed where a seed applied. There are no confidence intervals and no estimate of run-to-run variance.
- The corpus used one production map. Results may expose Richmond-specific failures and do not establish behavior on other OpenDRIVE maps.
- Human review was decisive for the product decision but was not conducted as a blinded, scored, multi-reviewer study. The next evaluation should formalize that process.
- The published Chat2Scenic repository did not include its referenced Milvus snapshot. The adapter used the disclosed prompt-example substitute rather than reproducing the paper's complete retrieval corpus.
- Published Gemini defaults were replaced with the uniformly available Luna model for the original cross-method comparison.
- Raw model-generated Scenic/Python was not executed. A trusted adapter lowered intent into constrained placements before Scenic/native execution.
- The upstream Chat2Scenic repository is CC BY-NC 4.0. That integration is research-only and cannot be treated as a commercial product dependency without separate permission.

## Evidence index

- [Original 10-case evaluation](chat2scenic-20260803/evaluation.md)
- [Saved-result inspection rerun](chat2scenic-inspection-rerun-20260803/REPORT.md)
- [Controlled 20-case high-effort matrix](copilot-high-matrix-20260803/evaluation.md)
- [Controlled matrix machine-readable results](copilot-high-matrix-20260803/results.json)
- [Controlled matrix experiment manifest](copilot-high-matrix-20260803/manifest.json)
