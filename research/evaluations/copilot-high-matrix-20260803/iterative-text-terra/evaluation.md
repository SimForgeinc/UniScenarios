# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:40:11.961Z to 2026-08-04T06:50:53.008Z
- Model requested uniformly: `gpt-5.6-terra`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| simulation-agent | 11/20 | 11/20 | 0 | 7 | 2 | 1/7 | 2 | 32697 | 31776 | 87 | — | 49 | 177134 |

## Case outcomes

| Case | simulation-agent |
|---|---|
| Lead vehicle hard braking | failure |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | failure |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | success |
| Multi-actor intersection conflict | success |
| Stopped vehicle blocks lane | success |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | failure |
| Deliberately impossible request | expected-rejection |
| Pedestrian starts from vehicle distance | success |
| Pedestrian starts from TTC | success |
| Child occluded by two parked vehicles | success |
| Synchronized conflict-point near miss | success |
| Distance-triggered emergency yield | failure |
| Signal phase delayed turn | failure |
| Merge after rear-gap acceptance | success |
| Cyclist occluded by stopped bus | failure |
| Sequential lane change then brake | success |
| Contradictory physical constraints | expected-rejection |

## Representative failures

- **simulation-agent / Lead vehicle hard braking:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: two-vehicles=true: 2 vehicles; explicit-stop=false: stopped actor or zero-speed action; timed-speed-action=true: speed action at/after 4s; explicit-stop: stopped actor or zero-speed action
- **simulation-agent / Signalized turn conflict:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: two-vehicles=true: 2 vehicles; turn-route=true: route turn/path action; signal-control=false: signal plan/control/action; signal-control: signal plan/control/action
- **simulation-agent / Pedestrian near miss:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; bind_current_map: near_miss_infeasible_speed at choreography.interactions.pedestrian-ego-near-miss.target: no collision-free near miss satisfies the time, speed and clearance bounds
- **simulation-agent / Motorcycle and cyclist interaction:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; bind_current_map: choreography.interactions.1.actor: nearMiss routes are only supported for pedestrians
- **simulation-agent / Deliberately impossible request:** provider-generation — Unsupported request: native road actors cannot teleport, fly, or pass through buildings.
- **simulation-agent / Distance-triggered emergency yield:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: emergency-actor=false: emergency actors=0; relative-yield=true: 1 relative yield actions; emergency-actor: emergency actors=0
- **simulation-agent / Signal phase delayed turn:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: two-vehicles=true: 2 vehicles; delayed-turn=true: turn=true; delayed=true; signal-control=false: 0 plans; 0 controls; signal-control: 0 plans; 0 controls
- **simulation-agent / Cyclist occluded by stopped bus:** no-candidate — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; bind_current_map: action bicycle_emerge_laterally lane offset must be within -1..1
- **simulation-agent / Contradictory physical constraints:** expected-rejection — iteration_budget_exhausted: No candidate passed schema, map binding, full simulation, and requested semantic checks within 4 iterations.; check_requested_semantics: must-reject-contradiction=false: provider materialized mutually contradictory collision and separation requirements; must-reject-contradiction: provider materialized mutually contradictory collision and separation requirements

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

