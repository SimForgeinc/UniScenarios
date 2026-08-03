import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioTransport } from './StudioTransport';

afterEach(() => vi.unstubAllGlobals());

function clockHarness() {
  let now = 0;
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  return {
    frames,
    step(value: number) {
      now = value;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(value));
    },
  };
}

describe('StudioTransport', () => {
  it('owns one frame at a time and consumes zero frames while paused', () => {
    const clock = clockHarness();
    const transport = new StudioTransport();
    transport.configure(() => undefined, () => undefined);
    transport.play(0, 20);
    transport.play(0, 20);
    expect(clock.frames.size).toBe(1);
    clock.step(16);
    expect(clock.frames.size).toBe(1);
    transport.pause();
    expect(clock.frames.size).toBe(0);
    clock.step(1000);
    expect(transport.counters.frames).toBe(1);
  });

  it('renders smoothly but limits UI publication to 20 Hz', () => {
    const clock = clockHarness();
    const rendered: number[] = [];
    const published: number[] = [];
    const transport = new StudioTransport();
    transport.configure((time) => rendered.push(time), (time) => published.push(time));
    transport.play(0, 20);
    for (let time = 0; time <= 160; time += 16) clock.step(time);
    expect(rendered.length).toBeGreaterThan(8);
    expect(published.length).toBeLessThanOrEqual(4);
    expect(transport.counters.uiPublishes).toBe(published.length);
  });

  it('uses monotonic wall time across jitter, seeks atomically, and ends once', () => {
    const clock = clockHarness();
    const rendered: number[] = [];
    const published: number[] = [];
    const transport = new StudioTransport();
    transport.configure((time) => rendered.push(time), (time) => published.push(time));
    transport.play(1, 2);
    clock.step(100);
    clock.step(550);
    expect(rendered.at(-1)).toBeCloseTo(1.55);
    transport.seek(1.8);
    expect(rendered.at(-1)).toBe(1.8);
    clock.step(800);
    expect(rendered.at(-1)).toBe(2);
    expect(published.at(-1)).toBe(2);
    expect(transport.active).toBe(false);
    expect(clock.frames.size).toBe(0);
  });
});
