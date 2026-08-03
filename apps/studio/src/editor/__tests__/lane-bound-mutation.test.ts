import { Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { MemoryStorage, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import { EditorController } from '../controller';
import { EditorDocument } from '../document';
import { LaneIndex } from '../laneIndex';

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});
afterEach(() => vi.unstubAllGlobals());

function lanes(): LaneIndex {
  return LaneIndex.build({
    mapName: 'lane-mutation',
    lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', polyline: [{ x: 0, y: 0 }, { x: 400, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', polyline: [{ x: 0, y: 20 }, { x: 400, y: 20 }] },
    },
  });
}

describe('lane-bound pose mutation', () => {
  it('commits inspector cross-lane pose, anchor and executable route as one undoable change', async () => {
    const document = await EditorDocument.openBlank(MAPS[0]!, {
      store: new WebTemplateFileStore({ storage: new MemoryStorage() }), autosaveMs: 60_000,
    });
    document.add([{
      id: 'ego', catalogId: 'vehicle.sedan', x: 10, y: 0, z: 0, headingRad: 0,
      laneRef: { roadId: '1', section: 0, laneId: -1, s: 10, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: ['1:0:-1'], initialSpeedKph: 48.28032,
    }]);
    const controller = new EditorController({
      viewer: { scene: new Scene() } as unknown as CityViewer,
      laneIndex: lanes(), document, sampleHeight: () => 0,
    });

    controller.setWorldPose('ego', { x: 50, z: -20, headingDeg: 0 });

    expect(document.actor('ego')).toMatchObject({
      x: 50, z: -20,
      laneRef: { roadId: '2', section: 0, laneId: -1, s: 50, t: 0 },
      routeLaneRsls: ['2:0:-1'],
    });
    expect(document.data.roles[0]).toMatchObject({
      pose: { position: { x: 50, z: -20 } },
      laneRef: { roadId: '2', s: 50 },
      initialRoute: { lanes: ['2:0:-1'] },
    });
    expect(document.undo()).toBe(true);
    expect(document.actor('ego')).toMatchObject({ x: 10, z: 0, laneRef: { roadId: '1' }, routeLaneRsls: ['1:0:-1'] });
    expect(document.redo()).toBe(true);
    expect(document.actor('ego')).toMatchObject({ x: 50, z: -20, laneRef: { roadId: '2' }, routeLaneRsls: ['2:0:-1'] });

    controller.dispose();
    document.dispose();
  });

  it('moves an actor onto a short terminal lane and uses the available route', async () => {
    const document = await EditorDocument.openBlank(MAPS[0]!, {
      store: new WebTemplateFileStore({ storage: new MemoryStorage() }), autosaveMs: 60_000,
    });
    document.add([{
      id: 'ego', catalogId: 'vehicle.sedan', x: 10, y: 0, z: 0, headingRad: 0,
      laneRef: { roadId: '1', section: 0, laneId: -1, s: 10, t: 0, headingOffsetRad: 0 },
      routeLaneRsls: ['1:0:-1'], initialSpeedKph: 48.28032,
    }]);
    const short = LaneIndex.build({ mapName: 'short-destination', lanes: {
      '1:0:-1': { roadId: 1, section: 0, laneId: -1, laneType: 'driving', polyline: [{ x: 0, y: 0 }, { x: 400, y: 0 }] },
      '2:0:-1': { roadId: 2, section: 0, laneId: -1, laneType: 'driving', polyline: [{ x: 0, y: 20 }, { x: 20, y: 20 }] },
    } });
    const controller = new EditorController({ viewer: { scene: new Scene() } as unknown as CityViewer, laneIndex: short, document, sampleHeight: () => 0 });

    controller.setWorldPose('ego', { x: 10, z: -20 });

    expect(document.actor('ego')).toMatchObject({ x: 10, z: -20, laneRef: { roadId: '2' }, routeLaneRsls: ['2:0:-1'] });
    expect(document.undo()).toBe(true);
    expect(document.actor('ego')).toMatchObject({ x: 10, z: 0, laneRef: { roadId: '1' }, routeLaneRsls: ['1:0:-1'] });
    controller.dispose();
    document.dispose();
  });
});
