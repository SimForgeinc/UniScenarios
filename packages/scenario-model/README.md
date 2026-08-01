# @scenario-studio/scenario-model

The scenario document: schema, edit history, (de)serialization, migrations and
persistence. Framework-free TypeScript — no React, no three.js, no DOM beyond an
optional `localStorage`. Positions are plain `{x, y, z}` numbers.

```ts
import { ScenarioDocument, WebScenarioFileStore } from '@scenario-studio/scenario-model';

const doc = ScenarioDocument.create({
  name: 'Yale & Grant unprotected left',
  map: { mapId: 'yale-street', mapName: 'Yale Street' },
});

const id = doc.addEntity({
  kind: 'vehicle',
  model: { catalogId: 'sedan.generic' },
  pose: { position: { x: 118.25, y: 0, z: -402.5 }, headingRad: Math.PI / 2 },
});

doc.updateEntity(id, { label: 'Ego', pose: { position: { x: 120 } } });
doc.undo();

const store = new WebScenarioFileStore();
await store.write('yale-left-turn', doc);
doc.markClean();
```

## Layers

| Module | What it owns |
| --- | --- |
| `schema/v1.ts` | The zod schema and its inferred types. Source of truth. |
| `json-schema.ts` + `schema/scenario.v1.schema.json` | Generated JSON Schema for non-TS consumers. |
| `operations.ts` | The closed set of edits (`ScenarioOp`) and how they apply. |
| `document.ts` | `ScenarioDocument`: apply, undo/redo, dirty flag, `subscribe`. |
| `serialize.ts` | Canonical text: key order, float precision, freezing. |
| `migrate.ts` | Version dispatch. v1 is baseline; the chain is empty and ready. |
| `stores/` | `ScenarioFileStore` + in-memory and `localStorage` implementations. |

## Frame conventions

`pose.position` is the **scene frame**: metres, **y-up**, the same frame
`CoordinateFrame.localToScene` in `@scenario-studio/xodr-tools` produces and the
same one `manifest.scene.bounds` is expressed in. No translation is applied —
scene coordinates are absolute OpenDRIVE-local coordinates, re-axed as
`scene = (x, z, -y)`.

`pose.headingRad` is radians **CCW about +Y from +X** (right-hand rule, so +X
rotates toward −Z). Two consequences worth knowing:

- It is exactly `Object3D.rotation.y` in three.js, so the renderer needs no
  conversion.
- It is **numerically equal to the OpenDRIVE heading** of the same direction. A
  local heading `h` points along `(cos h, sin h, 0)` in the z-up frame, which the
  axis map sends to `(cos h, 0, −sin h)` — which is `+X` rotated by `h` about
  `+Y`. Positions need converting when crossing the frame boundary; headings do
  not. `src/__tests__/frame-convention.test.ts` pins this, and will fail if
  xodr-tools ever changes its axis map.

Headings are stored folded into `(-π, π]`.

Vertical convention: `position.y` is the **ground contact point** of the actor,
not its centroid. `dims` (when present) describes the full bounding box, so a
renderer places the model at `y + height/2` if its origin is centred.

## Schema decisions

**Strict everywhere, with one escape hatch.** Every object rejects unknown keys,
so `heading` instead of `headingRad` is a load error rather than silent data
loss. The exception is `extensions`, an untyped `Record<string, unknown>`
available on the document root and on every entity. Third-party tools and
in-flight experiments put their data there; nothing in this package interprets
it, and serialization preserves it verbatim.

**Scene pose is authoritative; `laneRef` is advisory.** When a placement was
lane-snapped we store both representations, but a loader must reconstruct the
transform from `pose`. That keeps files renderable without an `.xodr` in hand
and avoids making every load depend on lane-graph resolution. Promoting
`laneRef` to authoritative is a v2 decision, and the migration harness is there
for exactly that kind of change.

**Reserved blocks are present but empty.** `routes`, `triggers`, `lightPrograms`
(`maxItems: 0`) and `parameters` (`additionalProperties: false`) exist in v1.
Files therefore always carry the final key set, and v2 can define real element
shapes without a compat break — no v1 file can contain an element that v2 would
have to reinterpret. Writing anything into them today is a validation error, on
purpose.

