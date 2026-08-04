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
  {
    id: 'pedestrian-distance-trigger',
    summary: 'Pedestrian starts from vehicle distance',
    prompt: 'Create an ego sedan and a stopped adult pedestrian. The pedestrian must start walking only when the ego is within 12 meters, using a relative distance trigger rather than a fixed time.',
  },
  {
    id: 'pedestrian-ttc-trigger',
    summary: 'Pedestrian starts from TTC',
    prompt: 'Create an ego sedan approaching a stopped pedestrian. Start the pedestrian crossing when time-to-collision with the ego falls below 3 seconds, with a deadline inside the 20 second scenario.',
  },
  {
    id: 'child-between-parked-vehicles',
    summary: 'Child occluded by two parked vehicles',
    prompt: 'Create an occluded-child scenario with a moving ego sedan, two distinct parked vans, and a child pedestrian emerging between the parked vehicles toward the ego path.',
  },
  {
    id: 'synchronized-near-miss',
    summary: 'Synchronized conflict-point near miss',
    prompt: 'Create a vehicle and pedestrian conflict synchronized with a relative trigger so they pass the same conflict area as a near miss, with 0.7 meter target clearance and no collision.',
  },
  {
    id: 'emergency-yield-response',
    summary: 'Distance-triggered emergency yield',
    prompt: 'Create an approaching emergency vehicle and an ego sedan. When the emergency vehicle comes within 25 meters, the ego must yield by slowing to 5 km/h or stopping using a relative distance trigger.',
  },
  {
    id: 'signal-delayed-turn',
    summary: 'Signal phase delayed turn',
    prompt: 'At a signalized intersection, keep an adversary waiting and begin its turn only after 8 seconds when its signal permits, while the ego travels straight through the intersection.',
  },
  {
    id: 'merge-rear-gap',
    summary: 'Merge after rear-gap acceptance',
    prompt: 'Create two moving vehicles in adjacent lanes. The lead vehicle must merge only after a relative distance condition confirms at least a safe rear gap, then complete one lane change.',
  },
  {
    id: 'bus-occluded-cyclist',
    summary: 'Cyclist occluded by stopped bus',
    prompt: 'Create a moving ego sedan, a stopped bus as a large occluder, and a bicycle emerging from behind the bus into a close lateral interaction with the ego.',
  },
  {
    id: 'lane-change-then-brake',
    summary: 'Sequential lane change then brake',
    prompt: 'Create two moving cars. The adversary must first change into the ego lane, finish that maneuver, and only afterward brake to a complete stop before 15 seconds.',
  },
  {
    id: 'contradictory-constraints',
    summary: 'Contradictory physical constraints',
    prompt: 'Make the same ego sedan and pedestrian collide at 10 seconds while also guaranteeing that they always remain at least 10 meters apart. Both constraints are mandatory; reject the request if they cannot both be true.',
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

function whenCondition(doc: ScenarioTemplateV2, kind: 'distance' | 'ttc') {
  return doc.choreography.interactions.filter((interaction) => interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === kind);
}

function actorByCatalog(doc: ScenarioTemplateV2, fragment: string): string[] {
  return doc.roles.filter((role) => role.actor.catalogId?.includes(fragment) || role.actor.class.includes(fragment)).map((role) => role.id);
}

function actorActions(doc: ScenarioTemplateV2, actorIds: readonly string[]) {
  const ids = new Set(actorIds);
  return doc.choreography.interactions.filter((interaction) => ids.has(interaction.actor));
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
    case 'pedestrian-distance-trigger': {
      const pedestrianIds = doc.roles.filter((role) => role.actor.class === 'pedestrian').map((role) => role.id);
      const relative = actorActions(doc, pedestrianIds).filter((interaction) => interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'distance');
      return [
        check('vehicle-and-pedestrian', vehicleCount(doc) >= 1 && pedestrianIds.length >= 1, `${vehicleCount(doc)} vehicles; ${pedestrianIds.length} pedestrians`),
        check('pedestrian-distance-start', relative.some((interaction) => interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'distance' && interaction.trigger.condition.valueM <= 12), `${relative.length} pedestrian distance-triggered actions`),
      ];
    }
    case 'pedestrian-ttc-trigger': {
      const pedestrianIds = doc.roles.filter((role) => role.actor.class === 'pedestrian').map((role) => role.id);
      const relative = actorActions(doc, pedestrianIds).filter((interaction) => interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'ttc');
      return [
        check('vehicle-and-pedestrian', vehicleCount(doc) >= 1 && pedestrianIds.length >= 1, `${vehicleCount(doc)} vehicles; ${pedestrianIds.length} pedestrians`),
        check('pedestrian-ttc-start', relative.some((interaction) => interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'ttc' && interaction.trigger.condition.valueS <= 3), `${relative.length} pedestrian TTC-triggered actions`),
      ];
    }
    case 'child-between-parked-vehicles': {
      const child = actorByCatalog(doc, 'child');
      const parkedLarge = doc.roles.filter((role) => role.actor.static && ['van', 'truck', 'bus'].includes(role.actor.class));
      return [
        check('moving-vehicle-and-child', vehicleCount(doc) >= 1 && child.length >= 1, `${vehicleCount(doc)} vehicles; child=${child.length}`),
        check('two-parked-occluders', parkedLarge.length >= 2, `${parkedLarge.length} parked large actors`),
        check('child-movement', actorActions(doc, child).length >= 1, `${actorActions(doc, child).length} child actions`),
      ];
    }
    case 'synchronized-near-miss': {
      const nearMiss = doc.choreography.interactions.filter((interaction) => interaction.verb === 'route' && interaction.target.mode === 'nearMiss');
      return [
        check('vehicle-and-pedestrian', vehicleCount(doc) >= 1 && hasPedestrian, `${vehicleCount(doc)} vehicles; pedestrian=${hasPedestrian}`),
        check('near-miss-clearance', nearMiss.some((interaction) => interaction.target.mode === 'nearMiss' && interaction.target.clearanceM <= .7), `${nearMiss.length} near-miss actions`),
        check('relative-synchronization', nearMiss.some((interaction) => interaction.trigger.kind === 'when'), 'near-miss uses a relative trigger'),
      ];
    }
    case 'emergency-yield-response': {
      const emergency = actorByCatalog(doc, 'ambulance');
      const yieldActions = doc.choreography.interactions.filter((interaction) => interaction.verb === 'speed'
        && interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'distance'
        && (interaction.target.mode === 'stop' || (interaction.target.mode === 'absolute' && interaction.target.valueKph <= 5)));
      return [check('emergency-actor', emergency.length >= 1, `emergency actors=${emergency.length}`), check('relative-yield', yieldActions.length >= 1, `${yieldActions.length} relative yield actions`)];
    }
    case 'signal-delayed-turn': {
      const delayed = doc.choreography.interactions.some((interaction) => interaction.verb === 'route' && interaction.trigger.kind === 'at' && interaction.trigger.t >= 8);
      return [
        check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`),
        check('delayed-turn', hasTurnRoute(doc) && delayed, `turn=${hasTurnRoute(doc)}; delayed=${delayed}`),
        check('signal-control', doc.mapSignalPlans.length > 0 || doc.trafficControls.length > 0, `${doc.mapSignalPlans.length} plans; ${doc.trafficControls.length} controls`),
      ];
    }
    case 'merge-rear-gap': {
      const lateral = doc.choreography.interactions.filter((interaction) => (interaction.verb === 'changeLane' || interaction.verb === 'laneOffset') && interaction.trigger.kind === 'when' && interaction.trigger.condition.kind === 'distance');
      return [check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`), check('distance-gated-merge', lateral.length >= 1, `${lateral.length} distance-gated lateral actions`)];
    }
    case 'bus-occluded-cyclist': {
      const staticBus = doc.roles.some((role) => role.actor.class === 'bus' && role.actor.static);
      return [
        check('ego-and-bicycle', vehicleCount(doc) >= 1 && hasBicycle, `${vehicleCount(doc)} vehicles; bicycle=${hasBicycle}`),
        check('stopped-bus', staticBus, `stopped bus=${staticBus}`),
        check('cyclist-lateral-interaction', action(doc, 'changeLane') || action(doc, 'laneOffset') || hasNearMiss(doc), 'lateral or near-miss action'),
      ];
    }
    case 'lane-change-then-brake': {
      const byActor = new Map<string, typeof doc.choreography.interactions>();
      for (const interaction of doc.choreography.interactions) byActor.set(interaction.actor, [...(byActor.get(interaction.actor) ?? []), interaction]);
      const sequential = [...byActor.values()].some((interactions) => {
        const lane = interactions.find((interaction) => interaction.verb === 'changeLane');
        const brake = interactions.find((interaction) => interaction.verb === 'speed' && (interaction.target.mode === 'stop' || (interaction.target.mode === 'absolute' && interaction.target.valueKph <= .1)));
        if (!lane || !brake || lane.trigger.kind !== 'at' || brake.trigger.kind !== 'at') return false;
        const laneEnd = lane.until?.kind === 'at' ? lane.until.t : lane.trigger.t;
        return brake.trigger.t >= laneEnd && brake.trigger.t <= 15;
      });
      return [check('two-vehicles', vehicleCount(doc) >= 2, `${vehicleCount(doc)} vehicles`), check('same-actor-sequence', sequential, 'lane change completes before same actor stops')];
    }
    case 'contradictory-constraints':
      return [check('must-reject-contradiction', false, 'provider materialized mutually contradictory collision and separation requirements')];
    default:
      throw new Error(`Unknown benchmark case: ${caseId}`);
  }
}
