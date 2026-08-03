import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { contentHash, type AmbientTrafficProfile, type EvaluateFilters, type IntentRubricInput } from '@uniscenarios/sim-engine';
import type { MapEntry } from '../maps';
import type { AmbientPopulationSnapshot } from '../ambient/persistentPopulation';
import { parsePlaybackPair, type PlaybackBundle } from './model';
import type { AmbientRobustnessSummary, ScenarioWorkerRequest, ScenarioWorkerResponse } from './scenario-worker';
import type { ScenarioWorkerStartRequest } from './scenario-worker';
import { RevisionGate } from './mapRuntime';

export interface LivePlaybackRun {
  readonly bundle: PlaybackBundle;
  readonly completion: Promise<PlaybackBundle>;
  recordedUntil(): number;
  setPlaying(playing: boolean): void;
}

interface PendingRequest {
  readonly revision: string;
  readonly onMessage: (message: ScenarioWorkerResponse) => void;
  reject: (reason: Error) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
}

/** One long-lived worker owns map loading, document compilation and live play. */
export class ScenarioWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private compileGate = new RevisionGate();
  private activeCompile: number | null = null;
  private activeLive: number | null = null;
  private runtimeByInput = new Map<string, string>();

  prepare(
    template: ScenarioTemplateV2,
    map: MapEntry,
    ambientTraffic: AmbientTrafficProfile,
    baseInstance?: PlaybackBundle['instance'],
    options: {
      staticCollisionMode?: 'skip' | 'bounded';
      timeoutMs?: number;
      ambientPopulation?: AmbientPopulationSnapshot;
      /** Build only the warmed t=0 authoring world; Play streams the trace live. */
      materializeOnly?: boolean;
    } = {},
  ): Promise<PlaybackBundle> {
    this.cancelCompile();
    const id = ++this.sequence;
    const revision = contentHash({ template, ambientTraffic, baseInstance: baseInstance?.manifest.inputHash ?? null });
    this.compileGate.begin(revision);
    this.activeCompile = id;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (this.activeCompile === id) this.activeCompile = null;
        reject(new Error(`Scenario preparation exceeded ${options.timeoutMs ?? 45_000} ms while loading map collision data or simulating traffic.`));
      }, options.timeoutMs ?? 45_000);
      this.pending.set(id, { revision, reject, timeout, onMessage: (message) => {
        if (!this.compileGate.accepts(message.revision)) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        if (this.activeCompile === id) this.activeCompile = null;
        if (!message.ok) {
          reject(new Error(message.error));
          return;
        }
        if (message.kind !== 'prepare') {
          reject(new Error('Simulation worker returned a robustness report to a playback request'));
          return;
        }
        try {
          const bundle = parsePlaybackPair(message.instance, message.trace, {
            instanceName: 'authored scenario', traceName: 'simulation worker',
          });
          const result = {
            ...bundle,
            ambientTraffic: message.ambientTraffic,
            mapCollisions: deepFreeze(message.mapCollisions),
            openScenario: deepFreeze(message.openScenario),
          };
          this.runtimeByInput.set(contentHash(result.instance.input), message.runtimeKey);
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }});
      worker.postMessage({
        kind: options.materializeOnly ? 'compile' : 'export',
        id,
        revision,
        template,
        ambientTraffic,
        ...(baseInstance ? { baseInstance } : {}),
        ...(options.ambientPopulation ? { ambientPopulation: options.ambientPopulation } : {}),
        operation: options.materializeOnly ? 'materialize' : 'prepare',
        staticCollisionMode: options.staticCollisionMode ?? 'bounded',
        map: {
          id: map.id,
          manifest: map.manifest,
          topology: map.topology,
          derivedTopology: map.derivedTopology,
          locations: map.locations,
          xodr: map.xodr,
          signals: map.signals,
        },
      } satisfies ScenarioWorkerRequest);
    });
  }

  start(base: PlaybackBundle, _map: MapEntry): Promise<LivePlaybackRun> {
    this.cancelLive();
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    const revision = contentHash(base.instance.input);
    const runtimeKey = this.runtimeByInput.get(revision);
    if (!runtimeKey) return Promise.reject(new Error('This world was not compiled by the active map runtime.'));
    this.activeLive = id;
    let liveBundle: PlaybackBundle | null = null;
    let available = 0;
    let resolveCompletion!: (bundle: PlaybackBundle) => void;
    let rejectCompletion!: (reason: Error) => void;
    const completion = new Promise<PlaybackBundle>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { revision, reject, onMessage: (message) => {
        if (message.revision !== revision) return;
        if (!message.ok) {
          const error = new Error(message.error);
          this.pending.delete(id);
          reject(error);
          if (liveBundle) rejectCompletion(error);
          return;
        }
        if (message.kind !== 'ready' && message.kind !== 'progress' && message.kind !== 'complete') return;
        const parsed = parsePlaybackPair(base.instance, message.trace, {
          instanceName: 'live authored scenario', traceName: 'live fixed-step simulation',
        });
        available = message.recordedUntil;
        if (!liveBundle) {
          liveBundle = {
            ...parsed,
            endTime: base.instance.input.clipSeconds,
            ambientTraffic: base.ambientTraffic,
            mapCollisions: base.mapCollisions,
          };
          resolve({
            bundle: liveBundle,
            completion,
            recordedUntil: () => available,
            setPlaying: (playing) => worker.postMessage({ kind: 'transport', id, playing }),
          });
          const pending = this.pending.get(id);
          if (pending) pending.reject = rejectCompletion;
        } else {
          (liveBundle as { trace: PlaybackBundle['trace'] }).trace = parsed.trace;
        }
        if (message.kind === 'complete') {
          this.pending.delete(id);
          if (this.activeLive === id) this.activeLive = null;
          resolveCompletion(liveBundle);
        }
      }});
      worker.postMessage({ kind: 'start', id, revision, runtimeKey, input: base.instance.input } satisfies ScenarioWorkerStartRequest);
    });
  }

  cancel(): void {
    this.cancelCompile();
    this.cancelLive();
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.runtimeByInput.clear();
  }

  private cancelCompile(): void {
    this.compileGate.invalidate();
    if (this.activeCompile === null) return;
    this.rejectRequest(this.activeCompile, new DOMException('Scenario preparation was canceled', 'AbortError'));
    this.activeCompile = null;
  }

  private cancelLive(): void {
    if (this.activeLive === null) return;
    const id = this.activeLive;
    this.worker?.postMessage({ kind: 'cancel', id });
    this.rejectRequest(id, new DOMException('Live simulation was canceled', 'AbortError'));
    this.activeLive = null;
  }

  private rejectRequest(id: number, reason: Error): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.timeout) clearTimeout(pending.timeout);
    this.pending.delete(id);
    pending.reject(reason);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./scenario-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<ScenarioWorkerResponse>) => {
      this.pending.get(event.data.id)?.onMessage(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'Simulation worker failed');
      for (const id of [...this.pending.keys()]) this.rejectRequest(id, error);
      this.worker?.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** Run the deterministic Off/Light/Moderate robustness matrix in an isolated browser worker. */
export function evaluateAuthoredAmbientRobustness(
  template: ScenarioTemplateV2,
  map: MapEntry,
  filters: EvaluateFilters,
  intentRubric?: IntentRubricInput,
): Promise<AmbientRobustnessSummary> {
  const worker = new Worker(new URL('./scenario-worker.ts', import.meta.url), { type: 'module' });
  const id = Date.now() + Math.floor(Math.random() * 10_000);
  const revision = contentHash({ template, filters, intentRubric: intentRubric ?? null });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ScenarioWorkerResponse>) => {
      if (event.data.id !== id || event.data.revision !== revision) return;
      worker.terminate();
      if (!event.data.ok) { reject(new Error(event.data.error)); return; }
      if (event.data.kind !== 'robustness') { reject(new Error('Worker returned playback instead of a robustness report')); return; }
      resolve(event.data.report);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Ambient robustness worker failed'));
    };
    worker.postMessage({
      id,
      revision,
      kind: 'robustness',
      operation: 'robustness',
      template,
      evaluationFilters: filters,
      ...(intentRubric ? { intentRubric } : {}),
      ambientTraffic: { version: 1, preset: 'off', seed: 'robustness' },
      map: workerMap(map),
    } satisfies ScenarioWorkerRequest);
  });
}

function workerMap(map: MapEntry): ScenarioWorkerRequest['map'] {
  return {
    id: map.id,
    manifest: map.manifest,
    topology: map.topology,
    derivedTopology: map.derivedTopology,
    locations: map.locations,
    xodr: map.xodr,
    signals: map.signals,
  };
}
