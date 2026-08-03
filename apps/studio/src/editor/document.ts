/**
 * The editor's view of a canonical ScenarioTemplate v2: roles, undo and autosave.
 *
 * Current viewport placements are v2 `scene_absolute` roles. That role kind is
 * intentionally map-bound and therefore preserves exact editor poses without
 * inventing a portable anchor. Portable role kinds can coexist in the same
 * document and are materialized before playback; this viewport only renders
 * roles whose absolute authoring pose is available.
 *
 * ## Undo groups
 *
 * `TemplateDocument` undoes one operation at a time, but a single user gesture
 * (moving four selected actors) is several operations. This class keeps a stack
 * of group sizes so one Cmd-Z reverses one gesture. Every mutation therefore has
 * to go through here — an op applied behind its back would desynchronise the
 * grouping.
 */

import {
  TemplateDocument,
  ScenarioNotFoundError,
  WebTemplateFileStore,
  newTemplateId,
  type LaneRef,
  type RoleBinding,
  type Interaction,
  type ActorSensor,
  type ScenarioTemplateV2,
  type TemplateFileStore,
  type ValidationReport,
} from '@uniscenarios/scenario-model';
import { getEntry, type CatalogId, type Dims } from '@uniscenarios/prop-catalog';
import type { MapEntry } from '../maps';

/** Where an actor is stored. */
export type ActorSource = 'role' | 'prop';

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
  /** Studio-only presentation color, persisted with the role and ignored by export. */
  readonly bodyColor: string | undefined;
  /** Physical sensors mounted to this actor. */
  readonly sensors: readonly ActorSensor[];
}

/** Fields accepted when placing something new. */
export interface NewActor {
  /** Preallocated stable id, used when deterministic behaviour is planned before commit. */
  id?: string;
  catalogId: CatalogId;
  x: number;
  y: number;
  z: number;
  headingRad: number;
  laneRef?: LaneAnchor | undefined;
  label?: string;
  /** Exact connected lane chain for a default moving road actor. */
  routeLaneRsls?: readonly string[];
  /** Truthful initial/cruise speed paired with the generated route. */
  initialSpeedKph?: number;
  bodyColor?: string;
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
  /** Swap only the presentation model; identity and choreography stay intact. */
  catalogId?: CatalogId;
  bodyColor?: string;
}

/** Which lane a catalog id belongs in. */
export function actorKindFor(catalogId: CatalogId): ActorKind {
  // A loose shopping cart is a small moving conflict actor, not fixed scenery.
  if (catalogId === 'street.shopping_cart') return 'vehicle';
  const cls = getEntry(catalogId).class;
  if (cls === 'vehicle') return 'vehicle';
  if (cls === 'pedestrian') return 'pedestrian';
  return 'prop';
}

/** Preserve the semantic simulation class for specialized catalog actors. */
export function simulationClassFor(catalogId: CatalogId): 'car' | 'bus' | 'scooter' | 'pedestrian' | 'static_object' {
  if (catalogId === 'vehicle.tram') return 'bus';
  if (catalogId === 'vehicle.mobility_scooter' || catalogId === 'street.shopping_cart') return 'scooter';
  const kind = actorKindFor(catalogId);
  if (kind === 'pedestrian') return 'pedestrian';
  if (kind === 'prop') return 'static_object';
  return 'car';
}

export interface AuthoringGraphPrunePlan {
  readonly interactionIds: readonly string[];
  readonly propIds: readonly string[];
  readonly invariantIds: readonly string[];
  readonly variantIds: readonly string[];
  readonly clearMetricSubject: boolean;
}

/**
 * Find authored graph nodes that cannot survive after roles disappear.
 *
 * Interaction dependencies are closed transitively: removing an actor-owned
 * event also removes every event whose `after`/`until` trigger names it. Rules,
 * attached props and variants are then evaluated against that final set.
 */
