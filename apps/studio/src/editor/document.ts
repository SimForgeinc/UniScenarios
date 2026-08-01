/**
 * The editor's view of a scenario: entities, props, undo and autosave.
 *
 * ## One list, two storage lanes
 *
 * Everything the user places behaves identically — select it, grab it, rotate
 * it, delete it — so the editor works against a single {@link ActorRecord}
 * list. Underneath there are two lanes, because the v1 schema has two:
 *
 * - **Vehicles and pedestrians** are `Entity` records, the schema's first-class
 *   citizens, with `pose` and an optional `laneRef`.
 * - **Props** (cones, barriers, dumpsters, hedges, bus shelters — 22 of the 36
 *   catalog entries) have no home in v1: `EntityKind` is exactly
 *   `'vehicle' | 'pedestrian'`, and filing a traffic cone as a vehicle would put
 *   a lie in every file the studio writes, which is worse than the inconvenience
 *   of a sidecar.
 *
 * So props live in `extensions.{@link PROPS_KEY}` — the schema's one sanctioned
 * escape hatch (`ExtensionsSchema`, an untyped bag that round-trips verbatim).
 * They are in the same document, the same `localStorage` value and the same undo
 * history as everything else; they are simply namespaced as a v0 experiment
 * rather than pretending to be modelled.
 *
 * TODO(scenario-model v2): v2 defines a first-class `PropPlacement`. When it
 * lands, migrate `extensions.propsV0` into it and delete this lane. The shape
 * below is deliberately *not* coupled to the in-flight v2 schema — it is the
 * minimum the editor needs, so the migration is a pure read-side transform.
 *
 * ## Undo groups
 *
 * `ScenarioDocument` undoes one operation at a time, but a single user gesture
 * (moving four selected actors) is several operations. This class keeps a stack
 * of group sizes so one Cmd-Z reverses one gesture. Every mutation therefore has
 * to go through here — an op applied behind its back would desynchronise the
 * grouping.
 */

import {
  ScenarioDocument,
  ScenarioNotFoundError,
  WebScenarioFileStore,
  newId,
  type Entity,
  type LaneRef,
  type ScenarioV1,
} from '@scenario-studio/scenario-model';
import { getEntry, type CatalogId, type Dims } from '@scenario-studio/prop-catalog';
import type { MapEntry } from '../maps';

/** Extension key the prop sidecar lives under. */
export const PROPS_KEY = 'propsV0';

/** Where an actor is stored. */
export type ActorSource = 'entity' | 'prop';

/** Broad actor class, driving snapping rules and the palette grouping. */
export type ActorKind = 'vehicle' | 'pedestrian' | 'prop';

/** A lane-relative anchor, as the schema stores it. */
export interface LaneAnchor {
  roadId: string;
  section: number;
  laneId: number;
  s: number;
  t: number;
  headingOffsetRad: number;
}

