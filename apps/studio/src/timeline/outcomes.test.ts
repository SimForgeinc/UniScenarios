import { describe, expect, it } from 'vitest';
import type { Interaction } from '@uniscenarios/scenario-model';
import { buildTimelineOutcomeIndex, timelineOutcomesAt } from './model';
import { timelineActionOutcome } from './TimelineDock';

function interaction(id: string, actor = 'car'): Pick<Interaction, 'id' | 'actor'> {
  return { id, actor } as Pick<Interaction, 'id' | 'actor'>;
}

describe('canonical timeline outcome projection', () => {
  it('shows fired and missed outcomes only after their inclusive event time', () => {
    const index = buildTimelineOutcomeIndex([
      { t: 3, kind: 'trigger_fired', interactionId: 'straight', actorId: 'compiled-car' },
      { t: 5, kind: 'trigger_skipped', interactionId: 'turn', actorId: 'compiled-car' },
    ], [interaction('straight'), interaction('turn')]);

    expect(timelineActionOutcome(timelineOutcomesAt(index, 2.999), 'straight')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 3), 'straight')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 4.999), 'turn')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 5), 'turn')).toBe('missed');
  });

  it('tracks stacked clips independently', () => {
    const index = buildTimelineOutcomeIndex([
      { t: 4, kind: 'trigger_fired', interactionId: 'speed', actorId: 'car' },
      { t: 4, kind: 'trigger_skipped', interactionId: 'indicator', actorId: 'car' },
    ], [interaction('speed'), interaction('indicator')]);
    const outcomes = timelineOutcomesAt(index, 4);

    expect(timelineActionOutcome(outcomes, 'speed')).toBe('executed');
    expect(timelineActionOutcome(outcomes, 'indicator')).toBe('missed');
  });

  it('recomputes deterministically across backward and forward seeks', () => {
    const index = buildTimelineOutcomeIndex([
      { t: 2, kind: 'trigger_fired', interactionId: 'first', actorId: 'car' },
      { t: 18, kind: 'trigger_skipped', interactionId: 'last', actorId: 'car' },
    ], [interaction('first'), interaction('last')]);

    expect(timelineActionOutcome(timelineOutcomesAt(index, 20), 'last')).toBe('missed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 1), 'first')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 19), 'first')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 19), 'last')).toBe('missed');
  });

  it('projects clip-end evidence at 20 seconds and reset has no retained state', () => {
    const index = buildTimelineOutcomeIndex([
      { t: 20, kind: 'trigger_fired', interactionId: 'exact-end', actorId: 'car' },
      { t: 20, kind: 'trigger_skipped', interactionId: 'never', actorId: 'car' },
    ], [interaction('exact-end'), interaction('never')]);

    expect(timelineActionOutcome(timelineOutcomesAt(index, 19.999), 'exact-end')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 20), 'exact-end')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 20), 'never')).toBe('missed');
    expect(timelineActionOutcome([], 'exact-end')).toBe('pending');
    expect(timelineActionOutcome([], 'never')).toBe('pending');
  });

  it('ignores ambient and unrelated trace evidence regardless of provider', () => {
    const events = [
      { t: 1, kind: 'trigger_fired', interactionId: 'ambient-sumo-1', actorId: 'ambient-sumo-1' },
      { t: 2, kind: 'collision', actorId: 'car' },
      { t: 3, kind: 'trigger_fired', interactionId: 'authored', actorId: 'compiled-car' },
    ];
    const index = buildTimelineOutcomeIndex(events, [interaction('authored', 'document-car')]);

    expect(index).toEqual([{ interactionId: 'authored', actorId: 'document-car', time: 3, kind: 'trigger_fired' }]);
  });
});
