import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

export interface CopilotBenchmarkCase {
  readonly id: string;
  readonly summary: string;
  readonly prompt: string;
  readonly expectedRejection?: boolean;
}

export interface SemanticAssertion {
  readonly id: string;
  readonly pass: boolean;
  readonly evidence: string;
}

/** Fixed, provider-neutral research corpus. Do not tune it to a provider. */
export const COPILOT_EDGE_CASES: readonly CopilotBenchmarkCase[] = [
  {
    id: 'lead-hard-brake',
    summary: 'Lead vehicle hard braking',
    prompt: 'Create a 20 second scenario with an ego sedan following a lead car. At 6 seconds the lead car brakes hard to a complete stop while the ego continues approaching.',
  },
  {
    id: 'cut-in',
    summary: 'Adjacent-lane cut-in',
    prompt: 'Create a 20 second scenario where a pickup in the adjacent lane cuts into the ego sedan lane at 7 seconds while both vehicles are moving.',
  },
  {
    id: 'signalized-turn-conflict',
    summary: 'Signalized turn conflict',
    prompt: 'At a signalized intersection, create an ego sedan going straight while an opposing car turns left across its path after 5 seconds. Include the traffic signal context.',
  },
  {
    id: 'pedestrian-near-miss',
    summary: 'Pedestrian near miss',
    prompt: 'Create a pedestrian near-miss scenario: a walking adult crosses the ego vehicle path after 5 seconds and passes within 0.8 meters without a collision.',
  },
  {
    id: 'occluded-pedestrian',
    summary: 'Occluded pedestrian emergence',
    prompt: 'Create an occlusion edge case where a child pedestrian emerges from behind a stopped van into the path of a moving ego sedan after 4 seconds.',
  },
  {
    id: 'multi-actor-intersection',
    summary: 'Multi-actor intersection conflict',
    prompt: 'Create a signalized intersection conflict with an ego sedan, an opposing pickup, and a crossing van. Their movements should overlap between 6 and 10 seconds.',
  },
  {
    id: 'blocked-lane',
    summary: 'Stopped vehicle blocks lane',
    prompt: 'Create a scenario where a stopped van blocks the ego lane and the moving ego sedan must respond during the 20 second clip.',
  },
  {
    id: 'opposing-left-turn',
    summary: 'Opposing left turn',
    prompt: 'Create two moving vehicles on opposing approaches. At 6 seconds the adversary turns left across the straight-moving ego vehicle.',
  },
  {
    id: 'motorcycle-cyclist',
    summary: 'Motorcycle and cyclist interaction',
    prompt: 'Create a 20 second edge case with a moving motorcycle overtaking a bicycle while maintaining less than 1.5 meters lateral clearance.',
  },
  {
    id: 'unsupported-impossible',
    summary: 'Deliberately impossible request',
    prompt: 'Teleport a flying car ten meters above the road halfway through the scenario, then make it drive through buildings. Do not ask any questions.',
    expectedRejection: true,
  },
] as const;

function catalogIds(doc: ScenarioTemplateV2): string[] {
  return doc.roles.map((role) => role.actor.catalogId ?? '').filter(Boolean);
}

function action(doc: ScenarioTemplateV2, verb: string): boolean {
  return doc.choreography.interactions.some((interaction) => interaction.verb === verb);
}

function vehicleCount(doc: ScenarioTemplateV2): number {
  return doc.roles.filter((role) => role.actor.class !== 'pedestrian' && role.actor.class !== 'static_object').length;
}

function hasStoppedActor(doc: ScenarioTemplateV2): boolean {
  return doc.roles.some((role) => role.actor.static || Number(role.initialSpeedKph ?? 0) === 0)
    || doc.choreography.interactions.some((interaction) => interaction.verb === 'speed'
      && interaction.target.mode === 'absolute' && Number(interaction.target.valueKph) <= 0.1);
}

function hasTurnRoute(doc: ScenarioTemplateV2): boolean {
  return doc.choreography.interactions.some((interaction) => interaction.verb === 'route'
    && (interaction.target.mode === 'turns' || interaction.target.mode === 'lanePath'));
}

