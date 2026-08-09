import { Group } from 'three';

import { box, cone, cyl, sphere } from '../geometry';
import { material } from '../materials';

export interface AnimalParams { coatColor?: string; }

function quadruped(dims: { l: number; w: number; h: number }, params: AnimalParams, shape: 'dog' | 'cat' | 'deer' | 'raccoon'): Group {
  const group = new Group();
  const coat = material('fabric', params.coatColor ?? ({ dog: '#9b6d45', cat: '#6f747a', deer: '#9a6842', raccoon: '#666b70' }[shape]));
  const dark = material('plastic');
  const legH = dims.h * (shape === 'deer' ? .58 : .46);
  const bodyH = dims.h * .34;
  const bodyL = dims.l * (shape === 'deer' ? .56 : .58);
  group.add(sphere(.5, coat, { at: [-dims.l * .06, legH + bodyH * .45, 0], scale: [bodyL, bodyH, dims.w * .72], name: 'torso' }));
  const headR = dims.h * (shape === 'deer' ? .11 : .16);
  const headX = dims.l / 2 - headR;
  const headY = shape === 'deer' ? dims.h * .75 : legH + bodyH * .6;
  group.add(sphere(headR, coat, { at: [headX, headY, 0], scale: [1.2, 1, .9], name: 'head' }));
  group.add(sphere(headR * .55, dark, { at: [dims.l / 2 - headR * .1, headY - headR * .12, 0], scale: [1, .6, .75], name: 'muzzle' }));
  for (const x of [-bodyL * .34, bodyL * .3]) for (const z of [-dims.w * .29, dims.w * .29]) {
    group.add(cyl(Math.max(.018, dims.w * .045), legH, coat, { at: [x, legH / 2, z], name: 'animated-leg' }));
  }
  const tailL = Math.max(.18, dims.l * .28);
  const tail = cyl(Math.max(.018, dims.w * .04), tailL, coat, {
    axis: 'x', at: [-dims.l / 2 + tailL / 2, legH + bodyH * .55, 0], name: 'animated-tail',
  });
  tail.rotation.z = shape === 'cat' ? .55 : -.22;
  group.add(tail);
  for (const z of [-1, 1] as const) group.add(cone(headR * .38, headR * .8, coat, {
    at: [headX - headR * .15, headY + headR * .8, z * headR * .45], name: 'ear',
  }));
  if (shape === 'deer') {
    group.add(cyl(.018, dims.h * .26, dark, { at: [headX, dims.h * .88, -.08], name: 'antler' }));
    group.add(cyl(.018, dims.h * .26, dark, { at: [headX, dims.h * .88, .08], name: 'antler' }));
  }
  // Exact ground and lateral envelopes keep placement/collision dimensions honest.
  group.add(box([dims.l, .02, dims.w], coat, { at: [0, .01, 0], name: 'footprint-envelope' }));
  group.add(sphere(.015, coat, { at: [0, dims.h - .015, 0], name: 'height-envelope' }));
  return group;
}

export const buildDog = (params: AnimalParams = {}) => quadruped({ l: 1.1, w: .42, h: .78 }, params, 'dog');
export const buildCat = (params: AnimalParams = {}) => quadruped({ l: .72, w: .28, h: .42 }, params, 'cat');
export const buildDeer = (params: AnimalParams = {}) => quadruped({ l: 1.8, w: .55, h: 1.75 }, params, 'deer');
export const buildRaccoon = (params: AnimalParams = {}) => quadruped({ l: .85, w: .35, h: .5 }, params, 'raccoon');

export function buildGoose(params: AnimalParams = {}): Group {
  const group = new Group();
  const feather = material('safetyWhite', params.coatColor ?? '#d8d8cf');
  const dark = material('plastic');
  const orange = material('safetyOrange');
  group.add(sphere(.25, feather, { at: [-.08, .42, 0], scale: [1.1, .96, 1], name: 'body' }));
  group.add(cyl(.055, .43, dark, { at: [.22, .61, 0], rot: [0, 0, -.28], name: 'neck' }));
  group.add(sphere(.09, dark, { at: [.28, .79, 0], name: 'head' }));
  group.add(cone(.045, .18, orange, { at: [.39, .78, 0], rot: [0, 0, -Math.PI / 2], name: 'beak' }));
  for (const z of [-.08, .08]) {
    group.add(cyl(.014, .27, orange, { at: [-.02, .14, z], name: 'leg' }));
    group.add(box([.18, .02, .07], orange, { at: [.03, .01, z], name: 'foot' }));
  }
  group.add(box([.86, .015, .5], feather, { at: [0, .0075, 0], name: 'footprint-envelope' }));
  return group;
}
