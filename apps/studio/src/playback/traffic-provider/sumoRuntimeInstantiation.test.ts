import { describe, expect, it, vi } from 'vitest';
import { compileSumoRuntime } from './sumoRuntimeInstantiation';

describe('SUMO browser runtime instantiation', () => {
  it('builds an Emscripten hook from supplied bytes without a second fetch', async () => {
    const emptyModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer;
    const instantiate = await compileSumoRuntime(emptyModule);
    const success = vi.fn();
    instantiate?.({}, success);
    expect(success).toHaveBeenCalledOnce();
    expect(success.mock.calls[0]?.[0]).toBeInstanceOf(WebAssembly.Instance);
  });

  it('rejects corrupt runtime bytes instead of hanging', async () => {
    await expect(compileSumoRuntime(new Uint8Array([1, 2, 3]).buffer)).rejects.toBeInstanceOf(WebAssembly.CompileError);
  });
});