export function authoringGraphPrunePlan(
  template: ScenarioTemplateV2,
  deletingRoleIds: readonly string[] = [],
): AuthoringGraphPrunePlan {
  const deleting = new Set(deletingRoleIds);
  const remainingRoles = new Set(template.roles.map((role) => role.id).filter((id) => !deleting.has(id)));
  const removedInteractions = new Set<string>();
  for (const interaction of template.choreography.interactions) {
    if ((interaction.actor !== '@world' && !remainingRoles.has(interaction.actor))
      || triggerReferencesMissingRole(interaction.trigger, remainingRoles)
      || (interaction.until && triggerReferencesMissingRole(interaction.until, remainingRoles))
      || targetReferencesMissingRole(interaction.target, remainingRoles)) {
      removedInteractions.add(interaction.id);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const interaction of template.choreography.interactions) {
      if (removedInteractions.has(interaction.id)) continue;
      if (triggerReferencesInteraction(interaction.trigger, removedInteractions)
        || (interaction.until && triggerReferencesInteraction(interaction.until, removedInteractions))) {
        removedInteractions.add(interaction.id);
        changed = true;
      }
    }
  }
  const propIds = template.props.filter((prop) => {
    const attachment = prop.attachment?.role;
    const occludes = prop.occludes;
    return (attachment && !remainingRoles.has(attachment))
      || (occludes && (!remainingRoles.has(occludes.observer) || !remainingRoles.has(occludes.target)));
  }).map((prop) => prop.id);
  const invariantIds = template.invariants.filter((invariant) => invariant.kind === 'event_order'
    ? invariant.events.some((id) => removedInteractions.has(id)
    : invariantReferencesMissingRole(invariant as unknown as Record<string, unknown>, remainingRoles)).map((invariant) => invariant.id);
  const removedProps = new Set(propIds);
  const removedInvariants = new Set(invariantIds);
  const variantIds = template.variants.filter((variant) => variant.overrides.some((override) => {
    const match = /^(roles|props|invariants)#([A-Za-z][A-Za-z0-9_-]*)/.exec(override.path);
    if (!match) return false;
    return match[1] === 'roles' ? !remainingRoles.has(match[2]!)
      : match[1] === 'props' ? removedProps.has(match[2]!)
        : removedInvariants.has(match[2]!);
  })).map((variant) => variant.id);
  return {
    interactionIds: [...removedInteractions],
    propIds,
    invariantIds,
    variantIds,
    clearMetricSubject: template.metricSubject !== undefined && !remainingRoles.has(template.metricSubject),
  };
}

function triggerReferencesInteraction(trigger: Interaction['trigger'], removed: ReadonlySet<string>): boolean {
  return trigger.kind === 'after' && removed.has(trigger.of);
}

function triggerReferencesMissingRole(trigger: Interaction['trigger'], roles: ReadonlySet<string>): boolean {
  if (trigger.kind === 'arrival') return !roles.has(trigger.of) || !roles.has(trigger.syncWith) || pointReferencesMissingRole(trigger.at, roles);
  if (trigger.kind === 'when') return conditionReferencesMissingRole(trigger.condition as unknown as Record<string, unknown>, roles);
  return false;
}

function pointReferencesMissingRole(point: unknown, roles: ReadonlySet<string>): boolean {
  return isRecord(point) && typeof point.role === 'string' && !roles.has(point.role);
}

function conditionReferencesMissingRole(condition: Record<string, unknown>, roles: ReadonlySet<string>): boolean {
  if (condition.kind === 'and' || condition.kind === 'or') {
    return Array.isArray(condition.operands) && condition.operands.some((item) => isRecord(item) && conditionReferencesMissingRole(item, roles));
  }
  if (condition.kind === 'not') return isRecord(condition.operand) && conditionReferencesMissingRole(condition.operand, roles);
  for (const key of ['from', 'of', 'to', 'with'] as const) {
    const value = condition[key];
    if (typeof value === 'string' && value !== 'any' && !roles.has(value)) return true;
    if (key === 'to' && pointReferencesMissingRole(value, roles)) return true;
  }
  if (pointReferencesMissingRole(condition.region, roles)) return true;
  return false;
}

function targetReferencesMissingRole(target: Interaction['target'], roles: ReadonlySet<string>): boolean {
  if (!isRecord(target)) return false;
  return typeof target.role === 'string' && !roles.has(target.role);
}

function invariantReferencesMissingRole(invariant: Record<string, unknown>, roles: ReadonlySet<string>): boolean {
  for (const key of ['of', 'to', 'syncWith'] as const) {
    const value = invariant[key];
    if (typeof value === 'string' && !roles.has(value)) return true;
  }
  return pointReferencesMissingRole(invariant.at, roles);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/** Exact SI conversion of the authored default: 30 mph = 13.4112 m/s. */
export const DEFAULT_AUTHORED_VEHICLE_SPEED_MPS = 13.4112;
export const DEFAULT_AUTHORED_VEHICLE_SPEED_KPH = 48.28032;

/** Autosave debounce. Long enough to coalesce a drag, short enough to trust. */
const AUTOSAVE_DEBOUNCE_MS = 400;

/** Deep enough that a session's worth of gestures survives; see "Undo groups". */
const HISTORY_LIMIT = 1000;

export interface EditorDocumentOptions {
  store?: TemplateFileStore;
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

  #doc: TemplateDocument;
  readonly #store: TemplateFileStore;
  readonly #autosaveMs: number;
  readonly #listeners = new Set<() => void>();

  #actors: ActorRecord[] = [];
  /** Ops applied since construction; the group bookkeeping counts against it. */
  #opCount = 0;
  #groups: number[] = [];
  #redoGroups: number[] = [];
  #saveTimer: ReturnType<typeof setTimeout> | null = null;
  #savePromise: Promise<void> | null = null;
  /** Optional user-facing saved-scenario slot mirrored alongside map autosave. */
  #namedSave: string | null = null;
  #savedAt: number | null = null;
  #saveError: string | null = null;
  #unsubscribe: () => void;
  #disposed = false;

  private constructor(map: MapEntry, doc: TemplateDocument, options: EditorDocumentOptions) {
    this.map = map;
    this.#doc = doc;
    this.#store = options.store ?? new WebTemplateFileStore();
    this.#autosaveMs = options.autosaveMs ?? AUTOSAVE_DEBOUNCE_MS;
    this.#unsubscribe = doc.subscribe((change) => {
      if (change.reason === 'apply') this.#opCount++;
    });
    this.#rebuild();
  }

  /** Load this map's autosave, or start a fresh scenario for it. */
  static async open(map: MapEntry, options: EditorDocumentOptions = {}): Promise<EditorDocument> {
    const store = options.store ?? new WebTemplateFileStore();
    let doc: TemplateDocument;
    try {
      const data = await store.read(autosaveName(map.id));
      doc = TemplateDocument.fromJSON(data, { historyLimit: HISTORY_LIMIT });
    } catch (err) {
      if (!(err instanceof ScenarioNotFoundError)) {
        // A corrupt or outdated autosave must not lock the user out of the map.
        console.warn(`[editor] could not read autosave for ${map.id}; starting fresh`, err);
      }
      doc = TemplateDocument.create(
        {
          name: `${map.label} scratch`,
          sourceMap: { mapId: map.id, mapName: map.label },
          anchor: { features: [], pin: { mapId: map.id } },
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

  get data(): ScenarioTemplateV2 {
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

  /** Tier-1 template validation, suitable for the future Validate panel. */
  get validation(): ValidationReport {
    return this.#doc.validate();
  }

  actor(id: string): ActorRecord | undefined {
    return this.#actors.find((a) => a.id === id);
  }

  /** Stable input for deterministic per-actor route choice. */
  get routeSeed(): string {
    return `${this.map.id}|${this.#doc.data.meta.createdAt}|${this.#doc.data.meta.name}`;
  }

  allocateActorId(catalogId: CatalogId): string {
    const kind = actorKindFor(catalogId);
    let id = newTemplateId(kind);
    while (this.#doc.role(id)) id = newTemplateId(kind);
    return id;
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
      for (const input of inputs) {
        const kind = actorKindFor(input.catalogId);
        const dims = getEntry(input.catalogId).dims;
        const id = input.id ?? this.allocateActorId(input.catalogId);
        if (this.#doc.role(id)) throw new Error(`actor id "${id}" already exists`);
        this.#doc.addRole({
          id,
          kind: 'scene_absolute',
          actor: {
            class: simulationClassFor(input.catalogId),
            catalogId: input.catalogId,
            dims: { length: dims.l, width: dims.w, height: dims.h },
            static: kind === 'prop',
            sensors: [],
          },
          pose: {
            position: { x: q(input.x), y: q(input.y), z: q(input.z) },
            headingRad: q(input.headingRad),
          },
          ...(input.label === undefined ? {} : { label: input.label }),
          ...(input.initialSpeedKph === undefined ? {} : { initialSpeedKph: q(Math.max(0, input.initialSpeedKph)) }),
          ...(input.laneRef ? { laneRef: quantizeAnchor(input.laneRef) } : {}),
          essentiality: kind === 'prop' ? 'preferred' : 'required',
          ...(input.bodyColor ? { extensions: { 'studio.presentation.bodyColor': input.bodyColor } } : {}),
        });
        if (input.routeLaneRsls && input.routeLaneRsls.length > 0) {
          this.#doc.addInteraction({
            id: `route_${id}_initial`.slice(0, 64),
            actor: id,
            // This is deliberately a presentation label over a concrete,
            // deterministic lanePath. It is not a new simulator/export verb.
            label: 'Random turns',
            trigger: { kind: 'at', t: 0 },
            verb: 'route',
            target: { mode: 'lanePath', lanes: [...input.routeLaneRsls] },
          });
        }
        if (input.initialSpeedKph !== undefined && input.initialSpeedKph > 0) {
          this.#doc.addInteraction({
            id: `speed_${id}_initial`.slice(0, 64),
            actor: id,
            label: input.initialSpeedKph === DEFAULT_AUTHORED_VEHICLE_SPEED_KPH
              ? '30 mph'
              : `Cruise at ${q(input.initialSpeedKph)} km/h`,
            trigger: { kind: 'at', t: 0 },
            verb: 'speed',
            target: { mode: 'absolute', valueKph: q(input.initialSpeedKph) },
            dynamics: { shape: 'linear', constraint: 'time', value: 0.25 },
          });
        }
        ids.push(id);
      }
    });
    return ids;
  }

  /** Patch any number of actors as one gesture. */
  update(updates: readonly ActorUpdate[]): void {
    if (updates.length === 0) return;
    this.#transaction(() => {
      for (const update of updates) {
        const current = this.#doc.role(update.id);
        if (!current || current.kind !== 'scene_absolute') continue;
        const role: RoleBinding = {
          ...current,
          ...(update.label === undefined ? {} : { label: update.label }),
          pose: {
            position: {
              x: q(update.x ?? current.pose.position.x),
              y: q(update.y ?? current.pose.position.y),
              z: q(update.z ?? current.pose.position.z),
            },
            headingRad: q(update.headingRad ?? current.pose.headingRad),
          },
        };
        if (update.catalogId !== undefined) {
          const entry = getEntry(update.catalogId);
          role.actor = {
            ...current.actor,
            class: simulationClassFor(update.catalogId),
            catalogId: update.catalogId,
            dims: { length: entry.dims.l, width: entry.dims.w, height: entry.dims.h },
            static: actorKindFor(update.catalogId) === 'prop',
          };
        }
        if (update.bodyColor !== undefined) {
          role.extensions = { ...current.extensions, 'studio.presentation.bodyColor': update.bodyColor };
        }
        if (update.laneRef === null) delete role.laneRef;
        else if (update.laneRef !== undefined) role.laneRef = quantizeAnchor(update.laneRef);
        this.#doc.replaceRole(update.id, role);
      }
    });
  }

  /** Delete actors as one gesture. */
  remove(ids: readonly string[]): void {
    if (ids.length === 0) return;
    this.#transaction(() => {
      for (const id of ids) {
        if (!this.#doc.role(id)) continue;
        for (const interaction of [...this.#doc.data.choreography.interactions]) {
          if (interaction.actor === id) this.#doc.removeInteraction(interaction.id);
        }
        this.#doc.removeRole(id);
      }
    });
  }

  /** Rename the scenario itself. */
  rename(name: string): void {
    this.#transaction(() => {
      this.#doc.setMeta({ name });
    });
  }

  /**
   * Open a validated canonical v2 template in this map session.
   *
   * Campaign and Saved Scenario imports replace the undo-bearing document as
   * one explicit navigation operation. The previous autosave is already
   * preserved by the named-scenario store; history must not cross documents.
   */
  importTemplate(value: unknown, options: { saveName?: string } = {}): void {
    const next = TemplateDocument.fromJSON(value, { historyLimit: HISTORY_LIMIT });
    this.#unsubscribe();
    this.#doc = next;
    this.#opCount = 0;
    this.#groups = [];
    this.#redoGroups = [];
    this.#unsubscribe = next.subscribe((change) => {
      if (change.reason === 'apply') this.#opCount++;
    });
    this.#savedAt = null;
    this.#saveError = null;
    this.#namedSave = options.saveName ?? null;
    this.#rebuild();
    this.#scheduleSave();
    this.#emit();
  }

  /** Add one semantic timeline interaction as an undoable/autosaved gesture. */
  addInteraction(interaction: Interaction): void {
    this.#transaction(() => { this.#doc.addInteraction(interaction); });
  }

  /** Replace one timeline interaction while retaining its stable identity. */
  replaceInteraction(id: string, interaction: Interaction): void {
    this.#transaction(() => { this.#doc.replaceInteraction(id, interaction); });
  }

  /** Delete one semantic timeline interaction. Validation surfaces dangling references. */
  removeInteraction(id: string): void {
    this.#transaction(() => { this.#doc.removeInteraction(id); });
  }

  /** Add one validated actor-attached sensor as an undoable/autosaved gesture. */
  addActorSensor(actorId: string, sensor: ActorSensor): string {
    let id = sensor.id;
    this.#transaction(() => { id = this.#doc.addActorSensor(actorId, sensor); });
    return id;
  }

  /** Replace one sensor while retaining its stable identity. */
  updateActorSensor(actorId: string, sensorId: string, sensor: ActorSensor): void {
    if (sensor.id !== sensorId) throw new Error('sensor identity cannot change during update');
    this.#transaction(() => { this.#doc.replaceActorSensor(actorId, sensorId, sensor); });
  }

  /** Remove one actor-attached sensor. */
  removeActorSensor(actorId: string, sensorId: string): void {
    this.#transaction(() => { this.#doc.removeActorSensor(actorId, sensorId); });
  }

  /** Set recorded/warm-up duration as one editor gesture. */
  setClip(clip: { clipSeconds?: number; warmupSeconds?: number }): void {
    this.#transaction(() => { this.#doc.setClip(clip.clipSeconds, clip.warmupSeconds); });
  }

  /**
   * Persist editor presentation state (cameras, layout, render preferences).
   * Materialization deliberately ignores these extensions, so these edits do
   * not change SimScenarioInput or its deterministic hash.
   */
  setPresentationExtension(key: string, value?: unknown): void {
    if (!key.startsWith('studio.presentation.')) {
      throw new Error(`presentation extension key must start with "studio.presentation.": ${key}`);
    }
    this.#transaction(() => { this.#doc.setExtension(key, value); });
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
    for (const role of this.#doc.data.roles) {
      const record = recordFromRole(role);
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
        if (this.#namedSave && this.#namedSave !== autosaveName(this.map.id)) {
          await this.#store.write(this.#namedSave, this.#doc);
        }
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

function recordFromRole(role: RoleBinding): ActorRecord | null {
  if (role.kind !== 'scene_absolute' || !role.actor.catalogId) return null;
  const catalogId = role.actor.catalogId as CatalogId;
  const dims = role.actor.dims
    ? { l: role.actor.dims.length, w: role.actor.dims.width, h: role.actor.dims.height }
    : safeDims(catalogId);
  const isProp = role.actor.class === 'static_object';
  return {
    id: role.id,
    source: isProp ? 'prop' : 'role',
    kind: isProp ? 'prop' : role.actor.class === 'pedestrian' ? 'pedestrian' : 'vehicle',
    catalogId,
    label: role.label,
    x: role.pose.position.x,
    y: role.pose.position.y,
    z: role.pose.position.z,
    headingRad: role.pose.headingRad,
    laneRef: anchorFrom(role.laneRef),
    dims,
    bodyColor: typeof role.extensions?.['studio.presentation.bodyColor'] === 'string'
      ? role.extensions['studio.presentation.bodyColor']
      : undefined,
    sensors: role.actor.sensors,
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
