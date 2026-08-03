import type { CameraPresentation } from './model';

export interface CameraCompanionMetadata {
  schema: 'uniscenarios-camera-companion/1';
  scenarioInputHash?: string;
  presentation: CameraPresentation;
  notice: string;
}

/**
 * Sidecar seam for downstream renderers. This does not imply portable camera
 * support in OpenSCENARIO XML/DSL and must not be folded into simulation input.
 */
export function createCameraCompanion(
  presentation: CameraPresentation,
  scenarioInputHash?: string,
): CameraCompanionMetadata {
  return {
    schema: 'uniscenarios-camera-companion/1',
    ...(scenarioInputHash ? { scenarioInputHash } : {}),
    presentation,
    notice: 'Presentation metadata only; not a native ASAM OpenSCENARIO camera declaration.',
  };
}

