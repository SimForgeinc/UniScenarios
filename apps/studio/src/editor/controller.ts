/**
 * The editor's interaction state machine.
 *
 * Framework-free on purpose: React renders panels, this owns the pointer, the
 * keyboard, the three.js objects and the document. Panels read
 * {@link EditorController.state} and call methods; nothing in a render path
 * touches the scene graph, and a ghost tracking the cursor never depends on a
 * React commit.
 *
 * ## Sharing input with the camera
 *
 * `CameraRig` listens on the canvas. Listeners on the *same* element fire in
 * registration order regardless of the capture flag, so "register later and stop
 * propagation" does not work. Instead every listener here is registered on the
 * canvas's **parent** in the capture phase, which by DOM ordering runs before
 * anything on the canvas — so the editor can consume an event (placement click,
 * gizmo drag, lateral scroll) or let it through to the camera (orbit drag, zoom)
 * on a case-by-case basis.
 *
 * The division that makes the tool feel right:
 *
 * | gesture | owner |
 * |---|---|
 * | left click, no drag | editor (select or place) |
 * | left drag on empty map | camera (orbit) |
 * | middle drag | camera (ground-plane pan) |
 * | right drag | camera (pan), or cancel while editing |
 * | wheel | camera, except lateral nudge while lane-snapped |
 * | any pointer while in a modal mode (`G`/`R`/placing) | editor |
 *
 * ## Modal editing
 *
 * `G` and `R` are modes, not drags: press, move, click to confirm, `Esc` to
 * cancel — the Blender contract. While a mode is live the affected actors are
 * drawn from a preview overlay rather than from the document, so a 40-actor
 * drag writes exactly one undo entry at the end instead of one per frame.
 */

import { Raycaster, Vector2, Vector3, type Intersection } from 'three';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { CATALOG, getEntry, type CatalogId } from '@uniscenarios/prop-catalog';
import { buildSeededPlacementRoute } from '@uniscenarios/sim-engine';
import { ActorRenderer, GhostActor, type ActorView } from './actorRenderer';
import {
  actorKindFor,
  DEFAULT_AUTHORED_VEHICLE_SPEED_KPH,
  type ActorKind,
  type ActorRecord,
  type ActorUpdate,
  type EditorDocument,
  type LaneAnchor,
  type NewActor,
} from './document';
import {
  advanceAlongTravel,
  headingDelta,
  normalizeHeading,
  type IndexedLane,
  type LaneIndex,
} from './laneIndex';
import { firstOverlap, type Footprint } from './obb';

export type EditorMode = 'idle' | 'placing' | 'grab' | 'rotate';

/** Everything the panels render from. Replaced wholesale on every change. */
export interface EditorState {
  /** Exact EditorDocument revision represented by this snapshot. */
  readonly revision: number;
  readonly name: string;
  readonly mode: EditorMode;
  readonly actors: readonly ActorRecord[];
  readonly selection: readonly string[];
  /** Catalog id currently being placed. */
  readonly placing: CatalogId | null;
  /** Lane snapping is active for the current ghost (vehicles, no ⌥). */
  readonly snapped: boolean;
  /** Lateral nudge inside the lane, metres, positive to the left. */
  readonly lateral: number;
  /** Tab has flipped the ghost to the opposing lane. */
  readonly flipped: boolean;
  /** Ghost placement is legal. */
  readonly valid: boolean;
  /** One-line status hint: mode plus the modifiers that apply to it. */
  readonly hint: string;
  /** Transient feedback (a refused placement, a broken anchor). */
  readonly message: string | null;
  /** Live yaw readout while rotating, degrees. */
  readonly rotationDeg: number | null;
  /** Lane under the ghost / selection, for the status bar. */
  readonly laneLabel: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirty: boolean;
  readonly savedAt: number | null;
}

/** Live pose overrides used while a modal gesture is in flight. */
interface PosePatch {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  laneRef?: LaneAnchor | null;
}

interface GrabSession {
  origin: Map<string, ActorRecord>;
  start: Vector3;
  broke: boolean;
}

interface RotateSession {
  origin: Map<string, ActorRecord>;
  centerX: number;
  centerZ: number;
  startAngle: number;
  delta: number;
}

interface GhostPose {
  x: number;
  y: number;
  z: number;
  headingRad: number;
  laneRef: LaneAnchor | null;
  laneLabel: string | null;
  valid: boolean;
  reason: string | null;
}

export interface EditorControllerOptions {
  viewer: CityViewer;
  laneIndex: LaneIndex;
  document: EditorDocument;
  /** Ground height in scene metres, or `null` off the map. */
  sampleHeight: (x: number, z: number) => number | null;
}

/** How far from the cursor the snapper will look for a lane, metres. */
const SNAP_RADIUS_M = 30;
/** Clearance every pair of actors must keep, metres. */
const CLEARANCE_M = 0.3;
/** Pointer travel below which a press counts as a click, CSS pixels. */
const CLICK_SLOP_PX = 5;
/** Lateral nudge per wheel notch, metres. */
const LATERAL_STEP_M = 0.25;
/** Shift-snap increment while rotating, degrees. */
const ROTATE_SNAP_DEG = 15;
/** How long a transient status message stays up. */
const MESSAGE_MS = 2600;

const _ndc = new Vector2();
const _origin = new Vector3();
const _direction = new Vector3();

export class EditorController {
  readonly renderer = new ActorRenderer();
  /** Public so tooling (and the verification harness) can query lane geometry. */
  readonly laneIndex: LaneIndex;
  readonly doc: EditorDocument;

