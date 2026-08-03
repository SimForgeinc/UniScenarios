import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Interaction } from '@uniscenarios/scenario-model';
import { buildTimelineOutcomeIndex, initialTimelineOutcomesFromManifest, timelineOutcomesAt } from './model';
import { timelineActionOutcome } from './TimelineDock';

function interaction(id: string, actor = 'car'): Pick<Interaction, 'id' | 'actor'> {
  return { id, actor } as Pick<Interaction, 'id' | 'actor'>;
}

function routeInteraction(id: string, actor = 'car'): Pick<Interaction, 'id' | 'actor' | 'verb'> {
  return { id, actor, verb: 'route' } as Pick<Interaction, 'id' | 'actor' | 'verb'>;
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

  it('executes an accepted t0 route while independently tracking a stacked speed action', () => {
    const route = routeInteraction('baseline-route');
    const speed = interaction('accelerate');
    const index = buildTimelineOutcomeIndex(
      [{ t: 0, kind: 'trigger_fired', interactionId: 'accelerate', actorId: 'car' }],
      [route, speed],
      [{
        interactionId: 'baseline-route', actorId: 'car', verb: 'route', timeS: 0,
        outcome: 'executed', basis: 'folded_initial_state',
      }],
    );

    expect(timelineActionOutcome(timelineOutcomesAt(index, 0), 'baseline-route')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 0), 'accelerate')).toBe('executed');
    expect(timelineActionOutcome([], 'baseline-route')).toBe('pending');
  });

  it('leaves delayed routes pending until fired and marks an elapsed route window missed', () => {
    const index = buildTimelineOutcomeIndex([
      { t: 6, kind: 'trigger_fired', interactionId: 'delayed-route', actorId: 'car' },
      { t: 5, kind: 'trigger_skipped', interactionId: 'windowed-route', actorId: 'car' },
    ], [routeInteraction('delayed-route'), routeInteraction('windowed-route')]);

    expect(timelineActionOutcome(timelineOutcomesAt(index, 4.999), 'windowed-route')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 5), 'windowed-route')).toBe('missed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 5), 'delayed-route')).toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 6), 'delayed-route')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 2), 'delayed-route')).toBe('pending');
  });

  it('projects the existing EC05 folded routes from its canonical manifest', () => {
    const root = new URL('../../../../examples/edge-cases/05-cyclist-occlusion-conflict/', import.meta.url);
    const template = JSON.parse(readFileSync(new URL('scenario.template.json', root), 'utf8')) as {
      choreography: { interactions: Interaction[] };
    };
    const instance = JSON.parse(readFileSync(new URL('scenario.instance.json', root), 'utf8')) as {
      manifest: { initialInteractionOutcomes?: unknown; notes?: unknown };
    };
    const trace = JSON.parse(gunzipSync(readFileSync(new URL('scenario.trace.json.gz', root))).toString('utf8')) as {
      events: Array<{ t: number; kind: string; interactionId?: string; actorId?: string }>;
    };
    const initial = initialTimelineOutcomesFromManifest(
      template.choreography.interactions,
      instance.manifest.initialInteractionOutcomes,
      instance.manifest.notes,
    );
    const index = buildTimelineOutcomeIndex(trace.events, template.choreography.interactions, initial);

    expect(timelineActionOutcome(timelineOutcomesAt(index, 0), 'focus-vehicle-garage-route')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 0), 'contraflow-route')).toBe('executed');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 20), 'focus-vehicle-garage-route')).not.toBe('pending');
    expect(timelineActionOutcome(timelineOutcomesAt(index, 20), 'contraflow-route')).not.toBe('pending');
  });
});
