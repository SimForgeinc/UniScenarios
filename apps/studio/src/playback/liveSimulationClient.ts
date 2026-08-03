import type { MapEntry } from '../maps';
import { parsePlaybackPair, type PlaybackBundle } from './model';
import type { LiveSimulationResponse, LiveSimulationStart } from './live-simulation-worker';

export interface LivePlaybackRun {
  readonly bundle: PlaybackBundle;
  readonly completion: Promise<PlaybackBundle>;
  recordedUntil(): number;
  setPlaying(playing: boolean): void;
}

/** A reusable worker; each start supersedes the prior run without recreating the worker. */
export class LiveSimulationClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private rejectPending: ((reason: Error) => void) | null = null;

  start(base: PlaybackBundle, map: MapEntry): Promise<LivePlaybackRun> {
    this.cancel();
    const worker = this.worker ?? new Worker(new URL('./live-simulation-worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const id = ++this.sequence;
    let liveBundle: PlaybackBundle | null = null;
    let available = 0;
    let resolveCompletion!: (bundle: PlaybackBundle) => void;
    let rejectCompletion!: (reason: Error) => void;
    const completion = new Promise<PlaybackBundle>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });

    return new Promise((resolve, reject) => {
      this.rejectPending = (reason) => {
        reject(reason);
      };
      worker.onmessage = (event: MessageEvent<LiveSimulationResponse>) => {
        if (event.data.id !== id || id !== this.sequence) return;
        if (!event.data.ok) {
          const error = new Error(event.data.error);
          this.rejectPending = null;
          reject(error);
          if (liveBundle) rejectCompletion(error);
          return;
        }
        const parsed = parsePlaybackPair(base.instance, event.data.trace, {
          instanceName: 'live authored scenario',
          traceName: 'live fixed-step simulation',
        });
        available = event.data.recordedUntil;
        if (!liveBundle) {
          liveBundle = {
            ...parsed,
            // The producer stays ahead of visible time. Sampling clamps to the
            // latest recorded tick if rendering briefly catches the buffer.
            endTime: base.instance.input.clipSeconds,
            ambientTraffic: base.ambientTraffic,
            mapCollisions: base.mapCollisions,
          };
          this.rejectPending = rejectCompletion;
          resolve({
            bundle: liveBundle,
            completion,
            recordedUntil: () => available,
            setPlaying: (playing) => worker.postMessage({ kind: 'transport', id, playing }),
          });
        } else {
          (liveBundle as { trace: PlaybackBundle['trace'] }).trace = parsed.trace;
        }
        if (event.data.kind === 'complete') {
          this.rejectPending = null;
          resolveCompletion(liveBundle);
        }
      };
      worker.onerror = (event) => {
        if (id !== this.sequence) return;
        const error = new Error(event.message || 'Live simulation worker failed');
        this.rejectPending = null;
        reject(error);
        if (liveBundle) rejectCompletion(error);
      };
      worker.postMessage({
        kind: 'start',
        id,
        input: base.instance.input,
        topologyUrl: map.topology,
      } satisfies LiveSimulationStart);
    });
  }

  cancel(): void {
    this.sequence += 1;
    this.worker?.postMessage({ kind: 'cancel' });
    const reject = this.rejectPending;
    this.rejectPending = null;
    reject?.(new DOMException('Live simulation was canceled', 'AbortError'));
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
