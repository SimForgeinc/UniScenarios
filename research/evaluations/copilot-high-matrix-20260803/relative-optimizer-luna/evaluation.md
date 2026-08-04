# Scenario Copilot edge-case evaluation

- Run: 2026-08-04T06:18:09.716Z to 2026-08-04T06:26:31.897Z
- Model requested uniformly: `gpt-5.6-luna`
- Reasoning effort: `high`
- Maps: richmond-field-station
- Success requires native map materialization, an editable ScenarioDoc, full 20-second canonical simulation, and every deterministic semantic assertion.

| Provider | Strict success | Full 20s | Semantic mismatch | Pipeline failure | Expected rejection | Relative triggers fired | Median convergence iterations | Median generation ms | Median total ms | Median simulation ms | Scenic compile+sample ms | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| relative-goal-optimizer | 3/20 | 3/20 | 0 | 15 | 2 | 1/1 | 23 | 26335 | 25215 | 63 | — | 18 | 95696 |

## Case outcomes

| Case | relative-goal-optimizer |
|---|---|
| Lead vehicle hard braking | failure |
| Adjacent-lane cut-in | success |
| Signalized turn conflict | failure |
| Pedestrian near miss | failure |
| Occluded pedestrian emergence | failure |
| Multi-actor intersection conflict | failure |
| Stopped vehicle blocks lane | failure |
| Opposing left turn | success |
| Motorcycle and cyclist interaction | failure |
| Deliberately impossible request | expected-rejection |
| Pedestrian starts from vehicle distance | failure |
| Pedestrian starts from TTC | failure |
| Child occluded by two parked vehicles | failure |
| Synchronized conflict-point near miss | failure |
| Distance-triggered emergency yield | failure |
| Signal phase delayed turn | failure |
| Merge after rear-gap acceptance | success |
| Cyclist occluded by stopped bus | failure |
| Sequential lane change then brake | failure |
| Contradictory physical constraints | expected-rejection |

## Representative failures

- **relative-goal-optimizer / Lead vehicle hard braking:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 21/24 evaluations.
- **relative-goal-optimizer / Signalized turn conflict:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 24/24 evaluations.
- **relative-goal-optimizer / Pedestrian near miss:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 18/24 evaluations.
- **relative-goal-optimizer / Occluded pedestrian emergence:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 24/24 evaluations.
- **relative-goal-optimizer / Multi-actor intersection conflict:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 24/24 evaluations.
- **relative-goal-optimizer / Stopped vehicle blocks lane:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 23/24 evaluations.
- **relative-goal-optimizer / Motorcycle and cyclist interaction:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 24/24 evaluations.
- **relative-goal-optimizer / Deliberately impossible request:** provider-generation — Unsupported request: physical constraints are impossible or mutually contradictory.
- **relative-goal-optimizer / Pedestrian starts from vehicle distance:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 13/24 evaluations.
- **relative-goal-optimizer / Pedestrian starts from TTC:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 17/24 evaluations.
- **relative-goal-optimizer / Child occluded by two parked vehicles:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 24/24 evaluations.
- **relative-goal-optimizer / Synchronized conflict-point near miss:** no-candidate — optimizer_budget_exhausted: No parameter set passed full simulation and requested goals in 14/24 evaluations.

Raw model responses and credentials are deliberately excluded. See `results.json` for executable assertion evidence and per-run metrics.

