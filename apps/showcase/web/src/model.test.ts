import { describe, expect, it } from 'vitest';
import { artifactKind, cells, stageList } from './model';

describe('showcase contract adapters', () => {
  it('merges object-shaped stage indexes with live SSE updates', () => {
    const result = stageList({ stages: { '00-brief': { status: 'complete' }, '10-route': { status: 'running' } } }, {
      '10': { stage: '10-route', status: 'complete', artifacts: [{ path: 'job/10-route.json' }] },
    });
    expect(result[0].status).toBe('complete');
    expect(result[1].status).toBe('complete');
    expect(result[1].artifacts).toHaveLength(1);
  });
  it('accepts keyed cells and detects media', () => {
    expect(cells({ cells: { alpha: { map: 'sf' } } })[0].cellId).toBe('alpha');
    expect(artifactKind({ path: 'rollout.mp4' })).toBe('video');
    expect(artifactKind({ path: 'frame.png' })).toBe('image');
  });
});
