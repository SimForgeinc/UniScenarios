import { describe, expect, it } from 'vitest';
import type { Interaction, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { buildTimelineGroups, moveInteraction, timelineTrack, triggerAnchor } from './model';

const speed: Interaction = {
  id: 'speed_ego', actor: 'ego', trigger: { kind: 'at', t: 3 }, verb: 'speed',
  target: { mode: 'stop' }, dynamics: { shape: 'linear', constraint: 'time', value: 1 },
};

describe('semantic timeline projection', () => {
  it('groups verbs by semantic axis', () => {
    expect(timelineTrack(speed)).toBe('speed');
    expect(timelineTrack({ id: 'spawn', actor: 'ego', trigger: { kind: 'at', t: 0 }, verb: 'exist', target: { state: 'present' } })).toBe('actions');
  });

  it('resolves after chains while retaining conditional uncertainty', () => {
    const after: Interaction = { ...speed, id: 'after_ego', trigger: { kind: 'after', of: speed.id, event: 'start', delayS: 2 } };
    expect(triggerAnchor(after.trigger, [speed, after], 20)).toEqual({ time: 5, unresolved: false });
    expect(triggerAnchor({ kind: 'when', condition: { kind: 'speed', of: 'ego', op: '<=', valueKph: 10 }, byLatest: 8, ifNever: 'skip' }, [speed], 20)).toEqual({ time: 8, unresolved: true });
  });

  it('moves clips through a typed at trigger replacement', () => {
    expect(moveInteraction(speed, 7.126).trigger).toEqual({ kind: 'at', t: 7.126 });
  });

  it('adapts legacy verbs to exactly two human-facing rows without changing them', () => {
    const lane: Interaction = { id: 'left', actor: 'ego', trigger: { kind: 'at', t: 6 }, verb: 'changeLane', target: { mode: 'relative', dk: 1 }, dynamics: { shape: 'linear', constraint: 'time', value: 2 } };
    const indicator: Interaction = { id: 'signal', actor: 'ego', trigger: { kind: 'at', t: 5 }, verb: 'set', target: { key: 'lights.indicator', value: 'left' } };
    const template = {
      schemaVersion: 2 as const, id: 'two-row', map: { mode: 'scene_absolute' as const, mapId: 'map' },
      roles: [{ id: 'ego', label: 'Ego', actor: { class: 'car' as const, static: false }, kind: 'scene_absolute' as const, pose: { x: 0, y: 0, z: 0, headingRad: 0 } }],
      choreography: { clipSeconds: 20, warmupSeconds: 0, interactions: [speed, lane, indicator] },
      invariants: [], variants: [],
    };
    const [group] = buildTimelineGroups(template as unknown as ScenarioTemplateV2);
    expect(Object.keys(group!.tracks)).toEqual(['speed', 'actions']);
    expect(group!.tracks.speed.map((item) => item.interaction)).toEqual([speed]);
    expect(group!.tracks.actions.map((item) => item.interaction)).toEqual([indicator, lane]);
  });
});
