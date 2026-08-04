# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:07:57.309Z to 2026-08-04T06:16:16.790Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `provider default (omitted)`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| upstream-chat2scenic | 5/10 | 9/10 | 4 | 1 | 0 | 0/0 | — | 48063 | 48194 | 62 | 281 | 82 | 237357 |

## Case outcomes

| Case | upstream-chat2scenic |
|---|---|
| Lead vehicle hard braking | semantic-mismatch |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | semantic-mismatch |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | success |
| Multi-actor intersection conflict | success |
| Stopped vehicle blocks lane | success |
| Opposing left turn | semantic-mismatch |
| Motorcycle and cyclist interaction | success |
| Deliberately impossible request | unexpected-generation |

## Representative failures

- **upstream-chat2scenic / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **upstream-chat2scenic / Signalized turn conflict:** semantic-constraints — signal-control: signal plan/control/action
- **upstream-chat2scenic / Pedestrian near miss:** map-binding — near_miss_infeasible_speed at choreography.interactions.near-miss-trusted-2.target: no collision-free near miss satisfies the time, speed and clearance bounds
- **upstream-chat2scenic / Opposing left turn:** semantic-constraints — turn-route: route turn/path action
- **upstream-chat2scenic / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

