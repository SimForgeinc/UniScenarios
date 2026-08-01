import {
  buildRoute,
  toSceneXZ,
  type Interaction,
  type Pose,
  type Route,
  type SimScenarioInput,
} from '@uniscenarios/sim-engine';

import {
  AsamExportError,
  type AsamExportIssue,
  type AsamExportOptions,
  type AsamExportWarning,
  type ResolvedAsamScenario,
  type ResolvedInteraction,
} from './types.js';

const DSL_KEYWORDS = new Set([
  'action', 'actor', 'and', 'as', 'bool', 'call', 'cover', 'default', 'def', 'do',
  'else', 'emit', 'enum', 'event', 'extend', 'false', 'float', 'hard', 'if', 'import',
  'in', 'inherits', 'int', 'is', 'it', 'keep', 'list', 'modifier', 'not', 'of', 'on',
  'one_of', 'or', 'parallel', 'range', 'record', 'remove_default', 'scenario', 'serial',
  'string', 'struct', 'true', 'uint', 'until', 'var', 'wait', 'with',
]);

export function identifier(prefix: string, raw: string): string {
  let stem = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!stem || /^[0-9]/.test(stem) || DSL_KEYWORDS.has(stem)) stem = `id_${stem || 'unnamed'}`;
  return `${prefix}_${stem}`;
}

export function finite(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`cannot serialize non-finite number ${value}`);
  if (Object.is(value, -0)) return '0';
  const rounded = Math.round(value * 1e9) / 1e9;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function mapRule(cmp: 'lte' | 'gte'): 'lessOrEqual' | 'greaterOrEqual' {
  return cmp === 'lte' ? 'lessOrEqual' : 'greaterOrEqual';
}

function dynamicsDuration(interaction: Interaction): number | null {
  if (!('dynamics' in interaction)) return 0;
  if (interaction.dynamics.shape === 'step') return 0;
  return interaction.dynamics.constraint === 'time' ? interaction.dynamics.value : null;
}

/** Resolve `at`/`after` triggers to absolute time for the DSL profile. */
export function resolveStaticStartTimes(
  interactions: readonly Interaction[],
): { times: Map<string, number>; issues: AsamExportIssue[] } {
  const byId = new Map(interactions.map((interaction) => [interaction.id, interaction]));
  const times = new Map<string, number>();
  const visiting = new Set<string>();
  const issues: AsamExportIssue[] = [];

  const visit = (interaction: Interaction): number | null => {
    const cached = times.get(interaction.id);
    if (cached !== undefined) return cached;
    const path = `interactions.${interaction.id}.trigger`;
    if (visiting.has(interaction.id)) {
      issues.push({ code: 'trigger_cycle', path, reason: 'after() dependency cycle is not exportable' });
      return null;
    }
    visiting.add(interaction.id);
    let value: number | null = null;
    if (interaction.trigger.kind === 'at') {
      value = Math.max(0, interaction.trigger.t);
    } else if (interaction.trigger.kind === 'after') {
      const parent = byId.get(interaction.trigger.interactionId);
      if (!parent) {
        issues.push({ code: 'unknown_interaction', path, reason: `unknown interaction ${interaction.trigger.interactionId}` });
      } else {
        const parentStart = visit(parent);
        const duration = dynamicsDuration(parent);
        if (duration === null) {
          issues.push({
            code: 'non_static_after',
            path,
            reason: `after(${parent.id}) depends on a ${parent.verb} action whose duration is constrained by ${'dynamics' in parent ? parent.dynamics.constraint : 'runtime state'}`,
          });
        } else if (parentStart !== null) {
          value = parentStart + duration + interaction.trigger.delayS;
        }
      }
    } else {
      issues.push({
        code: 'unsupported_trigger',
        path,
        reason: `${interaction.trigger.kind} triggers are not in the concrete DSL 2.2 export profile`,
      });
    }
    visiting.delete(interaction.id);
    if (value !== null) times.set(interaction.id, value);
    return value;
  };

  for (const interaction of interactions) visit(interaction);
  return { times, issues };
}

function sampledRoutePoses(
  input: SimScenarioInput,
  actorIndex: number,
  options: AsamExportOptions,
): { route: Route; points: Pose[] } | AsamExportIssue {
  const actor = input.actors[actorIndex]!;
  const built = buildRoute(options.graph, actor.behavior.route);
  if (!built.ok) {
    return {
      code: built.error.code,
      path: `actors.${actorIndex}.behavior.route`,
      reason: built.error.reason,
    };
  }
  if (built.route.lengthM <= 1e-6) {
    return {
      code: 'route_too_short',
      path: `actors.${actorIndex}.behavior.route`,
      reason: 'ASAM routes require at least two distinct world positions',
    };
  }
  const step = options.routeSampleM ?? 20;
  if (!Number.isFinite(step) || step <= 0) {
    return { code: 'bad_route_sample', path: 'routeSampleM', reason: 'route sample distance must be positive' };
  }
  const count = Math.max(2, Math.ceil(built.route.lengthM / step) + 1);
  const points: Pose[] = [];
  for (let i = 0; i < count; i += 1) {
    const pose = built.route.poseAt((built.route.lengthM * i) / (count - 1));
    const scene = toSceneXZ(pose.point);
    points.push({ x: scene.x, z: scene.z, headingRad: pose.headingRad });
  }
  return { route: built.route, points };
}

