# `@scenario-studio/cli` — `scen`

Layer 4 of `docs/agent-authoring-architecture.md`: the surface an LLM agent
drives the whole stack through. Query a map's semantics, author a template
against the published JSON Schemas, match it onto concrete sites, sample it into
thousands of instances, simulate, filter, triage.

```bash
node packages/cli/bin/scen.js sites match examples/ltap-opposing.template.json --all-maps --pretty
node packages/cli/bin/scen.js batch examples/ltap-opposing.template.json --all-maps --draws 5 --out out/
```

## The contract

| | |
|---|---|
| **stdout** | the result, as JSON. `--pretty` renders the *same object* for humans. |
| **stderr** | `{code, path?, reason, detail?}` — one JSON line, always. |
| **exit 0** | ok |
| **exit 1** | the command could not run (bad flag, missing map, unreadable file) |
| **exit 2** | it ran and found something wrong with the *input*: schema issues, no matching site, an infeasible cell, a rejected trace |

That 1-vs-2 split is the whole reason an unattended repair loop works: `1` means
"you called me wrong", `2` means "your document is wrong, here is where".

## Commands

```
scen maps list
scen locations find    --map <id> [--type --subtype --tags --affordances
                                   --facts k=v,k2>=v2 --near <handle>
                                   --within-m N --limit N --diversity-m N]
scen locations get     <handleOrId> --map <id> [--describe]
scen locations resolve --map <id> "<free text>"
scen template validate <file> [--map <id> [--site <siteId>]]
scen sites match       <template.json> --map <id> | --maps a,b | --all-maps
                       [--min-score --max-sites --rejected]
scen instantiate       <template.json> --map <id> --site <siteId>
                       [--seed <hex> | --draw K] [--out file]
scen simulate          <instance.json> [--trace out.trace.json.gz]
scen validate          <instance|template> [--tier 1|2 --map --site --draw]
scen evaluate          <trace> [--filter critical|negative-control|all]
                       [--trivial-ttc S --reject-collisions]
scen batch             <template.json> --maps a,b,c --draws N --out dir/
                       [--concurrency N --min-score --max-sites --force --no-trace]
scen schemas           [--name template|anchor|interactions] [--content]
```

`locations` is the model's spatial awareness: it never sees a road id, it
queries by semantics and receives **handles**, road anchors and
`matchedReasons`. Everything below the handle is carried through for the layers
that need it.

## The materializer

`scen instantiate` is the only genuinely new code in this package — everything
else composes the four packages below it. The four layers are each deliberately
incomplete: the matcher does the *structural* pass and stops, the engine takes a
*fully resolved* document and refuses anything less. `src/materialize.ts` is the
join.

```
1. PARAMS    paramSeed = sha256(templateId|paramsVersion|siteId|drawIndex)
             → xoshiro128**, one forked stream per declaration, so inserting a
               parameter does not resample the ones declared after it
2. FRAME     the site's AnchorFrame reference path is rebuilt as a sim-engine
             Route — that is what turns a frame `s` into a world point
3. ROLES     each FeatureBinding becomes a concrete actor. Its route comes from
             the binding's lane chain; its spawn comes from *projecting the
             frame point onto that route*, never from re-adding lane lengths
4. TIMELINE  v2 interactions → engine interactions, verb by verb. `set rules.*`
             and `route(polyline)` at `t ≤ 0` fold into the actor's initial
             state, because a thing that happens at spawn *is* spawn state
5. ARRIVAL   every `conflicting_gate` role with `arriveAtConflict`, and every
             timeline `arrival` trigger, is back-solved by `sim-engine`'s
             bisection and baked into the instance
6. GUARDS    `checkFeasibility` — runway, decel budget, spawn overlap, route
             connectivity — reported as structured findings
```

### Why projection, not arithmetic

A role's pose is `(k, s)` in the anchor frame. Adding up lane lengths until `s`
is consumed is wrong for every role that is not on the reference lane: `k = +1`
and opposing lanes have their own arc-length origins, and two packages measuring
the same polyline disagree in the sixth decimal. So the frame `s` becomes a
**world point** on the reference route, and that point is projected onto the
actor's own route. The packages only have to agree about geometry, never about
bookkeeping.

### Two places the materializer checks the matcher's work

- **Upstream coverage.** The matcher builds a role's lane chain from the
  *statically* evaluated `dsM`, which is `0` whenever the spawn is a
  site-dependent expression like `-(0.8 * lane.speedLimitKph / 3.6) * 8`. Using
  that chain would spawn the ego *past* the junction it was supposed to
  approach. So the chain is extended upstream until the target point projects
  into the route's interior rather than onto an endpoint.
- **Downstream runway.** The matcher stops walking at its own 150 m run-up
  constant. A 16-second clip at 51 kph covers 227 m. The chain is extended
  forward until it covers the clip, because the materializer is the only layer
  that knows both the clip length and the actor's speed.

## Replay keys

Every instance carries the key that reproduces it:

```json
{ "templateId": "ltap-opposing", "templateVersion": 2, "templateDigest": "…",
  "mapId": "yale-street", "topologyDigest": "…", "siteId": "…",
  "matcherVersion": "…", "solverVersion": "…", "paramSeed": "…", "drawIndex": 0 }
```

`scen batch` resumes on all of it, not just the seed: a cached verdict from an
older matcher or an older engine is exactly the stale answer a resumable batch
exists to prevent.

## Batch

Sites × draws, per-cell seeds, a worker-thread pool (the engine is synchronous
CPU work, so an async pool in one thread would run it strictly serially), and a
sorted summary that does not depend on which worker finished first.

```
out/
  batch-summary.json
  <mapId>/<siteId>/draw-000.instance.json
                   draw-000.trace.json.gz
                   draw-000.result.json
```

## What this package deliberately does not do yet

Stated plainly, because they bound what a number from `scen` means:

- **No signal programs.** The derived index carries junction *control*, not
  per-approach heads with phase timing, so `signalPrograms` is empty and a
  `signal` condition is dropped with a note. Junction control still scores the
  anchor; it just does not animate.
- **Variants are not applied.** `variants[]` parses and validates; the
  materializer does not yet fold overrides into a draw.
- **`props` are occluders only.** They become OBBs for the line-of-sight test.
  `targetRevealToConflictS` is *reported against*, not solved for.
- **Prop footprints are mirrored, not imported.** `prop-catalog` depends on
  three.js; `src/prop-dims.ts` copies the dimensions of the props that can
  occlude, and a test reads the catalog as text to catch drift.
- **`route(turn|toFeature|acquire)` is dropped with a note.** Topology is fixed
  by the role binding's lane chain at instantiation time, so the timeline entry
  would be a no-op restatement.

## Tests

```bash
pnpm --filter @scenario-studio/cli test
```

The pure tests (adapter, seeding, prop-dims) always run. The materializer and
CLI smoke tests read `dev-assets/`, which is gitignored, and `skipIf` themselves
on a clean checkout.
