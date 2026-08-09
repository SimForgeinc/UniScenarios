import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioTransport } from '@uniscenarios/playback';

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
    expect(rendered).toEqual([0]);
    expect(published).toEqual([0]);
    for (let time = 0; time <= 160; time += 16) clock.step(time);
    expect(rendered.length).toBeGreaterThan(8);
    expect(published.length).toBeLessThanOrEqual(4);
    expect(transport.counters.uiPublishes).toBe(published.length);
  });

  it('publishes t=0 synchronously and freezes at the streamed edge without jumping', () => {
    const clock = clockHarness();
    const rendered: number[] = [];
    let available = 0;
    const transport = new StudioTransport();
    transport.configure((time) => rendered.push(time), () => undefined, () => available);
    transport.play(0, 20);
    expect(rendered).toEqual([0]);
    clock.step(50);
    clock.step(100);
    expect(rendered.at(-1)).toBe(0);
    expect(transport.counters).toMatchObject({ underruns: 1, underrunFrames: 2 });

    // Slow-CPU fallback: once a 300 ms batch arrives, advance from the frozen
    // edge rather than jumping to the old wall-clock position.
    available = 0.3;
    clock.step(150);
    expect(rendered.at(-1)).toBeCloseTo(0.05);
    clock.step(200);
    expect(rendered.at(-1)).toBeCloseTo(0.1);
  });

  it('pause, resume, and cancellation preserve the streamed playhead', () => {
    const clock = clockHarness();
    const rendered: number[] = [];
    const transport = new StudioTransport();
    transport.configure((time) => rendered.push(time), () => undefined, () => 20);
    transport.play(0, 20);
    clock.step(100);
    transport.pause();
    clock.step(5_000);
    expect(rendered.at(-1)).toBeCloseTo(0.1);
    transport.play(rendered.at(-1)!, 20);
    clock.step(5_100);
    expect(rendered.at(-1)).toBeCloseTo(0.2);
    transport.dispose();
    expect(clock.frames.size).toBe(0);
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
