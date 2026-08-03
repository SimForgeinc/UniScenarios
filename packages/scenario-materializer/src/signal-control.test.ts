import { describe, expect, it } from 'vitest';
import type { SignalProgram } from '@uniscenarios/sim-engine';
import {
  buildSignalControlIndex,
  evaluateSignalReferencePhase,
  selectSignalReference,
} from './signal-control.js';

const programs: SignalProgram[] = [
  {
    id: 'north-through', phases: [{ phase: 'green', durationS: 10 }], offsetS: 0, loop: true,
    stopLines: [{ rsl: '1:0:-1', s: 10, connectingLaneRsls: ['10:0:-1'] }],
    mapBinding: {
      junctionId: 'j1', controllerIds: ['stage-ns'], headIds: ['h1', 'h2'], timingSource: 'authored',
      controllerHeadGroups: [{ controllerId: 'stage-ns', headIds: ['h1', 'h2'] }],
    },
  },
  {
    id: 'east-through', phases: [{ phase: 'red', durationS: 10 }], offsetS: 0, loop: true,
    stopLines: [{ rsl: '2:0:-1', s: 8, connectingLaneRsls: ['20:0:-1'] }],
    mapBinding: {
      junctionId: 'j1', controllerIds: ['stage-ew'], headIds: ['h3'], timingSource: 'authored',
      controllerHeadGroups: [{ controllerId: 'stage-ew', headIds: ['h3'] }],
    },
  },
];

describe('signal control index and reference evaluation', () => {
  it('builds exact head to movement to junction/controller reverse indices', () => {
    const index = buildSignalControlIndex(programs, ['h1', 'h2', 'h3', 'unbound']);
    expect(index.heads.get('h1')).toMatchObject({
      movementIds: ['north-through'], controllerIds: ['stage-ns'], junctionIds: ['j1'], resolved: true,
    });
    expect(index.controllers.get('stage-ns')).toMatchObject({ headIds: ['h1', 'h2'], movementIds: ['north-through'] });
    expect(index.junctions.get('j1')?.headIds).toEqual(['h1', 'h2', 'h3']);
    expect(index.diagnostics).toContainEqual(expect.objectContaining({ code: 'unresolved_head', headIds: ['unbound'] }));
  });

  it('selects a stable reference and exposes all three highlight scopes', () => {
    const selected = selectSignalReference(buildSignalControlIndex(programs), 'h2');
    expect(selected).toMatchObject({
      selectedHeadId: 'h2', referenceMovementId: 'north-through', junctionId: 'j1',
      controllerIds: ['stage-ns'], movementHeadIds: ['h1', 'h2'],
      intersectionHeadIds: ['h1', 'h2', 'h3'], relatedMovementIds: ['east-through', 'north-through'],
    });
  });

  it('holds a competing controller stage red and reports the conflict', () => {
    const index = buildSignalControlIndex(programs);
    const selected = selectSignalReference(index, 'h1')!;
    const result = evaluateSignalReferencePhase(index, selected, {
      timeSeconds: 3,
      referencePhase: 'green',
      movementPhases: { 'east-through': 'green' },
    });
    expect(result.headStates).toEqual({ h1: 'green', h2: 'green', h3: 'red' });
    expect(result.movementStates['east-through']).toBe('red');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'conflicting_controller_stage' }));
  });

  it('resolves incompatible claims on a shared physical head restrictively', () => {
    const shared: SignalProgram = {
      ...programs[1]!, id: 'east-shared',
      mapBinding: {
        ...programs[1]!.mapBinding!, headIds: ['h1'],
        controllerHeadGroups: [{ controllerId: 'stage-ew', headIds: ['h1'] }],
      },
    };
    const index = buildSignalControlIndex([programs[0]!, shared]);
    const selected = selectSignalReference(index, 'h1', 'north-through')!;
    const result = evaluateSignalReferencePhase(index, selected, {
      timeSeconds: 1, referencePhase: 'green', movementPhases: { 'east-shared': 'red' },
    });
    expect(result.headStates.h1).toBe('red');
    expect(result.diagnostics.filter((entry) => entry.code === 'shared_head').length).toBeGreaterThan(0);
  });
});
