import { useEffect, useRef, useState } from 'react';
import {
  buildSumoAuthoredOccupancies,
  type ResolvedAmbientTrafficProfile,
  type SumoAuthoredOccupancySource,
  type SumoRoadOccupancyIndex,
} from '@uniscenarios/sim-engine';
import type { ActorView } from '../editor/actorRenderer';
import type { ActorRenderer } from '../editor/actorRenderer';
import type { MapEntry } from '../maps';
import { evaluateSumoPerformance } from '../playback/traffic-provider/adaptiveFallback';
import type { ExternalTrafficActor, TrafficNetworkPayload, TrafficStepRequest, TrafficStepResult } from '../playback/traffic-provider/protocol';
import { SumoWasmTrafficProvider } from '../playback/traffic-provider/sumoWasmProvider';
import { decodeSumoSignalSnapshot, type SumoSignalTopology } from '../playback/traffic-provider/signalState';
import type { StudioSessionMode } from '../session/model';
import { DISABLED_SUMO_STATUS, type SumoTrafficStatus } from './provider';
import { decodeSumoActorViews, loadSumoAssets, signalNetworkForScenario, SUMO_RUNTIME_MODULE_URL } from './sumoAssets';
import type { SumoDemandFocus } from './sumoAssets';

export type SumoExternalActorView = SumoAuthoredOccupancySource;

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
  readonly acceleratedSignalCycles: boolean;
}

/**
 * Owns browser SUMO independently of the authored timeline. The renderer layer
 * survives playback layer swaps, while every authored road user is mirrored as
 * an external proxy and is therefore never driven by SUMO state.
 */
