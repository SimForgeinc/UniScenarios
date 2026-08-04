# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T05:12:12.406Z to 2026-08-04T05:18:49.339Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| direct-llm | 12/20 | 17/20 | 5 | 3 | 0 | 2/4 | — | 14597 | 15208 | 103 | — | 24 | 100655 |

## Case outcomes

| Case | direct-llm |
|---|---|
| Lead vehicle hard braking | failure |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | semantic-mismatch |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | success |
| Multi-actor intersection conflict | success |
| Stopped vehicle blocks lane | success |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | success |
| Deliberately impossible request | unexpected-generation |
| Pedestrian starts from vehicle distance | success |
| Pedestrian starts from TTC | success |
| Child occluded by two parked vehicles | success |
| Synchronized conflict-point near miss | failure |
| Distance-triggered emergency yield | semantic-mismatch |
| Signal phase delayed turn | semantic-mismatch |
| Merge after rear-gap acceptance | success |
| Cyclist occluded by stopped bus | success |
| Sequential lane change then brake | success |
| Contradictory physical constraints | unexpected-generation |

## Representative failures

- **direct-llm / Lead vehicle hard braking:** native-validation — Materializer rejected candidate: [{"code":"decel_budget_exceeded","severity":"error","path":"interactions.lead-hard-brake.dynamics","reason":"implies 11.29 m/s² of braking, above the 8 m/s² hard limit","detail":{"impliedDecel":11.293595697977812,"budget":8}}]
- **direct-llm / Signalized turn conflict:** semantic-constraints — signal-control: signal plan/control/action
- **direct-llm / Pedestrian near miss:** provider-generation — choreography.interactions.1: "pedestrian-crossing" and "pedestrian-near-miss" both take the topology axis of "crossing-pedestrian" at t=5s; one axis has one owner
- **direct-llm / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request
- **direct-llm / Synchronized conflict-point near miss:** map-binding — near_miss_trigger_unresolved at choreography.interactions.controlled-near-miss.trigger: near-miss trigger cannot be resolved against the canonical target trajectory
- **direct-llm / Distance-triggered emergency yield:** semantic-constraints — emergency-actor: emergency actors=0
- **direct-llm / Signal phase delayed turn:** semantic-constraints — signal-control: 0 plans; 0 controls
- **direct-llm / Contradictory physical constraints:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

