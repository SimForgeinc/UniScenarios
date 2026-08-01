/**
 * `@scenario-studio/scenario-model` — the versioned scenario document.
 *
 * Framework-free: no React, no three.js. Positions are plain `{x, y, z}` in the
 * y-up scene frame that `@scenario-studio/xodr-tools` produces, and headings are
 * radians CCW about +Y from +X (equal to the OpenDRIVE heading — see
 * `schema/v1.ts`).
 *
 * Four layers:
 *
 * 1. **Schema** — {@link ScenarioV1Schema} and friends (zod v4, strict, with a
 *    generated JSON Schema at `schema/scenario.v1.schema.json`).
 * 2. **Document** — {@link ScenarioDocument}: typed operations, immer-patch
 *    undo/redo, dirty flag, `subscribe()`.
 * 3. **Migration** — {@link migrate} and the {@link SCENARIO_MIGRATIONS} chain.
 * 4. **Persistence** — {@link ScenarioFileStore} with in-memory and
 *    `localStorage` implementations.
 *
 * @example
 * ```ts
 * import { ScenarioDocument, MemoryScenarioFileStore } from '@scenario-studio/scenario-model';
 *
 * const doc = ScenarioDocument.create({
 *   name: 'Yale & Grant left turn',
 *   map: { mapId: 'yale-street', mapName: 'Yale Street' },
 * });
 * doc.addEntity({
 *   kind: 'vehicle',
 *   model: { catalogId: 'sedan.generic' },
 *   pose: { position: { x: 118.2, y: 0, z: -402.7 }, headingRad: Math.PI / 2 },
 * });
 *
 * const store = new MemoryScenarioFileStore();
 * await store.write('yale-left-turn', doc);
 * doc.markClean();
 * ```
 *
 * @packageDocumentation
 */

export {
  SCENARIO_VERSION,
  ScenarioV1Schema,
  ScenarioV1ObjectSchema,
  ScenarioMetaSchema,
  MapRefSchema,
  EntitySchema,
  EntityIdSchema,
  EntityKindSchema,
  ModelRefSchema,
  PoseSchema,
  Vec3Schema,
  LaneRefSchema,
  DimensionsSchema,
  ExtensionsSchema,
  TimestampSchema,
  type ScenarioV1,
  type ScenarioV1Input,
  type ScenarioMeta,
  type MapRef,
  type Entity,
  type EntityKind,
  type ModelRef,
  type Pose,
  type Vec3,
  type LaneRef,
  type LaneRefInput,
  type Dimensions,
  type Extensions,
} from './schema/v1.js';

export {
  ScenarioDocument,
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_APP_VERSION,
  type ScenarioDocumentOptions,
  type CreateScenarioInit,
  type ScenarioChange,
  type ScenarioChangeReason,
} from './document.js';

export {
  applyOp,
  buildEntity,
  describeOp,
  normalizeHeading,
  type ScenarioOp,
  type AddEntityOp,
  type UpdateEntityOp,
  type RemoveEntityOp,
  type MoveEntityOp,
  type SetMetaOp,
  type SetMapOp,
  type SetExtensionOp,
  type NewEntity,
  type EntityPatch,
  type MetaPatch,
} from './operations.js';

export {
  migrate,
  runMigrations,
  deserializeScenario,
  CURRENT_SCENARIO_VERSION,
  SCENARIO_MIGRATIONS,
  type ScenarioMigration,
  type MigrateResult,
  type RunMigrationsOptions,
} from './migrate.js';

export {
  serializeScenario,
  parseScenario,
  canonicalize,
  roundFloat,
  deepFreeze,
  FLOAT_DECIMALS,
} from './serialize.js';

export { newId, sequentialIds, ULID_PATTERN } from './ids.js';

export { buildJsonSchema, JSON_SCHEMA_ID, JSON_SCHEMA_PATH } from './json-schema.js';

export {
  ScenarioValidationError,
  ScenarioMigrationError,
  ScenarioOperationError,
  ScenarioNotFoundError,
  toScenarioIssues,
  type ScenarioIssue,
} from './errors.js';

export {
  assertValidScenarioName,
  toScenarioV1,
  type ScenarioFileStore,
  type ScenarioFileEntry,
  type ScenarioLike,
} from './stores/types.js';

export { MemoryScenarioFileStore } from './stores/memory.js';

export {
  WebScenarioFileStore,
  MemoryStorage,
  DEFAULT_STORAGE_PREFIX,
  type StorageLike,
  type WebScenarioFileStoreOptions,
} from './stores/web.js';