  private readonly viewer: CityViewer;
  private readonly sampleHeight: (x: number, z: number) => number | null;
  private readonly ghost = new GhostActor();
  private readonly raycaster = new Raycaster();
  private readonly listeners = new Set<() => void>();

  private host: HTMLElement | null = null;
  private unbindDoc: (() => void) | null = null;

  private mode: EditorMode = 'idle';
  private selection: string[] = [];
  private placing: CatalogId | null = null;
  private placingKind: 'vehicle' | 'pedestrian' | null = null;
  private pendingActorId: string | null = null;
  private lateral = 0;
  private flipped = false;
  private ghostPose: GhostPose | null = null;
  private preview = new Map<string, PosePatch>();
  private grab: GrabSession | null = null;
  private rotate: RotateSession | null = null;
  private message: string | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pointer bookkeeping for the click-vs-drag discrimination. */
  private pressX = 0;
  private pressY = 0;
  private pressButton = -1;
  private pressMoved = false;
  private headingDrag: { x: number; z: number } | null = null;
  private freeHeading = 0;
  private altDown = false;
  private shiftDown = false;
  private lastGroundY = 0;
  private notifyHandle = 0;
  private frameHandle = 0;
  /** False for every non-authoring session state. This is the capability gate,
   * not a cosmetic UI flag: all document-changing commands return at this boundary. */
  private authoringEnabled = true;

  private snapshot: EditorState;

  constructor(options: EditorControllerOptions) {
    this.viewer = options.viewer;
    this.laneIndex = options.laneIndex;
    this.doc = options.document;
    this.sampleHeight = options.sampleHeight;
    this.viewer.scene.add(this.renderer.group);
    this.viewer.scene.add(this.ghost.group);
    this.unbindDoc = this.doc.subscribe(() => {
      this.syncScene();
      // Document edits are already gesture-coalesced. Publish them immediately
      // so timeline edits update route previews before autosave/materialization.
      this.publish();
    });
    this.snapshot = this.buildState();
    this.syncScene();
  }

  // ------------------------------------------------------------ React glue

  get state(): EditorState {
    return this.snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EditorState => this.snapshot;

  setAuthoringEnabled(enabled: boolean): void {
    if (this.authoringEnabled === enabled) return;
    this.authoringEnabled = enabled;
    if (!enabled) {
      this.cancelModal();
      this.placing = null;
    }
    this.notify();
  }

  get canAuthor(): boolean {
    return this.authoringEnabled;
  }

  // ------------------------------------------------------------- lifecycle

  /**
   * Bind input.
   *
   * @param host The element *containing* the canvas — see the module docs on
   *   why listeners cannot live on the canvas itself.
   */
  attach(host: HTMLElement): void {
    this.detach();
    this.host = host;
    host.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    host.addEventListener('pointermove', this.onPointerMove, { capture: true });
    host.addEventListener('pointerup', this.onPointerUp, { capture: true });
    host.addEventListener('wheel', this.onWheel, { capture: true, passive: false });
    host.addEventListener('contextmenu', this.onContextMenu, { capture: true });
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
  }

  detach(): void {
    const host = this.host;
    if (!host) return;
    host.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    host.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    host.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    host.removeEventListener('wheel', this.onWheel, { capture: true });
    host.removeEventListener('contextmenu', this.onContextMenu, { capture: true });
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('keyup', this.onKeyUp, { capture: true });
    this.host = null;
  }

  dispose(): void {
    this.detach();
    if (this.messageTimer !== null) clearTimeout(this.messageTimer);
    if (this.notifyHandle) cancelAnimationFrame(this.notifyHandle);
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.unbindDoc?.();
    this.unbindDoc = null;
    this.ghost.dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }

  // ---------------------------------------------------------- commands (UI)

  /** Enter placement mode with a catalog item, or leave it if it is already active. */
  togglePlacement(catalogId: CatalogId): void {
    if (!this.authoringEnabled) return;
    if (this.mode === 'placing' && this.placing === catalogId) {
      this.cancel();
      return;
    }
    this.cancelModal();
    this.placingKind = null;
    this.pendingActorId = null;
    this.mode = 'placing';
    this.placing = catalogId;
    this.lateral = 0;
    this.flipped = false;
    this.ghost.show(catalogId);
    this.ghost.hide(); // stays hidden until the cursor is over the map
    this.notify();
  }

  /** Arm one human-level actor tool; the concrete appearance is stable per actor. */
  togglePlacementKind(kind: 'vehicle' | 'pedestrian'): void {
    if (!this.authoringEnabled) return;
    if (this.mode === 'placing' && this.placingKind === kind) {
      this.cancel();
      return;
    }
    this.cancelModal();
    this.mode = 'placing';
    this.placingKind = kind;
    this.prepareRandomActorAppearance(kind);
    this.lateral = 0;
    this.flipped = false;
    this.notify();
  }

  /** Change only appearance in one undoable document gesture. */
  updateActorAppearance(id: string, patch: { catalogId?: CatalogId; bodyColor?: string; initialSpeedKph?: number }): void {
    if (!this.authoringEnabled) return;
    const actor = this.doc.actor(id);
    if (!actor) return;
    if (patch.catalogId && actorKindFor(patch.catalogId) !== actor.kind) return;
    this.doc.update([{ id, ...patch }]);
  }

  /** Leave whatever mode is active; from idle, clear the selection. */
  cancel(): void {
    if (this.mode === 'idle') {
      if (this.selection.length > 0) this.setSelection([]);
      return;
    }
    this.cancelModal();
    this.notify();
  }

  setSelection(ids: readonly string[]): void {
    this.selection = [...new Set(ids)].filter((id) => this.doc.actor(id));
    this.syncScene();
    this.notify();
  }

  /** Deliberate, name-click-only camera framing. Timeline row controls never call this. */
  frameActor(id: string, materializedActor?: ActorView): void {
    const actor = this.doc.actor(id) ?? (materializedActor?.id === id ? materializedActor : undefined);
    if (!actor) return;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    const from = this.viewer.controls.getView();
    const startPosition = new Vector3(...from.position);
    const startTarget = new Vector3(...from.target);
    const target = new Vector3(actor.x, actor.y + actor.dims.h * 0.5, actor.z);
    const direction = startPosition.clone().sub(startTarget);
    if (direction.lengthSq() < 0.001) direction.set(1, 0.8, 1);
    const distance = Math.max(14, Math.min(42, Math.max(actor.dims.l, actor.dims.h) * 4.5));
    const destination = target.clone().add(direction.normalize().multiplyScalar(distance));
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const linear = Math.min(1, (now - startedAt) / 320);
      const eased = 1 - Math.pow(1 - linear, 3);
      this.viewer.controls.setView(
        startPosition.clone().lerp(destination, eased),
        startTarget.clone().lerp(target, eased),
      );
      if (linear < 1) this.frameHandle = requestAnimationFrame(tick);
      else this.frameHandle = 0;
    };
    this.frameHandle = requestAnimationFrame(tick);
  }

