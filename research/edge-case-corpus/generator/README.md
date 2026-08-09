# Archetype grammar — a generative approach to edge-case scenarios

## The idea
An edge case is not a monolithic thing to be authored. It is a point in a space of orthogonal
mechanism axes. Enumerate the space, prune it with physical-feasibility rules, sample it for
diversity, and compile each point with ONE shared compiler.

```
topology   x challenger x occlusion x control x fault
7            10           6           6         5
```
- **topology** — how the paths interact: rear_end, crossing_lateral, opposing_turn,
  merge_converge, encroach_lateral, static_obstacle, reverse_conflict
- **challenger** — who: car, truck, bus, motorcycle, cyclist, ped_adult, ped_child, animal, worker, debris
- **occlusion** — what hides it: none, parked_row, large_vehicle, queue, geometry_curve, roadside_furniture
- **control** — what governs right of way: open_road, uncontrolled_junction, stop_controlled,
  signalized, work_zone, school_zone
- **fault** — why it goes wrong: challenger_row_violation, challenger_sudden_decel,
  ego_gap_acceptance, late_reveal, challenger_unexpected_entry

Raw cross-product 12,600 -> **1,067 physically feasible** after pruning -> **100 selected** by
stratified maximin diversity sampling (mean pairwise axis distance 4.17 / 5, all axis values present,
no duplicates).

## Why this is not templating
There is no template library and no per-archetype code. `compile_archetype(cell)` is a pure function
whose every constant is keyed by an **axis value**. Adding an archetype adds a row of data, never a
line of code. The same compiler produced all 35 dev archetypes; the 65 held-out archetypes will be
compiled by the identical function with no modification.

## Anti-overfitting protocol (frozen before any compiler code was written)
- 35 DEV / 65 HELDOUT, stratified by topology, `sha256 d6202dce07fb53e2`, recorded in
  `archetype-space.json`.
- DEV may be inspected and used to debug the compiler. HELDOUT is run **once, unchanged**.
- The reported number is the **generalization gap**: admission rate on DEV vs HELDOUT.
- No per-archetype magic constants are permitted; parameter ranges are solved by a shared solver.

## Progress
| Stage | DEV validate | DEV transfer (>=3 sites, >=2 maps) | DEV admitted (critical) |
|---|---:|---:|---:|
| first compiler | 6/35 | - | - |
| + schema-contract fixes | 35/35 | 28/35 | 6/35 |
| + curve-as-feature | 35/35 | 35/35 | 6/35 |
| + occlusion-only-when-late_reveal, in-lane occluders | 35/35 | 35/35 | - |
| + motion-pattern dispatcher | 35/35 | 35/35 | **9/35** |

### General lessons already encoded in the compiler (each fixed once, for all archetypes)
1. **A minimum-curvature corridor clause is structurally unsatisfiable.** The matcher scores the
   worst value over the whole s-interval, so "curvature >= 1 deg/10 m" fails wherever the corridor
   straightens. Localized geometry must be a **feature** (`curve`, `crest`, `occlusion_zone`), not a
   corridor band. Fixing this took 7 archetypes from 0 sites to 40 sites across 5 maps.
2. **Occlusion is a modifier, not a mechanism.** Declaring `occludes` on every archetype that merely
   has scenery produced `occlusion_unproven` on 100% of cells. `occludes` is now emitted only when
   `fault == late_reveal`; otherwise props are context.
3. **Occluder placement must follow the threat.** A roadside occluder cannot hide a lead vehicle in
   your own lane. Occluder lateral offset is now chosen by topology (in-lane vs roadside).
4. **Motion realisation depends on the actor kind, not just the topology.** Applying a pedestrian
   dart polyline to a bus is why every vehicle challenger failed. Vehicle-vs-vehicle path conflicts
   now bind through `conflicting_gate` at a junction feature; VRUs keep the polyline dart.
5. **Runway must cover the whole clip** (`ego_max_speed * (clip + warmup) * 1.15`).
6. **The criticality invariant is always windowed** (the predicted-vs-realized PET defect).

## Open (next iteration)
`opposing_turn`, `merge_converge` and `static_obstacle` are still at 0 admission:
- opposing_turn: `no_interaction` 243 / `invariant_unchecked` 272 — the ego left turn and the
  conflicting gate are not producing a shared conflict point.
- static_obstacle: `occlusion_unproven` 541 + `out_of_window` 327.
- merge_converge: `trivially_safe` 65 — the cut-in is not close enough.
Then the general parameter-range solver, then HELDOUT.
