import { contentHash } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

/**
 * Identity of the complete authored execution input.
 * Provenance, display labels, catalog appearance, sensors, and extensions under
 * `studio.presentation.*` are deliberately excluded: they can be overlaid on
 * the same verified trace. Every other field consumed by matching,
 * materialization, or simulation belongs here.
 */
export function simulationSourceHash(template: ScenarioTemplateV2): string {
  return contentHash({
    meta: {
      archetype: template.meta.archetype,
      negativeControl: template.meta.negativeControl,
      // The materializer uses the name only as the anchor identity fallback.
      anchorNameFallback: template.anchor.id ? undefined : template.meta.name,
    },
    params: template.params,
    environment: template.environment,
    anchor: template.anchor,
    roles: template.roles.map((role) => {
      const { label: _label, extensions, actor, ...binding } = role;
      const { catalogId: _catalogId, sensors: _sensors, ...behaviorActor } = actor;
      return { ...binding, extensions: executionExtensions(extensions), actor: behaviorActor };
    }),
    props: template.props.map((prop) => {
      const { label: _label, extensions, ...placement } = prop;
      return { ...placement, extensions: executionExtensions(extensions) };
    }),
    trafficControls: (template.trafficControls ?? []).map((control) => {
      const { label: _label, ...executionControl } = control;
      return executionControl;
    }),
    mapSignalPlans: template.mapSignalPlans ?? [],
    choreography: template.choreography,
    metricSubject: template.metricSubject,
    extensions: executionExtensions(template.extensions),
  });
}

function executionExtensions(extensions?: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extensions ?? {}).filter(([key]) => !key.startsWith('studio.presentation.')),
  );
}

export function sameRoleIdentity(left: ScenarioTemplateV2, right: ScenarioTemplateV2): boolean {
  const ids = (template: ScenarioTemplateV2) => template.roles.map((role) => role.id).sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}
