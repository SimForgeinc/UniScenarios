import { Group } from 'three';

import { box, cyl, sphere } from '../geometry.js';
import { material } from '../materials.js';

export interface RobotParams { color?: string }

/** Canonical compact delivery rover used as the sidewalk-robot fallback. */
export function buildDeliveryRover(params: RobotParams = {}): Group {
  const dims = { l: 0.75, w: 0.55, h: 0.8 };
  const group = new Group();
  const paint = material('paint', params.color ?? '#f1a34f');
  const dark = material('plastic');
  const glass = material('glass');
  const wheelR = Math.min(dims.h * 0.16, dims.w * 0.18);
  const wheelW = dims.w * 0.08;
  const floorH = 0.04;
  group.add(box([dims.l, floorH, dims.w], dark, { at: [0, floorH / 2, 0], name: 'chassis' }));
  group.add(box([dims.l * 0.76, dims.h * 0.58, dims.w * 0.78], paint, {
    at: [-dims.l * 0.03, wheelR + dims.h * 0.29, 0], name: 'cargo-body',
  }));
  group.add(box([dims.l * 0.28, dims.h * 0.12, dims.w * 0.8], glass, {
    at: [dims.l * 0.28, wheelR + dims.h * 0.42, 0], name: 'sensor-band',
  }));
  for (const x of [-dims.l * 0.3, dims.l * 0.3]) for (const z of [-1, 1] as const) {
    group.add(cyl(wheelR, wheelW, dark, { axis: 'z', at: [x, wheelR, z * (dims.w / 2 - wheelW / 2)], name: 'wheel' }));
  }
  const mastH = dims.h * 0.2;
  group.add(cyl(0.025, mastH, material('metal'), { at: [dims.l * 0.18, dims.h - mastH / 2, 0], name: 'sensor-mast' }));
  group.add(sphere(0.055, glass, { at: [dims.l * 0.18, dims.h - 0.055, 0], name: 'lidar' }));
  return group;
}