  selectAll(): void {
    this.setSelection(this.doc.actors.map((a) => a.id));
  }

  deleteSelection(): void {
    if (!this.authoringEnabled) return;
    if (this.selection.length === 0) return;
    const n = this.selection.length;
    this.doc.remove(this.selection);
    this.selection = [];
    this.flash(`deleted ${n} actor${n === 1 ? '' : 's'}`);
  }

  /**
   * Copy the selection one body-length upstream.
   *
   * "Upstream" is along the lane when the actor is anchored (so a duplicated car
   * lands in its own lane behind itself, ready to become a queue) and along its
   * own heading otherwise. Pedestrians and props use a flat 2 m, since their
   * body length is not a meaningful spacing.
   */
  duplicateSelection(): void {
    if (!this.authoringEnabled) return;
    if (this.selection.length === 0) return;
    const inputs: NewActor[] = [];
    for (const id of this.selection) {
      const actor = this.doc.actor(id);
      if (!actor) continue;
      const gap = actor.kind === 'vehicle' ? actor.dims.l + 1 : 2;
      const lane = actor.laneRef ? this.laneFor(actor.laneRef) : null;
      if (lane && actor.laneRef) {
        const s = advanceAlongTravel(lane, actor.laneRef.s, -gap);
        const pose = this.laneIndex.poseAt(lane, s, actor.laneRef.t);
        inputs.push({
          catalogId: actor.catalogId,
          x: pose.x,
          y: this.groundY(pose.x, pose.z, actor.y),
          z: pose.z,
          headingRad: normalizeHeading(pose.headingRad + actor.laneRef.headingOffsetRad),
          laneRef: { ...actor.laneRef, s },
        });
        continue;
      }
      const x = actor.x - Math.cos(actor.headingRad) * gap;
      const z = actor.z + Math.sin(actor.headingRad) * gap;
      inputs.push({
        catalogId: actor.catalogId,
        x,
        y: this.groundY(x, z, actor.y),
        z,
        headingRad: actor.headingRad,
      });
    }
    const ids = this.doc.add(inputs);
    this.selection = ids;
    this.flash(`duplicated ${ids.length}`);
  }

  undo(): void {
    if (!this.authoringEnabled) return;
    if (!this.doc.undo()) return;
    this.selection = this.selection.filter((id) => this.doc.actor(id));
    this.syncScene();
    this.notify();
  }

  redo(): void {
    if (!this.authoringEnabled) return;
    if (!this.doc.redo()) return;
    this.selection = this.selection.filter((id) => this.doc.actor(id));
    this.syncScene();
    this.notify();
  }

  /** Start a move gesture on the current selection (the `G` key, or a button). */
  beginGrab(): void {
    if (!this.authoringEnabled) return;
    if (this.selection.length === 0) {
      this.flash('select something first');
      return;
    }
    const start = this.lastGroundPoint;
    if (!start) return;
    this.cancelModal();
    this.grab = {
      origin: new Map(this.selection.map((id) => [id, this.doc.actor(id) as ActorRecord])),
      start: start.clone(),
      broke: false,
    };
    this.mode = 'grab';
    this.notify();
  }

  /** Start a rotate gesture on the current selection (the `R` key). */
  beginRotate(): void {
    if (!this.authoringEnabled) return;
    if (this.selection.length === 0) {
      this.flash('select something first');
      return;
    }
    const point = this.lastGroundPoint;
    if (!point) return;
    this.cancelModal();
    const origin = new Map(this.selection.map((id) => [id, this.doc.actor(id) as ActorRecord]));
    let cx = 0;
    let cz = 0;
    for (const actor of origin.values()) {
      cx += actor.x;
      cz += actor.z;
    }
    cx /= origin.size;
    cz /= origin.size;
    this.rotate = {
      origin,
      centerX: cx,
      centerZ: cz,
      startAngle: Math.atan2(-(point.z - cz), point.x - cx),
      delta: 0,
    };
    this.mode = 'rotate';
    this.notify();
  }

  // ------------------------------------------------------- inspector edits

  setLabel(id: string, label: string): void {
    if (!this.authoringEnabled) return;
    this.doc.update([{ id, label }]);
  }

