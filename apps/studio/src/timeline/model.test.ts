import { describe, expect, it } from 'vitest';
import type { Interaction, MapSignalPlan, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { buildMapSignalTimelineGroups, buildTimelineGroups, conflictingAction, editMapSignalPlanClip, moveInteraction, moveMapSignalPlanClip, packActionLanes, resizeMapSignalPlanClip, triggerAnchor, type TimelineItem } from './model';

const speed: Interaction = { id: 'speed_ego', actor: 'ego', trigger: { kind: 'at', t: 3 }, verb: 'speed', target: { mode: 'stop' }, dynamics: { shape: 'linear', constraint: 'time', value: 1 } };
const item = (interaction: Interaction, resource: TimelineItem['resource'], start: number, end: number): TimelineItem => ({ interaction, actorId: interaction.actor, track: 'actions', resource, anchorTime: start, endTime: end, unresolved: false });

describe('action-only timeline projection', () => {
  it('resolves trigger chains and moves actions with typed at triggers', () => { const after: Interaction = { ...speed, id: 'after', trigger: { kind: 'after', of: speed.id, event: 'start', delayS: 2 } }; expect(triggerAnchor(after.trigger, [speed, after], 20)).toEqual({ time: 5, unresolved: false }); expect(moveInteraction(speed, 7.126).trigger).toEqual({ kind: 'at', t: 7.126 }); });
  it('moves a clip without changing its strict execution-window duration', () => { const clip = { ...speed, until: { kind: 'at', t: 5 } } as Interaction; const moved = moveInteraction(clip, 8); expect(moved.trigger).toEqual({ kind: 'at', t: 8 }); expect(moved.until).toEqual({ kind: 'at', t: 10 }); });
  it('packs overlapping independent actions onto automatic parallel lanes', () => { const horn = { id: 'horn', actor: 'ego', trigger: { kind: 'at', t: 3 }, verb: 'set', target: { key: 'audio.horn', value: true } } as Interaction; expect(packActionLanes([item(speed, 'longitudinal', 3, 5), item(horn, 'horn', 4, 5)]).map((lane) => lane.items.length)).toEqual([1, 1]); });
  it('rejects overlap on longitudinal or lateral resources but allows independent overlap', () => { const existing = item(speed, 'longitudinal', 3, 5); expect(conflictingAction(item({ ...speed, id: 'other' }, 'longitudinal', 4, 6), [existing])?.interaction.id).toBe(speed.id); expect(conflictingAction(item({ ...speed, id: 'horn' }, 'horn', 4, 6), [existing])).toBeUndefined(); });
  it('uses one actions collection and hides incompatible legacy commands', () => { const lane: Interaction = { id: 'left', actor: 'ego', trigger: { kind: 'at', t: 6 }, verb: 'changeLane', target: { mode: 'relative', dk: 1 }, dynamics: { shape: 'linear', constraint: 'time', value: 2 } }; const advanced: Interaction = { id: 'exist', actor: 'ego', trigger: { kind: 'at', t: 0 }, verb: 'exist', target: { state: 'present' } }; const template = { schemaVersion: 2, roles: [{ id: 'ego', label: 'Ego', actor: { class: 'car', static: false }, kind: 'scene_absolute', pose: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 } }], choreography: { clipSeconds: 20, warmupSeconds: 0, interactions: [speed, lane, advanced] }, invariants: [], variants: [] } as unknown as ScenarioTemplateV2; const [group] = buildTimelineGroups(template); expect(Object.keys(group!.tracks)).toEqual(['actions']); expect(group!.tracks.actions.map((entry) => entry.interaction.id)).toEqual(['speed_ego', 'left']); });
});

const signalPlan = (): MapSignalPlan => ({
  id: 'junction_447_plan', version: 1,
  binding: { mapId: 'yalestreet', junctionId: '447', controlDigest: 'sha256:test' },
  clips: [
    { id: 'green_1', startS: 2, endS: 6, reference: { controllerId: '447', headId: 'head_a' }, indication: 'green' },
    { id: 'red_1', startS: 6, endS: 10, reference: { controllerId: '447', headId: 'head_a' }, indication: 'red' },
  ],
});

describe('map signal timeline projection', () => {
  it('projects one controller row with time-sorted half-open clips', () => {
    const plan = signalPlan();
    const template = { mapSignalPlans: [{ ...plan, clips: [...plan.clips].reverse() }] } as unknown as ScenarioTemplateV2;
    expect(buildMapSignalTimelineGroups(template)).toMatchObject([{
      planId: 'junction_447_plan', junctionId: '447', label: 'Intersection 447',
      clips: [{ clip: { id: 'green_1' }, anchorTime: 2, endTime: 6 }, { clip: { id: 'red_1' }, anchorTime: 6, endTime: 10 }],
    }]);
  });

  it('permits adjacency but rejects positive overlap', () => {
    const plan = signalPlan();
    expect(editMapSignalPlanClip(plan, { ...plan.clips[0]!, endS: 6 }, 20).ok).toBe(true);
    const result = editMapSignalPlanClip(plan, { ...plan.clips[0]!, endS: 6.001 }, 20);
    expect(result).toEqual({ ok: false, message: expect.stringContaining('overlaps “red_1”') });
  });

  it('moves and resizes while retaining the selected reference head and indication', () => {
    const moved = moveMapSignalPlanClip(signalPlan(), 'green_1', 10, 20);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.plan.clips.find((clip) => clip.id === 'green_1')).toMatchObject({
      startS: 10, endS: 14, indication: 'green', reference: { controllerId: '447', headId: 'head_a' },
    });
    const resized = resizeMapSignalPlanClip(moved.plan, 'green_1', 'end', 16, 20);
    expect(resized.ok).toBe(true);
    if (resized.ok) expect(resized.plan.clips.find((clip) => clip.id === 'green_1')).toMatchObject({ startS: 10, endS: 16 });
  });

  it('clamps clip moves to the authored scenario duration', () => {
    const result = moveMapSignalPlanClip(signalPlan(), 'green_1', 19, 20);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.clips.find((clip) => clip.id === 'green_1')).toMatchObject({ startS: 16, endS: 20 });
  });
});
