import { describe, expect, it } from 'vitest';

import {
  MemoryStorage,
  TemplateDocument,
  WebTemplateFileStore,
  defaultDashCamera,
} from '@uniscenarios/scenario-model';
import { MAPS } from '../../maps';
import {
  DEFAULT_AUTHORED_VEHICLE_SPEED_KPH,
  DEFAULT_AUTHORED_VEHICLE_SPEED_MPS,
  EditorDocument,
  autosaveName,
} from '../document';
import { defaultDrivingSpeedKph, deterministicActorCatalog } from '../controller';

describe('default placed-vehicle route lifecycle', () => {
  it('groups actor, exact route and cruise speed into one undoable, persisted gesture', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const route = ['1:0:-1', '2:0:-1', '3:0:-1'];

    const [actorId] = document.add([{
      id: 'vehicle_default_route',
      catalogId: 'vehicle.sedan',
      x: 10,
      y: 0,
      z: 20,
      headingRad: 0,
      laneRef: {
        roadId: '1',
        section: 0,
        laneId: -1,
        s: 10,
        t: 0,
        headingOffsetRad: 0,
      },
      routeLaneRsls: route,
      initialSpeedKph: DEFAULT_AUTHORED_VEHICLE_SPEED_KPH,
    }]);

    expect(actorId).toBe('vehicle_default_route');
    expect(document.data.roles.map((role) => role.id)).toContain(actorId);
    expect(document.data.choreography.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `route_${actorId}_initial`,
        actor: actorId,
        label: 'Random turns',
        verb: 'route',
        target: { mode: 'lanePath', lanes: route },
      }),
      expect.objectContaining({
        id: `speed_${actorId}_initial`,
        actor: actorId,
        label: '30 mph',
        verb: 'speed',
        target: { mode: 'absolute', valueKph: DEFAULT_AUTHORED_VEHICLE_SPEED_KPH },
      }),
    ]));
    expect(document.validation.ok).toBe(true);

    expect(document.undo()).toBe(true);
    expect(document.actor(actorId!)).toBeUndefined();
    expect(document.data.choreography.interactions.some((item) => item.actor === actorId)).toBe(false);
    expect(document.canUndo).toBe(false);

    expect(document.redo()).toBe(true);
    expect(document.actor(actorId!)).toBeDefined();
    expect(document.data.choreography.interactions.filter((item) => item.actor === actorId)).toHaveLength(2);

    await document.flush();
    const saved = TemplateDocument.fromJSON(await store.read(autosaveName(map.id)));
    expect(saved.data.roles.map((role) => role.id)).toContain(actorId);
    expect(saved.data.choreography.interactions).toEqual(document.data.choreography.interactions);
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.actor(actorId!)).toBeDefined();
    expect(reopened.data.choreography.interactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: actorId,
        verb: 'route',
        target: { mode: 'lanePath', lanes: route },
      }),
      expect.objectContaining({ actor: actorId, verb: 'speed' }),
    ]));
    reopened.dispose();
  });

  it('uses the exact 30 mph SI value only for newly placeable motor-road vehicles', () => {
    expect(DEFAULT_AUTHORED_VEHICLE_SPEED_MPS).toBe(13.4112);
    expect(DEFAULT_AUTHORED_VEHICLE_SPEED_KPH / 3.6).toBeCloseTo(13.4112, 10);
    expect(defaultDrivingSpeedKph('vehicle.sedan')).toBe(DEFAULT_AUTHORED_VEHICLE_SPEED_KPH);
    expect(defaultDrivingSpeedKph('vehicle.motorcycle')).toBe(DEFAULT_AUTHORED_VEHICLE_SPEED_KPH);
    expect(defaultDrivingSpeedKph('vehicle.bicycle')).toBeNull();
    expect(defaultDrivingSpeedKph('vehicle.mobility_scooter')).toBeNull();
    expect(defaultDrivingSpeedKph('pedestrian.adult_walking')).toBeNull();
    expect(defaultDrivingSpeedKph('hazard.cardboard_box')).toBeNull();
  });

  it('chooses compatible models deterministically and persists appearance edits without touching behavior', async () => {
    const seed = 'map|scenario|seed';
    const first = deterministicActorCatalog('vehicle', seed, 'vehicle_42');
    expect(deterministicActorCatalog('vehicle', seed, 'vehicle_42')).toBe(first);
    expect(deterministicActorCatalog('pedestrian', seed, 'pedestrian_42')).toMatch(/^pedestrian\./);
    expect(defaultDrivingSpeedKph(first)).toBe(DEFAULT_AUTHORED_VEHICLE_SPEED_KPH);

    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const [id] = document.add([{ id: 'vehicle_appearance', catalogId: 'vehicle.sedan', x: 1, y: 2, z: 3, headingRad: .4, bodyColor: '#123456' }]);
    document.update([{ id: id!, catalogId: 'vehicle.suv', bodyColor: '#abcdef' }]);
    expect(document.actor(id!)?.catalogId).toBe('vehicle.suv');
    expect(document.actor(id!)?.bodyColor).toBe('#abcdef');
    expect(document.actor(id!)).toMatchObject({ x: 1, y: 2, z: 3, headingRad: .4 });
    expect(document.undo()).toBe(true);
    expect(document.actor(id!)?.catalogId).toBe('vehicle.sedan');
    expect(document.actor(id!)?.bodyColor).toBe('#123456');
    expect(document.redo()).toBe(true);
    await document.flush();
    document.dispose();
    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.actor(id!)).toMatchObject({ catalogId: 'vehicle.suv', bodyColor: '#abcdef', x: 1, y: 2, z: 3 });
    reopened.dispose();
  });

  it('persists dash-camera edits and groups each sensor action into undo history', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const [id] = document.add([{ id: 'camera_vehicle', catalogId: 'vehicle.sedan', x: 0, y: 0, z: 0, headingRad: 0 }]);
    const role = document.data.roles.find((item) => item.id === id)!;
    const camera = defaultDashCamera(role.actor, 'front-dash-camera');

    document.addActorSensor(id!, camera);
    expect(document.actor(id!)?.sensors).toEqual([camera]);
    document.updateActorSensor(id!, camera.id, {
      ...camera,
      enabled: false,
      camera: { ...camera.camera, horizontalFovDeg: 105 },
    });
    expect(document.actor(id!)?.sensors[0]).toMatchObject({ enabled: false, camera: { horizontalFovDeg: 105 } });
    expect(document.undo()).toBe(true);
    expect(document.actor(id!)?.sensors[0]).toMatchObject({ enabled: true, camera: { horizontalFovDeg: 90 } });
    expect(document.redo()).toBe(true);

    await document.flush();
    document.dispose();
    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.actor(id!)?.sensors[0]).toMatchObject({ id: camera.id, enabled: false, camera: { horizontalFovDeg: 105 } });
    reopened.removeActorSensor(id!, camera.id);
    expect(reopened.actor(id!)?.sensors).toEqual([]);
    expect(reopened.undo()).toBe(true);
    expect(reopened.actor(id!)?.sensors).toHaveLength(1);
    reopened.dispose();
  });

  it('deletes an object as one undoable gesture and persists its removal on reload', async () => {
    const map = MAPS[0]!;
    const store = new WebTemplateFileStore({ storage: new MemoryStorage() });
    const document = await EditorDocument.open(map, { store, autosaveMs: 1 });
    const [id] = document.add([{ id: 'timeline_delete_prop', catalogId: 'construction.traffic_cone', x: 2, y: 0, z: 3, headingRad: 0 }]);

    document.remove([id!]);
    expect(document.data.roles.some((role) => role.id === id)).toBe(false);
    expect(document.undo()).toBe(true);
    expect(document.data.roles.some((role) => role.id === id)).toBe(true);
    expect(document.redo()).toBe(true);
    expect(document.data.roles.some((role) => role.id === id)).toBe(false);

    await document.flush();
    document.dispose();
    const reopened = await EditorDocument.open(map, { store, autosaveMs: 1 });
    expect(reopened.data.roles.some((role) => role.id === id)).toBe(false);
    reopened.dispose();
  });
});
