import { describe, expect, it, vi } from 'vitest';
import { confirmRunAgain, isSavedDraftCompatible } from './CopilotComparisonView';
import type { CopilotGenerationHistoryEntry } from './historyTypes';

describe('saved generation actions', () => {
  it('keeps a new model run behind an explicit confirmation', () => {
    const rerun = vi.fn();
    confirmRunAgain(entry(), rerun, () => false);
    expect(rerun).not.toHaveBeenCalled();
    confirmRunAgain(entry(), rerun, (message) => {
      expect(message).toContain('new model calls');
      expect(message).toContain('API tokens');
      return true;
    });
    expect(rerun).toHaveBeenCalledOnce();
  });

  it('allows an original saved draft only on the compatible map and schema', () => {
    expect(isSavedDraftCompatible(entry(), 'richmond-field-station', 'map-hash')).toBe(true);
    expect(isSavedDraftCompatible(entry(), 'yale-street', 'map-hash')).toBe(false);
    expect(isSavedDraftCompatible({ ...entry(), mapHash: 'old-map-hash' }, 'richmond-field-station', 'map-hash')).toBe(false);
    expect(isSavedDraftCompatible({ ...entry(), candidate: null, savedDraftStatus: 'not-recorded' }, 'richmond-field-station', 'map-hash')).toBe(false);
  });
});

function entry(): CopilotGenerationHistoryEntry {
  const scenarioDoc = {
    schemaVersion: 2, meta: { id: 'saved', name: 'Saved', description: '', tags: [] }, map: { mapId: 'richmond-field-station', mode: 'anchored' },
    parameters: [], roles: [], props: [], trafficControls: [], mapSignalPlans: [], choreography: { clip: { start: 0, end: 20 }, interactions: [] }, invariants: [], variants: [], validation: { rules: [] },
  } as unknown as NonNullable<CopilotGenerationHistoryEntry['candidate']>['scenarioDoc'];
  const actor = { id: 'ego', role: 'ego' as const, kind: 'vehicle' as const, catalogId: 'vehicle.sedan', behavior: 'drive' };
  return {
    id: 'saved', source: 'live', caseId: null, caseTitle: 'Saved', prompt: 'A saved prompt', expectedRejection: false,
    provider: 'direct-llm', requestedModel: 'model', actualModel: 'model', reasoningEffort: 'high', artifactId: null, mapId: 'richmond-field-station', mapHash: 'map-hash', scenarioSchemaVersion: 2,
    savedDraftStatus: 'original', savedResultHash: 'saved-hash', seed: null, generatedAt: null,
    intent: { scenario: 'Saved', ego: actor, adversaries: [], contextActors: [], spatialRelations: [], restrictions: [], desiredOutcome: 'run', assumptions: [] },
    candidate: { id: 'candidate', title: 'Saved', summary: 'Saved', intent: { scenario: 'Saved', ego: actor, adversaries: [], contextActors: [], spatialRelations: [], restrictions: [], desiredOutcome: 'run', assumptions: [] }, scenarioDoc, diagnostics: [], provenance: { provider: 'direct-llm', model: 'model', generatedAt: '', mapId: 'richmond-field-station', mapHash: 'map-hash', promptHash: 'saved-hash', retrievedExampleIds: [], stages: [], repairAttempts: 0, implementation: 'direct-native' } },
    actorCount: 0, actionCount: 0, triggerSummary: [], semanticPass: true, semanticAssertions: [], mapBindingPass: true, materializationPass: true,
    simulationPass: true, simulationDurationS: 20, canonicalTraceSummary: null, scenicCompilePass: null, scenicSamplePass: null, latencyMs: 1,
    totalTokens: 1, apiCalls: 1, repairCount: 0, outcome: 'success', failureCategory: null, diagnostic: null, provenance: null,
    generatedScenic: null, directTypedDraft: null, iterationTrace: null,
  };
}