export function useSumoTraffic(options: UseSumoTrafficOptions): SumoTrafficStatus {
  const [status, setStatus] = useState<SumoTrafficStatus>(DISABLED_SUMO_STATUS);
  const run = useRef<SumoTrafficRun | null>(null);
  const externals = useRef(options.externalActors);
  const previousMode = useRef(options.mode);
  externals.current = options.externalActors;

  useEffect(() => {
    const active = run.current;
    if (!active) return;
    active.requestedAcceleratedSignalCycles = options.acceleratedSignalCycles;
    if (active.payload && active.appliedAcceleratedSignalCycles !== options.acceleratedSignalCycles) {
      reconfigureSignalCycles(active, options.acceleratedSignalCycles);
    }
  }, [options.acceleratedSignalCycles]);

  useEffect(() => {
    const active = run.current;
    if (shouldResetSumoForModeTransition(previousMode.current, options.mode, active?.timelineAdvanced ?? false)
      && active?.occupancyRoads) {
      resetSumoRun(active, {
        targetTime: options.time,
        externalActors: externalTrafficActors(externals.current, active.occupancyRoads),
        focus: options.focus,
        renderer: options.renderer,
        sampleHeight: options.sampleHeight,
        phaseAfterReset: 'ready',
        setStatus,
        onFallback: options.onFallback,
      });
    }
    previousMode.current = options.mode;
  }, [options.focus, options.mode, options.onFallback, options.renderer, options.sampleHeight, options.time]);

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
      generation: 0,
      sequence: 0,
      // The provider may be created while the author is scrubbed away from t=0.
      // Establish the proxy baseline at that same editor instant; a later
      // rewind is classified explicitly and rebuilds from the new instant.
      lastRequestedTime: options.time,
      stepping: Promise.resolve(),
      stepSamples: [],
      missedDeadlines: 0,
      seenActorIds: new Set(),
      completedActorIds: new Set(),
      occupancyRoads: null,
      lastExternalActors: [],
      timelineAdvanced: false,
      resetting: false,
      disposed: false,
      requestedAcceleratedSignalCycles: options.acceleratedSignalCycles,
      appliedAcceleratedSignalCycles: options.acceleratedSignalCycles,
      reconfiguring: false,
    };
    run.current = active;
    setStatus({ phase: 'loading', actorCount: 0, reason: 'loading runtime and map assets' });
    void loadSumoAssets(options.map, options.profile, fetch, options.focus, active.appliedAcceleratedSignalCycles).then(async ({
      payload,
      runtime,
      demand,
      signalTopology,
      adjustedSignalControllers,
      occupancyRoads,
      rawNetworkXml,
    }) => {
      if (cancelled) return;
      setStatus({ phase: 'loading', actorCount: 0, reason: 'starting browser traffic engine' });
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
      setStatus({
        phase: 'loading',
        actorCount: 0,
        reason: 'warming initial traffic',
        initMilliseconds: initialized.initMilliseconds,
        heapBytes: initialized.heapBytes,
        wasmBytes: runtime.wasmBytes,
      });
      const initialExternalActors = externalTrafficActors(externals.current, occupancyRoads);
      const first = await provider.step({ generation: active.generation, sequence: active.sequence++, deltaSeconds: demand.warmupSeconds, externalActors: initialExternalActors });
      if (cancelled) return;
      active.signalTopology = signalTopology;
      active.payload = payload;
      active.rawNetworkXml = rawNetworkXml;
      active.adjustedSignalControllers = adjustedSignalControllers;
      active.occupancyRoads = occupancyRoads;
      active.lastExternalActors = initialExternalActors;
      active.warmupSeconds = demand.warmupSeconds;
      active.statusBase = {
        initMilliseconds: initialized.initMilliseconds,
        heapBytes: initialized.heapBytes,
        wasmBytes: runtime.wasmBytes,
        requestedActorCount: demand.requestedActors,
        nearbyRouteStarts: demand.nearbyRouteStarts,
        detailedSafetyMetricsAvailable: false,
        adjustedSignalControllers,
      };
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
      if (active.requestedAcceleratedSignalCycles !== active.appliedAcceleratedSignalCycles) {
        reconfigureSignalCycles(active, active.requestedAcceleratedSignalCycles);
      }
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      options.renderer?.clearLayer('sumo-traffic');
      setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      options.onFallback(message);
    });
    return () => {
      cancelled = true;
      active.disposed = true;
      active.generation += 1;
      if (run.current === active) run.current = null;
      options.renderer?.clearLayer('sumo-traffic');
      void provider.close();
    };
  }, [options.enabled, options.map, options.profile, options.renderer, options.sampleHeight, options.onFallback, options.focus?.x, options.focus?.z]);

  useEffect(() => {
    const active = run.current;
    if (!active || !active.occupancyRoads || active.resetting || options.mode !== 'playing') return;
    const occupancyRoads = active.occupancyRoads;
    const delta = options.time - active.lastRequestedTime;
    const timing = classifySumoTimelineStep(delta);
    if (timing === 'wait') return;
    active.lastRequestedTime = options.time;
    if (timing === 'reset') {
      resetSumoRun(active, {
        targetTime: options.time,
        externalActors: externalTrafficActors(externals.current, occupancyRoads),
        focus: options.focus,
        renderer: options.renderer,
        sampleHeight: options.sampleHeight,
        phaseAfterReset: 'running',
        setStatus,
        onFallback: options.onFallback,
      });
      return;
    }
    // Capture the pose at the same editor instant as `delta`. Reading the
    // mutable ref inside the queued promise pairs a future pose with an older
    // step interval whenever the worker is briefly backlogged, which makes
    // TraCI report physically impossible implied speeds.
    const targetExternalActors = externalTrafficActors(externals.current, occupancyRoads);
    const requests = buildSumoCatchUpRequests(
      active.generation,
      active.sequence,
      Math.max(.001, delta),
      active.lastExternalActors,
      targetExternalActors,
    );
    active.sequence += requests.length;
    active.lastExternalActors = targetExternalActors;
    active.timelineAdvanced = true;
    const generation = active.generation;
    active.stepping = active.stepping.then(async () => {
      let result: TrafficStepResult | null = null;
      const stepSamples: number[] = [];
      for (const request of requests) {
        result = await active.provider.step(request);
        stepSamples.push(result.stepMilliseconds);
      }
      if (!result) return;
      if (active.disposed || run.current !== active || !isCurrentSumoGeneration(generation, active.generation, result.generation)) return;
      active.stepSamples.push(...stepSamples);
      while (active.stepSamples.length > 120) active.stepSamples.shift();
      const p95 = percentile(active.stepSamples, .95);
      const requestedStepSeconds = Math.max(...requests.map((request) => request.deltaSeconds));
      if (active.stepSamples.length >= 20 && p95 > requestedStepSeconds * 500) active.missedDeadlines += 1;
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
      if (active.disposed || run.current !== active || active.generation !== generation) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      options.renderer?.clearLayer('sumo-traffic');
      setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      options.onFallback(message);
    });
  }, [options.focus, options.mode, options.onFallback, options.renderer, options.sampleHeight, options.time]);

  function resetSumoRun(active: SumoTrafficRun, reset: SumoResetRequest): void {
    if (active.disposed || !active.signalTopology || !active.warmupSeconds) return;
    if (active.resetting || active.reconfiguring) {
      // A Stop can arrive while a rewind reset is already in flight. Retain the
      // latest authoring baseline and run it next without ever publishing the
      // superseded reset result.
      active.pendingReset = reset;
      return;
    }
    const generation = active.generation + 1;
    active.generation = generation;
    active.sequence = 1;
    active.lastRequestedTime = reset.targetTime;
    active.lastExternalActors = reset.externalActors;
    active.stepSamples.length = 0;
    active.missedDeadlines = 0;
    active.seenActorIds.clear();
    active.completedActorIds.clear();
    active.timelineAdvanced = false;
    active.resetting = true;
    reset.setStatus({
      phase: 'loading',
      actorCount: 0,
      reason: 'resetting traffic',
      ...active.statusBase,
    });
    active.stepping = active.stepping.then(async () => {
      const result = await active.provider.reset({
        generation,
        sequence: 0,
        deltaSeconds: active.warmupSeconds!,
        externalActors: reset.externalActors,
      });
      if (active.disposed || run.current !== active || !isCurrentSumoGeneration(generation, active.generation, result.generation)) return;
      const pendingReset = active.pendingReset;
      if (pendingReset) {
        active.pendingReset = undefined;
        active.resetting = false;
        resetSumoRun(active, pendingReset);
        return;
      }
      active.resetting = false;
      active.stepSamples.push(result.stepMilliseconds);
      reset.renderer?.syncLayer('sumo-traffic', decodeSumoActorViews(result, reset.sampleHeight!));
      const signals = decodeSumoSignalSnapshot(result.signalStates, result.signalLinkCount, active.signalTopology!);
      reset.setStatus({
        phase: reset.phaseAfterReset,
        actorCount: result.actorCount,
        stepP95Milliseconds: result.stepMilliseconds,
        ...active.statusBase,
        ...trafficMetrics(result, reset.focus, active),
        simulatedActorCount: result.simulatedActorCount,
        signalStates: signals.heads,
        mappedSignalHeads: signals.mappedHeadCount,
        unmappedSignalLinks: signals.unmappedLinkCount,
      });
      if (active.requestedAcceleratedSignalCycles !== active.appliedAcceleratedSignalCycles) {
        reconfigureSignalCycles(active, active.requestedAcceleratedSignalCycles);
      }
    }).catch((reason: unknown) => {
      if (active.disposed || run.current !== active || active.generation !== generation) return;
      active.resetting = false;
      const message = reason instanceof Error ? reason.message : String(reason);
      reset.renderer?.clearLayer('sumo-traffic');
      reset.setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      reset.onFallback(message);
    });
  }

  function reconfigureSignalCycles(active: SumoTrafficRun, accelerated: boolean): void {
    if (active.disposed || active.reconfiguring || active.resetting || !active.payload || !active.rawNetworkXml
      || !active.signalTopology || !active.occupancyRoads || !active.warmupSeconds) return;
    active.reconfiguring = true;
    const generation = active.generation + 1;
    active.generation = generation;
    active.sequence = 1;
    active.lastRequestedTime = options.time;
    active.lastExternalActors = externalTrafficActors(externals.current, active.occupancyRoads);
    active.stepSamples.length = 0;
    active.missedDeadlines = 0;
    active.seenActorIds.clear();
    active.completedActorIds.clear();
    active.timelineAdvanced = false;
    const synchronized = signalNetworkForScenario(active.rawNetworkXml, accelerated, 20);
    const payload = {
      ...active.payload,
      network: new TextEncoder().encode(synchronized.xml).buffer,
      wasmBinary: undefined,
    };
    setStatus({
      phase: 'loading',
      actorCount: 0,
      reason: 'resetting signal cycles',
      ...active.statusBase,
      signalStates: {},
      adjustedSignalControllers: synchronized.adjustedControllers,
    });
    active.stepping = active.stepping.then(async () => {
      const result = await active.provider.reconfigure(payload, {
        generation,
        sequence: 0,
        deltaSeconds: active.warmupSeconds!,
        externalActors: active.lastExternalActors,
      });
      if (active.disposed || run.current !== active || !isCurrentSumoGeneration(generation, active.generation, result.generation)) return;
      active.payload = payload;
      active.appliedAcceleratedSignalCycles = accelerated;
      active.adjustedSignalControllers = synchronized.adjustedControllers;
      active.statusBase = { ...active.statusBase!, adjustedSignalControllers: synchronized.adjustedControllers };
      active.reconfiguring = false;
      active.stepSamples.push(result.stepMilliseconds);
      options.renderer?.syncLayer('sumo-traffic', decodeSumoActorViews(result, options.sampleHeight!));
      const signals = decodeSumoSignalSnapshot(result.signalStates, result.signalLinkCount, active.signalTopology!);
      setStatus({
        phase: options.mode === 'playing' ? 'running' : 'ready',
        actorCount: result.actorCount,
        stepP95Milliseconds: result.stepMilliseconds,
        ...active.statusBase,
        ...trafficMetrics(result, options.focus, active),
        simulatedActorCount: result.simulatedActorCount,
        signalStates: signals.heads,
        mappedSignalHeads: signals.mappedHeadCount,
        unmappedSignalLinks: signals.unmappedLinkCount,
      });
      const pendingReset = active.pendingReset;
      if (pendingReset) {
        active.pendingReset = undefined;
        resetSumoRun(active, pendingReset);
        return;
      }
      if (active.requestedAcceleratedSignalCycles !== active.appliedAcceleratedSignalCycles) {
        reconfigureSignalCycles(active, active.requestedAcceleratedSignalCycles);
      }
    }).catch((reason: unknown) => {
      if (active.disposed || run.current !== active || active.generation !== generation) return;
      active.reconfiguring = false;
      const message = reason instanceof Error ? reason.message : String(reason);
      options.renderer?.clearLayer('sumo-traffic');
      setStatus({ phase: 'fallback', actorCount: 0, reason: message });
      options.onFallback(message);
    });
  }

  return status;
}

