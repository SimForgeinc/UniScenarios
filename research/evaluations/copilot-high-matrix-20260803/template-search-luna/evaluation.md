# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:16:31.470Z to 2026-08-04T06:18:01.080Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| verified-template-search | 3/20 | 10/20 | 7 | 8 | 2 | 0/3 | — | 3819 | 3259 | 49 | — | 10 | 5889 |

## Case outcomes

| Case | verified-template-search |
|---|---|
| Lead vehicle hard braking | semantic-mismatch |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | semantic-mismatch |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | failure |
| Multi-actor intersection conflict | semantic-mismatch |
| Stopped vehicle blocks lane | semantic-mismatch |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | failure |
| Deliberately impossible request | expected-rejection |
| Pedestrian starts from vehicle distance | failure |
| Pedestrian starts from TTC | failure |
| Child occluded by two parked vehicles | failure |
| Synchronized conflict-point near miss | failure |
| Distance-triggered emergency yield | semantic-mismatch |
| Signal phase delayed turn | semantic-mismatch |
| Merge after rear-gap acceptance | success |
| Cyclist occluded by stopped bus | failure |
| Sequential lane change then brake | semantic-mismatch |
| Contradictory physical constraints | expected-rejection |

## Representative failures

- **verified-template-search / Lead vehicle hard braking:** semantic-constraints — explicit-stop: stopped actor or zero-speed action
- **verified-template-search / Signalized turn conflict:** semantic-constraints — signal-control: signal plan/control/action
- **verified-template-search / Pedestrian near miss:** provider-generation — Verified template ec-double-crosswalk could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Occluded pedestrian emergence:** provider-generation — Verified template ec-child-bus could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Multi-actor intersection conflict:** semantic-constraints — three-vehicles: 2 vehicles; coordinated-actions: 1 actions
- **verified-template-search / Stopped vehicle blocks lane:** semantic-constraints — stopped-obstacle: stopped/static actor or zero-speed action
- **verified-template-search / Motorcycle and cyclist interaction:** provider-generation — Verified template ec-cyclist-occlusion could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Deliberately impossible request:** provider-generation — Unsupported or contradictory request cannot be satisfied by a verified road-scenario template.
- **verified-template-search / Pedestrian starts from vehicle distance:** provider-generation — Verified template ec-double-crosswalk could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Pedestrian starts from TTC:** provider-generation — Verified template ec-double-crosswalk could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Child occluded by two parked vehicles:** provider-generation — Verified template ec-child-bus could not bind and simulate within the 24-candidate search budget
- **verified-template-search / Synchronized conflict-point near miss:** provider-generation — Verified template ec-double-crosswalk could not bind and simulate within the 24-candidate search budget

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

