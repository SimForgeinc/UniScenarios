import { describe, expect, it } from 'vitest';
import { canMutate, initialSession, reduceSession, shouldPreparePlayback } from './model';

describe('Studio session state machine', () => {
  it('locks authoring through preparation, playback, pause and the exact end', () => {
    let state = initialSession(2);
    expect(canMutate(state.mode)).toBe(true);
    state = reduceSession(state, { type: 'prepare', duration: 2 });
    expect(state.mode).toBe('preparing');
    state = reduceSession(state, { type: 'ready' });
    state = reduceSession(state, { type: 'play' });
    expect(state.mode).toBe('playing');
    expect(canMutate(state.mode)).toBe(false);
    state = reduceSession(state, { type: 'tick', delta: 3 });
    expect(state).toMatchObject({ mode: 'ended', time: 2 });
    state = reduceSession(state, { type: 'stop' });
    expect(state).toMatchObject({ mode: 'authoring', time: 0 });
  });

  it('keeps seek bounded and playback states read-only', () => {
    let state = reduceSession(initialSession(20), { type: 'prepare', duration: 20 });
    state = reduceSession(state, { type: 'ready' });
    state = reduceSession(state, { type: 'seek', time: 99 });
    expect(state).toMatchObject({ mode: 'ended', time: 20 });
    expect(canMutate('paused')).toBe(false);
  });

  it('restores authoring after failed preparation without changing session duration', () => {
    let state = reduceSession(initialSession(12), { type: 'prepare', duration: 12 });
    state = reduceSession(state, { type: 'fail', message: 'materialization rejected' });
    expect(state).toMatchObject({ mode: 'error', duration: 12, validation: 'invalid' });
    expect(canMutate(state.mode)).toBe(false);
    state = reduceSession(state, { type: 'stop' });
    expect(state).toEqual(initialSession(12));
    expect(canMutate(state.mode)).toBe(true);
  });

  it('lets Play retry a failed preparation instead of becoming a dead control', () => {
    expect(shouldPreparePlayback('authoring')).toBe(true);
    expect(shouldPreparePlayback('error')).toBe(true);
    expect(shouldPreparePlayback('preparing')).toBe(false);
    expect(shouldPreparePlayback('playing')).toBe(false);
    expect(shouldPreparePlayback('paused')).toBe(false);
    expect(shouldPreparePlayback('ended')).toBe(false);
  });

  it('latches one cold Play intent through preparation as one atomic transition', () => {
    const preparing = reduceSession(initialSession(20), { type: 'prepare', duration: 20 });
    const playing = reduceSession(preparing, { type: 'ready-and-play' });
    expect(playing).toMatchObject({ mode: 'playing', time: 0, validation: 'valid' });
    // A late worker completion after Stop/cancel cannot restart playback.
    expect(reduceSession(initialSession(20), { type: 'ready-and-play' })).toEqual(initialSession(20));
  });

  it('supports repeated Play to Escape-stop cycles without retaining derived playhead state', () => {
    let state = initialSession(20);
    for (const stopAt of [3.25, 11.5, 19.9]) {
      state = reduceSession(state, { type: 'prepare', duration: 20 });
      state = reduceSession(state, { type: 'ready' });
      state = reduceSession(state, { type: 'play' });
      state = reduceSession(state, { type: 'clock', time: stopAt });
      expect(state).toMatchObject({ mode: 'playing', time: stopAt });
      state = reduceSession(state, { type: 'stop' });
      expect(state).toEqual(initialSession(20));
      expect(canMutate(state.mode)).toBe(true);
    }
  });
});
