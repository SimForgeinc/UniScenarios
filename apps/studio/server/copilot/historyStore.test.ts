import { describe, expect, it } from 'vitest';
import type { CopilotGenerationRequest, CopilotGenerationResult } from '../../src/copilot/types';
import { CopilotHistoryStore } from './historyStore';

describe('Scenario Copilot generation history', () => {
  it('excludes the original 30 draftless benchmark rows from the application feed', () => {
    const history = new CopilotHistoryStore().list();
    const rows = history.entries.filter((entry) => entry.source === 'benchmark' && entry.artifactId === 'chat2scenic-20260803/results.json');
    expect(rows).toHaveLength(0);
    expect(history.entries.every((entry) => entry.candidate !== null)).toBe(true);
    expect(history.entries.every((entry) => entry.savedDraftStatus === 'original')).toBe(true);
    expect(history.entries.every((entry) => entry.scenarioSchemaVersion === 2)).toBe(true);
  });

  it('keeps benchmark evidence when live runs are cleared', () => {
    const store = new CopilotHistoryStore();
    store.record(request(), result());
    expect(store.list().entries.filter((entry) => entry.source === 'live')).toHaveLength(0);
    store.clearLive();
    expect(store.list().entries.filter((entry) => entry.source === 'live')).toHaveLength(0);
    expect(store.list().entries.filter((entry) => entry.source === 'benchmark').length).toBeGreaterThan(0);
  });
});

function request(): CopilotGenerationRequest {
  return {
    providerId: 'direct-llm', prompt: 'A sedan follows a stopped van on the current road.',
    mapContext: { mapId: 'test', mapName: 'Test', xodrSha256: null, laneCount: 1, junctionLaneCount: 0, bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, placementSlots: [] },
  };
}

function result(): CopilotGenerationResult {
  const actor = { id: 'ego', role: 'ego' as const, kind: 'vehicle' as const, catalogId: 'vehicle.sedan', behavior: 'drive' };
  return {
    runId: 'run', provider: 'direct-llm', model: 'test', intent: { scenario: 'test', ego: actor, adversaries: [], contextActors: [], spatialRelations: [], restrictions: [], desiredOutcome: 'test', assumptions: [] },
    candidates: [], metrics: { latencyMs: 10, inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: null, candidatesRequested: 1, candidatesReturned: 0 }, diagnostics: [], warnings: [],
  };
}
