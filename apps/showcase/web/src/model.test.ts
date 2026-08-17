import { describe, expect, it } from 'vitest';
import { artifactKind, cells, normalizeGallery, normalizeJob, scopeStageArtifacts, stageList, threeDVideos } from './model';

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
  it('adapts the real server file index into stages, cells, and scoped artifacts', () => {
    const job = normalizeJob({ jobId: 'abc', files: [
      { path: '00-brief.json', json: { brief: 'A real brief', engine: 'auto' } },
      { path: '10-route.json', json: { engine: 'compiler' } },
      { path: '40-cells/index.json', json: { cells: [{ cellId: 'cell-1', mapId: 'yale-street' }] } },
      { path: '50-gate.json', json: { cells: [{ cellId: 'cell-1', pass: true }] } },
      { path: '60-render2d/cell-1/rollout.mp4', size: 12 },
      { path: '70-judge.json', json: { cells: [{ cellId: 'cell-1', realism: 8, dynamism: 7 }] } },
    ] });
    expect(job.brief).toBe('A real brief');
    expect(job.engine).toBe('compiler');
    expect(cells(job)[0].gate).toMatchObject({ pass: true });
    expect(cells(job)[0].artifacts?.[0].path).toBe('jobs/abc/60-render2d/cell-1/rollout.mp4');
  });
  it('selects one preferred 3D rollout video per rendered cell', () => {
    const job = normalizeJob({ jobId: 'abc', files: [
      { path: '40-cells/index.json', json: { cells: [{ cellId: 'cell-1', mapId: 'el-camino-road' }, { cellId: 'cell-2', mapId: 'yale-street' }] } },
      { path: '65-render3d/cell-1/frame.png', size: 12 },
      { path: '65-render3d/cell-1/video.mp4', size: 13 },
      { path: '65-render3d/cell-1/rollout.mp4', size: 14 },
      { path: '60-render2d/cell-2/rollout.mp4', size: 15 },
      { path: '70-judge.json', json: { cells: [{ cellId: 'cell-1', productAccepted: true }] } },
      { path: '90-gallery.json', json: { accepted: true } },
    ] });
    const videos = threeDVideos(job);
    expect(videos[0].cell.cellId).toBe('cell-1');
    expect(videos[0].artifact.path).toBe('jobs/abc/65-render3d/cell-1/rollout.mp4');
    expect(threeDVideos({ ...job, status: 'running' })).toHaveLength(0);
    expect(threeDVideos({ ...job, cells: [{ ...cells(job)[0], judge: { productAccepted: false } }] })).toHaveLength(0);
  });
  it('normalizes nested gallery metrics and SSE paths from the real server', () => {
    const [card] = normalizeGallery([{ jobId: 'abc', headline: '/artifacts/jobs/abc/movie.mp4', gate: { passed: 2, cells: 3 }, scores: { realism: 8.2, dynamism: 7.4 } }]);
    expect(card).toMatchObject({ media: '/artifacts/jobs/abc/movie.mp4', admittedCells: 2, totalCells: 3, realism: 8.2, dynamism: 7.4 });
    expect(scopeStageArtifacts('abc', { stage: '20-author', status: 'complete', artifacts: [{ path: '20-author/template.json' }] }).artifacts?.[0].path).toBe('jobs/abc/20-author/template.json');
  });
});
