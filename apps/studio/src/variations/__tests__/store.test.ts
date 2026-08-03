import { beforeEach, describe, expect, it } from 'vitest';
import { VariationProjectStore } from '../store';

class MemoryStorage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('variation project persistence', () => {
  beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true }); });

  it('preserves rejected decisions across store instances', () => {
    new VariationProjectStore().recordDecision({ key: 'map:site:direct', sourcePatternId: 'pattern', mapId: 'map', siteId: 'site', decision: 'rejected', decidedAt: '2026-01-01T00:00:00Z', resumeToken: 'resume' });
    expect(new VariationProjectStore().decision('map:site:direct')).toMatchObject({ decision: 'rejected', resumeToken: 'resume' });
  });

  it('persists shortlist and promotion review states', () => {
    const store = new VariationProjectStore();
    store.recordDecision({ key: 'short', sourcePatternId: 'pattern', mapId: 'map', siteId: 'site', decision: 'shortlisted', decidedAt: '2026-01-01T00:00:00Z', resumeToken: 'resume' });
    store.recordDecision({ key: 'promoted', sourcePatternId: 'pattern', mapId: 'map', siteId: 'site-2', decision: 'promoted', decidedAt: '2026-01-01T00:00:00Z', resumeToken: 'resume' });
    expect(new VariationProjectStore().decision('short')?.decision).toBe('shortlisted');
    expect(new VariationProjectStore().decision('promoted')?.decision).toBe('promoted');
  });

  it('saves and reopens an accepted project without losing its concrete instance', () => {
    const project = { key: 'map:site:direct', name: 'variation-project', mapId: 'map', siteId: 'site', sourcePatternId: 'pattern', createdAt: '2026-01-01T00:00:00Z', template: { scenarioVersion: 2 }, instance: { kind: 'scenario-instance', version: 1, input: { mapId: 'map' } }, acceptance: { status: 'accepted' } } as any;
    new VariationProjectStore().saveProject(project);
    expect(new VariationProjectStore().projects()[0]).toMatchObject({ name: 'variation-project', instance: { input: { mapId: 'map' } }, acceptance: { status: 'accepted' } });
  });
});
