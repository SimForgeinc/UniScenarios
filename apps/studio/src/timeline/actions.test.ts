import { describe, expect, it } from 'vitest';
import { actionsForActor, defaultSpeedKph } from './actions';

describe('actor-specific action catalog', () => {
  it('offers vehicle controls without pedestrian commands', () => {
    const ids = actionsForActor('car').map((action) => action.id);
    expect(ids).toEqual(expect.arrayContaining(['accelerate', 'brake_stop', 'lane_left', 'keep_lane', 'turn_right', 'pull_over', 'indicator_left', 'horn_on', 'lights_on']));
    expect(ids).not.toContain('walk');
  });

  it('keeps pedestrian, cyclist, and static choices distinct', () => {
    const pedestrian = actionsForActor('pedestrian').map((action) => action.id);
    expect(pedestrian).toEqual(expect.arrayContaining(['walk', 'wait', 'pace_faster']));
    expect(pedestrian).not.toEqual(expect.arrayContaining(['cross', 'direction_left']));
    const cyclist = actionsForActor('bicycle').map((action) => action.id);
    expect(cyclist).toEqual(expect.arrayContaining(['cycle_faster', 'cycle_stop', 'cycle_lane_left', 'cycle_keep_lane', 'cycle_turn_right']));
    expect(cyclist).not.toContain('cycle_signal_left');
    expect(actionsForActor('static_object')).toEqual([]);
  });

  it('provides type-appropriate actor default speeds', () => {
    expect(defaultSpeedKph('car')).toBe(48.28032);
    expect(defaultSpeedKph('pedestrian')).toBe(5);
    expect(defaultSpeedKph('bicycle')).toBe(18);
    expect(defaultSpeedKph('static_object')).toBe(0);
  });
});
