# D1 findings (in progress)

## Step 1 — the materializer is NOT at fault
Minimal template: ego `on_reference` + lead `relative_to ref=ego dLane=0 dsM=param.initialGapM in [8,30]`.
Metric: geometric forward projection of (lead.pos - ego.pos) onto ego's heading unit vector.

| requested dsM | instance placement (materialize) | trace t=0 (after 2 s warm-up) |
|---|---|---|
|20.7|20.6|20.6|
|29.4|29.4|21.7|
|29.1|29.1|29.1|
|21.9|21.9|12.7|
|20.4|20.4|20.0|
|29.1|29.1|21.6|
|26.9|26.9|26.9|
|13.9|13.6|6.6|
|13.3|13.3|12.9|
|23.9|23.9|23.9|
|27.0|27.0|23.6|
|21.0|21.0|18.9|

materialize.ts places dsM correctly (max abs err 0.4 m). The loss happens in the sim-engine warm-up.
