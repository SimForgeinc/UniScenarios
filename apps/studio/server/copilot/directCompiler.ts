import { getEntry, isCatalogId } from '@uniscenarios/prop-catalog';
import { parseTemplate, validateTemplate, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { DirectMapContextSchema, DirectNativeDraftSchema, type DirectMapContext, type DirectNativeDraft } from './directTypes.js';

function actorClass(catalogId: string): 'car' | 'truck' | 'bus' | 'van' | 'motorcycle' | 'bicycle' | 'scooter' | 'pedestrian' | 'static_object' {
  if (catalogId === 'vehicle.bus' || catalogId === 'vehicle.tram') return 'bus';
  if (catalogId === 'vehicle.van' || catalogId === 'vehicle.ambulance') return 'van';
  if (['vehicle.pickup', 'vehicle.box_truck', 'vehicle.semi_truck'].includes(catalogId)) return 'truck';
  if (catalogId === 'vehicle.motorcycle') return 'motorcycle';
  if (catalogId === 'vehicle.bicycle') return 'bicycle';
  if (catalogId === 'vehicle.mobility_scooter' || catalogId === 'street.shopping_cart') return 'scooter';
  const entry = getEntry(catalogId as never);
  if (entry.class === 'pedestrian') return 'pedestrian';
  if (entry.class !== 'vehicle') return 'static_object';
  return 'car';
}

function expectedSlotKind(catalogId: string): 'vehicle' | 'pedestrian' | 'prop' {
  const cls = actorClass(catalogId);
  return cls === 'pedestrian' ? 'pedestrian' : cls === 'static_object' ? 'prop' : 'vehicle';
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`);
}

/**
 * The model selects only immutable map-owned slot ids. Coordinates, lane
 * anchors, routes and catalog dimensions are copied from trusted server input.
 */
export function compileDirectDraft(rawDraft: unknown, rawMapContext: unknown, now = new Date()): ScenarioTemplateV2 {
  const draft = DirectNativeDraftSchema.parse(rawDraft);
  const map = DirectMapContextSchema.parse(rawMapContext);
  const slots = new Map(map.placementSlots.map((slot) => [slot.id, slot]));
  assertUnique(draft.actors.map((actor) => actor.id), 'actor ids');
  assertUnique(draft.actors.map((actor) => actor.slotId), 'actor placement slots');
  assertUnique(draft.actions.map((action) => action.id), 'action ids');

  for (const actor of draft.actors) {
    if (!isCatalogId(actor.catalogId)) throw new Error(`actor ${actor.id} uses unknown catalog id ${actor.catalogId}`);
    const slot = slots.get(actor.slotId);
    if (!slot) throw new Error(`actor ${actor.id} references unknown placement slot ${actor.slotId}`);
    if (slot.catalogIds && !slot.catalogIds.includes(actor.catalogId)) {
      throw new Error(`catalog id ${actor.catalogId} is not permitted in placement slot ${actor.slotId}`);
    }
    const kind = expectedSlotKind(actor.catalogId);
    if (!slot.actorKinds.includes(kind)) throw new Error(`${kind} actor ${actor.id} cannot use ${actor.slotId}`);
    if (kind === 'vehicle' && (!slot.laneRef || !slot.routeLaneRsls?.length)) {
      throw new Error(`vehicle placement slot ${actor.slotId} lacks a snapped lane route`);
    }
  }

  const actorIds = new Set(draft.actors.map((actor) => actor.id));
  const durationS = 20;
  for (const action of draft.actions) {
    if (!actorIds.has(action.actorId)) throw new Error(`action ${action.id} references unknown actor ${action.actorId}`);
    if (action.startS + action.durationS > durationS + 1e-6) throw new Error(`action ${action.id} ends after the scenario`);
    if (action.kind === 'speed' && (action.value < 0 || action.value > 160)) throw new Error(`action ${action.id} speed is outside 0–160 kph`);
    if (action.kind === 'changeLane' && ![-1, 1].includes(action.value)) throw new Error(`action ${action.id} lane delta must be -1 or 1`);
    if (action.kind === 'laneOffset' && (action.value < -1 || action.value > 1)) throw new Error(`action ${action.id} lane offset must be within -1..1`);
  }

  const timestamp = now.toISOString();
  const template = parseTemplate({
    scenarioVersion: 2,
    meta: {
      name: draft.title,
      description: draft.description,
      createdAt: timestamp,
      modifiedAt: timestamp,
      appVersion: '0.1.0-editor',
      author: 'Scenario Copilot · Direct LLM',
      tags: ['generated', 'direct-llm'],
    },
    sourceMap: { mapId: map.mapId, mapName: map.mapName },
    anchor: { features: [], pin: { mapId: map.mapId } },
    roles: draft.actors.map((actor) => {
      const slot = slots.get(actor.slotId)!;
      const entry = getEntry(actor.catalogId as never);
      return {
        id: actor.id,
        kind: 'scene_absolute' as const,
        label: actor.label,
        actor: {
          class: actorClass(actor.catalogId),
          catalogId: actor.catalogId,
          dims: { length: entry.dims.l, width: entry.dims.w, height: entry.dims.h },
          static: expectedSlotKind(actor.catalogId) === 'prop',
          sensors: [],
        },
        pose: { position: { x: slot.pose.x, y: slot.pose.y, z: slot.pose.z }, headingRad: slot.pose.headingRad },
        ...(slot.laneRef ? { laneRef: slot.laneRef } : {}),
        ...(slot.routeLaneRsls ? { initialRoute: { mode: 'lanePath' as const, lanes: slot.routeLaneRsls } } : {}),
        initialSpeedKph: expectedSlotKind(actor.catalogId) === 'prop' ? 0 : Math.min(actor.initialSpeedKph, slot.recommendedSpeedKph ?? actor.initialSpeedKph),
        essentiality: 'required' as const,
        extensions: { 'studio.copilot.placementSlotId': slot.id },
      };
    }),
    props: [],
    trafficControls: [],
    mapSignalPlans: [],
    choreography: {
      clipSeconds: durationS,
      warmupSeconds: 1,
      interactions: draft.actions.map((action) => ({
        id: action.id,
        actor: action.actorId,
        trigger: { kind: 'at' as const, t: action.startS },
        until: { kind: 'at' as const, t: action.startS + action.durationS },
        label: action.label,
        ...(action.kind === 'speed' ? {
          verb: 'speed' as const,
          target: action.value === 0 ? { mode: 'stop' as const } : { mode: 'absolute' as const, valueKph: action.value },
          dynamics: { shape: 'linear' as const, constraint: 'time' as const, value: action.durationS },
        } : action.kind === 'changeLane' ? {
          verb: 'changeLane' as const,
          target: { mode: 'relative' as const, dk: action.value },
          dynamics: { shape: 'sinusoidal' as const, constraint: 'time' as const, value: action.durationS },
          maneuverDurationS: action.durationS,
          maneuverStyle: 'normal' as const,
        } : {
          verb: 'laneOffset' as const,
          target: { tFrac: action.value, reference: 'lane_center' as const },
          dynamics: { shape: 'sinusoidal' as const, constraint: 'time' as const, value: action.durationS },
          maneuverDurationS: action.durationS,
          maneuverStyle: 'normal' as const,
        }),
      })),
    },
    invariants: [],
    variants: [],
    metricSubject: draft.actors.find((actor) => expectedSlotKind(actor.catalogId) === 'vehicle')?.id ?? draft.actors[0]!.id,
    extensions: {
      'studio.copilot.provider': 'direct-llm',
      'studio.copilot.reasoningSummary': draft.reasoningSummary,
    },
  });
  const report = validateTemplate(template);
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  return template;
}

export function directDraftRepairFeedback(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `The draft was rejected by deterministic native validation. Repair it once. Keep the same map slot ids and return only schema-valid JSON. Errors: ${message.slice(0, 4000)}`;
}

export type { DirectMapContext, DirectNativeDraft };
