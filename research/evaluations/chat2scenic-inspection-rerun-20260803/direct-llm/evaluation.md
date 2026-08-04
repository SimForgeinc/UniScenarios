# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:05:33.730Z to 2026-08-04T06:07:28.147Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `provider default (omitted)`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| direct-llm | 6/10 | 9/10 | 3 | 1 | 0 | 0/0 | — | 9603 | 10052 | 76 | — | 11 | 36828 |

## Case outcomes

| Case | direct-llm |
|---|---|
| Lead vehicle hard braking | semantic-mismatch |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | semantic-mismatch |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | success |
| Multi-actor intersection conflict | success |
| Stopped vehicle blocks lane | success |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | success |
| Deliberately impossible request | unexpected-generation |

## Representative failures

- **direct-llm / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **direct-llm / Signalized turn conflict:** semantic-constraints — signal-control: signal plan/control/action
- **direct-llm / Pedestrian near miss:** provider-generation — choreography.interactions.1: "pedestrian-crossing" and "pedestrian-near-miss" both take the topology axis of "adult-pedestrian" at t=5s; one axis has one owner
- **direct-llm / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