export function classifySumoTimelineStep(deltaSeconds: number): 'wait' | 'step' | 'reset' {
  if (deltaSeconds < -.001 || deltaSeconds > 5) return 'reset';
  return deltaSeconds >= .04 ? 'step' : 'wait';
}

export function shouldResetSumoForModeTransition(previousMode: StudioSessionMode, mode: StudioSessionMode, timelineAdvanced: boolean): boolean {
  return mode === 'authoring' && previousMode !== 'authoring' && timelineAdvanced;
}

export function isCurrentSumoGeneration(expected: number, active: number, result: number): boolean {
  return expected === active && result === active;
}

interface SumoTrafficRun {
  readonly provider: SumoWasmTrafficProvider;
  generation: number;
  sequence: number;
  lastRequestedTime: number;
  stepping: Promise<void>;
  readonly stepSamples: number[];
  missedDeadlines: number;
  readonly seenActorIds: Set<number>;
  readonly completedActorIds: Set<number>;
  signalTopology?: SumoSignalTopology;
  adjustedSignalControllers?: number;
  occupancyRoads: SumoRoadOccupancyIndex | null;
  lastExternalActors: readonly ExternalTrafficActor[];
  warmupSeconds?: number;
  statusBase?: Pick<SumoTrafficStatus,
    'initMilliseconds' | 'heapBytes' | 'wasmBytes' | 'requestedActorCount' | 'nearbyRouteStarts'
    | 'detailedSafetyMetricsAvailable' | 'adjustedSignalControllers'>;
  timelineAdvanced: boolean;
  resetting: boolean;
  pendingReset?: SumoResetRequest;
  disposed: boolean;
  payload?: TrafficNetworkPayload;
  rawNetworkXml?: string;
  requestedAcceleratedSignalCycles: boolean;
  appliedAcceleratedSignalCycles: boolean;
  reconfiguring: boolean;
}

