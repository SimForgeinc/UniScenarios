import { parseSimScenarioInput, type SimScenarioInput } from '@uniscenarios/sim-engine';

/** Stable map-only base for ambient authoring. It deliberately has no authored semantics. */
export function createAmbientWorldPreviewInput(mapId: string): SimScenarioInput {
  // The execution schema requires one actor because authored simulations do.
  // Parse through that contract, then remove the private seed actor before the
  // ambient generator sees the input; the engine itself supports the generated
  // population normally.
  const parsed = parseSimScenarioInput({
    mapId,
    clipSeconds: 20,
    warmupSeconds: 0,
    dt: 0.05,
    seed: `ambient-world:${mapId}`,
    actors: [{
      id: 'ambient-world-seed',
      kind: 'static_object',
      static: true,
      initial: { pose: { x: 0, z: 0, headingRad: 0 }, speedMps: 0 },
      behavior: { route: { kind: 'polyline', points: [{ x: 0, z: 0 }, { x: 1, z: 0 }] } },
    }],
    physics: { mode: 'kinematic-v1' },
  });
  return { ...parsed, actors: [] };
}
