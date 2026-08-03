import { describe, expect, it, vi } from 'vitest';
import { PreparationGate, throwIfPreparationAborted } from './preparationGate';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Play preparation cancellation', () => {
  it('prevents Escape during preparation from entering playback after late resolution', async () => {
    const gate = new PreparationGate();
    const work = deferred();
    const enterPlayback = vi.fn();
    const ticket = gate.begin();
    const completion = work.promise.then(() => {
      throwIfPreparationAborted(ticket.signal);
      if (gate.complete(ticket)) enterPlayback();
    }).catch(() => undefined);

    gate.cancel(); // Escape
    expect(ticket.signal.aborted).toBe(true);
    work.resolve();
    await completion;
    expect(enterPlayback).not.toHaveBeenCalled();
  });

  it('stops an already-started attempt and supports repeated Play/Escape cycles', async () => {
    const gate = new PreparationGate();
    for (let cycle = 0; cycle < 3; cycle++) {
      const ticket = gate.begin();
      expect(gate.complete(ticket)).toBe(true);
      gate.cancel(); // Escape after playback mounted
      expect(gate.isCurrent(ticket)).toBe(false);
    }
    const finalTicket = gate.begin();
    expect(gate.complete(finalTicket)).toBe(true);
  });

  it('treats unmount/HMR disposal like Escape', () => {
    const gate = new PreparationGate();
    const ticket = gate.begin();
    gate.cancel();
    expect(ticket.signal.aborted).toBe(true);
    expect(gate.complete(ticket)).toBe(false);
  });
});
