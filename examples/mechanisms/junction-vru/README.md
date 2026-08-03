# Junction and VRU mechanisms

This tranche contains only mechanisms that the current matcher, materializer,
and simulation engine can preserve with explicit primitives:

- `intersection.right-turn-crosswalk`
- `intersection.left-turn-crosswalk`
- `intersection-blocked-box-reveal`
- `vru.adult-midblock-crossing`
- `vru.cyclist-crossing-path`

The turn/crosswalk templates require a map-derived turn and a receiving-side
crossing. The blocked-box template requires a geometric crossing gate and a
separate adjacent lane for its static queue occluder. The cyclist template uses
the semantic `bicycle` actor kind end to end; it is not substituted with a
pedestrian or generic vehicle.

Both freeform VRU paths contain the exact lane-centre pose used by their
arrival invariant, then continue to the far road edge. Turn-crossing actors use
the mapped crossing route from end to end. No template despawns an incident
participant at conflict, so every rendition retains a legible aftermath. The
blocked-box queue van is both a static collision actor and the specifically
declared line-of-sight occluder for the cross-traffic car.

The following taxonomy entries are intentionally not represented here:

- stop violation: no stop-line dwell-and-release controller or violation
  metric;
- late red-light entry: authoritative movement phase and stop-line timing is
  not generally available;
- opposing-turn encroachment: no lane-boundary penetration or escape-width
  invariant;
- cyclist right hook: no matcher binding that proves the cyclist remains on an
  independent parallel path while ego turns;
- crossing-guard release: recorded gestures do not yet control or release a
  pedestrian group.

Those labels should not be attached to scenarios composed from weaker
look-alike behavior.
