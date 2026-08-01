import {
  buildRoute,
  toSceneXZ,
  type Condition,
  type Interaction,
  type Pose,
  type Route,
  type SimActor,
  type SimScenarioInput,
} from '@uniscenarios/sim-engine';

import { assertDefaultControllerRules, finite, identifier, mapRule, resolveScenario, xml } from './common.js';
import {
  AsamExportError,
  type AsamExportIssue,
  type AsamExportOptions,
  type AsamExportResult,
  type ResolvedAsamScenario,
} from './types.js';

function lines(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return text.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function worldPosition(pose: Pose): string {
  return `<WorldPosition x="${finite(pose.x)}" y="${finite(-pose.z)}" z="0" h="${finite(pose.headingRad)}" p="0" r="0"/>`;
}

function routeXml(name: string, points: readonly Pose[]): string {
  return [
    `<Route name="${xml(name)}" closed="false">`,
    ...points.map((pose) => lines(`<Waypoint routeStrategy="shortest"><Position>${worldPosition(pose)}</Position></Waypoint>`, 2)),
    '</Route>',
  ].join('\n');
}

function routePoints(route: Route, sampleM: number): Pose[] {
  const count = Math.max(2, Math.ceil(route.lengthM / sampleM) + 1);
  const points: Pose[] = [];
  for (let i = 0; i < count; i += 1) {
    const pose = route.poseAt((route.lengthM * i) / (count - 1));
    const scene = toSceneXZ(pose.point);
    points.push({ x: scene.x, z: scene.z, headingRad: pose.headingRad });
  }
  return points;
}

function boundingBox(actor: SimActor): string {
  return [
    '<BoundingBox>',
    `  <Center x="0" y="0" z="${finite(actor.dims.h / 2)}"/>`,
    `  <Dimensions width="${finite(actor.dims.w)}" length="${finite(actor.dims.l)}" height="${finite(actor.dims.h)}"/>`,
    '</BoundingBox>',
  ].join('\n');
}

function actorEntity(actor: SimActor, name: string): string {
  const properties = [
    `<Property name="uniscenarios.actorId" value="${xml(actor.id)}"/>`,
    ...actor.tags.map((tag) => `<Property name="uniscenarios.tag" value="${xml(tag)}"/>`),
  ];
  if (actor.kind === 'pedestrian') {
    return [
      `<ScenarioObject name="${xml(name)}">`,
      '  <Pedestrian name="uniscenarios_pedestrian" mass="80" pedestrianCategory="pedestrian">',
      lines(boundingBox(actor), 4),
      '    <Properties>',
      ...properties.map((property) => `      ${property}`),
      '    </Properties>',
      '  </Pedestrian>',
      '</ScenarioObject>',
    ].join('\n');
  }
  const wheel = Math.min(0.8, Math.max(0.3, actor.dims.h * 0.45));
  const track = Math.max(0.5, actor.dims.w * 0.84);
  const axleX = Math.max(0.5, actor.dims.l * 0.58);
  return [
    `<ScenarioObject name="${xml(name)}">`,
    '  <Vehicle name="uniscenarios_vehicle" vehicleCategory="car">',
    lines(boundingBox(actor), 4),
    '    <Performance maxSpeed="100" maxAcceleration="12" maxDeceleration="12"/>',
    '    <Axles>',
    `      <FrontAxle maxSteering="0.7" wheelDiameter="${finite(wheel)}" trackWidth="${finite(track)}" positionX="${finite(axleX)}" positionZ="${finite(wheel / 2)}"/>`,
    `      <RearAxle maxSteering="0" wheelDiameter="${finite(wheel)}" trackWidth="${finite(track)}" positionX="0" positionZ="${finite(wheel / 2)}"/>`,
    '    </Axles>',
    '    <Properties>',
    ...properties.map((property) => `      ${property}`),
    '    </Properties>',
    '  </Vehicle>',
    '</ScenarioObject>',
  ].join('\n');
}

function occluderEntity(input: SimScenarioInput, index: number): string {
  const o = input.occluders[index]!;
  const name = identifier('occluder', o.id);
  return [
    `<ScenarioObject name="${xml(name)}">`,
    `  <MiscObject mass="1" name="uniscenarios_occluder" miscObjectCategory="obstacle">`,
    '    <BoundingBox>',
    `      <Center x="0" y="0" z="${finite(o.obb.heightM / 2)}"/>`,
    `      <Dimensions width="${finite(o.obb.widthM)}" length="${finite(o.obb.lengthM)}" height="${finite(o.obb.heightM)}"/>`,
    '    </BoundingBox>',
    '    <Properties>',
    `      <Property name="uniscenarios.occluderId" value="${xml(o.id)}"/>`,
    ...(o.groupId ? [`      <Property name="uniscenarios.occluderGroupId" value="${xml(o.groupId)}"/>`] : []),
    '    </Properties>',
    '  </MiscObject>',
    '</ScenarioObject>',
  ].join('\n');
}

function speedAction(interaction: Extract<Interaction, { verb: 'speed' }>, actorName: string): string {
  const dynamics = interaction.dynamics;
  const target = interaction.target;
  let targetXml: string;
  if (target.mode === 'absolute' || target.mode === 'stop') {
    const value = target.mode === 'stop' ? 0 : target.value;
    targetXml = `<AbsoluteTargetSpeed value="${finite(value)}"/>`;
  } else if (target.mode === 'match') {
    targetXml = `<RelativeTargetSpeed entityRef="${xml(identifier('actor', target.actorId))}" value="${finite(target.offsetMps)}" speedTargetValueType="delta" continuous="true"/>`;
  } else {
    targetXml = `<RelativeTargetSpeed entityRef="${xml(actorName)}" value="${finite(target.value)}" speedTargetValueType="${target.mode}" continuous="false"/>`;
  }
  return [
    '<PrivateAction>',
    '  <LongitudinalAction>',
    '    <SpeedAction>',
    `      <SpeedActionDynamics dynamicsShape="${dynamics.shape}" dynamicsDimension="${dynamics.constraint}" value="${finite(dynamics.value)}"/>`,
    '      <SpeedActionTarget>',
    `        ${targetXml}`,
    '      </SpeedActionTarget>',
    '    </SpeedAction>',
    '  </LongitudinalAction>',
    '</PrivateAction>',
  ].join('\n');
}

function laneChangeAction(
  interaction: Extract<Interaction, { verb: 'changeLane' }>,
  actorName: string,
): string | AsamExportIssue {
  if (interaction.target.mode !== 'left' && interaction.target.mode !== 'right') {
    return {
      code: 'unsupported_lane_target',
      path: `interactions.${interaction.id}.target`,
      reason: `${interaction.target.mode} does not have a portable XML relative-lane representation`,
    };
  }
  const value = interaction.target.count * (interaction.target.mode === 'left' ? 1 : -1);
  return [
    '<PrivateAction>',
    '  <LateralAction>',
    '    <LaneChangeAction>',
    `      <LaneChangeActionDynamics dynamicsShape="${interaction.dynamics.shape}" dynamicsDimension="${interaction.dynamics.constraint}" value="${finite(interaction.dynamics.value)}"/>`,
    '      <LaneChangeTarget>',
    `        <RelativeTargetLane entityRef="${xml(actorName)}" value="${value}"/>`,
    '      </LaneChangeTarget>',
    '    </LaneChangeAction>',
    '  </LateralAction>',
    '</PrivateAction>',
  ].join('\n');
}

function interactionActions(
  resolved: ResolvedAsamScenario,
  interaction: Interaction,
  options: AsamExportOptions,
): string[] | AsamExportIssue {
  const actorName = resolved.actorNames.get(interaction.actorId)!;
  switch (interaction.verb) {
    case 'speed':
      return [speedAction(interaction, actorName)];
    case 'changeLane': {
      const action = laneChangeAction(interaction, actorName);
      return typeof action === 'string' ? [action] : action;
    }
    case 'route': {
      const built = buildRoute(options.graph, interaction.target);
      if (!built.ok) {
        return { code: built.error.code, path: `interactions.${interaction.id}.target`, reason: built.error.reason };
      }
      const sampleM = options.routeSampleM ?? 20;
      return [[
        '<PrivateAction>',
        '  <RoutingAction>',
        '    <AssignRouteAction>',
        lines(routeXml(identifier('route_event', interaction.id), routePoints(built.route, sampleM)), 6),
        '    </AssignRouteAction>',
        '  </RoutingAction>',
        '</PrivateAction>',
      ].join('\n')];
    }
    case 'exist': {
      const body = interaction.target.state === 'absent'
        ? '<DeleteEntityAction/>'
        : `<AddEntityAction><Position>${worldPosition(resolved.actors.find((a) => a.actor.id === interaction.actorId)!.actor.initial.pose)}</Position></AddEntityAction>`;
      return [`<GlobalAction><EntityAction entityRef="${xml(actorName)}">${body}</EntityAction></GlobalAction>`];
    }
    case 'set': {
      const match = /^signal:(.+)\.phase$/.exec(interaction.target.key);
      if (match && typeof interaction.target.value === 'string') {
        return [`<GlobalAction><InfrastructureAction><TrafficSignalAction><TrafficSignalControllerAction trafficSignalControllerRef="${xml(match[1]!)}" phase="${xml(interaction.target.value)}"/></TrafficSignalAction></InfrastructureAction></GlobalAction>`];
      }
      return {
        code: 'unsupported_set_action',
        path: `interactions.${interaction.id}.target.key`,
        reason: `${interaction.target.key} has no standard XML 1.4 action with equivalent semantics`,
      };
    }
    case 'gap':
      return {
        code: 'unsupported_gap_dynamics',
        path: `interactions.${interaction.id}`,
        reason: 'XML LongitudinalDistanceAction cannot preserve UniScenarios transition shape and dimension',
      };
    case 'laneOffset':
      return {
        code: 'unsupported_lane_offset_dynamics',
        path: `interactions.${interaction.id}`,
        reason: 'XML LaneOffsetAction cannot preserve UniScenarios transition dimension and value',
      };
  }
}

interface LeafConditionXml { triggeringActor?: string; xml: string }

function leafCondition(resolved: ResolvedAsamScenario, condition: Condition): LeafConditionXml | AsamExportIssue {
  const actor = (id: string): string => resolved.actorNames.get(id) ?? identifier('actor', id);
  switch (condition.kind) {
    case 'distance':
      return {
        triggeringActor: actor(condition.a),
        xml: `<RelativeDistanceCondition entityRef="${xml(actor(condition.b))}" relativeDistanceType="${condition.mode === 'euclidean' ? 'euclidianDistance' : 'longitudinal'}" freespace="false" rule="${mapRule(condition.cmp)}" value="${finite(condition.value)}" coordinateSystem="${condition.mode === 'euclidean' ? 'entity' : 'road'}"/>`,
      };
    case 'ttc':
      return {
        triggeringActor: actor(condition.a),
        xml: `<TimeToCollisionCondition freespace="false" rule="${mapRule(condition.cmp)}" value="${finite(condition.value)}"><TimeToCollisionConditionTarget><EntityRef entityRef="${xml(actor(condition.b))}"/></TimeToCollisionConditionTarget></TimeToCollisionCondition>`,
      };
    case 'headway':
      return {
        triggeringActor: actor(condition.a),
        xml: `<TimeHeadwayCondition entityRef="${xml(actor(condition.b))}" freespace="false" rule="${mapRule(condition.cmp)}" value="${finite(condition.value)}" coordinateSystem="road" relativeDistanceType="longitudinal"/>`,
      };
    case 'speed':
      return { triggeringActor: actor(condition.actorId), xml: `<SpeedCondition rule="${mapRule(condition.cmp)}" value="${finite(condition.value)}"/>` };
    case 'standstill':
      return { triggeringActor: actor(condition.actorId), xml: `<StandStillCondition duration="${finite(condition.durationS)}"/>` };
    case 'signal':
      return { xml: `<TrafficSignalControllerCondition trafficSignalControllerRef="${xml(condition.signalId)}" phase="${condition.phase}"/>` };
    case 'collision':
      if (!condition.a || !condition.b) {
        return { code: 'unsupported_collision_scope', path: 'condition', reason: 'XML export requires both collision participants' };
      }
      return { triggeringActor: actor(condition.a), xml: `<CollisionCondition><EntityRef entityRef="${xml(actor(condition.b))}"/></CollisionCondition>` };
    case 'reaches':
    case 'visible':
    case 'and':
    case 'or':
    case 'not':
      return { code: 'unsupported_condition', path: 'condition', reason: `${condition.kind} has no exact XML 1.4 mapping in this profile` };
  }
}

function conditionElement(name: string, leaf: LeafConditionXml): string {
  if (leaf.triggeringActor) {
    return `<Condition name="${xml(name)}" delay="0" conditionEdge="rising"><ByEntityCondition><TriggeringEntities triggeringEntitiesRule="any"><EntityRef entityRef="${xml(leaf.triggeringActor)}"/></TriggeringEntities><EntityCondition>${leaf.xml}</EntityCondition></ByEntityCondition></Condition>`;
  }
  return `<Condition name="${xml(name)}" delay="0" conditionEdge="rising"><ByValueCondition>${leaf.xml}</ByValueCondition></Condition>`;
}

function whenGroups(
  resolved: ResolvedAsamScenario,
  interaction: Interaction & { trigger: Extract<Interaction['trigger'], { kind: 'when' }> },
): string[] | AsamExportIssue {
  const condition = interaction.trigger.condition;
  const groups: Condition[][] = condition.kind === 'or'
    ? condition.of.map((leaf) => [leaf])
    : condition.kind === 'and'
      ? [condition.of]
      : condition.kind === 'not'
        ? []
        : [[condition]];
  if (condition.kind === 'not') {
    return { code: 'unsupported_condition', path: `interactions.${interaction.id}.trigger.condition`, reason: 'XML Trigger has no generic logical NOT' };
  }
  const output: string[] = [];
  for (const [groupIndex, group] of groups.entries()) {
    const leaves: string[] = [];
    for (const [leafIndex, condition] of group.entries()) {
      const rendered = leafCondition(resolved, condition);
      if ('code' in rendered) return { ...rendered, path: `interactions.${interaction.id}.trigger.condition` };
      leaves.push(conditionElement(`${interaction.id}_${groupIndex}_${leafIndex}`, rendered));
    }
    output.push(`<ConditionGroup>${leaves.join('')}</ConditionGroup>`);
  }
  if (interaction.trigger.ifNever === 'fire') {
    output.push(`<ConditionGroup><Condition name="${xml(`${interaction.id}_latest`)}" delay="0" conditionEdge="none"><ByValueCondition><SimulationTimeCondition value="${finite(interaction.trigger.byLatest)}" rule="greaterOrEqual"/></ByValueCondition></Condition></ConditionGroup>`);
  } else {
    return {
      code: 'unsupported_when_deadline',
      path: `interactions.${interaction.id}.trigger`,
      reason: 'ifNever=skip cannot be bounded in XML without an additional state variable and guard',
    };
  }
  return output;
}

function startTrigger(resolved: ResolvedAsamScenario, interaction: Interaction): string | AsamExportIssue {
  const trigger = interaction.trigger;
  if (trigger.kind === 'at') {
    return `<StartTrigger><ConditionGroup><Condition name="${xml(`${interaction.id}_start`)}" delay="0" conditionEdge="none"><ByValueCondition><SimulationTimeCondition value="${finite(Math.max(0, trigger.t))}" rule="greaterOrEqual"/></ByValueCondition></Condition></ConditionGroup></StartTrigger>`;
  }
  if (trigger.kind === 'after') {
    const parent = resolved.interactionNames.get(trigger.interactionId)!;
    return `<StartTrigger><ConditionGroup><Condition name="${xml(`${interaction.id}_after`)}" delay="${finite(trigger.delayS)}" conditionEdge="rising"><ByValueCondition><StoryboardElementStateCondition storyboardElementRef="${xml(parent)}" storyboardElementType="event" state="completeState"/></ByValueCondition></Condition></ConditionGroup></StartTrigger>`;
  }
  if (trigger.kind === 'when') {
    const groups = whenGroups(resolved, interaction as never);
    return Array.isArray(groups) ? `<StartTrigger>${groups.join('')}</StartTrigger>` : groups;
  }
  return { code: 'unsupported_arrival_trigger', path: `interactions.${interaction.id}.trigger`, reason: 'arrival triggers must be resolved while materializing the concrete instance' };
}

function validateXmlProfile(input: SimScenarioInput): void {
  const issues: AsamExportIssue[] = [];
  for (const [i, interaction] of input.interactions.entries()) {
    if (interaction.until) {
      issues.push({
        code: 'unsupported_until',
        path: `interactions.${i}.until`,
        reason: 'XML Event does not provide an equivalent generic stop condition for this action profile',
      });
    }
  }
  for (const [i, program] of input.signalPrograms.entries()) {
    if (!program.loop) {
      issues.push({
        code: 'unsupported_finite_signal_program',
        path: `signalPrograms.${i}.loop`,
        reason: 'XML TrafficSignalController cycles; a finite non-looping program needs explicit storyboard state',
      });
    }
    const phases = new Set<string>();
    for (const [phaseIndex, phase] of program.phases.entries()) {
      if (phases.has(phase.phase)) {
        issues.push({
          code: 'duplicate_signal_phase_name',
          path: `signalPrograms.${i}.phases.${phaseIndex}.phase`,
          reason: `XML controller phase references require unique names; ${phase.phase} occurs more than once`,
        });
      }
      phases.add(phase.phase);
    }
  }
  if (issues.length > 0) throw new AsamExportError(issues);
}

export function exportOpenScenarioXml14(
  input: SimScenarioInput,
  options: AsamExportOptions,
): AsamExportResult {
  assertDefaultControllerRules(input, false);
  validateXmlProfile(input);
  const resolved = resolveScenario(input, options, false);
  const issues: AsamExportIssue[] = [];
  const actorEvents = new Map<string, string[]>();
  for (const actor of resolved.actors) actorEvents.set(actor.actor.id, []);

  for (const { interaction, name } of resolved.interactions) {
    const actions = interactionActions(resolved, interaction, options);
    const trigger = startTrigger(resolved, interaction);
    if (!Array.isArray(actions)) issues.push(actions);
    if (typeof trigger !== 'string') issues.push(trigger);
    if (!Array.isArray(actions) || typeof trigger !== 'string') continue;
    actorEvents.get(interaction.actorId)!.push([
      `<Event name="${xml(name)}" priority="overwrite" maximumExecutionCount="1">`,
      ...actions.map((action, i) => lines(`<Action name="${xml(`${name}_action_${i}`)}">${action}</Action>`, 2)),
      lines(trigger, 2),
      '</Event>',
    ].join('\n'));
  }
  if (issues.length > 0) throw new AsamExportError(issues);

  const initGlobal = input.signalPrograms.map((program) => {
    const phase = program.phases[0]!.phase;
    return `<GlobalAction><InfrastructureAction><TrafficSignalAction><TrafficSignalControllerAction trafficSignalControllerRef="${xml(program.id)}" phase="${phase}"/></TrafficSignalAction></InfrastructureAction></GlobalAction>`;
  });
  const initPrivate = resolved.actors.flatMap(({ actor, name, routeName, points }) => {
    if (!actor.presentAtStart) return [];
    return [[
      `<Private entityRef="${xml(name)}">`,
      '  <PrivateAction><TeleportAction><Position>',
      lines(worldPosition(actor.initial.pose), 6),
      '  </Position></TeleportAction></PrivateAction>',
      '  <PrivateAction><RoutingAction><AssignRouteAction>',
      lines(routeXml(routeName, points), 6),
      '  </AssignRouteAction></RoutingAction></PrivateAction>',
      '  <PrivateAction><LongitudinalAction><SpeedAction>',
      '    <SpeedActionDynamics dynamicsShape="step" dynamicsDimension="time" value="0"/>',
      `    <SpeedActionTarget><AbsoluteTargetSpeed value="${finite(actor.initial.speedMps)}"/></SpeedActionTarget>`,
      '  </SpeedAction></LongitudinalAction></PrivateAction>',
      '</Private>',
    ].join('\n')];
  });
  const initOccluders = input.occluders.map((o) => {
    const name = identifier('occluder', o.id);
    return `<Private entityRef="${xml(name)}"><PrivateAction><TeleportAction><Position>${worldPosition({ x: o.obb.center.x, z: o.obb.center.z, headingRad: o.obb.headingRad })}</Position></TeleportAction></PrivateAction></Private>`;
  });
  const controllers = input.signalPrograms.map((program) => [
    `<TrafficSignalController name="${xml(program.id)}" reference="${xml(program.id)}" delay="${finite(program.offsetS)}">`,
    ...program.phases.map((phase) => `  <Phase name="${phase.phase}" duration="${finite(phase.durationS)}" semantics="${phase.phase === 'green' ? 'go' : phase.phase === 'yellow' ? 'caution' : 'stop'}"><TrafficSignalGroupState state="${phase.phase}"/></Phase>`),
    '</TrafficSignalController>',
  ].join('\n'));

  const maneuverGroups = resolved.actors.flatMap(({ actor, name }) => {
    const events = actorEvents.get(actor.id)!;
    if (events.length === 0) return [];
    return [[
      `<ManeuverGroup name="${xml(identifier('group', actor.id))}" maximumExecutionCount="1">`,
      `  <Actors selectTriggeringEntities="false"><EntityRef entityRef="${xml(name)}"/></Actors>`,
      `  <Maneuver name="${xml(identifier('maneuver', actor.id))}">`,
      ...events.map((event) => lines(event, 4)),
      '  </Maneuver>',
      '</ManeuverGroup>',
    ].join('\n')];
  });

  const date = options.headerDate ?? '1970-01-01T00:00:00.000Z';
  const content = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSCENARIO>',
    `  <FileHeader revMajor="1" revMinor="4" date="${xml(date)}" description="${xml(options.description ?? 'Concrete UniScenarios scenario instance')}" author="${xml(options.author ?? 'UniScenarios')}"/>`,
    '  <ParameterDeclarations/>',
    '  <CatalogLocations/>',
    '  <RoadNetwork>',
    `    <LogicFile filepath="${xml(options.roadFile ?? `${input.mapId}.xodr`)}"/>`,
    ...(controllers.length > 0 ? ['    <TrafficSignals>', ...controllers.map((controller) => lines(controller, 6)), '    </TrafficSignals>'] : []),
    '  </RoadNetwork>',
    '  <Entities>',
    ...resolved.actors.map(({ actor, name }) => lines(actorEntity(actor, name), 4)),
    ...input.occluders.map((_, i) => lines(occluderEntity(input, i), 4)),
    '  </Entities>',
    '  <Storyboard>',
    '    <Init><Actions>',
    ...initGlobal.map((action) => lines(action, 6)),
    ...initPrivate.map((action) => lines(action, 6)),
    ...initOccluders.map((action) => lines(action, 6)),
    '    </Actions></Init>',
    ...(maneuverGroups.length > 0 ? [
      '    <Story name="uniscenarios_story">',
      '      <Act name="uniscenarios_act">',
      ...maneuverGroups.map((group) => lines(group, 8)),
      '        <StartTrigger><ConditionGroup><Condition name="act_start" delay="0" conditionEdge="none"><ByValueCondition><SimulationTimeCondition value="0" rule="greaterOrEqual"/></ByValueCondition></Condition></ConditionGroup></StartTrigger>',
      '      </Act>',
      '    </Story>',
    ] : []),
    `    <StopTrigger><ConditionGroup><Condition name="scenario_end" delay="0" conditionEdge="none"><ByValueCondition><SimulationTimeCondition value="${finite(input.clipSeconds)}" rule="greaterOrEqual"/></ByValueCondition></Condition></ConditionGroup></StopTrigger>`,
    '  </Storyboard>',
    '</OpenSCENARIO>',
    '',
  ].join('\n');

  return {
    format: 'xosc-1.4',
    standard: 'ASAM OpenSCENARIO XML 1.4.0',
    extension: '.xosc',
    mediaType: 'application/xml',
    content,
    warnings: resolved.warnings,
  };
}
