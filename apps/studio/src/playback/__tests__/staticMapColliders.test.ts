import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractGlbColliders, loadStaticMapCollidersBounded } from '../staticMapColliders';

describe('static map collider extraction', () => {
  it('reads semantic buildings and fences from a real Yale map tile without decoding triangles', () => {
    const bytes = readFileSync(resolve(process.cwd(), '../../fixtures/yale-tile_0_0.lod3.glb'));
    const start = performance.now();
    const result = extractGlbColliders(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'yale-0-0');
    const elapsed = performance.now() - start;

    expect(result.colliders.filter((item) => item.class === 'building').length).toBeGreaterThanOrEqual(5);
    expect(result.colliders.filter((item) => item.class === 'wall').length).toBeGreaterThanOrEqual(2);
    expect(result.colliders.every((item) => item.id.startsWith('yale-0-0/'))).toBe(true);
    expect(result.colliders.every((item) => item.obb.lengthM > 0 && item.obb.widthM > 0)).toBe(true);
    // JSON-header extraction should stay far below one frame's worth of heavy
    // geometry work even though the fixture still contains its binary payload.
    expect(elapsed).toBeLessThan(50);
  });

  it('fails closed on data that is not a GLB v2 asset', () => {
    expect(() => extractGlbColliders(new ArrayBuffer(32), 'broken')).toThrow(/not GLB v2/);
  });

  it('fails open with explicit diagnostics when extraction exceeds its preview budget', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    try {
      const result = await loadStaticMapCollidersBounded('/never-resolves.json', {} as never, 5);
      expect(result.colliders).toEqual([]);
      expect(result.diagnostics).toMatchObject({
        status: 'unavailable',
        accepted: 0,
        warning: expect.stringContaining('exceeded 5 ms'),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
