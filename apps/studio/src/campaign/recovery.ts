import { contentHash } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

/**
 * Identity of the fields that determine concrete motion and placement.
 * Sensors, display labels, catalog appearance and Studio presentation metadata
 * are deliberately excluded: they can be overlaid on the same verified trace.
 */
export function simulationSourceHash(template: ScenarioTemplateV2): string {
  return contentHash({
    roles: template.roles.map((role) => {
      const { label: _label, extensions: _extensions, actor, ...binding } = role;
      const { catalogId: _catalogId, sensors: _sensors, ...behaviorActor } = actor;
      return { ...binding, actor: behaviorActor };
    }),
    props: template.props,
    choreography: template.choreography,
  });
}

export function sameRoleIdentity(left: ScenarioTemplateV2, right: ScenarioTemplateV2): boolean {
  const ids = (template: ScenarioTemplateV2) => template.roles.map((role) => role.id).sort();
  return JSON.stringify(ids(left)) === JSON.stringify(ids(right));
}
