import { Group } from 'three';

import { box, cyl, sphere } from '../geometry.js';
import { material } from '../materials.js';

export interface DroneParams { color?: string }

/** Canonical camera quadcopter used as the drone fallback. */
export function buildCameraDrone(params: DroneParams = {}): Group {
  const dims = { l: 0.65, w: 0.65, h: 0.32 };
  const group = new Group();
  const paint = material('paint', params.color ?? '#444c57');
  const dark = material('plastic');
  const metal = material('metal');
  const armT = 0.035;
  const bodyY = dims.h * 0.52;
  group.add(box([dims.l, 0.025, armT], metal, { at: [0, bodyY, 0], name: 'rotor-arm-x' }));
  group.add(box([armT, 0.025, dims.w], metal, { at: [0, bodyY, 0], name: 'rotor-arm-z' }));
  group.add(box([dims.l * 0.27, dims.h * 0.25, dims.w * 0.27], paint, { at: [0, bodyY, 0], name: 'flight-controller' }));
  for (const [x, z] of [[-0.4, -0.4], [-0.4, 0.4], [0.4, -0.4], [0.4, 0.4]] as const) {
    const px = x * dims.l;
    const pz = z * dims.w;
    group.add(cyl(0.045, 0.07, dark, { at: [px, bodyY + 0.035, pz], name: 'motor' }));
    group.add(box([dims.l * 0.18, 0.012, 0.025], dark, { at: [px, bodyY + 0.085, pz], name: 'rotor' }));
  }
  group.add(box([dims.l * 0.3, dims.h * 0.26, dims.w * 0.28], dark, {
    at: [0, bodyY - dims.h * 0.22, 0], name: 'camera-payload',
  }));
  group.add(sphere(0.055, material('glass'), { at: [dims.l * 0.14, bodyY - dims.h * 0.1, 0], name: 'camera-gimbal' }));
  for (const z of [-1, 1] as const) {
    group.add(box([dims.l * 0.45, 0.025, 0.025], dark, { at: [0, 0.0125, z * dims.w * 0.2], name: 'landing-skid' }));
    group.add(box([0.025, bodyY * 0.62, 0.025], dark, { at: [-dims.l * 0.16, bodyY * 0.31, z * dims.w * 0.2], name: 'landing-leg' }));
  }
  group.add(sphere(0.015, paint, { at: [0, dims.h - 0.015, 0], name: 'height-envelope' }));
  return group;
}
