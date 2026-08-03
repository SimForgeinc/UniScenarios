import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { AmbientTrafficProfile, EvaluateFilters, IntentRubricInput } from '@uniscenarios/sim-engine';
import type { MapEntry } from '../maps';
import { parsePlaybackPair, type PlaybackBundle } from './model';
import type { AmbientRobustnessSummary, ScenarioWorkerRequest, ScenarioWorkerResponse } from './scenario-worker';


/** One-shot workers make cancellation immediate even while simulation is synchronously running. */
export class ScenarioWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private rejectPending: ((reason: Error) => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;


  prepare(
    template: ScenarioTemplateV2,
    map: MapEntry,
    ambientTraffic: AmbientTrafficProfile,
    baseInstance?: PlaybackBundle['instance'],
    options: { staticCollisionMode?: 'skip' | 'bounded'; timeoutMs?: number; operation?: 'prepare' | 'ambient-preview' } = {},
  ): Promise<PlaybackBundle> {
    this.cancel();
    const id = ++this.sequence;
    const worker = new Worker(new URL('./scenario-worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      this.timeout = setTimeout(() => {
        if (worker !== this.worker) return;
        this.worker = null;
        this.rejectPending = null;
        this.timeout = null;
        worker.terminate();
        reject(new Error(`Scenario preparation exceeded ${options.timeoutMs ?? 45_000} ms while loading map collision data or simulating traffic.`));
      }, options.timeoutMs ?? 45_000);
      worker.onmessage = (event: MessageEvent<ScenarioWorkerResponse>) => {
        if (event.data.id !== id || worker !== this.worker) return;
        this.worker = null;
        this.rejectPending = null;
        if (this.timeout !== null) clearTimeout(this.timeout);
        this.timeout = null;
        worker.terminate();
        if (!event.data.ok) {
          reject(new Error(event.data.error));
          return;
        }
        if (event.data.kind !== 'prepare') {
          reject(new Error('Simulation worker returned a robustness report to a playback request'));
          return;
        }
        try {
          const bundle = parsePlaybackPair(event.data.instance, event.data.trace, {
            instanceName: 'authored scenario', traceName: 'simulation worker',
          });
          resolve({
            ...bundle,
            ambientTraffic: event.data.ambientTraffic,
            mapCollisions: deepFreeze(event.data.mapCollisions),
            openScenario: deepFreeze(event.data.openScenario),
          });
        } catch (error) {
          reject(error);
        }
      };
      worker.onerror = (event) => {
        if (worker !== this.worker) return;
        this.worker = null;
        this.rejectPending = null;
        if (this.timeout !== null) clearTimeout(this.timeout);
        this.timeout = null;
        worker.terminate();
        reject(new Error(event.message || 'Simulation worker failed'));
      };
      worker.postMessage({
        id,
        template,
        ambientTraffic,
        ...(baseInstance ? { baseInstance } : {}),
        operation: options.operation ?? 'prepare',
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

  /** Map-only City population; independent of authored scenario validity. */
  prepareAmbientPreview(
    template: ScenarioTemplateV2,
    map: MapEntry,
    ambientTraffic: AmbientTrafficProfile,
  ): Promise<PlaybackBundle> {
    return this.prepare(template, map, ambientTraffic, undefined, {
      operation: 'ambient-preview',
      staticCollisionMode: 'skip',
      timeoutMs: 30_000,
    });
  }

  cancel(): void {
    this.sequence += 1;
    this.worker?.terminate();
    this.worker = null;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    const reject = this.rejectPending;
    this.rejectPending = null;
    reject?.(new DOMException('Scenario preparation was canceled', 'AbortError'));
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
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ScenarioWorkerResponse>) => {
      if (event.data.id !== id) return;
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
