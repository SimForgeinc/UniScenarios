import { describe, expect, it } from 'vitest';

import { ScenarioOperationError, ScenarioValidationError } from '../errors.js';
import { parseTemplate, serializeTemplate } from '../serialize.js';
import { TemplateDocument } from '../template-document.js';
import {
  dashCameras,
  defaultDashCamera,
  firstEnabledDashCamera,
  sensorAperture,
  supportsDashCamera,
} from '../schema/v2/sensors.js';
import { ltapTemplateInput } from './v2-fixtures.js';

describe('actor-attached sensors', () => {
  it('migrates legacy actor specs to an explicit empty sensor list', () => {
    const template = parseTemplate(ltapTemplateInput());
    expect(template.roles.every((role) => Array.isArray(role.actor.sensors))).toBe(true);
    expect(template.roles[0]?.actor.sensors).toEqual([]);
  });

  it('round-trips a dash camera without losing its stable id or calibration', () => {
    const input = ltapTemplateInput();
    const camera = defaultDashCamera(
      { class: 'car', dims: { length: 4.4, width: 1.8, height: 1.6 } },
      'front-dash-camera',
    );
    input.roles![0]!.actor.sensors = [camera];

    const first = parseTemplate(input);
    const second = parseTemplate(JSON.parse(serializeTemplate(first)));
    expect(second.roles[0]?.actor.sensors).toEqual(first.roles[0]?.actor.sensors);
    expect(firstEnabledDashCamera(second.roles[0]!.actor)?.id).toBe('front-dash-camera');
  });

  it('rejects duplicate sensor ids and unsupported actor mounts clearly', () => {
    const duplicate = ltapTemplateInput();
    const camera = defaultDashCamera({ class: 'car' }, 'same-camera');
    duplicate.roles![0]!.actor.sensors = [camera, camera];
    expect(() => parseTemplate(duplicate)).toThrow(ScenarioValidationError);

    const unsupported = ltapTemplateInput();
    unsupported.roles![0]!.actor = {
      class: 'pedestrian',
      sensors: [{ ...camera, id: 'pedestrian-camera' }],
    };
    expect(() => parseTemplate(unsupported)).toThrow(/not supported on actor class/);
    expect(supportsDashCamera({ class: 'pedestrian' })).toBe(false);
  });

  it('discovers enabled dash cameras deterministically', () => {
    const first = defaultDashCamera({ class: 'car' }, 'first');
    const disabled = { ...defaultDashCamera({ class: 'car' }, 'disabled'), enabled: false };
    const last = defaultDashCamera({ class: 'car' }, 'last');
    expect(dashCameras({ sensors: [first, disabled, last] }).map((sensor) => sensor.id))
      .toEqual(['first', 'last']);
  });

  it('supports add, update, remove and undo through TemplateDocument', () => {
    const doc = TemplateDocument.fromJSON(ltapTemplateInput());
    const camera = defaultDashCamera(doc.role('ego')!.actor, 'ego-dash-camera');
    doc.addActorSensor('ego', camera);
    expect(doc.actorSensor('ego', camera.id)).toEqual(camera);

    doc.replaceActorSensor('ego', camera.id, {
      ...camera,
      camera: { ...camera.camera, horizontalFovDeg: 110 },
    });
    // `sensors` is now a union over modalities, so read the angular envelope
    // through the shared accessor rather than a camera-only field.
    expect(sensorAperture(doc.actorSensor('ego', camera.id)!).horizontalFovDeg).toBe(110);

    doc.removeActorSensor('ego', camera.id);
    expect(doc.actorSensor('ego', camera.id)).toBeUndefined();
    expect(doc.undo()).toBe(true);
    expect(sensorAperture(doc.actorSensor('ego', camera.id)!).horizontalFovDeg).toBe(110);
    expect(() => doc.removeActorSensor('ego', 'missing')).toThrow(ScenarioOperationError);
  });
});
