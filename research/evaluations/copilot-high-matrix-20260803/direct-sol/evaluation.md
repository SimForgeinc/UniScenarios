# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T05:19:15.324Z to 2026-08-04T05:30:13.739Z
- Model requested uniformly: `gpt-5.6-sol`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| direct-llm | 11/20 | 18/20 | 7 | 2 | 0 | 4/8 | — | 21238 | 21335 | 100 | — | 22 | 90292 |

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
| Opposing left turn | semantic-mismatch |
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

- **direct-llm / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **direct-llm / Signalized turn conflict:** semantic-constraints — signal-control: signal plan/control/action
- **direct-llm / Pedestrian near miss:** map-binding — near_miss_infeasible_speed at choreography.interactions.pedestrian-crossing-near-miss.target: no collision-free near miss satisfies the time, speed and clearance bounds
- **direct-llm / Opposing left turn:** semantic-constraints — turn-route: route turn/path action
- **direct-llm / Deliberately impossible request:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request
- **direct-llm / Synchronized conflict-point near miss:** map-binding — near_miss_trigger_unresolved at choreography.interactions.near-miss-1.trigger: near-miss trigger cannot be resolved against the canonical target trajectory
- **direct-llm / Distance-triggered emergency yield:** semantic-constraints — emergency-actor: emergency actors=0
- **direct-llm / Signal phase delayed turn:** semantic-constraints — delayed-turn: turn=false; delayed=false; signal-control: 0 plans; 0 controls
- **direct-llm / Contradictory physical constraints:** unsupported-request-not-rejected — Provider materialized and simulated an unsupported request

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

