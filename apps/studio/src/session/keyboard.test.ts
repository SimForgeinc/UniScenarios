import { describe, expect, it, vi } from 'vitest';
import { handleTransportKey } from './keyboard';
import type { StudioSessionMode } from './model';

function press(target: EventTarget | null, mode: StudioSessionMode, init: Partial<{ key: string; code: string; repeat: boolean }> = {}) {
  const preventDefault = vi.fn();
  const toggle = vi.fn();
  const stop = vi.fn();
  const handled = handleTransportKey({
    key: init.key ?? ' ', code: init.code ?? 'Space', repeat: init.repeat ?? false,
    target, preventDefault,
  }, mode, toggle, stop);
  return { preventDefault, toggle, stop, handled };
}

describe('Space transport keyboard contract', () => {
  it.each(['authoring', 'playing', 'paused', 'ended'] as const)('toggles from %s and prevents scrolling', (mode) => {
    const result = press(null, mode);
    expect(result.handled).toBe(true);
    expect(result.preventDefault).toHaveBeenCalledOnce();
    expect(result.toggle).toHaveBeenCalledOnce();
  });

  it.each(['preparing', 'error'] as const)('consumes Space without transitioning from %s', (mode) => {
    const result = press(null, mode);
    expect(result.preventDefault).toHaveBeenCalledOnce();
    expect(result.toggle).not.toHaveBeenCalled();
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('does nothing in %s controls', (tagName) => {
    const result = press({ tagName } as unknown as EventTarget, 'playing');
    expect(result.handled).toBe(false);
    expect(result.preventDefault).not.toHaveBeenCalled();
    expect(result.toggle).not.toHaveBeenCalled();
  });

  it('does nothing in contenteditable descendants or on key repeat', () => {
    const editable = press({ tagName: 'SPAN', closest: () => ({}) } as unknown as EventTarget, 'playing');
    expect(editable.toggle).not.toHaveBeenCalled();
    const repeated = press(null, 'playing', { repeat: true });
    expect(repeated.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores unrelated keys', () => {
    expect(press(null, 'playing', { key: 'k', code: 'KeyK' }).handled).toBe(false);
  });

  it.each(['preparing', 'playing', 'paused', 'ended', 'error'] as const)('Escape stops and resets editable playback from %s', (mode) => {
    const result = press(null, mode, { key: 'Escape', code: 'Escape' });
    expect(result.handled).toBe(true);
    expect(result.preventDefault).toHaveBeenCalledOnce();
    expect(result.stop).toHaveBeenCalledOnce();
    expect(result.toggle).not.toHaveBeenCalled();
  });

  it('leaves authoring Escape to the editor and ignores Escape in editable controls', () => {
    expect(press(null, 'authoring', { key: 'Escape', code: 'Escape' }).handled).toBe(false);
    expect(press({ tagName: 'INPUT' } as unknown as EventTarget, 'playing', { key: 'Escape', code: 'Escape' }).handled).toBe(false);
  });
});
