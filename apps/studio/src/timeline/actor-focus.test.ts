import { describe, expect, it } from 'vitest';
import { cameraActorForTimelineClick } from './TimelineDock';

describe('timeline actor camera intent', () => {
  it('frames only the actor header, never Speed or Actions rows', () => {
    expect(cameraActorForTimelineClick('actor-header', 'ambulance')).toBe('ambulance');
    expect(cameraActorForTimelineClick('speed-row', 'ambulance')).toBeNull();
    expect(cameraActorForTimelineClick('actions-row', 'ambulance')).toBeNull();
  });
});
