# Parking and transit mechanisms

These portable scenario-template v2 examples implement the five parking and
transit mechanisms that were not previously template-backed:

- `parking.vehicle-pulls-out`
- `parking.backing-out-vehicle`
- `parking.delivery-double-park`
- `parking.driveway-emergence`
- `transit.bus-pullout`

`transit.bus-stop-emergence` remains implemented by
`examples/bus-stop-emergence.template.json` and is intentionally not duplicated
here.

The templates retain mechanism-bearing actor semantics: a transit bus remains a
`bus`, the double-parked cargo van is a static actor and occluder, the delivery
worker remains a `pedestrian`, the backing manoeuvre declares perpendicular bay
orientation plus reverse lamps, and driveway visibility is constrained by a
static hedge prop.
