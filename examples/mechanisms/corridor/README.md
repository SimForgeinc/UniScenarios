# Corridor mechanism templates

These v2 templates are small, executable mechanism definitions for longitudinal
and same-direction lane-conflict testing. They deliberately use only primitives
that the current template materializer and simulation engine implement.

Implemented here:

- `lead-hard-brake.template.json`
- `queue-tail.template.json`
- `cutout-reveals-stopped.template.json`
- `cut-in-brake.template.json`
- `sideswipe.template.json`
- `merge-gap-collapse.template.json`

## Deferred mechanisms and exact blockers

- **Slow vulnerable lead:** a bicycle can be routed as a vehicle-like actor, but
  the invariant and trace vocabularies have no lateral passing-clearance metric.
  Implementing only a slow bicycle would omit the taxonomy's decisive
  passing-clearance condition and would therefore overstate coverage.
- **Lane-drop late merge:** `lane_drop` is matchable as an anchor feature, but
  the concrete engine input does not carry a lane-end/taper boundary and has no
  reaches-lane-end condition or remaining-pavement invariant. A normal adjacent
  lane change placed near a label would not prove a late merge at a disappearing
  lane.
- **Oncoming overtake:** opposing roles can be spawned and routed, but the lane
  change controller resolves only same-direction lateral lanes. It cannot cross
  the centreline into an opposing lane and later resolve a return gap around a
  slower vehicle.

