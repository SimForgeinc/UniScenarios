# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:26:42.194Z to 2026-08-04T06:39:36.294Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| simulation-agent-vision | 7/20 | 7/20 | 0 | 11 | 2 | 2/4 | 1 | 25932 | 29130 | 62 | — | 19 | 112416 |

## Case outcomes

| Case | simulation-agent-vision |
|---|---|
| Lead vehicle hard braking | failure |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | failure |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | failure |
| Multi-actor intersection conflict | failure |
| Stopped vehicle blocks lane | success |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | failure |
| Deliberately impossible request | expected-rejection |
| Pedestrian starts from vehicle distance | success |
| Pedestrian starts from TTC | success |
| Child occluded by two parked vehicles | failure |
| Synchronized conflict-point near miss | failure |
| Distance-triggered emergency yield | failure |
| Signal phase delayed turn | failure |
| Merge after rear-gap acceptance | success |
| Cyclist occluded by stopped bus | failure |
| Sequential lane change then brake | success |
| Contradictory physical constraints | expected-rejection |

## Representative failures

- **simulation-agent-vision / Lead vehicle hard braking:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: two-vehicles=true: 2 vehicles; explicit-stop=false: stopped actor or zero-speed action; timed-speed-action=true: speed action at/after 4s; explicit-stop: stopped actor or zero-speed action
- **simulation-agent-vision / Signalized turn conflict:** provider-generation — choreography.interactions.1: "opposing-left-turn" and "opposing-near-miss" both take the topology axis of "opposing-sedan" at t=5s; one axis has one owner; choreography.interactions.2.actor: nearMiss routes are only supported for pedestrians
- **simulation-agent-vision / Pedestrian near miss:** provider-generation — action pedestrian-crossing lane offset must be within -1..1
- **simulation-agent-vision / Occluded pedestrian emergence:** provider-generation — action child-enters-ego-path lane offset must be within -1..1
- **simulation-agent-vision / Multi-actor intersection conflict:** provider-generation — choreography.interactions.6: "ego-pickup-conflict" and "ego-van-conflict" both take the topology axis of "ego-sedan" at t=8s; one axis has one owner; choreography.interactions.6.actor: nearMiss routes are only supported for pedestrians; choreography.interactions.7.actor: nearMiss routes are only supported for pedestrians; choreography.interactions.8.actor: nearMiss routes are only supported for pedestrians
- **simulation-agent-vision / Motorcycle and cyclist interaction:** provider-generation — action motorcycle-close-lateral-pass lane offset must be within -1..1
- **simulation-agent-vision / Deliberately impossible request:** provider-generation — Unsupported request: native road actors cannot teleport, fly, or pass through buildings.
- **simulation-agent-vision / Child occluded by two parked vehicles:** provider-generation — action action-child-emerge lane offset must be within -1..1
- **simulation-agent-vision / Synchronized conflict-point near miss:** provider-generation — choreography.interactions.2.actor: nearMiss routes are only supported for pedestrians
- **simulation-agent-vision / Distance-triggered emergency yield:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: emergency-actor=false: emergency actors=0; relative-yield=true: 1 relative yield actions; emergency-actor: emergency actors=0
- **simulation-agent-vision / Signal phase delayed turn:** provider-generation — choreography.interactions.2: "adversary-signal-plan" and "adversary-signal-wait" both take the longitudinal axis of "adversary" at t=0s; one axis has one owner; choreography.interactions.2: "adversary-signal-plan" and "adversary-signal-permit" both take the longitudinal axis of "adversary" at t=0s; one axis has one owner; choreography.interactions.3: "adversary-signal-wait" and "adversary-signal-permit" both take the longitudinal axis of "adversary" at t=0s; one axis has one owner
- **simulation-agent-vision / Cyclist occluded by stopped bus:** provider-generation — action bicycle-emergence lane offset must be within -1..1

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

