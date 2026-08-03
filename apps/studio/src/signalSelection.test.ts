import { describe, expect, it, vi } from 'vitest';
import { buildSignalControlIndex } from '@uniscenarios/scenario-materializer';
import type { SignalProgram } from '@uniscenarios/sim-engine';
import { StudioSignalSelectionModel } from './signalSelection';

const program = {
  id: 'through', phases: [{ phase: 'green', durationS: 10 }], offsetS: 0, loop: true, stopLines: [],
  mapBinding: {
    junctionId: 'junction', controllerIds: ['stage'], headIds: ['head'], timingSource: 'authored',
    controllerHeadGroups: [{ controllerId: 'stage', headIds: ['head'] }],
  },
} satisfies SignalProgram;

const reboundProgram = {
  ...program,
  mapBinding: {
    junctionId: 'new-junction', controllerIds: ['new-stage'], headIds: ['head'], timingSource: 'authored',
    controllerHeadGroups: [{ controllerId: 'new-stage', headIds: ['head'] }],
  },
} satisfies SignalProgram;

describe('StudioSignalSelectionModel', () => {
  it('publishes exact head selections and clears them', () => {
    const model = new StudioSignalSelectionModel(buildSignalControlIndex([program]));
    const listener = vi.fn();
    const unsubscribe = model.subscribe(listener);
    expect(model.selectHead('head')).toMatchObject({ selectedHeadId: 'head', referenceMovementId: 'through' });
    expect(listener).toHaveBeenCalledTimes(1);
    model.clear();
    expect(listener).toHaveBeenLastCalledWith(null);
    unsubscribe();
  });

  it('refreshes derived membership when stable head and movement ids are rebound', () => {
    const model = new StudioSignalSelectionModel(buildSignalControlIndex([program]));
    const listener = vi.fn();
    model.subscribe(listener);
    model.selectHead('head');
    model.setIndex(buildSignalControlIndex([reboundProgram]));
    expect(model.snapshot).toMatchObject({ junctionId: 'new-junction', controllerIds: ['new-stage'] });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ junctionId: 'new-junction' }));
  });
});