interface SumoResetRequest {
  readonly targetTime: number;
  readonly externalActors: readonly ExternalTrafficActor[];
  readonly focus: SumoDemandFocus | null;
  readonly renderer: ActorRenderer | null | undefined;
  readonly sampleHeight: ((x: number, z: number) => number | null) | null;
  readonly phaseAfterReset: 'ready' | 'running';
  readonly setStatus: (status: SumoTrafficStatus) => void;
  readonly onFallback: (reason: string) => void;
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

export function externalTrafficActors(
  actors: readonly SumoExternalActorView[],
  roads: SumoRoadOccupancyIndex,
): readonly ExternalTrafficActor[] {
  return buildSumoAuthoredOccupancies(actors, roads).map((actor) => ({
    id: `external:${actor.id}`,
    kind: actor.kind,
    routeId: 'proxy-route',
    x: actor.x,
    z: actor.z,
    headingDegrees: 90 + actor.headingRad * 180 / Math.PI,
    speedMetersPerSecond: actor.speedMps,
    lengthMeters: actor.lengthM,
    widthMeters: actor.widthM,
  }));
}

const SUMO_PROXY_SUBSTEP_SECONDS = .05;

/**
 * A delayed render may advance the editor by several SUMO ticks at once.
 * Preserve the full elapsed duration and interpolate external poses at every
 * 50 ms traffic step so moveToXY never observes the whole displacement in the
 * first substep. Actor births/removals occur only on the final boundary.
 */
export function buildSumoCatchUpRequests(
  generation: number,
  firstSequence: number,
  deltaSeconds: number,
  previous: readonly ExternalTrafficActor[],
  current: readonly ExternalTrafficActor[],
): readonly TrafficStepRequest[] {
  const count = Math.max(1, Math.ceil(deltaSeconds / SUMO_PROXY_SUBSTEP_SECONDS));
  const stepSeconds = deltaSeconds / count;
  const previousById = new Map(previous.map((actor) => [actor.id, actor] as const));
  const currentById = new Map(current.map((actor) => [actor.id, actor] as const));
  return Array.from({ length: count }, (_, index) => {
    const alpha = (index + 1) / count;
    const final = index === count - 1;
    const externalActors: ExternalTrafficActor[] = [];
    for (const before of previous) {
      const after = currentById.get(before.id);
      if (!after) {
        if (!final) externalActors.push(before);
        continue;
      }
      externalActors.push(interpolateExternalActor(before, after, alpha));
    }
    if (final) {
      for (const after of current) if (!previousById.has(after.id)) externalActors.push(after);
    }
    return {
      generation,
      sequence: firstSequence + index,
      deltaSeconds: stepSeconds,
      externalActors,
    };
  });
}

function interpolateExternalActor(before: ExternalTrafficActor, after: ExternalTrafficActor, alpha: number): ExternalTrafficActor {
  let headingDelta = (after.headingDegrees - before.headingDegrees) % 360;
  if (headingDelta > 180) headingDelta -= 360;
  if (headingDelta < -180) headingDelta += 360;
  return {
    ...after,
    x: before.x + (after.x - before.x) * alpha,
    z: before.z + (after.z - before.z) * alpha,
    headingDegrees: before.headingDegrees + headingDelta * alpha,
    speedMetersPerSecond: before.speedMetersPerSecond
      + (after.speedMetersPerSecond - before.speedMetersPerSecond) * alpha,
    lengthMeters: before.lengthMeters + (after.lengthMeters - before.lengthMeters) * alpha,
    widthMeters: before.widthMeters + (after.widthMeters - before.widthMeters) * alpha,
  };
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]!;
}