/** One placed thing, whichever lane it is stored in. */
export interface ActorRecord {
  readonly id: string;
  readonly source: ActorSource;
  readonly kind: ActorKind;
  readonly catalogId: CatalogId;
  readonly label: string | undefined;
  /** Ground-contact position in scene metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly headingRad: number;
  readonly laneRef: LaneAnchor | undefined;
  readonly dims: Dims;
}

/** A prop as persisted in `extensions.propsV0`. */
interface PropPlacementV0 {
  id: string;
  catalogId: string;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  label?: string;
  laneRef?: LaneAnchor;
}

/** Fields accepted when placing something new. */
export interface NewActor {
  catalogId: CatalogId;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  laneRef?: LaneAnchor | undefined;
  label?: string;
}

/** A partial edit of one actor. `laneRef: null` clears the anchor. */
export interface ActorUpdate {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  headingRad?: number;
  label?: string;
  laneRef?: LaneAnchor | null;
}

/** Which lane a catalog id belongs in. */
export function actorKindFor(catalogId: CatalogId): ActorKind {
  const cls = getEntry(catalogId).class;
  if (cls === 'vehicle') return 'vehicle';
  if (cls === 'pedestrian') return 'pedestrian';
  return 'prop';
}

/** Quantise to the serializer's 6-decimal precision so save/load is an identity. */
function q(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number.isInteger(value) ? value : Number(value.toFixed(6));
}

function quantizeAnchor(anchor: LaneAnchor): LaneAnchor {
  return {
    roadId: anchor.roadId,
    section: anchor.section,
    laneId: anchor.laneId,
    s: q(Math.max(0, anchor.s)),
    t: q(anchor.t),
    headingOffsetRad: q(anchor.headingOffsetRad),
  };
}

const APP_VERSION = '0.1.0-editor';

/** Autosave debounce. Long enough to coalesce a drag, short enough to trust. */
const AUTOSAVE_DEBOUNCE_MS = 400;

/** Deep enough that a session's worth of gestures survives; see "Undo groups". */
const HISTORY_LIMIT = 1000;

export interface EditorDocumentOptions {
  store?: WebScenarioFileStore;
  /** Override the debounce (tests, verification scripts). */
  autosaveMs?: number;
}

/**
 * The autosave slot for a map.
 *
 * One scenario per map, keyed by map slug, so switching maps parks the current
 * work and switching back restores it. `ScenarioFileStore` names may not contain
 * `:` or `/`, and the slug is already `[a-z0-9-]`.
 */
export function autosaveName(mapId: string): string {
  return `autosave-${mapId}`;
}

export class EditorDocument {
  readonly map: MapEntry;

  #doc: ScenarioDocument;
  readonly #store: WebScenarioFileStore;
  readonly #autosaveMs: number;
  readonly #listeners = new Set<() => void>();

  #actors: ActorRecord[] = [];
  /** Ops applied since construction; the group bookkeeping counts against it. */
  #opCount = 0;
  #groups: number[] = [];
  #redoGroups: number[] = [];
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #savePromise: Promise<void> | null = null;
  #savedAt: number | null = null;
  #saveError: string | null = null;
  #unsubscribe: () => void;
  #disposed = false;

