import { createHash, randomUUID } from 'node:crypto';
import { getEntry } from '@uniscenarios/prop-catalog';
import { TemplateDocument, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type {
  CopilotCandidate,
  CopilotDiagnostic,
  CopilotGenerationRequest,
  CopilotIntent,
  CopilotIntentActor,
  CopilotPlacementSlot,
  CopilotProvenance,
} from '../../src/copilot/types.js';

const CATALOG_ALLOWLIST = new Set([
  'vehicle.sedan', 'vehicle.pickup', 'vehicle.van', 'vehicle.motorcycle', 'vehicle.bicycle',
  'vehicle.bus', 'pedestrian.adult_walking', 'pedestrian.child_walking', 'pedestrian.adult_standing',
]);

export function promptHash(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

export function normalizeIntent(intent: CopilotIntent): CopilotIntent {
  const seen = new Set<string>();
  const normalizeActor = (actor: CopilotIntentActor, fallbackId: string): CopilotIntentActor => {
    let id = safeId(actor.id || fallbackId);
    while (seen.has(id)) id = `${id}-${seen.size + 1}`;
    seen.add(id);
    const catalogId = CATALOG_ALLOWLIST.has(actor.catalogId) ? actor.catalogId : catalogFor(actor.kind, actor.role);
    return {
      id,
      role: actor.role,
      kind: actor.kind === 'prop' ? 'prop' : actor.kind === 'pedestrian' ? 'pedestrian' : 'vehicle',
      catalogId,
      behavior: actor.behavior.slice(0, 240),
      ...(actor.initialSpeedKph === undefined ? {} : { initialSpeedKph: Math.max(0, Math.min(80, actor.initialSpeedKph)) }),
    };
  };
  return {
    scenario: intent.scenario.slice(0, 600),
    ego: normalizeActor({ ...intent.ego, role: 'ego' }, 'ego'),
    adversaries: intent.adversaries.slice(0, 6).map((actor, index) => normalizeActor({ ...actor, role: 'adversary' }, `adversary-${index + 1}`)),
    contextActors: intent.contextActors.slice(0, 6).map((actor, index) => normalizeActor({ ...actor, role: 'context' }, `context-${index + 1}`)),
    spatialRelations: intent.spatialRelations.slice(0, 12).map((item) => item.slice(0, 240)),
    restrictions: intent.restrictions.slice(0, 12).map((item) => item.slice(0, 240)),
    desiredOutcome: intent.desiredOutcome.slice(0, 300),
    assumptions: intent.assumptions.slice(0, 12).map((item) => item.slice(0, 240)),
  };
}

export function heuristicIntent(prompt: string): CopilotIntent {
  const lower = prompt.toLowerCase();
  const pedestrian = /pedestrian|walker|child|person|crosswalk/.test(lower);
  const motorcycle = /motorcycle|motorbike/.test(lower);
  const bicycle = /bicycle|cyclist|bike/.test(lower);
  const occlusion = /occlu|hidden|behind|blocked view/.test(lower);
  const nearMiss = /near miss|avoid|almost hit/.test(lower);
  const adversaryCatalog = pedestrian ? (/child/.test(lower) ? 'pedestrian.child_walking' : 'pedestrian.adult_walking')
    : motorcycle ? 'vehicle.motorcycle' : bicycle ? 'vehicle.bicycle' : 'vehicle.pickup';
  return {
    scenario: prompt.trim().slice(0, 600) || 'A vehicle interaction on the current map.',
    ego: { id: 'ego', role: 'ego', kind: 'vehicle', catalogId: 'vehicle.sedan', behavior: 'Proceed along the bound lane and respond to the adversary.', initialSpeedKph: 28 },
    adversaries: [{
      id: pedestrian ? 'pedestrian-1' : 'challenger',
      role: 'adversary',
      kind: pedestrian ? 'pedestrian' : 'vehicle',
      catalogId: adversaryCatalog,
      behavior: pedestrian ? 'Begin moving after four seconds into the ego path.' : 'Proceed on its bound route toward the interaction.',
      initialSpeedKph: pedestrian ? 0 : 22,
    }],
    contextActors: occlusion ? [{ id: 'occluder', role: 'context', kind: 'vehicle', catalogId: 'vehicle.van', behavior: 'Remain stopped as a visual occluder.', initialSpeedKph: 0 }] : [],
    spatialRelations: [pedestrian ? 'Adversary begins ahead of the ego on a compatible current-map lane.' : 'Ego and challenger occupy distinct compatible current-map placements.'],
    restrictions: ['Use only the current map and known catalog actors.', 'Keep all generated values inside the native typed scenario schema.'],
    desiredOutcome: nearMiss ? 'A close interaction without a collision.' : 'A temporally coordinated interaction suitable for native simulation.',
    assumptions: ['The current map topology is authoritative.', 'Generated actors use deterministic lane-bound placement slots.'],
  };
}

export function compileNativeCandidate(
  request: CopilotGenerationRequest,
  rawIntent: CopilotIntent,
  provenance: CopilotProvenance,
  ordinal = 0,
): CopilotCandidate {
  const intent = normalizeIntent(rawIntent);
  const actors = [intent.ego, ...intent.adversaries, ...intent.contextActors].slice(0, 12);
  const slots = assignSlots(request.mapContext.placementSlots, actors.length, ordinal);
  const now = new Date().toISOString();
  const roles = actors.map((actor, index) => {
    const slot = slots[index]!;
    const entry = getEntry(actor.catalogId as Parameters<typeof getEntry>[0]);
    const actorClass = actor.kind === 'pedestrian' ? 'pedestrian'
      : actor.catalogId.includes('motorcycle') ? 'motorcycle'
        : actor.catalogId.includes('bicycle') ? 'bicycle'
          : actor.catalogId.includes('bus') ? 'bus'
            : actor.catalogId.includes('van') ? 'van' : actor.catalogId.includes('pickup') ? 'truck' : 'car';
    const requestedSpeed = actor.initialSpeedKph ?? slot.recommendedSpeedKph ?? 25;
    const runwaySpeed = slot.availableDownstreamM === undefined ? requestedSpeed : Math.max(1, ((slot.availableDownstreamM - 12) / 21) * 3.6);
    const speed = actor.role === 'context' ? 0 : Math.min(requestedSpeed, runwaySpeed);
    return {
      id: actor.id,
      kind: 'scene_absolute' as const,
      label: actor.role === 'ego' ? 'Ego vehicle' : actor.id.replaceAll('-', ' '),
      actor: {
        class: actorClass,
        catalogId: actor.catalogId,
        dims: { length: entry.dims.l, width: entry.dims.w, height: entry.dims.h },
        static: actor.role === 'context' && speed === 0,
        sensors: [],
      },
      pose: { position: { x: slot.pose.x, y: slot.pose.y, z: slot.pose.z }, headingRad: slot.pose.headingRad },
      laneRef: slot.laneRef,
      initialRoute: slot.routeLaneRsls?.length ? { mode: 'lanePath' as const, lanes: [...slot.routeLaneRsls] } : undefined,
      initialSpeedKph: speed,
      essentiality: actor.role === 'context' ? 'preferred' as const : 'required' as const,
      extensions: { 'scenarioCopilot.role': actor.role, 'scenarioCopilot.behavior': actor.behavior },
    };
  });
  const interactions = actors.flatMap((actor, index) => {
    if (actor.role === 'context') return [];
    const runwayBoundSpeed = Number(roles[index]?.initialSpeedKph ?? actor.initialSpeedKph ?? 20);
    const targetSpeed = actor.kind === 'pedestrian' ? Math.min(6, runwayBoundSpeed) : runwayBoundSpeed;
    return [{
      id: `${actor.id}-generated-speed`,
      actor: actor.id,
      verb: 'speed' as const,
      trigger: { kind: 'at' as const, t: actor.role === 'ego' ? 0 : 4 + index * 0.25 },
      target: { mode: 'absolute' as const, valueKph: targetSpeed },
      dynamics: { shape: 'linear' as const, constraint: 'time' as const, value: actor.kind === 'pedestrian' ? 0.5 : 1.5 },
      label: actor.behavior.slice(0, 200),
    }];
  });
  const raw = {
    scenarioVersion: 2,
    meta: {
      name: candidateTitle(intent, ordinal), description: intent.scenario, createdAt: now, modifiedAt: now,
      appVersion: 'uniscenarios/scenario-copilot-v1', tags: ['generated', 'scenario-copilot', provenance.provider],
      author: `Scenario Copilot (${provenance.model})`, negativeControl: false,
    },
    sourceMap: { mapId: request.mapContext.mapId, mapName: request.mapContext.mapName },
    params: { declarations: [], constraints: [] },
    environment: {},
    anchor: { id: `copilot-${safeId(request.mapContext.mapId)}`, features: [], pin: { mapId: request.mapContext.mapId }, policy: { allowMirror: false, maxSitesPerMap: 1, diversity: 'off', minScore: 0 } },
    roles,
    props: [], trafficControls: [], mapSignalPlans: [],
    choreography: { clipSeconds: 20, warmupSeconds: 1, interactions },
    invariants: [], variants: [], metricSubject: intent.ego.id,
    extensions: {
      'scenarioCopilot.provenance': provenance,
      'scenarioCopilot.intent': intent,
      'scenarioCopilot.currentMapLocked': true,
    },
  };
  const parsed: ScenarioTemplateV2 = TemplateDocument.fromJSON(raw).data;
  const diagnostics: CopilotDiagnostic[] = [
    { severity: 'info', code: 'map_locked', message: `Bound to ${request.mapContext.mapName}; generated coordinates were selected from known map slots.` },
    { severity: 'info', code: 'typed_ir', message: 'No generated Python or Scenic code was executed.' },
  ];
  return {
    id: randomUUID(), title: parsed.meta.name, summary: intent.desiredOutcome, intent, scenarioDoc: parsed, diagnostics, provenance,
  };
}

function assignSlots(slots: readonly CopilotPlacementSlot[], count: number, ordinal: number): CopilotPlacementSlot[] {
  if (slots.length < count) throw new Error(`The current map exposes ${slots.length} safe slots, but the intent needs ${count}.`);
  const start = ordinal % Math.max(1, slots.length - count + 1);
  const chosen: CopilotPlacementSlot[] = [];
  for (let i = 0; i < count; i++) chosen.push(slots[(start + i * 3) % slots.length]!);
  return chosen;
}

function safeId(value: string): string {
  const id = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return /^[a-z]/.test(id) ? id : `actor-${id || 'generated'}`;
}

function catalogFor(kind: CopilotIntentActor['kind'], role: CopilotIntentActor['role']): string {
  if (kind === 'pedestrian') return 'pedestrian.adult_walking';
  if (kind === 'prop') return 'vehicle.van';
  return role === 'ego' ? 'vehicle.sedan' : 'vehicle.pickup';
}

function candidateTitle(intent: CopilotIntent, ordinal: number): string {
  const seed = intent.scenario.split(/[.!?]/)[0]?.trim() || 'Generated scenario';
  return `${seed.slice(0, 70)}${ordinal > 0 ? ` · option ${ordinal + 1}` : ''}`;
}
