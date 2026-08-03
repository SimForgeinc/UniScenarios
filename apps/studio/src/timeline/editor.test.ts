import { describe, expect, it } from 'vitest';
import { createInteractionDraft, defaultTargetJson, draftFromInteraction, interactionFromDraft } from './editor';

describe('timeline interaction editor', () => {
  it('creates an executable fixed-time speed interaction with dynamics', () => {
    const draft = createInteractionDraft('ego', 2.5, 1);
    draft.speedValue = 42;
    draft.dynamicsValue = 1.25;
    const result = interactionFromDraft(draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction).toMatchObject({
      actor: 'ego', verb: 'speed', trigger: { kind: 'at', t: 2.5 },
      target: { mode: 'absolute', valueKph: 42 },
      dynamics: { shape: 'linear', constraint: 'time', value: 1.25 },
    });
    expect(draftFromInteraction(result.interaction)).toMatchObject({ speedValue: 42, time: 2.5 });
  });

  it.each(['gap', 'changeLane', 'laneOffset', 'route', 'exist', 'set'] as const)('supports the %s verb through its structured target', (verb) => {
    const draft = createInteractionDraft('ego', 1, 2);
    draft.verb = verb;
    draft.targetJson = defaultTargetJson(verb, 'ego');
    const result = interactionFromDraft(draft);
    expect(result.ok, result.ok ? '' : result.error).toBe(true);
  });

  it.each(['speed', 'gap', 'changeLane', 'laneOffset', 'route', 'exist', 'set'] as const)('round-trips edits to the %s verb', (verb) => {
    const draft = createInteractionDraft('actor-one', 3.5, 8);
    draft.verb = verb;
    draft.targetJson = defaultTargetJson(verb, 'actor-one');
    const saved = interactionFromDraft(draft);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(draftFromInteraction(saved.interaction)).toMatchObject({ actor: 'actor-one', verb });
  });

  it('supports after, when, and arrival trigger forms', () => {
    const after = createInteractionDraft('ego', 1, 3);
    after.triggerKind = 'after'; after.afterId = 'speed_ego_1'; after.delayS = 2;
    expect(interactionFromDraft(after)).toMatchObject({ ok: true, interaction: { trigger: { kind: 'after', of: 'speed_ego_1', delayS: 2 } } });

    const when = createInteractionDraft('ego', 1, 4);
    when.triggerKind = 'when'; when.byLatest = 8;
    expect(interactionFromDraft(when)).toMatchObject({ ok: true, interaction: { trigger: { kind: 'when', byLatest: 8 } } });

    const arrival = createInteractionDraft('ego', 1, 5);
    arrival.triggerKind = 'arrival'; arrival.syncWith = 'challenger';
    expect(interactionFromDraft(arrival)).toMatchObject({ ok: true, interaction: { trigger: { kind: 'arrival', of: 'ego', syncWith: 'challenger', ttc: 1.5 } } });
  });

  it.each(['at', 'after', 'when', 'arrival'] as const)('round-trips the %s trigger editor', (triggerKind) => {
    const draft = createInteractionDraft('ego', 2, 9);
    draft.triggerKind = triggerKind;
    if (triggerKind === 'after') draft.afterId = 'prior-action';
    if (triggerKind === 'arrival') draft.syncWith = 'challenger';
    const saved = interactionFromDraft(draft);
    expect(saved.ok, saved.ok ? '' : saved.error).toBe(true);
    if (!saved.ok) return;
    expect(draftFromInteraction(saved.interaction).triggerKind).toBe(triggerKind);
  });

  it('returns inline diagnostics instead of committing malformed JSON', () => {
    const draft = createInteractionDraft('ego', 1, 6);
    draft.verb = 'route'; draft.targetJson = '{bad';
    expect(interactionFromDraft(draft)).toMatchObject({ ok: false });
  });
});
