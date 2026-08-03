import { describe, expect, it } from 'vitest';
import { createCameraCompanion } from '../companion';
import { preferredAuthoredCamera, parseCameraPresentation } from '../model';

describe('camera presentation metadata', () => {
  it('parses valid views and drops corrupt presentation records safely', () => {
    const parsed = parseCameraPresentation({
      version: 99,
      policy: 'authored',
      activeCameraId: 'camera-1',
      cameras: [
        { id: 'camera-1', name: 'Signal', position: [1, 2, 3], target: [4, 5, 6], fov: 500,
          attachment: { kind: 'traffic-signal', id: 'signal-a', approach: 'north' } },
        { id: 'broken', name: 'Broken', position: [0], target: [0, 0, 0] },
      ],
    });
    expect(parsed.version).toBe(1);
    expect(parsed.policy).toBe('authored');
    expect(parsed.activeCameraId).toBe('camera-1');
    expect(parsed.cameras).toHaveLength(1);
    expect(parsed.cameras[0]?.fov).toBe(120);
    expect(parsed.cameras[0]?.attachment).toEqual({ kind: 'traffic-signal', id: 'signal-a', approach: 'north' });
  });

  it('labels camera export as companion metadata rather than ASAM support', () => {
    const presentation = parseCameraPresentation({ cameras: [], policy: 'free' });
    const companion = createCameraCompanion(presentation, 'input-hash');
    expect(companion.schema).toBe('uniscenarios-camera-companion/1');
    expect(companion.scenarioInputHash).toBe('input-hash');
    expect(companion.notice).toContain('not a native ASAM');
  });

  it('prefers the active authored camera without mutating template presentation state', () => {
    const extension = {
      version: 1,
      policy: 'authored',
      activeCameraId: 'signal-view',
      cameras: [
        { id: 'wide', name: 'Wide', position: [0, 20, 30], target: [0, 0, 0], fov: 55 },
        { id: 'signal-view', name: 'Traffic light', position: [4, 3, 8], target: [8, 1, 2], fov: 42, attachment: { kind: 'traffic-signal', id: 'signal-1' } },
      ],
    };
    const before = JSON.stringify(extension);
    expect(preferredAuthoredCamera({ extensions: { 'studio.presentation.cameras.v1': extension } } as never)).toEqual({
      position: [4, 3, 8], target: [8, 1, 2], fov: 42,
    });
    expect(JSON.stringify(extension)).toBe(before);
  });
});