  private constructor(map: MapEntry, doc: ScenarioDocument, options: EditorDocumentOptions) {
    this.map = map;
    this.#doc = doc;
    this.#store = options.store ?? new WebScenarioFileStore();
    this.#autosaveMs = options.autosaveMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.#unsubscribe = doc.subscribe((change) => {
      if (change.reason === 'apply') this.#opCount++;
    });
    this.#rebuild();
  }

  /** Load this map's autosave, or start a fresh scenario for it. */
  static async open(map: MapEntry, options: EditorDocumentOptions = {}): Promise<EditorDocument> {
    const store = options.store ?? new WebScenarioFileStore();
    let doc: ScenarioDocument;
    try {
      const data = await store.read(autosaveName(map.id));
      doc = ScenarioDocument.fromJSON(data, { historyLimit: HISTORY_LIMIT });
    } catch (err) {
      if (!(err instanceof ScenarioNotFoundError)) {
        // A corrupt or outdated autosave must not lock the user out of the map.
        console.warn(`[editor] could not read autosave for ${map.id}; starting fresh`, err);
      }
      doc = ScenarioDocument.create(
        {
          name: `${map.label} scratch`,
          map: { mapId: map.id, mapName: map.label },
          appVersion: APP_VERSION,
        },
        { historyLimit: HISTORY_LIMIT },
      );
    }
    return new EditorDocument(map, doc, { ...options, store });
  }

  // ------------------------------------------------------------------ reads

  get actors(): readonly ActorRecord[] {
    return this.#actors;
  }

  get data(): ScenarioV1 {
    return this.#doc.data;
  }

  get name(): string {
    return this.#doc.data.meta.name;
  }

  get canUndo(): boolean {
    return this.#groups.length > 0;
  }

  get canRedo(): boolean {
    return this.#redoGroups.length > 0;
  }

  get isDirty(): boolean {
    return this.#doc.isDirty;
  }

  /** `Date.now()` of the last successful autosave. */
  get savedAt(): number | null {
    return this.#savedAt;
  }

  get saveError(): string | null {
    return this.#saveError;
  }

  actor(id: string): ActorRecord | undefined {
    return this.#actors.find((a) => a.id === id);
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  // ----------------------------------------------------------------- writes

  /**
   * Place one or more actors as a single undoable gesture.
   *
   * @returns The new actor ids, in input order.
   */
  add(inputs: readonly NewActor[]): string[] {
    const ids: string[] = [];
    this.#transaction(() => {
      const props: PropPlacementV0[] = [...this.#props()];
      let propsChanged = false;
      for (const input of inputs) {
        const kind = actorKindFor(input.catalogId);
        if (kind === 'prop') {
          const placement: PropPlacementV0 = {
            id: newId(),
            catalogId: input.catalogId,
            x: q(input.x),
            y: q(input.y),
            z: q(input.z),
            headingRad: q(input.headingRad),
          };
          if (input.label !== undefined) placement.label = input.label;
          if (input.laneRef) placement.laneRef = quantizeAnchor(input.laneRef);
          props.push(placement);
          propsChanged = true;
          ids.push(placement.id);
          continue;
        }
        const dims = getEntry(input.catalogId).dims;
        ids.push(
          this.#doc.addEntity({
            kind,
            model: { catalogId: input.catalogId },
            pose: {
              position: { x: input.x, y: input.y, z: input.z },
              headingRad: input.headingRad,
            },
            ...(input.label === undefined ? {} : { label: input.label }),
            ...(input.laneRef ? { laneRef: quantizeAnchor(input.laneRef) } : {}),
            dims: { length: dims.l, width: dims.w, height: dims.h },
          }),
        );
      }
      if (propsChanged) this.#writeProps(props);
    });
    return ids;
  }

  /** Patch any number of actors as one gesture. */
  update(updates: readonly ActorUpdate[]): void {
    if (updates.length === 0) return;
    this.#transaction(() => {
      const props = [...this.#props()];
      let propsChanged = false;
      for (const update of updates) {
        const index = props.findIndex((p) => p.id === update.id);
        if (index >= 0) {
          const current = props[index] as PropPlacementV0;
          const next: PropPlacementV0 = { ...current };
          if (update.x !== undefined) next.x = q(update.x);
          if (update.y !== undefined) next.y = q(update.y);
          if (update.z !== undefined) next.z = q(update.z);
          if (update.headingRad !== undefined) next.headingRad = q(update.headingRad);
          if (update.label !== undefined) next.label = update.label;
          if (update.laneRef === null) delete next.laneRef;
          else if (update.laneRef !== undefined) next.laneRef = quantizeAnchor(update.laneRef);
          props[index] = next;
          propsChanged = true;
          continue;
        }
        const position: { x?: number; y?: number; z?: number } = {};
        if (update.x !== undefined) position.x = update.x;
        if (update.y !== undefined) position.y = update.y;
        if (update.z !== undefined) position.z = update.z;
        this.#doc.updateEntity(update.id, {
          ...(Object.keys(position).length > 0 || update.headingRad !== undefined
            ? {
                pose: {
                  ...(Object.keys(position).length > 0 ? { position } : {}),
                  ...(update.headingRad === undefined ? {} : { headingRad: update.headingRad }),
                },
              }
            : {}),
          ...(update.label === undefined ? {} : { label: update.label }),
          ...(update.laneRef === undefined
            ? {}
            : { laneRef: update.laneRef === null ? null : quantizeAnchor(update.laneRef) }),
        });
      }
      if (propsChanged) this.#writeProps(props);
    });
  }

  /** Delete actors as one gesture. */
  remove(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.#transaction(() => {
      const keep = this.#props().filter((p) => !ids.includes(p.id));
      if (keep.length !== this.#props().length) this.#writeProps(keep);
      for (const id of ids) {
        if (this.#doc.entity(id)) this.#doc.removeEntity(id);
      }
    });
  }

  /** Rename the scenario itself. */
  rename(name: string): void {
    this.#transaction(() => {
      this.#doc.setMeta({ name });
    });
  }

  undo(): boolean {
    const size = this.#groups.pop();
    if (size === undefined) return false;
    for (let i = 0; i < size; i++) this.#doc.undo();
    this.#redoGroups.push(size);
    this.#afterMutation();
    return true;
  }

  redo(): boolean {
    const size = this.#redoGroups.pop();
    if (size === undefined) return false;
    for (let i = 0; i < size; i++) this.#doc.redo();
    this.#groups.push(size);
    this.#afterMutation();
    return true;
  }

  /** Write now, cancelling any pending debounce. Resolves when the bytes land. */
  async flush(): Promise<void> {
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    await this.#write();
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#unsubscribe();
    this.#listeners.clear();
  }

  // -------------------------------------------------------------- internals

  #props(): readonly PropPlacementV0[] {
    const raw = this.#doc.data.extensions?.[PROPS_KEY];
    return Array.isArray(raw) ? (raw as PropPlacementV0[]) : [];
  }

  #writeProps(props: readonly PropPlacementV0[]): void {
    // One extension write per gesture, not per prop: the whole array is the
    // unit of change, which also keeps the undo group small.
    this.#doc.setExtension(PROPS_KEY, props.length === 0 ? [] : props.map((p) => ({ ...p })));
  }

  #transaction(fn: () => void): void {
    const before = this.#opCount;
    try {
      fn();
    } finally {
      const applied = this.#opCount - before;
      if (applied > 0) {
        this.#groups.push(applied);
        this.#redoGroups.length = 0;
        this.#afterMutation();
      }
    }
  }

  #afterMutation(): void {
    this.#rebuild();
    this.#scheduleSave();
    this.#emit();
  }

  #rebuild(): void {
    const out: ActorRecord[] = [];
    for (const entity of this.#doc.data.entities) out.push(recordFromEntity(entity));
    for (const prop of this.#props()) {
      const record = recordFromProp(prop);
      if (record) out.push(record);
    }
    this.#actors = out;
  }

  #scheduleSave(): void {
    if (this.#disposed) return;
    if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#write();
    }, this.#autosaveMs);
  }

  async #write(): Promise<void> {
    // Serialise writes: two overlapping saves would race on the same key.
    const run = async (): Promise<void> => {
      try {
        await this.#store.write(autosaveName(this.map.id), this.#doc);
        this.#doc.markClean();
        this.#savedAt = Date.now();
        this.#saveError = null;
      } catch (err) {
        this.#saveError = err instanceof Error ? err.message : String(err);
        console.error('[editor] autosave failed', err);
      }
      this.#emit();
    };
    this.#savePromise = (this.#savePromise ?? Promise.resolve()).then(run);
    await this.#savePromise;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

