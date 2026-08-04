# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T04:23:34.881Z to 2026-08-04T04:39:44.552Z
- Model requested uniformly: `gpt-5.6-luna`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| staged-rag | 2/10 | 8/10 | 6 | 2 | 0 | 5034 | 5172 | 140 | — | 10 | 12362 |
| direct-llm | 4/10 | 9/10 | 5 | 1 | 0 | 7220 | 7296 | 91 | — | 10 | 29422 |
| upstream-chat2scenic | 3/10 | 10/10 | 7 | 0 | 0 | 51174 | 51251 | 99 | 277 | 82 | 234943 |

## Case outcomes

| Case | staged-rag | direct-llm | upstream-chat2scenic |
|---|---|---|---|
| Lead vehicle hard braking | semantic-mismatch | failure | semantic-mismatch |
| Adjacent-lane cut-in | semantic-mismatch | success | success |
| Signalized turn conflict | semantic-mismatch | semantic-mismatch | semantic-mismatch |
| Pedestrian near miss | failure | semantic-mismatch | semantic-mismatch |
| Occluded pedestrian emergence | failure | semantic-mismatch | semantic-mismatch |
| Multi-actor intersection conflict | success | success | success |
| Stopped vehicle blocks lane | success | success | success |
| Opposing left turn | semantic-mismatch | semantic-mismatch | semantic-mismatch |
| Motorcycle and cyclist interaction | semantic-mismatch | success | semantic-mismatch |
| Deliberately impossible request | unexpected-generation | unexpected-generation | unexpected-generation |

## Representative failures

- **staged-rag / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **staged-rag / Adjacent-lane cut-in:** semantic-constraints — lateral-action: changeLane or laneOffset action
- **staged-rag / Signalized turn conflict:** semantic-constraints — turn-route: route turn/path action; signal-control: signal plan/control/action
- **staged-rag / Pedestrian near miss:** native-validation — Materializer rejected candidate: [object Object]
- **staged-rag / Occluded pedestrian emergence:** native-validation — Materializer rejected candidate: [object Object]
- **staged-rag / Opposing left turn:** semantic-constraints — turn-route: route turn/path action
- **staged-rag / Motorcycle and cyclist interaction:** semantic-constraints — lateral-action: lateral or near-miss action
- **staged-rag / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request
- **direct-llm / Lead vehicle hard braking:** native-validation — Materializer rejected candidate: [object Object]
- **direct-llm / Signalized turn conflict:** semantic-constraints — turn-route: route turn/path action; signal-control: signal plan/control/action
- **direct-llm / Pedestrian near miss:** semantic-constraints — near-miss-target: route nearMiss target
- **direct-llm / Occluded pedestrian emergence:** semantic-constraints — static-large-occluder: static occluder; catalogs=vehicle.sedan,vehicle.van,pedestrian.child_walking

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

## Interpretation

- The direct native approach is the best current product baseline: 4/10 strict
  semantic successes versus 3/10 upstream and 2/10 staged, with roughly one
  seventh of upstream median generation latency and one eighth of its tokens.
- The upstream research adapter was the most mechanically robust: all ten
  outputs bound to Richmond, remained editable, and completed the full
  20-second canonical simulation. Its six semantic mismatches show that
  compilation and simulation do not establish prompt fidelity.
- Every approach incorrectly materialized the deliberately impossible flying,
  teleporting request. A deterministic feasibility/rejection classifier is a
  release blocker before any mode can be presented as autonomous authoring.
- The upstream pipeline succeeded on cut-in, multi-actor intersection, and
  blocked-lane cases. It missed hard-stop, signal/turn, explicit near-miss,
  static occluder, left-turn route, and motorcycle/cyclist lateral semantics.
- Scenic compilation itself was not the bottleneck: upstream's median combined
  compile/sample time was 277 ms. Its median 51.2-second generation time came
  from the published multi-agent structure (82 API calls and 234,943 tokens
  across ten cases).

## Research-fidelity caveats

- The exact upstream commit and prompts are pinned and attributed, but the
  Milvus vector database snapshot referenced by the repository is not present
  in Git. Evaluation therefore used examples embedded in the original prompts
  (`prompt-examples-substitute`), not the paper's complete retrieval corpus.
- Published Gemini defaults were replaced by the uniformly available
  `gpt-5.6-luna` model so the three approaches could be compared on one model.
- Raw model-generated Scenic/Python was not executed. A strict adapter lowered
  the generated intent into trusted map slots, then Scenic 3.1.0 loaded the raw
  Richmond OpenDRIVE and compiled/sampled the fixed actor scene before native
  materialization. This is a safety deviation from the repository.
- Some Richmond lanes are narrower than Scenic's default CARLA actor footprint.
  Footprint containment was disabled for trusted lane-center points; native
  lane binding and the canonical simulation remained authoritative.
- Yale was not used for this run because its canonical raw OpenDRIVE does not
  currently parse cleanly in Scenic 3.1.0. No canonical map was modified.
- CC BY-NC 4.0 restricts the pinned upstream mode to noncommercial research.
