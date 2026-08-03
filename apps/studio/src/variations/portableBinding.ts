import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { SimActor, SimScenarioInput } from '@uniscenarios/sim-engine';
import type { VariationCandidateResult } from './model';

export const ACCEPTED_BINDING_CONTRACT = 'studio.accepted-variation-binding.v1';

/**
 * Converts the exact materialized target binding into an editable, map-bound
 * v2 project. It fails closed if any authored role disappeared.
 */
export function bindAcceptedVariation(
  source: ScenarioTemplateV2,
  result: VariationCandidateResult,
  mapLabel: string,
): ScenarioTemplateV2 {
  const input = result.instance?.input;
  if (!input) throw new Error('Candidate has no validated materialized instance');
  const byId = new Map(input.actors.map((actor) => [actor.id, actor]));
  const missing = source.roles.filter((role) => role.essentiality === 'required' && !byId.has(role.id));
  if (missing.length) throw new Error(`Required roles were not materialized: ${missing.map((role) => role.id).join(', ')}`);
  const roles: ScenarioTemplateV2['roles'][number][] = source.roles.flatMap((role) => {
    const actor = byId.get(role.id);
    return actor ? [toAbsoluteRole(role, actor)] : [];
  });
  for (const prop of input.props) {
    roles.push({
      id: prop.id,
      kind: 'scene_absolute',
      actor: {
        class: 'static_object',
        catalogId: prop.catalogId,
        dims: { length: prop.dims.l * prop.scale, width: prop.dims.w * prop.scale, height: prop.dims.h * prop.scale },
        static: true,
        sensors: [],
      },
      pose: { position: { x: prop.pose.x, y: 0, z: prop.pose.z }, headingRad: prop.pose.headingRad },
      initialSpeedKph: 0,
      essentiality: prop.essentiality,
      ...(prop.occludes ? { extensions: { occludes: prop.occludes } } : {}),
    });
  }
  const now = new Date().toISOString();
  return {
    ...source,
    meta: {
      ...source.meta,
      name: `${source.meta.name} · ${mapLabel}`,
      modifiedAt: now,
    },
    sourceMap: { mapId: result.candidate.mapId, mapName: mapLabel },
    anchor: {
      features: [],
      pin: { mapId: result.candidate.mapId },
      policy: source.anchor.policy,
    },
    roles,
    props: [],
    extensions: {
      ...(source.extensions ?? {}),
      'studio.variation.binding': {
        contractVersion: ACCEPTED_BINDING_CONTRACT,
        sourcePatternId: result.candidate.site.anchorId,
        siteId: result.candidate.site.siteId,
        topologyDigest: result.candidate.site.topologyDigest,
        permutationKey: result.candidate.permutationKey,
        mirrored: result.candidate.site.frame.mirrored,
      },
    },
  };
}

function toAbsoluteRole(source: ScenarioTemplateV2['roles'][number], actor: SimActor): ScenarioTemplateV2['roles'][number] {
  const lane = actor.initial.laneRef ? parseRsl(actor.initial.laneRef.rsl) : null;
  return {
    id: source.id,
    kind: 'scene_absolute',
    actor: source.actor,
    pose: {
      position: { x: actor.initial.pose.x, y: 0, z: actor.initial.pose.z },
      headingRad: actor.initial.pose.headingRad,
    },
    ...(lane ? { laneRef: { ...lane, s: actor.initial.laneRef!.s, t: 0, headingOffsetRad: 0 } } : {}),
    initialSpeedKph: actor.initial.speedMps * 3.6,
    label: source.label,
    essentiality: source.essentiality,
    extensions: source.extensions,
  };
}

function parseRsl(rsl: string): { roadId: string; section: number; laneId: number } | null {
  const match = /^(.*):(-?\d+):(-?\d+)$/.exec(rsl);
  if (!match) return null;
  return { roadId: match[1]!, section: Number(match[2]), laneId: Number(match[3]) };
}

export function acceptedProjectInput(result: VariationCandidateResult): SimScenarioInput {
  if (!result.instance) throw new Error('Accepted candidate has no concrete input');
  return result.instance.input;
}
