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

const sharedMovementProgram = {
  ...program,
  mapBinding: {
    junctionId: 'junction', controllerIds: ['first-stage', 'preferred-stage'], headIds: ['head'], timingSource: 'authored',
    controllerHeadGroups: [
      { controllerId: 'first-stage', headIds: ['head'] },
      { controllerId: 'preferred-stage', headIds: ['head'] },
    ],
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

  it('retains a non-first preferred controller for a shared movement and map refresh', () => {
    const model = new StudioSignalSelectionModel(buildSignalControlIndex([sharedMovementProgram]));
    expect(model.selectHead('head', 'through', 'preferred-stage')).toMatchObject({
      referenceMovementId: 'through',
      referenceControllerId: 'preferred-stage',
      controllerIds: ['first-stage', 'preferred-stage'],
    });
    model.setIndex(buildSignalControlIndex([sharedMovementProgram]));
    expect(model.snapshot?.referenceControllerId).toBe('preferred-stage');
  });
});
