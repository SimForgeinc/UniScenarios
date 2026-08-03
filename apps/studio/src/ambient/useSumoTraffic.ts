import { useEffect, useRef, useState } from 'react';
import type { ResolvedAmbientTrafficProfile } from '@uniscenarios/sim-engine';
import type { ActorView } from '../editor/actorRenderer';
import type { ActorRenderer } from '../editor/actorRenderer';
import type { MapEntry } from '../maps';
import { evaluateSumoPerformance } from '../playback/traffic-provider/adaptiveFallback';
import type { ExternalTrafficActor } from '../playback/traffic-provider/protocol';
import { SumoWasmTrafficProvider } from '../playback/traffic-provider/sumoWasmProvider';
import { decodeSumoSignalSnapshot, type SumoSignalTopology } from '../playback/traffic-provider/signalState';
import type { StudioSessionMode } from '../session/model';
import { DISABLED_SUMO_STATUS, type SumoTrafficStatus } from './provider';
import { decodeSumoActorViews, loadSumoAssets, SUMO_RUNTIME_MODULE_URL } from './sumoAssets';
import type { SumoDemandFocus } from './sumoAssets';

export interface SumoExternalActorView {
  readonly id: string;
  readonly kind: ExternalTrafficActor['kind'];
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
  readonly speedMetersPerSecond: number;
  readonly lengthMeters: number;
  readonly widthMeters: number;
}

export interface UseSumoTrafficOptions {
  readonly enabled: boolean;
  readonly map: MapEntry;
  readonly profile: ResolvedAmbientTrafficProfile;
  readonly renderer: ActorRenderer | null | undefined;
  readonly sampleHeight: ((x: number, z: number) => number | null) | null;
  readonly mode: StudioSessionMode;
  readonly time: number;
  readonly externalActors: readonly SumoExternalActorView[];
  readonly focus: SumoDemandFocus | null;
  readonly onFallback: (reason: string) => void;
}

/**
 * Owns browser SUMO independently of the authored timeline. The renderer layer
 * survives playback layer swaps, while every authored road user is mirrored as
 * an external proxy and is therefore never driven by SUMO state.
 */
export function useSumoTraffic(options: UseSumoTrafficOptions): SumoTrafficStatus {
  const [status, setStatus] = useState<SumoTrafficStatus>(DISABLED_SUMO_STATUS);
  const [resetOrdinal, setResetOrdinal] = useState(0);
  const run = useRef<SumoTrafficRun | null>(null);
  const externals = useRef(options.externalActors);
  const previousMode = useRef(options.mode);
  externals.current = options.externalActors;

  useEffect(() => {
    if (options.mode === 'authoring' && previousMode.current !== 'authoring') {
      setResetOrdinal((value) => value + 1);
    }
    previousMode.current = options.mode;
  }, [options.mode]);

  useEffect(() => {
    if (!options.enabled || !options.renderer || !options.sampleHeight || options.profile.preset === 'off') {
      options.renderer?.clearLayer('sumo-traffic');
      setStatus(DISABLED_SUMO_STATUS);
      return;
    }
    let cancelled = false;
    const provider = new SumoWasmTrafficProvider(SUMO_RUNTIME_MODULE_URL);
    const active: SumoTrafficRun = {
      provider,
      sequence: 0,
      simulationTime: 0,
      lastRequestedTime: 0,
      stepping: Promise.resolve(),
      stepSamples: [],
      missedDeadlines: 0,
      seenActorIds: new Set(),
      completedActorIds: new Set(),
    };
    run.current = active;
    setStatus({ phase: 'loading', actorCount: 0 });
    void loadSumoAssets(options.map, options.profile, fetch, options.focus).then(async ({
      payload,
      runtime,
      demand,
      signalTopology,
      adjustedSignalControllers,
    }) => {
      if (cancelled) return;
      const initialized = await provider.initialize(payload);
      if (cancelled) return;
      const initialGate = evaluateSumoPerformance({
        initMilliseconds: initialized.initMilliseconds,
        wasmBytes: runtime.wasmBytes,
        heapBytes: initialized.heapBytes,
        stepP95Milliseconds: 0,
        requestedStepMilliseconds: payload.stepSeconds * 1_000,
      });
      if (!initialGate.useSumo) throw new Error(`capability gate: ${initialGate.reason}`);
      // Warm the staggered departures before publishing the authoring preview.
      // This keeps the city populated before Play without a visible spawn burst.
      const first = await provider.step({ sequence: active.sequence++, deltaSeconds: demand.warmupSeconds, externalActors: externalTrafficActors(externals.current) });
      if (cancelled) return;
      active.simulationTime = first.simulationSeconds;
      active.signalTopology = signalTopology;
      active.adjustedSignalControllers = adjustedSignalControllers;
      active.stepSamples.push(first.stepMilliseconds);
      const firstMetrics = trafficMetrics(first, options.focus, active);
      options.renderer!.syncLayer('sumo-traffic', decodeSumoActorViews(first, options.sampleHeight!));
      const signals = decodeSumoSignalSnapshot(first.signalStates, first.signalLinkCount, signalTopology);
      setStatus({
        phase: 'ready',
        actorCount: first.actorCount,
        initMilliseconds: initialized.initMilliseconds,
        heapBytes: initialized.heapBytes,
        wasmBytes: runtime.wasmBytes,
        stepP95Milliseconds: first.stepMilliseconds,
        ...firstMetrics,
        requestedActorCount: demand.requestedActors,
        simulatedActorCount: first.simulatedActorCount,
        nearbyRouteStarts: demand.nearbyRouteStarts,
        detailedSafetyMetricsAvailable: false,
        signalStates: signals.heads,
        mappedSignalHeads: signals.mappedHeadCount,
        unmappedSignalLinks: signals.unmappedLinkCount,
        adjustedSignalControllers,
      });
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      options.renderer?.clearLayer('sumo-traffic');
      setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      options.onFallback(message);
    });
    return () => {
      cancelled = true;
      if (run.current === active) run.current = null;
      options.renderer?.clearLayer('sumo-traffic');
      void provider.close();
    };
  }, [options.enabled, options.map, options.profile, options.renderer, options.sampleHeight, options.onFallback, options.focus?.x, options.focus?.z, resetOrdinal]);

  useEffect(() => {
    const active = run.current;
    if (!active || options.mode !== 'playing') return;
    const delta = options.time - active.lastRequestedTime;
    if (!(delta >= .04)) return;
    active.lastRequestedTime = options.time;
    if (delta > 5 || options.time + .001 < active.simulationTime) {
      setResetOrdinal((value) => value + 1);
      return;
    }
    active.stepping = active.stepping.then(async () => {
      const result = await active.provider.step({
        sequence: active.sequence++,
        deltaSeconds: Math.max(.001, delta),
        externalActors: externalTrafficActors(externals.current),
      });
      active.simulationTime = result.simulationSeconds;
      active.stepSamples.push(result.stepMilliseconds);
      if (active.stepSamples.length > 120) active.stepSamples.shift();
      const p95 = percentile(active.stepSamples, .95);
      if (active.stepSamples.length >= 20 && p95 > delta * 500) active.missedDeadlines += 1;
      else active.missedDeadlines = 0;
      if (active.missedDeadlines >= 3) throw new Error(`performance gate: ${p95.toFixed(1)} ms p95 exceeds realtime headroom`);
      options.renderer?.syncLayer('sumo-traffic', decodeSumoActorViews(result, options.sampleHeight!));
      const signals = active.signalTopology
        ? decodeSumoSignalSnapshot(result.signalStates, result.signalLinkCount, active.signalTopology)
        : { heads: {}, mappedHeadCount: 0, unmappedLinkCount: result.signalLinkCount };
      setStatus((current) => ({
        ...current,
        phase: 'running',
        actorCount: result.actorCount,
        simulatedActorCount: result.simulatedActorCount,
        stepP95Milliseconds: p95,
        ...trafficMetrics(result, options.focus, active),
        signalStates: signals.heads,
        mappedSignalHeads: signals.mappedHeadCount,
        unmappedSignalLinks: signals.unmappedLinkCount,
        adjustedSignalControllers: active.adjustedSignalControllers,
      }));
    }).catch((reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      options.renderer?.clearLayer('sumo-traffic');
      setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      options.onFallback(message);
    });
  }, [options.mode, options.onFallback, options.renderer, options.sampleHeight, options.time]);

  return status;
}

