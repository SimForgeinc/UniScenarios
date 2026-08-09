import { describe, expect, it } from 'vitest';
import { CopilotHistoryStore } from '../../server/copilot/historyStore';
import { draftCompatibility, hasExactDraft, hasMaterialAuthoredContent, parseSavedGenerationDraft } from './GenerationsWorkspace';

describe('top-level Generations authoring gallery', () => {
  it('contains only exact saved native drafts', () => {
    const entries = new CopilotHistoryStore().list().entries;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(hasExactDraft)).toBe(true);
    expect(entries.every((entry) => entry.candidate !== null)).toBe(true);
  });

  it('opens the exact stored template without invoking any provider', () => {
    const entry = new CopilotHistoryStore().list().entries[0]!;
    const parsed = parseSavedGenerationDraft(entry);
    expect(parsed).toMatchObject(entry.candidate!.scenarioDoc);
    expect(parsed.reasoningTrace).toEqual(entry.candidate!.scenarioDoc.reasoningTrace ?? []);
    expect(parsed.roles.map((role) => role.id)).toEqual(entry.candidate!.scenarioDoc.roles.map((role) => role.id));
  });

  it('blocks the wrong map and map hash while offering safe map switching', () => {
    const entry = new CopilotHistoryStore().list().entries[0]!;
    expect(draftCompatibility(entry, entry.mapId, entry.mapHash).compatible).toBe(true);
    expect(draftCompatibility(entry, 'another-map', entry.mapHash)).toMatchObject({ compatible: false, switchable: true });
    if (entry.mapHash) expect(draftCompatibility(entry, entry.mapId, 'different-hash')).toMatchObject({ compatible: false, switchable: false });
  });

  it('requires replacement confirmation only when the open author canvas has material content', () => {
    const template = parseSavedGenerationDraft(new CopilotHistoryStore().list().entries[0]!);
    expect(hasMaterialAuthoredContent(template)).toBe(true);
    expect(hasMaterialAuthoredContent({ ...template, roles: [], props: [], mapSignalPlans: [], choreography: { ...template.choreography, interactions: [] } })).toBe(false);
  });
});