  /**
   * Edit the world pose numerically.
   *
   * Moving an anchored actor in world space is a conflict: the lane anchor says
   * one thing, the numbers another. Rather than silently keeping a stale anchor,
   * the actor is re-snapped when it still lands on its own lane and the anchor is
   * dropped (with a message) when it does not.
   */
  setWorldPose(id: string, patch: { x?: number; z?: number; headingDeg?: number }): void {
    if (!this.authoringEnabled) return;
    const actor = this.doc.actor(id);
    if (!actor) return;
    const x = patch.x ?? actor.x;
    const z = patch.z ?? actor.z;
    const headingRad =
      patch.headingDeg === undefined
        ? actor.headingRad
        : normalizeHeading((patch.headingDeg * Math.PI) / 180);
    const update: ActorUpdate = { id, x, z, y: this.groundY(x, z, actor.y), headingRad };

    if (actor.laneRef) {
      const lane = this.laneFor(actor.laneRef);
      if (lane) {
        const hit = this.laneIndex.project(lane, x, z);
        if (Math.abs(hit.t) <= lane.widthM) {
          update.laneRef = {
            ...actor.laneRef,
            s: hit.s,
            t: hit.t,
            headingOffsetRad: headingDelta(hit.headingRad, headingRad),
          };
        } else {
          update.laneRef = null;
          this.flash('moved off its lane — anchor cleared');
        }
      } else {
        update.laneRef = null;
      }
    }
    this.doc.update([update]);
  }

  /** Edit the lane anchor numerically; the world pose is re-derived from it. */
  setLanePose(id: string, patch: { s?: number; t?: number }): void {
    if (!this.authoringEnabled) return;
    const actor = this.doc.actor(id);
    if (!actor?.laneRef) return;
    const lane = this.laneFor(actor.laneRef);
    if (!lane) return;
    const s = Math.min(lane.length, Math.max(0, patch.s ?? actor.laneRef.s));
    const t = patch.t ?? actor.laneRef.t;
    const pose = this.laneIndex.poseAt(lane, s, t);
    this.doc.update([
      {
        id,
        x: pose.x,
        z: pose.z,
        y: this.groundY(pose.x, pose.z, actor.y),
        headingRad: normalizeHeading(pose.headingRad + actor.laneRef.headingOffsetRad),
        laneRef: { ...actor.laneRef, s, t },
      },
    ]);
  }

  /** Lane length, so the inspector can bound its `s` field. */
  laneLength(anchor: LaneAnchor): number | null {
    return this.laneFor(anchor)?.length ?? null;
  }

