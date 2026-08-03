import type { MapSignalPlan, MapSignalPlanClip } from '@uniscenarios/scenario-model';
import type { ControlIndication, SignalProgram, TopologyIndex } from '@uniscenarios/sim-engine';

import type { MapSignalCatalog } from './map-signals.js';

export type MapSignalPlanCompileErrorCode =
  | 'map_signal_plan_map_mismatch'
  | 'map_signal_plan_stale_binding'
  | 'map_signal_plan_junction_unbound'
  | 'map_signal_plan_reference_unbound'
  | 'map_signal_plan_dual_ownership'
  | 'map_signal_plan_controller_conflict';

export class MapSignalPlanCompileError extends Error {
  constructor(
    readonly code: MapSignalPlanCompileErrorCode,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'MapSignalPlanCompileError';
  }
}

export interface CompileMapSignalPlansOptions {
  readonly mapId: string;
  readonly controlDigest: string;
  readonly clipSeconds: number;
  readonly warmupSeconds: number;
  readonly signalCatalog: MapSignalCatalog;
  readonly topology: TopologyIndex;
  /** Derived gate conflicts keyed by physical junction id. */
  readonly conflictPairsByJunction: Readonly<Record<string, readonly { gateA: string; gateB: string }[]>>;
  /** Resolved engine signal ids owned by legacy `@world set(signal:*.phase)`. */
  readonly worldSignalSetIds?: readonly string[];
}

const ENDPOINT_PAD_S = 1e-6;

function phaseAt(program: SignalProgram, timeS: number, warmupSeconds: number): ControlIndication {
  const cycle = program.phases.reduce((sum, phase) => sum + phase.durationS, 0);
  let elapsed = timeS + warmupSeconds + program.offsetS;
  if (program.loop) elapsed = ((elapsed % cycle) + cycle) % cycle;
  else if (elapsed <= 0) return program.phases[0]!.phase;
  else if (elapsed >= cycle) return program.phases[program.phases.length - 1]!.phase;
  let cursor = 0;
  for (const phase of program.phases) {
    cursor += phase.durationS;
    if (elapsed < cursor) return phase.phase;
  }
  return program.phases[program.phases.length - 1]!.phase;
}

function addBaselineBoundaries(
  into: Set<number>,
  program: SignalProgram,
  startS: number,
  endS: number,
  warmupSeconds: number,
): void {
  const cycle = program.phases.reduce((sum, phase) => sum + phase.durationS, 0);
  let cumulative = 0;
  for (const phase of program.phases) {
    cumulative += phase.durationS;
    const origin = cumulative - warmupSeconds - program.offsetS;
    if (program.loop) {
      const first = Math.ceil((startS - origin) / cycle);
      const last = Math.floor((endS - origin) / cycle);
      for (let turn = first; turn <= last; turn += 1) {
        const value = origin + turn * cycle;
        if (value > startS && value < endS) into.add(value);
      }
    } else if (origin > startS && origin < endS) {
      into.add(origin);
    }
  }
}

function controllerStagePrograms(
  programs: readonly SignalProgram[],
  controllerId: string,
): SignalProgram[] {
  return programs.filter((program) => program.mapBinding?.controllerHeadGroups?.some(
    (group) => group.controllerId === controllerId,
  ));
}

function validateControllerStage(
  plan: MapSignalPlan,
  clip: MapSignalPlanClip,
  programs: readonly SignalProgram[],
  options: CompileMapSignalPlansOptions,
  path: string,
): ReadonlySet<string> {
  const junction = options.signalCatalog.junctions.find((item) => item.junctionId === plan.binding.junctionId);
  const controller = options.signalCatalog.controllers.find((item) => item.id === clip.reference.controllerId);
  if (!junction || !junction.controllerIds.includes(clip.reference.controllerId) || !controller) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_reference_unbound',
      `controller "${clip.reference.controllerId}" does not belong to junction "${plan.binding.junctionId}"`,
      `${path}.reference.controllerId`,
    );
  }
  if (!controller.signalIds.includes(clip.reference.headId)) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_reference_unbound',
      `head "${clip.reference.headId}" does not belong to controller "${clip.reference.controllerId}"`,
      `${path}.reference.headId`,
    );
  }
  const referenceProgram = programs.find((program) =>
    program.mapBinding?.headIds.includes(clip.reference.headId)
    && program.mapBinding.controllerHeadGroups?.some((group) => group.controllerId === clip.reference.controllerId),
  );
  if (!referenceProgram) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_reference_unbound',
      `head "${clip.reference.headId}" has no executable program in controller "${clip.reference.controllerId}"`,
      `${path}.reference`,
    );
  }

  const active = controllerStagePrograms(programs, clip.reference.controllerId);
  const activeIds = new Set(active.map((program) => program.id));
  const activeConnectingLanes = new Set(active.flatMap((program) =>
    program.stopLines.flatMap((line) => line.connectingLaneRsls),
  ));
  const gateById = new Map(options.topology.gates.map((gate) => [gate.id, gate]));
  for (const pair of options.conflictPairsByJunction[plan.binding.junctionId] ?? []) {
    const a = gateById.get(pair.gateA)?.connectingLaneRsl;
    const b = gateById.get(pair.gateB)?.connectingLaneRsl;
    if (a && b && activeConnectingLanes.has(a) && activeConnectingLanes.has(b)) {
      throw new MapSignalPlanCompileError(
        'map_signal_plan_controller_conflict',
        `controller "${clip.reference.controllerId}" contains conflicting movements ${pair.gateA} and ${pair.gateB}`,
        `${path}.reference.controllerId`,
      );
    }
  }
  return activeIds;
}

