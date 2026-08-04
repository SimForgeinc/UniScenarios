# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:05:33.730Z to 2026-08-04T06:06:36.862Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `provider default (omitted)`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| staged-rag | 2/10 | 8/10 | 6 | 2 | 0 | 0/0 | — | 5457 | 5566 | 117 | — | 10 | 12035 |

## Case outcomes

| Case | staged-rag |
|---|---|
| Lead vehicle hard braking | semantic-mismatch |
| Adjacent-lane cut-in | semantic-mismatch |
| Signalized turn conflict | semantic-mismatch |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | failure |
| Multi-actor intersection conflict | success |
| Stopped vehicle blocks lane | success |
| Opposing left turn | semantic-mismatch |
| Motorcycle and cyclist interaction | semantic-mismatch |
| Deliberately impossible request | unexpected-generation |

## Representative failures

- **staged-rag / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **staged-rag / Adjacent-lane cut-in:** semantic-constraints — lateral-action: changeLane or laneOffset action
- **staged-rag / Signalized turn conflict:** semantic-constraints — turn-route: route turn/path action; signal-control: signal plan/control/action
- **staged-rag / Pedestrian near miss:** native-validation — Materializer rejected candidate: [{"code":"decel_budget_exceeded","severity":"error","path":"interactions.crossing_pedestrian-generated-speed.dynamics","reason":"implies 21.67 m/s² of braking, above the 8 m/s² hard limit","detail":{"impliedDecel":21.666666666666668,"budget":8}}]
- **staged-rag / Occluded pedestrian emergence:** native-validation — Materializer rejected candidate: [{"code":"decel_budget_exceeded","severity":"error","path":"interactions.child_pedestrian-generated-speed.dynamics","reason":"implies 21.67 m/s² of braking, above the 8 m/s² hard limit","detail":{"impliedDecel":21.666666666666668,"budget":8}}]
- **staged-rag / Opposing left turn:** semantic-constraints — turn-route: route turn/path action
- **staged-rag / Motorcycle and cyclist interaction:** semantic-constraints — lateral-action: lateral or near-miss action
- **staged-rag / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

