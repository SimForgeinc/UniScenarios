import { describe, expect, it } from 'vitest';
import { SignalBook, contentHash, type SignalProgram } from '@uniscenarios/sim-engine';
import type { MapSignalPlan } from '@uniscenarios/scenario-model';

import { compileMapSignalPlans, MapSignalPlanCompileError } from './map-signal-plan-compiler.js';

const programs: SignalProgram[] = [
  {
    id: 'signal:h1', phases: [{ phase: 'green', durationS: 2 }, { phase: 'red', durationS: 2 }],
    offsetS: 0, loop: true,
    stopLines: [{ rsl: 'a', s: 9, connectingLaneRsls: ['ja'] }],
    mapBinding: { junctionId: 'j1', controllerIds: ['c1'], headIds: ['h1'], controllerHeadGroups: [{ controllerId: 'c1', headIds: ['h1'] }], timingSource: 'synthetic-default' },
  },
  {
    id: 'signal:h2', phases: [{ phase: 'red', durationS: 2 }, { phase: 'green', durationS: 2 }],
    offsetS: 0, loop: true,
    stopLines: [{ rsl: 'b', s: 9, connectingLaneRsls: ['jb'] }],
    mapBinding: { junctionId: 'j1', controllerIds: ['c2'], headIds: ['h2'], controllerHeadGroups: [{ controllerId: 'c2', headIds: ['h2'] }], timingSource: 'synthetic-default' },
  },
];
const catalog = {
  heads: [{ id: 'h1', roadId: '1', s: 1, dynamic: true }, { id: 'h2', roadId: '2', s: 1, dynamic: true }],
  roadControls: [], speedLimits: [], applicability: [],
  controllers: [{ id: 'c1', sequence: 0, signalIds: ['h1'] }, { id: 'c2', sequence: 1, signalIds: ['h2'] }],
  junctions: [{ junctionId: 'j1', controllerIds: ['c1', 'c2'] }],
} as const;
const controls = { signalPrograms: programs, roadControls: [] };
const digest = contentHash(controls);
const plan: MapSignalPlan = {
  id: 'j1-plan', version: 1,
  binding: { mapId: 'map', junctionId: 'j1', controlDigest: digest },
  clips: [{ id: 'clip', startS: 3, endS: 5, reference: { controllerId: 'c1', headId: 'h1' }, indication: 'yellow' }],
};
const topology = {
  lanes: {}, junctions: { j1: { junctionId: 'j1', gateIds: ['g1', 'g2'], internalLaneRsls: [], approachLaneRsls: [] } },
  gates: [
    { id: 'g1', junctionId: 'j1', turnRelation: 'Straight', headingChangeRad: 0, connectingLaneRsl: 'ja', approachLaneRsl: 'a', exitLaneRsls: [] },
    { id: 'g2', junctionId: 'j1', turnRelation: 'Straight', headingChangeRad: 0, connectingLaneRsl: 'jb', approachLaneRsl: 'b', exitLaneRsls: [] },
  ],
} as any;
const options = {
  mapId: 'map', controlDigest: digest, clipSeconds: 8, warmupSeconds: 2,
  signalCatalog: catalog, topology, conflictPairsByJunction: { j1: [{ gateA: 'g1', gateB: 'g2' }] },
};

describe('map signal plan compiler', () => {
  it('preserves baseline warm-up/gaps and atomically holds other stages red', () => {
    const compiled = compileMapSignalPlans(programs, [plan], options);
    const book = new SignalBook(compiled, 2);
    expect(book.phaseAt('signal:h1', -1)).toBe('green');
    expect(book.phaseAt('signal:h1', 2.5)).toBe('green');
    expect(book.phaseAt('signal:h1', 3)).toBe('yellow');
    expect(book.phaseAt('signal:h2', 4.999)).toBe('red');
    expect(book.phaseAt('signal:h1', 5)).toBe('red');
    expect(book.phaseAt('signal:h1', 8)).toBe('red');
    expect(compiled.every((program) => !program.loop && program.mapBinding?.timingSource === 'authored')).toBe(true);
  });

  it.each(['green', 'yellow', 'red', 'flashing_yellow', 'flashing_red', 'off'] as const)(
    'executes the %s indication for the exact half-open interval',
    (indication) => {
      const authored = { ...plan, clips: [{ ...plan.clips[0]!, indication }] };
      const book = new SignalBook(compileMapSignalPlans(programs, [authored], options), 2);
      expect(book.phaseAt('signal:h1', 2.999999)).toBe('green');
      expect(book.phaseAt('signal:h1', 3)).toBe(indication);
      expect(book.phaseAt('signal:h1', 4.999999)).toBe(indication);
      expect(book.phaseAt('signal:h1', 5)).toBe('red');
      expect(book.phaseAt('signal:h2', 4)).toBe(
        indication === 'flashing_yellow' || indication === 'flashing_red'
          ? 'flashing_red'
          : 'red',
      );
    },
  );

  it('switches adjacent clips exactly at their shared boundary and coalesces equal phases', () => {
    const adjacent: MapSignalPlan = {
      ...plan,
      clips: [
        { ...plan.clips[0]!, indication: 'green' },
        { ...plan.clips[0]!, id: 'next', startS: 5, endS: 6, indication: 'yellow' },
      ],
    };
    const compiled = compileMapSignalPlans(programs, [adjacent], options);
    const book = new SignalBook(compiled, 2);
    expect(book.phaseAt('signal:h1', 4.999999)).toBe('green');
    expect(book.phaseAt('signal:h1', 5)).toBe('yellow');
    expect(compiled.every((program) => program.phases.every((phase, index) =>
      index === 0 || program.phases[index - 1]!.phase !== phase.phase,
    ))).toBe(true);
  });

  it('fails closed on stale metadata and dual ownership', () => {
    expect(() => compileMapSignalPlans(programs, [plan], { ...options, controlDigest: 'changed' }))
      .toThrowError(expect.objectContaining({ code: 'map_signal_plan_stale_binding' }));
    expect(() => compileMapSignalPlans(programs, [plan], { ...options, worldSignalSetIds: ['signal:h1'] }))
      .toThrowError(expect.objectContaining({ code: 'map_signal_plan_dual_ownership' }));
  });

  it('rejects a controller stage whose simultaneously active heads conflict', () => {
    const groupedPrograms = programs.map((program) => ({
      ...program,
      mapBinding: { ...program.mapBinding!, controllerIds: ['c1'], controllerHeadGroups: [{ controllerId: 'c1', headIds: program.mapBinding!.headIds }] },
    }));
    const groupedCatalog = { ...catalog, controllers: [{ id: 'c1', sequence: 0, signalIds: ['h1', 'h2'] }], junctions: [{ junctionId: 'j1', controllerIds: ['c1'] }] };
    const groupedDigest = contentHash({ signalPrograms: groupedPrograms, roadControls: [] });
    expect(() => compileMapSignalPlans(groupedPrograms, [{ ...plan, binding: { ...plan.binding, controlDigest: groupedDigest } }], {
      ...options, controlDigest: groupedDigest, signalCatalog: groupedCatalog,
    })).toThrowError(expect.objectContaining({ code: 'map_signal_plan_controller_conflict' } satisfies Partial<MapSignalPlanCompileError>));
  });
});
