import { Group } from 'three';

import { box, cyl, sphere } from '../geometry';
import { material } from '../materials';

export interface RobotParams { color?: string; }

function wheeledRobot(dims: { l: number; w: number; h: number }, params: RobotParams, style: 'courier' | 'cooler'): Group {
  const group = new Group();
  const paint = material('paint', params.color ?? (style === 'courier' ? '#f1a34f' : '#edf1f4'));
  const dark = material('plastic');
  const glass = material('glass');
  const wheelR = Math.min(dims.h * .16, dims.w * .18);
  const wheelW = dims.w * .08;
  const floorH = .04;
  group.add(box([dims.l, floorH, dims.w], dark, { at: [0, floorH / 2, 0], name: 'chassis' }));
  group.add(box([dims.l * .76, dims.h * .58, dims.w * .78], paint, {
    at: [-dims.l * .03, wheelR + dims.h * .29, 0], name: 'cargo-body',
  }));
  group.add(box([dims.l * .28, dims.h * .12, dims.w * .8], glass, {
    at: [dims.l * .28, wheelR + dims.h * .42, 0], name: 'sensor-band',
  }));
  for (const x of [-dims.l * .3, dims.l * .3]) for (const z of [-1, 1] as const) {
    group.add(cyl(wheelR, wheelW, dark, { axis: 'z', at: [x, wheelR, z * (dims.w / 2 - wheelW / 2)], name: 'wheel' }));
  }
  const mastH = dims.h * .2;
  group.add(cyl(.025, mastH, material('metal'), { at: [dims.l * .18, dims.h - mastH / 2, 0], name: 'sensor-mast' }));
  group.add(sphere(.055, glass, { at: [dims.l * .18, dims.h - .055, 0], name: 'lidar' }));
  return group;
}

export function buildDeliveryRover(params: RobotParams = {}): Group {
  return wheeledRobot({ l: .75, w: .55, h: .8 }, params, 'courier');
}

export function buildCoolerRobot(params: RobotParams = {}): Group {
  return wheeledRobot({ l: .95, w: .65, h: .95 }, params, 'cooler');
}

export function buildQuadrupedCourier(params: RobotParams = {}): Group {
  const group = new Group();
  const paint = material('paint', params.color ?? '#e6b84f');
  const joint = material('plastic');
  const bodyY = .5;
  group.add(box([.72, .27, .34], paint, { at: [-.03, bodyY, 0], name: 'cargo-body' }));
  group.add(box([.22, .2, .3], joint, { at: [.4, .54, 0], name: 'sensor-head' }));
  group.add(box([1.05, .04, .5], joint, { at: [0, .02, 0], name: 'ground-envelope' }));
  for (const x of [-.28, .26]) for (const z of [-.2, .2]) {
    group.add(cyl(.035, .43, joint, { at: [x, .255, z], name: 'articulated-leg' }));
    group.add(sphere(.055, joint, { at: [x, .46, z], name: 'hip-joint' }));
  }
  group.add(cyl(.02, .22, material('metal'), { at: [.12, .61, 0], name: 'mast' }));
  group.add(sphere(.055, material('glass'), { at: [.12, .69, 0], name: 'lidar' }));
  return group;
}

type HumanoidStyle = 'general' | 'delivery' | 'warehouse' | 'public-safety' | 'construction';

function humanoidRobot(
  dims: { l: number; w: number; h: number },
  params: RobotParams,
  style: HumanoidStyle,
): Group {
  const group = new Group();
  const paint = material('paint', params.color ?? '#e8edf2');
  const joint = material('plastic');
  const metal = material('metal');
  const glass = material('glass');
  const headR = dims.h * .095;
  const footH = dims.h * .045;
  const legH = dims.h * .43;
  const hipY = footH + legH;
  const torsoH = dims.h * .34;
  const torsoY = hipY + torsoH * .48;
  const armR = dims.w * .055;

  // Full-length feet and outboard hands make the procedural preview obey the
  // same authored-model envelope promised by the catalog.
  for (const z of [-dims.w * .16, dims.w * .16]) {
    group.add(box([dims.l, footH, dims.w * .24], joint, { at: [dims.l * .06, footH / 2, z], name: 'foot' }));
    group.add(box([dims.l * .22, legH, dims.w * .16], paint, { at: [0, footH + legH / 2, z], name: 'articulated-leg' }));
    group.add(sphere(dims.w * .075, joint, { at: [0, hipY, z], name: 'hip-joint' }));
  }

  group.add(box([dims.l * .52, torsoH, dims.w * .56], paint, { at: [0, torsoY, 0], name: 'torso' }));
  group.add(box([dims.l * .58, dims.h * .07, dims.w * .62], joint, { at: [0, hipY, 0], name: 'pelvis' }));
  group.add(cyl(dims.w * .065, dims.h * .08, metal, { at: [0, torsoY + torsoH * .56, 0], name: 'neck' }));
  group.add(sphere(headR, paint, { at: [0, dims.h - headR, 0], name: 'head' }));
  group.add(box([headR * .55, headR * .42, headR * 1.55], glass, {
    at: [headR * .78, dims.h - headR, 0], name: 'sensor-face',
  }));

  for (const z of [-1, 1] as const) {
    const armZ = z * (dims.w / 2 - armR);
    group.add(cyl(armR, torsoH * .78, paint, { at: [0, torsoY - torsoH * .06, armZ], name: 'articulated-arm' }));
    group.add(sphere(armR, joint, { at: [0, torsoY - torsoH * .48, armZ], name: 'hand' }));
    group.add(sphere(armR * 1.18, joint, { at: [0, torsoY + torsoH * .35, armZ], name: 'shoulder-joint' }));
  }

  if (style === 'delivery') {
    group.add(box([dims.l * .24, dims.h * .27, dims.w * .48], paint, { at: [-dims.l * .30, torsoY, 0], name: 'parcel-pod' }));
  } else if (style === 'warehouse') {
    group.add(box([dims.l * .2, dims.h * .2, dims.w * .5], joint, { at: [-dims.l * .28, torsoY, 0], name: 'battery-pack' }));
  } else if (style === 'public-safety') {
    group.add(box([dims.l * .08, dims.h * .12, dims.w * .5], material('taillight'), { at: [dims.l * .29, torsoY + torsoH * .2, 0], name: 'warning-panel' }));
  } else if (style === 'construction') {
    group.add(cyl(headR * 1.15, headR * .32, material('safetyOrange'), { at: [0, dims.h - headR * .12, 0], name: 'safety-helmet' }));
  }

  return group;
}

export function buildGeneralPurposeHumanoid(params: RobotParams = {}): Group {
  return humanoidRobot({ l: .58, w: .62, h: 1.78 }, params, 'general');
}

export function buildDeliveryHumanoid(params: RobotParams = {}): Group {
  return humanoidRobot({ l: .62, w: .68, h: 1.7 }, params, 'delivery');
}

export function buildWarehouseHumanoid(params: RobotParams = {}): Group {
  return humanoidRobot({ l: .64, w: .7, h: 1.75 }, params, 'warehouse');
}

export function buildPublicSafetyHumanoid(params: RobotParams = {}): Group {
  return humanoidRobot({ l: .62, w: .68, h: 1.82 }, params, 'public-safety');
}

export function buildConstructionHumanoid(params: RobotParams = {}): Group {
  return humanoidRobot({ l: .66, w: .72, h: 1.85 }, params, 'construction');
}