  // ------------------------------------------------------------ input: keys

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') this.setAlt(true);
    if (event.key === 'Shift') this.setShift(true);
    if (isTypingTarget(event.target)) return;
    if (!this.authoringEnabled) return;

    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      event.stopPropagation();
      this.duplicateSelection();
      return;
    }
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      this.selectAll();
      return;
    }
    if (meta) return; // leave the rest of the browser's shortcuts alone

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
        return;
      case 'g':
      case 'G':
        event.preventDefault();
        event.stopPropagation();
        this.beginGrab();
        return;
      case 'r':
      case 'R':
        event.preventDefault();
        event.stopPropagation();
        this.beginRotate();
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        event.stopPropagation();
        this.deleteSelection();
        return;
      case 'Tab':
        if (this.mode === 'placing') {
          event.preventDefault();
          event.stopPropagation();
          this.flipped = !this.flipped;
          this.refreshGhost();
        }
        return;
      case 'Enter':
        if (this.mode === 'grab' || this.mode === 'rotate') {
          event.preventDefault();
          event.stopPropagation();
          this.commitModal();
        }
        return;
      default:
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') this.setAlt(false);
    if (event.key === 'Shift') this.setShift(false);
  };

  private setAlt(down: boolean): void {
    if (this.altDown === down) return;
    this.altDown = down;
    if (this.mode === 'placing') this.refreshGhost();
    else if (this.mode === 'grab') this.updateGrab();
  }

  private setShift(down: boolean): void {
    if (this.shiftDown === down) return;
    this.shiftDown = down;
    if (this.mode === 'rotate') this.updateRotate();
  }

  // -------------------------------------------------------- input: pointer

  private onContextMenu = (event: MouseEvent): void => {
    // Right-click cancels a modal gesture instead of opening a menu; outside a
    // mode it belongs to the camera (pan), which already suppresses the menu.
    if (this.mode === 'grab' || this.mode === 'rotate' || this.mode === 'placing') {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    }
  };

  /**
   * Only the canvas is the map.
   *
   * The panels are siblings of the canvas inside the host, so a capture-phase
   * listener on the host sees palette clicks and inspector scrolls too. Without
   * this guard, arming a prop from the palette would immediately place one.
   */
  private isCanvasEvent(event: Event): boolean {
    return event.target === this.viewer.renderer.domElement;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.isCanvasEvent(event)) return;
    if (!this.authoringEnabled) return;
    this.altDown = event.altKey;
    this.shiftDown = event.shiftKey;

    if (this.mode === 'grab' || this.mode === 'rotate') {
      if (event.button === 0) {
        event.preventDefault();
        event.stopPropagation();
        this.commitModal();
      }
      return;
    }

    this.pressButton = event.button;
    this.pressX = event.clientX;
    this.pressY = event.clientY;
    this.pressMoved = false;

    if (this.mode === 'placing' && event.button === 0) {
      // The camera must not orbit while the user is dropping actors.
      event.preventDefault();
      event.stopPropagation();
      const ground = this.groundPoint(event);
      if (ground) this.headingDrag = { x: ground.x, z: ground.z };
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.isCanvasEvent(event)) return;
    if (!this.authoringEnabled) return;
    this.altDown = event.altKey;
    this.shiftDown = event.shiftKey;
    if (
      this.pressButton >= 0 &&
      (Math.abs(event.clientX - this.pressX) > CLICK_SLOP_PX ||
        Math.abs(event.clientY - this.pressY) > CLICK_SLOP_PX)
    ) {
      this.pressMoved = true;
    }

    switch (this.mode) {
      case 'placing': {
        const ground = this.groundPoint(event);
        if (!ground) {
          this.ghost.hide();
          this.ghostPose = null;
          return;
        }
        if (this.headingDrag && this.pressMoved) {
          const dx = ground.x - this.headingDrag.x;
          const dz = ground.z - this.headingDrag.z;
          if (dx * dx + dz * dz > 0.5) this.freeHeading = Math.atan2(-dz, dx);
        }
        this.updateGhost(ground);
        return;
      }
      case 'grab':
        this.updateGrab(event);
        return;
      case 'rotate':
        this.updateRotate(event);
        return;
      default:
        // Idle: remember where the cursor is on the ground so `G`/`R` have an
        // anchor the moment they are pressed.
        this.groundPoint(event);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.isCanvasEvent(event)) return;
    if (!this.authoringEnabled) return;
    const wasPlacing = this.mode === 'placing';
    const button = this.pressButton;
    const moved = this.pressMoved;
    this.pressButton = -1;
    this.headingDrag = null;

    if (button !== 0) return;

    if (wasPlacing) {
      event.preventDefault();
      event.stopPropagation();
      this.commitPlacement(event.altKey);
      return;
    }
    if (this.mode !== 'idle' || moved) return;
    // A click that did not drag is a selection, not a camera move.
    this.pick(event);
  };

  private onWheel = (event: WheelEvent): void => {
    // Only steal the wheel when it has a lane to nudge along; otherwise it is
    // the camera's zoom and must stay that way.
    if (!this.isCanvasEvent(event) || !this.authoringEnabled) return;
    if (this.mode !== 'placing' || !this.ghostPose?.laneRef) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.deltaY > 0 ? -LATERAL_STEP_M : LATERAL_STEP_M;
    this.lateral += step;
    this.refreshGhost();
  };

  // ------------------------------------------------------------- placement

  private updateGhost(ground: Vector3): void {
    const catalogId = this.placing;
    if (!catalogId) return;
    const pose = this.computeGhostPose(catalogId, ground);
    this.ghostPose = pose;
    if (!pose) {
      this.ghost.hide();
      this.notify();
      return;
    }
    this.ghost.show(catalogId);
    this.ghost.setPose(pose.x, pose.y, pose.z, pose.headingRad);
    this.ghost.setValid(pose.valid);
    this.notify();
  }

  /** Recompute the ghost at the last known cursor position (after Tab/⌥/scroll). */
  private refreshGhost(): void {
    const point = this.lastGroundPoint;
    if (point && this.mode === 'placing') this.updateGhost(point);
    else this.notify();
  }

  private computeGhostPose(catalogId: CatalogId, ground: Vector3): GhostPose {
    const kind = actorKindFor(catalogId);
    const dims = getEntry(catalogId).dims;
    const wantsLane = kind === 'vehicle' && !this.altDown;

    if (wantsLane) {
      let hit = this.laneIndex.nearest(ground.x, ground.z, SNAP_RADIUS_M);
      if (hit && this.flipped) {
        hit = this.laneIndex.nearestOpposing(ground.x, ground.z, hit.headingRad, SNAP_RADIUS_M) ?? hit;
      }
      if (!hit) {
        return {
          x: ground.x,
          y: ground.y,
          z: ground.z,
          headingRad: this.freeHeading,
          laneRef: null,
          laneLabel: null,
          valid: false,
          reason: 'no driving lane within 30 m — hold ⌥ to place anyway',
        };
      }
      const limit = this.laneIndex.lateralLimit(hit.lane, dims.w);
      const t = Math.max(-limit, Math.min(limit, this.lateral));
      this.lateral = t;
      const pose = this.laneIndex.poseAt(hit.lane, hit.s, t);
      const y = this.groundY(pose.x, pose.z, ground.y);
      const blocker = this.overlap({
        x: pose.x,
        z: pose.z,
        length: dims.l,
        width: dims.w,
        headingRad: pose.headingRad,
      });
      return {
        x: pose.x,
        y,
        z: pose.z,
        headingRad: pose.headingRad,
        laneRef: {
          roadId: hit.lane.roadId,
          section: hit.lane.section,
          laneId: hit.lane.laneId,
          s: hit.s,
          t,
          headingOffsetRad: 0,
        },
        laneLabel: laneLabel(hit.lane, hit.s, t),
        valid: !blocker,
        reason: blocker ? `overlaps ${describe(blocker)} — hold ⌥ to place anyway` : null,
      };
    }

    // Free placement: ground snap, heading from the drag (or the last one).
    const heading = this.freeHeading;
    const blocker = this.overlap({
      x: ground.x,
      z: ground.z,
      length: dims.l,
      width: dims.w,
      headingRad: heading,
    });
    return {
      x: ground.x,
      y: ground.y,
      z: ground.z,
      headingRad: heading,
      laneRef: null,
      laneLabel: null,
      valid: !blocker,
      reason: blocker ? `overlaps ${describe(blocker)} — hold ⌥ to place anyway` : null,
    };
  }

  private commitPlacement(altClick: boolean): void {
    const pose = this.ghostPose;
    const catalogId = this.placing;
    if (!pose || !catalogId) return;
    if (!pose.valid && !altClick) {
      this.flash(pose.reason ?? 'cannot place here');
      return;
    }
    const actorId = this.pendingActorId ?? this.doc.allocateActorId(catalogId);
    const drivingSpeedKph = defaultDrivingSpeedKph(catalogId);
    let routeLaneRsls: readonly string[] | undefined;
    if (drivingSpeedKph !== null) {
      if (!pose.laneRef) {
        this.flash('Place road vehicles on a valid driving lane so a route can be created');
        return;
      }
      const startRsl = `${pose.laneRef.roadId}:${pose.laneRef.section}:${pose.laneRef.laneId}`;
      const duration = this.doc.data.choreography.clipSeconds + this.doc.data.choreography.warmupSeconds;
      // Cover warm-up plus every recorded frame at exactly 30 mph. A small
      // runway margin prevents the actor from landing on the terminal sample.
      const requiredDownstreamM = Math.max(100, (drivingSpeedKph / 3.6) * duration + 10);
      const planned = buildSeededPlacementRoute(this.laneIndex.graph, {
        startRsl,
        startStorageS: pose.laneRef.s,
        requiredDownstreamM,
        seed: this.doc.routeSeed,
        actorId,
      });
      if (!planned.ok) {
        this.flash(`No usable road route here — ${planned.error.reason}`);
        return;
      }
      routeLaneRsls = planned.lanes;
    }
    const ids = this.doc.add([{
      id: actorId,
      catalogId,
      x: pose.x,
      y: pose.y,
      z: pose.z,
      headingRad: pose.headingRad,
      ...(pose.laneRef ? { laneRef: pose.laneRef } : {}),
      ...(routeLaneRsls ? { routeLaneRsls, initialSpeedKph: drivingSpeedKph as number } : {}),
      ...(actorKindFor(catalogId) === 'vehicle'
        ? { bodyColor: defaultBodyColor(catalogId) }
        : {}),
    }]);
    if (!pose.valid) this.flash('placed with ⌥ override');
    // Stay in placement mode: filling a street means placing ten of these.
    this.selection = ids;
    if (this.placingKind) this.prepareRandomActorAppearance(this.placingKind);
    this.syncScene();
    this.notify();
  }

  private prepareRandomActorAppearance(kind: 'vehicle' | 'pedestrian'): void {
    const placeholder = kind === 'vehicle' ? 'vehicle.sedan' : 'pedestrian.adult_standing';
    const actorId = this.doc.allocateActorId(placeholder as CatalogId);
    const catalogId = deterministicActorCatalog(kind, this.doc.routeSeed, actorId);
    this.pendingActorId = actorId;
    this.placing = catalogId;
    this.ghost.show(catalogId);
    this.ghost.hide();
  }

  // ------------------------------------------------------------ grab/rotate

  private updateGrab(event?: PointerEvent): void {
    const session = this.grab;
    if (!session) return;
    const ground = event ? this.groundPoint(event) : this.lastGroundPoint;
    if (!ground) return;
    const dx = ground.x - session.start.x;
    const dz = ground.z - session.start.z;
    const breakAnchor = this.altDown;
    if (breakAnchor) session.broke = true;

    this.preview.clear();
    for (const actor of session.origin.values()) {
      const targetX = actor.x + dx;
      const targetZ = actor.z + dz;
      const lane = !breakAnchor && actor.laneRef ? this.laneFor(actor.laneRef) : null;
      if (lane && actor.laneRef) {
        // Anchored: the drag slides along the lane, it does not leave the road
        // network. Lanes are short — a junction lane on Yale Street can be 8 m —
        // so a drag that runs off the end hands over to whichever lane is now
        // nearest instead of piling up at the terminus. That keeps "drag a car
        // down the street" working across road and section boundaries, which a
        // strict single-lane projection cannot do.
        const hit = this.laneIndex.project(lane, targetX, targetZ);
        const ranOff = hit.s <= 1e-6 || hit.s >= lane.length - 1e-6;
        const handoff =
          ranOff && hit.distance > lane.widthM
            ? this.laneIndex.nearest(targetX, targetZ, SNAP_RADIUS_M)
            : null;
        const use = handoff && handoff.distance < hit.distance ? handoff : hit;
        const anchor: LaneAnchor =
          use === hit
            ? { ...actor.laneRef, s: hit.s }
            : {
                roadId: use.lane.roadId,
                section: use.lane.section,
                laneId: use.lane.laneId,
                s: use.s,
                t: actor.laneRef.t,
                headingOffsetRad: actor.laneRef.headingOffsetRad,
              };
        const pose = this.laneIndex.poseAt(use.lane, anchor.s, anchor.t);
        this.preview.set(actor.id, {
          x: pose.x,
          y: this.groundY(pose.x, pose.z, actor.y),
          z: pose.z,
          headingRad: normalizeHeading(pose.headingRad + anchor.headingOffsetRad),
          laneRef: anchor,
        });
        continue;
      }
      this.preview.set(actor.id, {
        x: targetX,
        y: this.groundY(targetX, targetZ, actor.y),
        z: targetZ,
        headingRad: actor.headingRad,
        laneRef: breakAnchor && actor.laneRef ? null : undefined,
      });
    }
    this.syncScene();
    this.notify();
  }

  private updateRotate(event?: PointerEvent): void {
    const session = this.rotate;
    if (!session) return;
    const ground = event ? this.groundPoint(event) : this.lastGroundPoint;
    if (!ground) return;
    const angle = Math.atan2(-(ground.z - session.centerZ), ground.x - session.centerX);
    let delta = normalizeHeading(angle - session.startAngle);
    if (this.shiftDown) {
      const step = (ROTATE_SNAP_DEG * Math.PI) / 180;
      delta = Math.round(delta / step) * step;
    }
    session.delta = delta;

    this.preview.clear();
    for (const actor of session.origin.values()) {
      // Rotate in place, not about the group pivot: a scenario author turning
      // three queued cars wants them all turned, not swung off their lane.
      const headingRad = normalizeHeading(actor.headingRad + delta);
      const patch: PosePatch = { x: actor.x, y: actor.y, z: actor.z, headingRad };
      if (actor.laneRef) {
        const lane = this.laneFor(actor.laneRef);
        if (lane) {
          const pose = this.laneIndex.poseAt(lane, actor.laneRef.s, actor.laneRef.t);
          patch.laneRef = {
            ...actor.laneRef,
            headingOffsetRad: headingDelta(pose.headingRad, headingRad),
          };
        }
      }
      this.preview.set(actor.id, patch);
    }
    this.syncScene();
    this.notify();
  }

  private commitModal(): void {
    const updates: ActorUpdate[] = [];
    for (const [id, patch] of this.preview) {
      updates.push({
        id,
        x: patch.x,
        y: patch.y,
        z: patch.z,
        headingRad: patch.headingRad,
        ...(patch.laneRef === undefined ? {} : { laneRef: patch.laneRef }),
      });
    }
    const broke = this.grab?.broke === true;
    this.preview.clear();
    this.grab = null;
    this.rotate = null;
    this.mode = 'idle';
    if (updates.length > 0) this.doc.update(updates);
    if (broke) this.flash('lane anchor cleared');
    this.syncScene();
    this.notify();
  }

  /** Drop any in-flight gesture without writing to the document. */
  private cancelModal(): void {
    this.preview.clear();
    this.grab = null;
    this.rotate = null;
    this.placing = null;
    this.placingKind = null;
    this.pendingActorId = null;
    this.ghost.hide();
    this.ghostPose = null;
    this.mode = 'idle';
    this.syncScene();
  }

  // -------------------------------------------------------------- picking

  private pick(event: PointerEvent): void {
    const targets = this.renderer.pickables();
    if (targets.length === 0) {
      if (!event.shiftKey) this.setSelection([]);
      return;
    }
    this.setRay(event);
    const hits: Intersection[] = this.raycaster.intersectObjects(targets, false);
    let id: string | null = null;
    for (const hit of hits) {
      id = this.renderer.actorIdForHit(hit);
      if (id) break;
    }
    if (!id) {
      if (!event.shiftKey) this.setSelection([]);
      return;
    }
    if (event.shiftKey) {
      const next = this.selection.includes(id)
        ? this.selection.filter((x) => x !== id)
        : [...this.selection, id];
      this.setSelection(next);
    } else {
      this.setSelection([id]);
      // A direct scene click has the same camera contract as clicking the
      // actor's name in the timeline: smoothly frame that actor.  Keep this
      // out of `setSelection` so Speed/Actions controls, box selection, and
      // playback-driven selection remain completely camera-neutral.
      this.frameActor(id);
    }
  }

  // --------------------------------------------------------------- helpers

  private lastGround: Vector3 | null = null;

  private get lastGroundPoint(): Vector3 | null {
    return this.lastGround;
  }

  private setRay(event: PointerEvent): void {
    const rect = (this.host ?? this.viewer.renderer.domElement).getBoundingClientRect();
    _ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(_ndc, this.viewer.camera);
  }

  /**
   * Where the cursor meets the ground.
   *
   * Not a raycast against the scene: the ground is a height *field*, so the
   * cheap answer is to intersect a horizontal plane and then iterate — sample
   * the terrain there, move the plane to that height, repeat. Three passes
   * converge to millimetres on real city grades, at ~0.2 µs a sample through
   * `GroundIndex`, and it never touches the scene graph.
   */
  private groundPoint(event: PointerEvent): Vector3 | null {
    this.setRay(event);
    _origin.copy(this.raycaster.ray.origin);
    _direction.copy(this.raycaster.ray.direction);
    if (_direction.y >= -1e-6) return null; // looking at or above the horizon

    let y = this.lastGroundY;
    const point = new Vector3();
    for (let i = 0; i < 4; i++) {
      const t = (y - _origin.y) / _direction.y;
      if (!(t > 0) || t > 1e5) return null;
      point.copy(_direction).multiplyScalar(t).add(_origin);
      const sampled = this.sampleHeight(point.x, point.z);
      if (sampled === null) break;
      if (Math.abs(sampled - y) < 0.01) {
        y = sampled;
        break;
      }
      y = sampled;
    }
    point.y = y;
    this.lastGroundY = y;
    this.lastGround = point;
    return point;
  }

  private groundY(x: number, z: number, fallback: number): number {
    const sampled = this.sampleHeight(x, z);
    return sampled === null ? fallback : sampled;
  }

  private laneFor(anchor: LaneAnchor): IndexedLane | null {
    return this.laneIndex.laneFor(anchor.roadId, anchor.section, anchor.laneId) ?? null;
  }

  private overlap(probe: Footprint): (Footprint & { id: string; catalogId: CatalogId }) | null {
    const others = this.doc.actors.map((a) => ({
      id: a.id,
      catalogId: a.catalogId,
      x: a.x,
      z: a.z,
      length: a.dims.l,
      width: a.dims.w,
      headingRad: a.headingRad,
    }));
    return firstOverlap(probe, others, CLEARANCE_M);
  }

  /** Push the current document + preview into the renderer. */
  private syncScene(): void {
    const views: ActorView[] = this.doc.actors.map((actor) => {
      const patch = this.preview.get(actor.id);
      return {
        id: actor.id,
        catalogId: actor.catalogId,
        x: patch?.x ?? actor.x,
        y: patch?.y ?? actor.y,
        z: patch?.z ?? actor.z,
        headingRad: patch?.headingRad ?? actor.headingRad,
        dims: actor.dims,
        bodyColor: actor.bodyColor,
      };
    });
    this.renderer.sync(views);
    const selected = new Set(this.selection);
    this.renderer.setSelection(views.filter((v) => selected.has(v.id)));
  }

  private flash(message: string): void {
    this.message = message;
    if (this.messageTimer !== null) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => {
      this.message = null;
      this.messageTimer = null;
      this.notify();
    }, MESSAGE_MS);
    this.notify();
  }

  /** Coalesce notifications to one per frame: pointer moves fire in bursts. */
  private notify(): void {
    if (this.notifyHandle) return;
    this.notifyHandle = requestAnimationFrame(() => {
      this.notifyHandle = 0;
      this.publish();
    });
  }

  private publish(): void {
    this.snapshot = this.buildState();
    for (const listener of [...this.listeners]) listener();
  }

  private buildState(): EditorState {
    const selectedRecord =
      this.selection.length === 1 ? this.doc.actor(this.selection[0] as string) : undefined;
    const laneLabel =
      this.mode === 'placing'
        ? this.ghostPose?.laneLabel ?? null
        : selectedRecord?.laneRef
          ? anchorLabel(selectedRecord.laneRef)
          : null;
    return {
      revision: this.doc.revision,
      name: this.doc.name,
      mode: this.mode,
      actors: this.doc.actors,
      selection: this.selection,
      placing: this.placing,
      snapped: this.ghostPose?.laneRef != null,
      lateral: this.lateral,
      flipped: this.flipped,
      valid: this.ghostPose?.valid ?? true,
      hint: this.buildHint(),
      message: this.message,
      rotationDeg:
        this.mode === 'rotate' && this.rotate ? (this.rotate.delta * 180) / Math.PI : null,
      laneLabel,
      canUndo: this.doc.canUndo,
      canRedo: this.doc.canRedo,
      dirty: this.doc.isDirty,
      savedAt: this.doc.savedAt,
    };
  }

  private buildHint(): string {
    switch (this.mode) {
      case 'placing': {
        const kind: ActorKind = this.placing ? actorKindFor(this.placing) : 'prop';
        if (kind === 'vehicle') {
          return this.ghostPose?.laneRef
            ? `click place · Tab opposite lane · scroll offset ${this.lateral.toFixed(2)} m · ⌥ free · right-click cancel`
            : 'free placement (⌥) · click place · drag set heading · right-click cancel';
        }
        return 'click place · click-drag set heading · right-click cancel';
      }
      case 'grab':
        return 'move · click confirm · ⌥ break lane anchor · right-click cancel';
      case 'rotate':
        return 'rotate · ⇧ 15° snap · click confirm · right-click cancel';
      default:
        return this.selection.length > 0
          ? `${this.selection.length} selected · G move · R rotate · ⌘D duplicate · ⌫ delete · ⇧click add`
          : 'choose a build tool · click select · left-drag rotate · middle-drag / WASD pan';
    }
  }
}

