# Research: edge-case taxonomy + timeline interaction primitives

Condensed from the 2026-07-31 standards survey (NHTSA pre-crash typology,
PEGASUS/6-layer, UN R157 ALKS, Euro NCAP AEB/VRU, CARLA Leaderboard/
scenario_runner, Scenic, OpenSCENARIO action vocabulary).

## Framing

- Author at the **logical** level (archetype + parameter ranges); concretes are
  generated. PEGASUS functional→logical→concrete is the app's core data model.
- 6-layer split decides what's on the timeline: L1 road / L2 infrastructure =
  map + anchor; **L3 temporary modifications (construction/occluders) =
  placeable prop layer**; **L4 movable actors = the timeline**; L5 environment =
  variation axes; L6 digital = signal state.
- **20 s episode timing contract**: t∈[-5,0) unrecorded warm-up (actors reach
  speed; no implausible instantaneous spawns); [0,3] settle; [3,6] precipitating
  event; [6,14] critical window (min-TTC target ≈ 8–11 s); [14,20] outcome tail.
  Distance budget: urban 160–280 m, highway 440–660 m of route.

## The taxonomy (15 categories, ~100 archetypes)

C1 car-following (lead stopped/slower/braking CCRs/CCRm/CCRb, brake-check,
end-of-queue past crest, stop-and-go, cut-in+brake, tailgated braking);
C2 cut-in/out & merges (R157 grids: cut-in by dx0 + lateral velocity 0.3–1.5 m/s,
cut-out revealing obstacle, parking cut-in, ramp merges both directions, exit
across traffic, weave, blind-spot intrusion, lane drop);
C3 intersections (LTAP/OD — the highest-value urban archetype, LTAP/LD, SCP,
red-light violation, RTIP, right hook cyclist, left hook PTW, all-way-stop
negotiation, occluded uncontrolled, dilemma zone, EV crossing);
C4 roundabouts; C5 pedestrians (Euro NCAP CPNA/CPFA/CPNCO dart-out/CPLA/CPTA/
CPRA geometries with their exact speeds, jaywalk angles, hesitate/reverse intent,
multiple-threat, bus-stop emergence, crowds, curb-standing negative control);
C6 cyclists/PTW (CBNA/CBNAO/CBFA/CBLA, door-zone swerve, contraflow,
lane-splitting, e-scooter); C7 occlusion (a MODIFIER not a scenario — parked
rows by occluder height class, double-parked truck, bus, hedge/corner setback,
barriers, queues, crest/curve, glare/fog);
C8 work zones (MUTCD structure: advance warning → taper → buffer → activity →
termination; lane-closure taper with speed-formula lengths, shifted alignment,
narrowing, flagger alternating one-way, moving work zone, worker intrusion,
night zone); C9 stationary hazards (disabled vehicle, accident scene, debris
classes, animal freeze, friction patches, post-crest hazard);
C10 oncoming (bend encroachment, wrong-way, third-party overtake, ego overtake
gap judgement, narrow-road negotiation, glare); C11 parking/low-speed (backing
out occluded, door open 0.9–1.2 m swing at TTC 0.8–3 s, contested spot, aisles);
C12 school zones (stop-arm bus — live NHTSA investigation area — crossing guard,
ball-then-child precursor cue, drop-off chaos); C13 traffic control (yellow
dilemma, outage→flashing, officer override, rail crossing, preemption);
C14 loss of control (friction patch, third-party spin); C15 adversarial long
tail (mostly negative-control set: phantom-brake bait, convoys, protests,
shedding loads).

**Occlusion's one derived metric: `reveal-to-conflict time`** (LOS opening →
collision point at current closing speeds). Critical band 0.4–1.5 s. Author by
tuning this readout live, not by dragging the occluder.

## The interaction model

Atomic unit: `Interaction = {actor, trigger, verb, target, dynamics?, until?}`.
**One axis, one owner; later preempts earlier** — schema-enforced, no priorities,
no nesting (this is the esmini lesson: action-level replacement beats event
priority).

**Seven verbs / five axes:**