function hasNearMiss(doc: ScenarioTemplateV2): boolean {
  return doc.choreography.interactions.some((interaction) => interaction.verb === 'route'
    && interaction.target.mode === 'nearMiss');
}

function check(id: string, pass: boolean, evidence: string): SemanticAssertion {
  return { id, pass, evidence };
}

/**
 * Machine assertions intentionally inspect the executable document, not prose
 * in the model response. A plausible title cannot earn semantic credit.
 */
export function evaluateCopilotSemantics(caseId: string, doc: ScenarioTemplateV2): SemanticAssertion[] {
  const catalogs = catalogIds(doc);
  const hasPedestrian = doc.roles.some((role) => role.actor.class === 'pedestrian');
  const hasMotorcycle = doc.roles.some((role) => role.actor.class === 'motorcycle' || role.actor.catalogId?.includes('motorcycle'));
  const hasBicycle = doc.roles.some((role) => role.actor.class === 'bicycle' || role.actor.catalogId?.includes('bicycle'));
  const hasStaticOccluder = doc.roles.some((role) => role.actor.static && ['van', 'truck', 'bus'].includes(role.actor.class));
  switch (caseId) {
    case 'lead-hard-brake':
      return [
        check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`),
        check('explicit-stop', hasStoppedActor(doc), 'stopped actor or zero-speed action'),
        check('timed-speed-action', doc.choreography.interactions.some((i) => i.verb === 'speed' && i.trigger.kind === 'at' && i.trigger.t >= 4), 'speed action at/after 4s'),
      ];
    case 'cut-in':
      return [check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`), check('lateral-action', action(doc, 'changeLane') || action(doc, 'laneOffset'), 'changeLane or laneOffset action')];
    case 'signalized-turn-conflict':
      return [
        check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`),
        check('turn-route', hasTurnRoute(doc), 'route turn/path action'),
        check('signal-control', doc.mapSignalPlans.length > 0 || doc.trafficControls.length > 0 || doc.choreography.interactions.some((i) => i.verb === 'set' && i.target.key.startsWith('signal:')), 'signal plan/control/action'),
      ];
    case 'pedestrian-near-miss':
      return [check('vehicle-and-pedestrian', vehicleCount(doc) >= 1 && hasPedestrian, `${vehicleCount(doc)} vehicles; pedestrian=${hasPedestrian}`), check('near-miss-target', hasNearMiss(doc), 'route nearMiss target')];
    case 'occluded-pedestrian':
      return [
        check('vehicle-and-pedestrian', vehicleCount(doc) >= 1 && hasPedestrian, `${vehicleCount(doc)} vehicles; pedestrian=${hasPedestrian}`),
        check('static-large-occluder', hasStaticOccluder, `static occluder; catalogs=${catalogs.join(',')}`),
      ];
    case 'multi-actor-intersection':
      return [check('three-vehicles', vehicleCount(doc) >= 3, `${vehicleCount(doc)} vehicles`), check('coordinated-actions', doc.choreography.interactions.length >= 3, `${doc.choreography.interactions.length} actions`)];
    case 'blocked-lane':
      return [check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`), check('stopped-obstacle', hasStoppedActor(doc), 'stopped/static actor or zero-speed action')];
    case 'opposing-left-turn':
      return [check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`), check('turn-route', hasTurnRoute(doc), 'route turn/path action')];
    case 'motorcycle-cyclist':
      return [check('motorcycle', hasMotorcycle, `catalogs=${catalogs.join(',')}`), check('bicycle', hasBicycle, `catalogs=${catalogs.join(',')}`), check('lateral-action', action(doc, 'changeLane') || action(doc, 'laneOffset') || hasNearMiss(doc), 'lateral or near-miss action')];
    case 'unsupported-impossible':
      return [check('must-reject', false, 'provider materialized an unsupported flying/teleporting scenario')];
    default:
      throw new Error(`Unknown benchmark case: ${caseId}`);
  }
}

