/// <reference lib="webworker" />

import {
  buildLaneGraph,
  createFixedStepSimulation,
  type SimScenarioInput,
  type SimTrace,
  type TopologyIndex,
} from '@uniscenarios/sim-engine';
import { initialLiveTickBudget, liveBatchTickBudget } from './liveSimulationPlan';

export interface LiveSimulationStart {
  readonly kind: 'start';
  readonly id: number;
  readonly input: SimScenarioInput;
  readonly topologyUrl: string;
}
export interface LiveSimulationCancel { readonly kind: 'cancel' }
export interface LiveSimulationTransport { readonly kind: 'transport'; readonly id: number; readonly playing: boolean }

export type LiveSimulationResponse =
  | { readonly id: number; readonly ok: true; readonly kind: 'ready' | 'progress' | 'complete'; readonly trace: SimTrace; readonly recordedUntil: number }
  | { readonly id: number; readonly ok: false; readonly error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let generation = 0;
const graphCache = new Map<string, ReturnType<typeof buildLaneGraph>>();
let transport: { id: number; playing: boolean; wake: (() => void) | null } | null = null;

scope.onmessage = (event: MessageEvent<LiveSimulationStart | LiveSimulationCancel | LiveSimulationTransport>): void => {
  if (event.data.kind === 'cancel') {
    generation += 1;
    transport?.wake?.();
    transport = null;
    return;
  }
  if (event.data.kind === 'transport') {
    if (transport?.id !== event.data.id) return;
    transport.playing = event.data.playing;
    transport.wake?.();
    transport.wake = null;
    return;
  }
  const request = event.data;
  const token = ++generation;
  transport = { id: request.id, playing: false, wake: null };
  void run(request, token).catch((reason: unknown) => {
    if (token !== generation) return;
    scope.postMessage({
      id: request.id,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    } satisfies LiveSimulationResponse);
  });
};

async function run(request: LiveSimulationStart, token: number): Promise<void> {
  let graph = graphCache.get(request.topologyUrl);
  if (!graph) {
    const response = await fetch(request.topologyUrl);
    if (!response.ok) throw new Error(`Could not load lane topology (${response.status})`);
    graph = buildLaneGraph(await response.json() as TopologyIndex);
    graphCache.set(request.topologyUrl, graph);
  }
  if (token !== generation) return;
  const simulation = createFixedStepSimulation(request.input, { graph, guards: 'throw' });

  // Produce t=0 plus a small lead before handing control back. On a cached map
  // this is deliberately bounded to a few fixed ticks, rather than 20 seconds.
  const initialTicks = initialLiveTickBudget(request.input.warmupSeconds, request.input.dt);
  let progress = simulation.advance(initialTicks);
  post(request.id, progress.done ? 'complete' : 'ready', progress.trace, progress.recordedUntil ?? 0);

  const batchTicks = liveBatchTickBudget(request.input.dt);
  while (!progress.done && token === generation) {
    await waitUntilPlaying(request.id, token);
    // Pace the producer close to wall time. A slight lead absorbs render jitter
    // without silently turning normal Play into another full fast-forward.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    if (transport?.id === request.id && !transport.playing) continue;
    if (token !== generation) return;
    progress = simulation.advance(batchTicks);
    post(request.id, progress.done ? 'complete' : 'progress', progress.trace, progress.recordedUntil ?? 0);
  }
}

async function waitUntilPlaying(id: number, token: number): Promise<void> {
  while (token === generation && transport?.id === id && !transport.playing) {
    await new Promise<void>((resolve) => {
      if (!transport || transport.id !== id || transport.playing) resolve();
      else transport.wake = resolve;
    });
  }
}

function post(id: number, kind: 'ready' | 'progress' | 'complete', trace: SimTrace, recordedUntil: number): void {
  scope.postMessage({ id, ok: true, kind, trace, recordedUntil } satisfies LiveSimulationResponse);
}