| Verb | Axis | Covers |
|---|---|---|
| `speed(target, dyn)` | longitudinal | accel/brake/stop/creep/resume (target: abs, ±Δ, ×k, match, 0) |
| `gap(actor, value, time\|distance, dyn)` | longitudinal | following, ACC, tailgating, queues |
| `changeLane(target, dyn)` | lateral | cut-in/out, merge, overtake legs, swerve |
| `laneOffset(target, dyn)` | lateral | drift, encroachment, partial blockage, cyclist edge-riding |
| `route(target)` | topology | turns, paths, crossings (peds!), jaywalk polylines, acquire(pose) |
| `exist(present\|absent)` | existence | spawn/despawn; teleport only as absent→present (visible on timeline) |
| `set(key, value)` | discrete state | typed key registry: `rules.*` (obeySignals, yield, **collisionAvoidance**, aggression), `lights.*`, `doors.*`, `pose.*` (flagger paddle, stop-arm), `signal:*.phase`, `env.*` |

Uniform `dynamics = {shape: step|linear|sinusoidal|cubic, constraint:
rate|time|distance, value}` — supports R157's lateral-velocity
parameterization directly. **Mandatory for LLM-generated content, never
defaulted.**

Rejected as primitives (all expressible): stop, yield-verb, crossRoad, turn,
wait/waitUntil, teleport, overtake (ship as a macro that desugars visibly),
followTrajectory (escape hatch only, never LLM-emitted).

**Triggers:** `at(t)` | `after(id, delay)` | `when(cond, byLatest, ifNever:
skip|fire)` — byLatest mandatory (a never-firing condition is a silent bug).
Conditions: distance (alongLane|euclidean), ttc, headway, reaches(region),
speed, signal phase, **visible(a, to: b)** (occlusion-aware), standstill,
collision, shallow and/or/not.

**The `arrival` solver — highest-value feature:** `when: arrival(of, at:
conflictPoint, syncWith: ego, ttc: 1.5)` back-solves start time/distance so the
challenger arrives at declared criticality. Without it ~80% of generated
scenarios are trivially non-critical. Both Euro NCAP (T0 = TTC 4 s) and Scenic's
CrossingBehavior converge on this. Critical chips should be arrival/TTC-
triggered; time triggers are for background flavor.

**Timeline UI:** chips placed at solved times from a deterministic baseline run;
condition chips visually distinct (tether line to the referenced actor);
dragging a condition chip edits the threshold (with live back-solved readout),
not the time; **Bake ⇄ Lift** converts time↔condition triggers one-click;
whiskers show fire-time spread across sampled concretes; ego lane is visually
special and defaults to route-only (no closed-loop ego choreography — that's
the system under test).

## Parameterization

**Tier 1 (criticality axes):** v_ego, Δv, initial gap/headway (0.6–4 s), **TTC
at trigger (critical band 1.2–2.5 s)**, arrival Δt at conflict (±1.5 s), lateral
velocity (0.3–1.5 m/s), lead decel (0.5–9 m/s²), overlap (±50%, 25% steps), VRU
speeds (NCAP: walk 5 km/h, run 8, cyclist 10–20), **reveal-to-conflict time
(0.4–1.5 s)**, accepted gap (1.5–8 s), rules.* flags as discrete axes.
**Tier 2 (coverage):** geometry, density, phase offset, actor class (dynamics +
occluder height double duty!), friction, lighting, weather, sun-azimuth-aligned
glare. **Tier 3:** fix or seed — never in the criticality search space.

**Reject filters for every generated concrete:** trivially-safe (min TTC > 3 s
→ negative-control tag), physically-unavoidable (required decel > μg at first
possible detection — RSS-style), never-fired triggers, kinematic inconsistency,
min-TTC outside t∈[4,16].

**LLM generation rules:** closed vocabulary, everything by reference (ids/
handles, never coordinates); emit LOGICAL scenarios (ranges), sampler makes the
thousands; mandatory dynamics + byLatest; critical events must use arrival/ttc
triggers; structured validator errors ({code, interaction, reason}) for
unattended repair loops; schemaVersion everywhere.

## The three make-or-break features

1. `arrival(..., ttc)` trigger solver.
2. `rules.collisionAvoidance = false` (without it every generated critical
   scenario silently degrades into a safe one — challenger controllers chicken out).
3. Occlusion authored by live reveal-to-conflict readout.