function anchorFrom(laneRef: LaneRef | LaneAnchor | undefined): LaneAnchor | undefined {
  if (!laneRef) return undefined;
  return {
    roadId: laneRef.roadId,
    section: laneRef.section,
    laneId: laneRef.laneId,
    s: laneRef.s,
    t: laneRef.t ?? 0,
    headingOffsetRad: laneRef.headingOffsetRad ?? 0,
  };
}

function recordFromEntity(entity: Entity): ActorRecord {
  const catalogId = entity.model.catalogId as CatalogId;
  const dims = entity.dims
    ? { l: entity.dims.length, w: entity.dims.width, h: entity.dims.height }
    : safeDims(catalogId);
  return {
    id: entity.id,
    source: 'entity',
    kind: entity.kind,
    catalogId,
    label: entity.label,
    x: entity.pose.position.x,
    y: entity.pose.position.y,
    z: entity.pose.position.z,
    headingRad: entity.pose.headingRad,
    laneRef: anchorFrom(entity.laneRef),
    dims,
  };
}

function recordFromProp(prop: PropPlacementV0): ActorRecord | null {
  if (typeof prop?.id !== 'string' || typeof prop.catalogId !== 'string') return null;
  const catalogId = prop.catalogId as CatalogId;
  return {
    id: prop.id,
    source: 'prop',
    kind: 'prop',
    catalogId,
    label: prop.label,
    x: prop.x,
    y: prop.y,
    z: prop.z,
    headingRad: prop.headingRad,
    laneRef: anchorFrom(prop.laneRef),
    dims: safeDims(catalogId),
  };
}

/** Catalog dims, or a 1 m cube for an id this build does not know. */
function safeDims(catalogId: CatalogId): Dims {
  try {
    return getEntry(catalogId).dims;
  } catch {
    return { l: 1, w: 1, h: 1 };
  }
}