**Two constraints live in code, not in JSON Schema:** entity ids must be unique
within a document, and `meta.modifiedAt` must not precede `meta.createdAt`. Both
are `.check()` refinements on `ScenarioV1Schema` and are called out in the
generated JSON Schema's `description`.

**Entity ids are ULIDs by construction, opaque by validation.** `newId()` mints
canonical 26-char ULIDs (lexicographic order = creation order, which makes
diffs and undo logs readable), but the schema accepts any URL-safe token up to
64 chars so fixtures and ids from other tools stay loadable.

## Determinism and float precision

`serializeScenario()` guarantees byte-identical output for identical content:

1. Object keys are sorted **lexicographically, recursively** — not in schema
   declaration order, which would rewrite every file whenever the schema is
   refactored.
2. Array order is preserved (`entities` is the author's outliner order).
3. Numbers are rounded to **6 decimal places** — 1 µm for scene metres, 1 µrad
   for headings. Four orders of magnitude finer than anything a user can place,
   and finer than the map pipeline's own ~7 m calibration residual. It kills
   `0.30000000000000004`-style diff noise, and it is idempotent.
4. `-0` becomes `0`; non-finite numbers are rejected (JSON cannot carry them).
5. Two-space indent, one trailing newline.

Operations quantise the geometry they write to the same 6 decimals, so the
in-memory document never holds a value the file cannot represent: **write then
read is an exact identity**, not an approximate one. (Numbers nested inside
`extensions` are opaque to this package and are only quantised on the way to
disk.)

## Edit history

Every mutation runs through immer's `produceWithPatches`. The inverse patch sets
*are* the undo stack, which buys three things:

- undo entries cost bytes, not whole document copies;
- structural sharing means `prev.entities[i] === next.entities[i]` for untouched
  entities, so a future React layer can memo on identity;
- no operation can forget to write its own inverse.

The stack is bounded (200 entries by default). `isDirty` is derived from the
undo cursor rather than a flag, so undoing back to the last save clears it — and
when the saved point is orphaned (by a new edit on a different branch, or by
falling off the end of a trimmed history) the document stays dirty rather than
lying about it.

`subscribe(listener)` is a plain callback set. Binding it to a UI framework is
the caller's job.

Operations validate before committing: a rejected op leaves the document
byte-identical, with no history entry and no notification.

## Persistence

`ScenarioFileStore` is async and name-keyed, because the implementation that
matters most — the Electron `fs` adapter — is both. `read()` returns a
*validated, migrated* document rather than text, so every adapter round-trips
through the canonical serializer and corruption fails at the boundary.

- `MemoryScenarioFileStore` — tests and scratch. Stores canonical text, so tests
  exercise the same path as disk.
- `WebScenarioFileStore` — browser `localStorage`, injectable for Node tests.
  OPFS was the alternative and lost: worker-only sync handles in Safari, engine
  differences that need shims, and no way to unit-test outside a browser. A
  scenario is a few KB (no geometry ever lands here), so the ~5 MB origin quota
  holds thousands of documents — and when it does not, the answer is the
  Electron `fs` adapter, which the async interface already accommodates.

## Adding schema v2

1. Add `src/schema/v2.ts` (usually `ScenarioV1ObjectSchema.extend(...)`).
2. Append one `ScenarioMigration` to `SCENARIO_MIGRATIONS` in `migrate.ts`.
3. Bump `SCENARIO_VERSION`.
4. Add a fixture test per step — `runMigrations` takes the chain and the
   validator as options precisely so each step is testable in isolation.
5. `pnpm run schema` to regenerate the JSON Schema (a test fails if you forget).

Files from a *newer* schema are rejected with an actionable message rather than
being partially parsed.

## Scripts

```sh
pnpm --filter @scenario-studio/scenario-model test        # vitest
pnpm --filter @scenario-studio/scenario-model typecheck   # tsc --noEmit
pnpm --filter @scenario-studio/scenario-model schema      # regenerate JSON Schema
```