export function resolveScenario(
  input: SimScenarioInput,
  options: AsamExportOptions,
  includeStaticTimes: boolean,
): ResolvedAsamScenario {
  const issues: AsamExportIssue[] = [];
  const warnings: AsamExportWarning[] = [];
  const actorNames = new Map<string, string>();
  const interactionNames = new Map<string, string>();
  const allNames = new Set<string>();

  for (const [i, actor] of input.actors.entries()) {
    const name = identifier('actor', actor.id);
    if (allNames.has(name)) {
      issues.push({ code: 'identifier_collision', path: `actors.${i}.id`, reason: `${actor.id} normalizes to duplicate ${name}` });
    }
    allNames.add(name);
    actorNames.set(actor.id, name);
  }
  for (const [i, interaction] of input.interactions.entries()) {
    const name = identifier('event', interaction.id);
    if (allNames.has(name)) {
      issues.push({ code: 'identifier_collision', path: `interactions.${i}.id`, reason: `${interaction.id} normalizes to duplicate ${name}` });
    }
    allNames.add(name);
    interactionNames.set(interaction.id, name);
  }

  const actors = input.actors.flatMap((actor, i) => {
    const resolved = sampledRoutePoses(input, i, options);
    if ('code' in resolved) {
      issues.push(resolved);
      return [];
    }
    return [{
      actor,
      name: actorNames.get(actor.id)!,
      routeName: identifier('route', actor.id),
      route: resolved.route,
      points: resolved.points,
    }];
  });

  let staticTimes = new Map<string, number>();
  if (includeStaticTimes) {
    const resolved = resolveStaticStartTimes(input.interactions);
    staticTimes = resolved.times;
    issues.push(...resolved.issues);
  }
  const interactions: ResolvedInteraction[] = input.interactions.map((interaction) => ({
    interaction,
    name: interactionNames.get(interaction.id)!,
    ...(staticTimes.has(interaction.id) ? { startTimeS: staticTimes.get(interaction.id)! } : {}),
  }));

  if (input.metricSubject) {
    warnings.push({
      code: 'evaluation_metadata_omitted',
      path: 'metricSubject',
      reason: 'ASAM OpenSCENARIO describes scenario behavior, not UniScenarios metric evaluation',
    });
  }
  if (input.occlusionPairs.length > 0) {
    warnings.push({
      code: 'evaluation_metadata_omitted',
      path: 'occlusionPairs',
      reason: 'physical occluders are exported, but UniScenarios line-of-sight evaluation pairs are not an ASAM execution concept',
    });
  }

  if (issues.length > 0) throw new AsamExportError(issues);
  return { input, actors, interactions, actorNames, interactionNames, warnings };
}

export function assertDefaultControllerRules(
  input: SimScenarioInput,
  allowCollisionAvoidance: boolean,
): void {
  const issues: AsamExportIssue[] = [];
  for (const [i, actor] of input.actors.entries()) {
    const rules = actor.behavior.rules;
    const changed: string[] = [];
    if (!rules.obeySignals) changed.push('obeySignals');
    if (!rules.yield) changed.push('yield');
    if (rules.aggression !== 0.5) changed.push('aggression');
    if (rules.speedFactor !== 1) changed.push('speedFactor');
    if (!allowCollisionAvoidance && !rules.collisionAvoidance) changed.push('collisionAvoidance');
    if (changed.length > 0) {
      issues.push({
        code: 'unsupported_controller_rules',
        path: `actors.${i}.behavior.rules`,
        reason: `no standard behavior preserves non-default ${changed.join(', ')}`,
      });
    }
    if (
      actor.behavior.cruiseSpeedMps !== undefined &&
      Math.abs(actor.behavior.cruiseSpeedMps - actor.initial.speedMps) > 1e-9
    ) {
      issues.push({
        code: 'unsupported_cruise_controller',
        path: `actors.${i}.behavior.cruiseSpeedMps`,
        reason: 'a cruise target different from initial speed needs an implementation-specific controller',
      });
    }
  }
  if (issues.length > 0) throw new AsamExportError(issues);
}