function laneLabel(lane: IndexedLane, s: number, t: number): string {
  const offset = Math.abs(t) < 0.005 ? '' : ` · t ${t >= 0 ? '+' : ''}${t.toFixed(2)} m`;
  return `road ${lane.roadId} · lane ${lane.laneId} · s ${s.toFixed(1)} m${offset}`;
}

function anchorLabel(anchor: LaneAnchor): string {
  const offset = Math.abs(anchor.t) < 0.005 ? '' : ` · t ${anchor.t >= 0 ? '+' : ''}${anchor.t.toFixed(2)} m`;
  return `road ${anchor.roadId} · lane ${anchor.laneId} · s ${anchor.s.toFixed(1)} m${offset}`;
}

function describe(actor: { catalogId: CatalogId }): string {
  try {
    return getEntry(actor.catalogId).label.toLowerCase();
  } catch {
    return 'another actor';
  }
}

/** Exact authored cruise speed for newly placed motor vehicles; null stays static. */
export function defaultDrivingSpeedKph(catalogId: CatalogId): number | null {
  const entry = getEntry(catalogId);
  if (entry.class !== 'vehicle' || !entry.tags.includes('roadway')) return null;
  // A cyclist is a VRU, not a default motor-traffic actor. Sidewalk mobility
  // devices are already excluded by the roadway requirement above.
  if (catalogId === 'vehicle.bicycle') return null;
  return DEFAULT_AUTHORED_VEHICLE_SPEED_KPH;
}

/** Stable catalog choice: save/reopen never rerolls an actor's appearance. */
export function deterministicActorCatalog(
  kind: 'vehicle' | 'pedestrian',
  scenarioSeed: string,
  actorId: string,
): CatalogId {
  const compatible = CATALOG.filter((entry) => kind === 'pedestrian'
    ? entry.class === 'pedestrian'
    : entry.class === 'vehicle' && (entry.tags as readonly string[]).includes('roadway') && entry.id !== 'vehicle.bicycle')
    .map((entry) => entry.id as CatalogId)
    .sort();
  if (compatible.length === 0) throw new Error(`No compatible ${kind} models are installed`);
  let hash = 2166136261;
  for (const char of `${scenarioSeed}|${actorId}|${kind}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return compatible[(hash >>> 0) % compatible.length] as CatalogId;
}

function defaultBodyColor(catalogId: CatalogId): string {
  const color = getEntry(catalogId).defaultParams['color'];
  return typeof color === 'string' ? color : '#59748f';
}

/** Keyboard shortcuts must not fire while the user is typing in the inspector. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || !element.tagName) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}