function authoredPhase(
  program: SignalProgram,
  programs: readonly SignalProgram[],
  plan: MapSignalPlan,
  clip: MapSignalPlanClip,
  activeIds: ReadonlySet<string>,
): ControlIndication {
  if (program.mapBinding?.junctionId !== plan.binding.junctionId) {
    throw new Error('internal map signal compiler junction mismatch');
  }
  // Fail-safe phase semantics are deliberately expanded here so every consumer
  // (preview, engine, trace, SUMO ownership and OSC export) sees one atomic
  // controller evaluation rather than independently interpreting a clip.
  if (clip.indication === 'red') return 'red';
  if (clip.indication === 'flashing_red') return 'flashing_red';
  if (clip.indication === 'flashing_yellow') {
    return activeIds.has(program.id) ? 'flashing_yellow' : 'flashing_red';
  }
  return activeIds.has(program.id) ? clip.indication : 'red';
}

function compileJunction(
  programs: readonly SignalProgram[],
  plan: MapSignalPlan,
  options: CompileMapSignalPlansOptions,
  planIndex: number,
): SignalProgram[] {
  const prefix = `mapSignalPlans.${planIndex}`;
  if (plan.binding.mapId !== options.mapId) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_map_mismatch',
      `signal plan is bound to map "${plan.binding.mapId}", not "${options.mapId}"`,
      `${prefix}.binding.mapId`,
    );
  }
  if (plan.binding.controlDigest !== options.controlDigest) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_stale_binding',
      'physical traffic-control metadata changed; reselect the intersection before playback',
      `${prefix}.binding.controlDigest`,
    );
  }
  const junctionPrograms = programs.filter((program) => program.mapBinding?.junctionId === plan.binding.junctionId);
  if (junctionPrograms.length === 0) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_junction_unbound',
      `junction "${plan.binding.junctionId}" has no executable physical signal programs`,
      `${prefix}.binding.junctionId`,
    );
  }
  const owned = new Set(junctionPrograms.map((program) => program.id));
  const dualOwner = options.worldSignalSetIds?.find((id) => owned.has(id));
  if (dualOwner) {
    throw new MapSignalPlanCompileError(
      'map_signal_plan_dual_ownership',
      `signal "${dualOwner}" is controlled by both mapSignalPlans and a @world set interaction`,
      prefix,
    );
  }

  const activeByClip = new Map<string, ReadonlySet<string>>();
  plan.clips.forEach((clip, clipIndex) => {
    activeByClip.set(clip.id, validateControllerStage(
      plan, clip, junctionPrograms, options, `${prefix}.clips.${clipIndex}`,
    ));
  });

  const startS = -options.warmupSeconds;
  const endS = options.clipSeconds + ENDPOINT_PAD_S;
  const points = new Set<number>([startS, 0, options.clipSeconds, endS]);
  for (const clip of plan.clips) {
    points.add(clip.startS);
    points.add(clip.endS);
  }
  for (const program of junctionPrograms) {
    addBaselineBoundaries(points, program, startS, endS, options.warmupSeconds);
  }
  const ordered = [...points].filter((point) => point >= startS && point <= endS).sort((a, b) => a - b);

  return junctionPrograms.map((program) => {
    const phases: Array<{ phase: ControlIndication; durationS: number }> = [];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const from = ordered[index]!;
      const to = ordered[index + 1]!;
      if (to <= from) continue;
      const sample = from + (to - from) / 2;
      const clip = plan.clips.find((candidate) => sample >= candidate.startS && sample < candidate.endS);
      const phase = clip
        ? authoredPhase(program, junctionPrograms, plan, clip, activeByClip.get(clip.id)!)
        : phaseAt(program, sample, options.warmupSeconds);
      const previous = phases[phases.length - 1];
      if (previous?.phase === phase) previous.durationS += to - from;
      else phases.push({ phase, durationS: to - from });
    }
    return {
      ...program,
      phases,
      offsetS: 0,
      loop: false,
      mapBinding: program.mapBinding ? { ...program.mapBinding, timingSource: 'authored' as const } : undefined,
    };
  });
}

/** Compile bounded authoring clips into complete, non-looping engine programs.
 * Baseline map timing is retained during warm-up and every uncovered gap. */
export function compileMapSignalPlans(
  programs: readonly SignalProgram[],
  plans: readonly MapSignalPlan[],
  options: CompileMapSignalPlansOptions,
): SignalProgram[] {
  let output = [...programs];
  plans.forEach((plan, planIndex) => {
    const compiled = compileJunction(output, plan, options, planIndex);
    const replacements = new Map(compiled.map((program) => [program.id, program]));
    output = output.map((program) => replacements.get(program.id) ?? program);
  });
  return output;
}
