# UniScenarios five-map incident catalog

`uniscenarios-five-map-v2.catalog.json` is the authoritative authored-design
manifest for the first five maps. It contains exactly 100 deterministic designs
per map. Every design binds:

- one incident mechanism from the 37-type, eight-domain taxonomy;
- one real location-catalog record and road anchor from that map;
- independent matcher-index, engine-graph, and location-catalog digests;
- an operational condition, actor intent, event sequence, and criticality
  observables;
- an acceptance manifest and reserved evidence paths.

## Count semantics

The progress counters are deliberately cumulative and must not be conflated:

- **authored**: the map-grounded functional design and acceptance contract exist;
- **generated**: a schema-valid concrete instance exists;
- **simulated**: a trace and result exist and passed the required machine gates;
- **rendered**: the required still/video bundle exists;
- **visually accepted**: all automated gates passed and a named human reviewer
  accepted the rendered scenario.

The initial manifest is `500 authored / 0 generated / 0 simulated / 0 rendered /
0 visually accepted`. The 500 authored designs are not a visual-acceptance claim.

## Reproduce and verify

```sh
node packages/cli/bin/scen.js catalog create \
  --out catalog/uniscenarios-five-map-v2.catalog.json

node packages/cli/bin/scen.js catalog verify \
  catalog/uniscenarios-five-map-v2.catalog.json
```

Use `catalog verify --require-evidence` only after every slot is expected to
have a complete evidence bundle. Normal verification requires evidence based on
each slot's current status and rejects advancement without the corresponding
files.

The catalog's research provenance points to official NHTSA/US DOT and Euro NCAP
sources. Those sources establish incident families and test conditions; they do
not substitute for map-specific kinematic or visual review.
