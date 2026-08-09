import { Group } from 'three';

import { box, cyl, sphere } from '../geometry';
import { material } from '../materials';

export interface DroneParams { color?: string; }

function quadcopter(dims: { l: number; w: number; h: number }, params: DroneParams, payload: 'parcel' | 'camera' | 'emergency'): Group {
  const group = new Group();
  const paint = material('paint', params.color ?? (payload === 'emergency' ? '#e9edf2' : '#444c57'));
  const dark = material('plastic');
  const metal = material('metal');
  const armT = .035;
  const bodyY = dims.h * .52;
  group.add(box([dims.l, .025, armT], metal, { at: [0, bodyY, 0], name: 'rotor-arm-x' }));
  group.add(box([armT, .025, dims.w], metal, { at: [0, bodyY, 0], name: 'rotor-arm-z' }));
  group.add(box([dims.l * .27, dims.h * .25, dims.w * .27], paint, { at: [0, bodyY, 0], name: 'flight-controller' }));
  for (const [x, z] of [[-.4, -.4], [-.4, .4], [.4, -.4], [.4, .4]] as const) {
    const px = x * dims.l;
    const pz = z * dims.w;
    group.add(cyl(.045, .07, dark, { at: [px, bodyY + .035, pz], name: 'motor' }));
    group.add(box([dims.l * .18, .012, .025], dark, { at: [px, bodyY + .085, pz], name: 'rotor' }));
  }
  const payloadH = dims.h * .26;
  group.add(box([dims.l * .3, payloadH, dims.w * .28], payload === 'parcel' ? material('cardboard') : dark, {
    at: [0, bodyY - dims.h * .22, 0], name: `${payload}-payload`,
  }));
  group.add(sphere(.055, material(payload === 'emergency' ? 'lamp' : 'glass'), {
    at: [dims.l * .14, bodyY - dims.h * .1, 0], name: payload === 'emergency' ? 'beacon' : 'camera-gimbal',
  }));
  for (const z of [-1, 1] as const) {
    group.add(box([dims.l * .45, .025, .025], dark, { at: [0, .0125, z * dims.w * .2], name: 'landing-skid' }));
    group.add(box([.025, bodyY * .62, .025], dark, { at: [-dims.l * .16, bodyY * .31, z * dims.w * .2], name: 'landing-leg' }));
  }
  group.add(sphere(.015, paint, { at: [0, dims.h - .015, 0], name: 'height-envelope' }));
  return group;
}

export function buildDeliveryDrone(params: DroneParams = {}): Group {
  return quadcopter({ l: 1.1, w: 1.1, h: .45 }, params, 'parcel');
}

export function buildCameraDrone(params: DroneParams = {}): Group {
  return quadcopter({ l: .65, w: .65, h: .32 }, params, 'camera');
}

export function buildEmergencyDrone(params: DroneParams = {}): Group {
  return quadcopter({ l: 1.4, w: 1.4, h: .5 }, params, 'emergency');
}