interface SumoTrafficRun {
  readonly provider: SumoWasmTrafficProvider;
  sequence: number;
  simulationTime: number;
  lastRequestedTime: number;
  stepping: Promise<void>;
  readonly stepSamples: number[];
  missedDeadlines: number;
  readonly seenActorIds: Set<number>;
  readonly completedActorIds: Set<number>;
  signalTopology?: SumoSignalTopology;
  adjustedSignalControllers?: number;
}

export function trafficMetrics(result: { readonly states: ArrayBuffer; readonly actorCount: number }, focus: SumoDemandFocus | null, run: Pick<SumoTrafficRun, 'seenActorIds' | 'completedActorIds'>): Pick<SumoTrafficStatus, 'nearbyActorCount' | 'queuedActorCount' | 'completedActorCount' | 'emergencyStoppingActorCount'> {
  const view = new DataView(result.states);
  const current = new Set<number>();
  let nearbyActorCount = 0;
  let queuedActorCount = 0;
  let emergencyStoppingActorCount = 0;
  for (let index = 0; index < result.actorCount; index += 1) {
    const offset = index * 32;
    const id = view.getUint32(offset, true);
    const x = view.getFloat32(offset + 4, true);
    const z = view.getFloat32(offset + 8, true);
    const speed = view.getFloat32(offset + 16, true);
    const acceleration = view.getFloat32(offset + 20, true);
    current.add(id);
    run.seenActorIds.add(id);
    if (focus && Math.hypot(x - focus.x, z - focus.z) <= 300) nearbyActorCount += 1;
    if (speed < .5) queuedActorCount += 1;
    if (acceleration <= -7) emergencyStoppingActorCount += 1;
  }
  for (const id of run.seenActorIds) if (!current.has(id)) run.completedActorIds.add(id);
  return { nearbyActorCount, queuedActorCount, completedActorCount: run.completedActorIds.size, emergencyStoppingActorCount };
}

export function externalTrafficActors(actors: readonly SumoExternalActorView[]): readonly ExternalTrafficActor[] {
  return actors.map((actor) => ({
    id: `external:${actor.id}`,
    kind: actor.kind,
    routeId: 'proxy-route',
    x: actor.x,
    z: actor.z,
    headingDegrees: 90 + actor.headingRad * 180 / Math.PI,
    speedMetersPerSecond: actor.speedMetersPerSecond,
    lengthMeters: actor.lengthMeters,
    widthMeters: actor.widthMeters,
  }));
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]!;
}
