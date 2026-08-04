import { TemplateDocument, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

export type GroundHeightSampler = (x: number, z: number) => number | null;

/**
 * Reconcile scene-absolute authoring poses with the rendered road surface.
 *
 * Height is presentation-only in the canonical 2D simulation. Keeping this
 * normalization at the authoring boundary fixes legacy generated drafts while
 * preserving every simulation-relevant field verbatim.
 */
export function groundEditableActors(
  template: ScenarioTemplateV2,
  sampleHeight: GroundHeightSampler | null,
): ScenarioTemplateV2 {
  if (!sampleHeight) return template;
  return TemplateDocument.fromJSON({
    ...template,
    roles: template.roles.map((role) => role.kind !== 'scene_absolute' ? role : ({
      ...role,
      pose: {
        ...role.pose,
        position: {
          ...role.pose.position,
          y: sampleHeight(role.pose.position.x, role.pose.position.z) ?? role.pose.position.y,
        },
      },
    })),
  }).data;
}
