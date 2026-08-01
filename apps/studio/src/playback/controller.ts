import { Vector3 } from 'three';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { ActorRenderer, type ActorView } from '../editor/actorRenderer';
import { samplePlaybackActors, type PlaybackBundle, type SampledActor } from './model';

export interface PlaybackState {
  readonly time: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly playing: boolean;
  readonly actorCount: number;
  readonly visibleActorCount: number;
  readonly instanceId: string;
  readonly inputHash: string;
}

export interface PlaybackControllerOptions {
  viewer: CityViewer;
  bundle: PlaybackBundle;
  sampleHeight: (x: number, z: number) => number | null;
}

/** Drives the real Studio actor renderer from trace time, independent of React render cadence. */
export class PlaybackController {
  readonly renderer = new ActorRenderer();
  readonly bundle: PlaybackBundle;

  private readonly viewer: CityViewer;
  private readonly sampleHeight: (x: number, z: number) => number | null;
  private readonly listeners = new Set<() => void>();
  private time: number;
  private playing = false;
  private raf = 0;
  private previousNow = 0;
  private sampled: readonly SampledActor[] = [];
  private snapshot: PlaybackState;

  constructor(options: PlaybackControllerOptions) {
    this.viewer = options.viewer;
    this.bundle = options.bundle;
    this.sampleHeight = options.sampleHeight;
    this.time = this.bundle.startTime;
    this.renderer.group.name = 'playback-actors';
    this.viewer.scene.add(this.renderer.group);
    this.syncScene();
    this.frameActors();
    this.snapshot = this.buildState();
  }

  get state(): PlaybackState {
    return this.snapshot;
  }

  /** Current scene-frame actor samples, exposed for deterministic verification. */
  get currentActors(): readonly SampledActor[] {
    return this.sampled;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PlaybackState => this.snapshot;

  play(): void {
    if (this.playing) return;
    if (this.time >= this.bundle.endTime) this.time = this.bundle.startTime;
    this.playing = true;
    this.previousNow = performance.now();
    this.publish();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.publish();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.time = Math.max(this.bundle.startTime, Math.min(this.bundle.endTime, time));
    this.syncScene();
    // A scrub is an explicit request to inspect this moment. Reframe the real
    // present actors rather than leaving them as sub-pixel dots in the map-wide
    // import view (the exact failure mode of the rejected map-only evidence).
    this.frameActors();
    this.publish();
  }

  dispose(): void {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer.dispose();
    this.listeners.clear();
  }

  private tick = (now: number): void => {
    if (!this.playing) return;
    const elapsed = Math.max(0, Math.min(0.25, (now - this.previousNow) / 1000));
    this.previousNow = now;
    this.time = Math.min(this.bundle.endTime, this.time + elapsed);
    this.syncScene();
    // Follow the incident while playing. Actor transforms still come solely
    // from the trace; this only keeps those actors visibly inspectable.
    this.frameActors();
    if (this.time >= this.bundle.endTime) {
      this.playing = false;
      this.raf = 0;
      this.publish();
      return;
    }
    this.publish();
    this.raf = requestAnimationFrame(this.tick);
  };

  private syncScene(): void {
    this.sampled = samplePlaybackActors(this.bundle, this.time);
    const views: ActorView[] = this.sampled
      .filter((actor) => actor.present)
      .map((actor) => ({
        id: actor.id,
        catalogId: actor.catalogId,
        dims: actor.dims,
        x: actor.x,
        y: this.sampleHeight(actor.x, actor.z) ?? 0,
        z: actor.z,
        headingRad: actor.headingRad,
      }));
    this.renderer.sync(views);
    this.renderer.setSelection([]);
  }

  private frameActors(): void {
    const visible = this.sampled.filter((actor) => actor.present);
    const actors = visible.length > 0 ? visible : this.sampled;
    if (actors.length === 0) return;
    const centerX = actors.reduce((sum, actor) => sum + actor.x, 0) / actors.length;
    const centerZ = actors.reduce((sum, actor) => sum + actor.z, 0) / actors.length;
    const ground = this.sampleHeight(centerX, centerZ) ?? 0;
    const radius = Math.max(
      8,
      ...actors.map((actor) => Math.hypot(actor.x - centerX, actor.z - centerZ)),
    );

    // Prefer the incident pair's sightline over an arbitrary map diagonal. A
    // high top-down camera repeatedly landed behind Yale's roofs: technically
    // three transforms existed, but the result was another map-only video. The
    // trace already declares the metric pair and subject, so use that semantic
    // geometry to place a low, trailing observer. This is the same composition
    // basis used by the accepted still exporter, now inside the real Studio.
    const pair: readonly string[] = this.bundle.trace.metrics.revealToConflict?.pair
      ?? this.bundle.trace.metrics.minTTC?.pair
      ?? [];
    const subjectId = pair.includes(this.bundle.trace.header.metricSubject ?? '')
      ? this.bundle.trace.header.metricSubject
      : pair[0];
    const otherId = pair.find((id) => id !== subjectId);
    const subject = actors.find((actor) => actor.id === subjectId) ?? actors[0]!;
    const other = actors.find((actor) => actor.id === otherId) ?? actors.at(-1)!;
    const sightline = Math.hypot(subject.x - other.x, subject.z - other.z);
    const away = sightline > 1e-6
      ? { x: (subject.x - other.x) / sightline, z: (subject.z - other.z) / sightline }
      : { x: -Math.cos(subject.headingRad), z: Math.sin(subject.headingRad) };
    const side = { x: -away.z, z: away.x };
    const revealT = this.bundle.trace.metrics.revealToConflict?.losOpenT ?? this.time;
    const conflictT = this.bundle.trace.metrics.revealToConflict?.conflictT
      ?? this.bundle.trace.metrics.minTTC?.t
      ?? this.time;
    const progress = conflictT > revealT
      ? Math.max(0, Math.min(1, (this.time - revealT) / (conflictT - revealT)))
      : 1;
    const baseDistance = Math.max(11, Math.min(15, radius * 0.45 + 8));
    const distance = baseDistance + 11 * progress;
    const sideOffset = 0.25 + 4.75 * progress;
    const eyeX = subject.x + away.x * distance + side.x * sideOffset;
    const eyeZ = subject.z + away.z * distance + side.z * sideOffset;
    const camera = this.viewer.camera;
    if (camera.isPerspectiveCamera) {
      camera.fov = Math.max(24, Math.min(52, 52 - (radius - 8) * 1.1));
      camera.updateProjectionMatrix();
    }
    this.viewer.controls.setView(
      new Vector3(eyeX, ground + 3.3 + 1.5 * progress, eyeZ),
      new Vector3(centerX, ground + 1.35, centerZ),
    );
  }

  private publish(): void {
    this.snapshot = this.buildState();
    for (const listener of [...this.listeners]) listener();
  }

  private buildState(): PlaybackState {
    return {
      time: this.time,
      startTime: this.bundle.startTime,
      endTime: this.bundle.endTime,
      playing: this.playing,
      actorCount: this.bundle.actors.length,
      visibleActorCount: this.sampled.filter((actor) => actor.present).length,
      instanceId: this.bundle.instance.manifest.instanceId,
      inputHash: this.bundle.instance.manifest.inputHash,
    };
  }
}
