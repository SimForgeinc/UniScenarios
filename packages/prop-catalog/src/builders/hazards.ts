import { Group } from 'three';

import { box, cyl, type Point2, profile, rand, sphere, torus } from '../geometry.js';
import { material } from '../materials.js';

/**
 * Small objects that end up in the travelled way. These are the classic
 * "is it drivable-over or is it a rock?" perception cases, so their size is the
 * whole point: a shredded retread is 0.7 m of black rubber, a blown-out
 * cardboard box is 0.6 m of nothing.
 */

/** Shredded truck retread lying in the lane. */
export function buildTireDebris(): Group {
  const group = new Group();
  const rubber = material('tire');

  const ring = torus(0.26, 0.055, rubber, { at: [0, 0.055, 0], rot: [Math.PI / 2, 0, 0], segments: 16 });
  ring.scale.set(1.15, 0.72, 1);
  group.add(ring);
  // A torn-off strip curling up off the road.
  group.add(
    profile(
      [
        [-0.30, 0.02],
        [-0.10, 0.20],
        [0.20, 0.24],
        [0.22, 0.17],
        [-0.06, 0.13],
        [-0.26, 0.0],
      ],
      0.20,
      rubber,
      { radius: 0.03, bevel: 0.02, at: [0.14, 0, 0.10], rot: [0, 0.5, 0] },
    ),
  );
  group.add(box([0.16, 0.05, 0.12], rubber, { at: [-0.24, 0.042, -0.14], rot: [0, 0.7, 0.2] }));
  return group;
}

/** Empty cardboard box, flaps open. */
export function buildCardboardBox(): Group {
  const group = new Group();
  const card = material('cardboard');
  const l = 0.58;
  const w = 0.42;
  const h = 0.36;

  group.add(box([l, h, w], card, { at: [0, h / 2, 0] }));
  // Open flaps, splayed at the top.
  group.add(box([l, 0.012, w * 0.5], card, { at: [0, h + 0.06, w * 0.30], rot: [-0.55, 0, 0] }));
  group.add(box([l, 0.012, w * 0.5], card, { at: [0, h + 0.04, -w * 0.34], rot: [0.75, 0, 0] }));
  group.add(box([0.03, 0.004, w], material('fabric'), { at: [0, h + 0.001, 0] }));
  return group;
}

export interface TrashBagParams {
  count: number;
  seed: number;
}

/** Cluster of tied refuse sacks at the kerb. */
export function buildTrashBags(params: TrashBagParams = { count: 3, seed: 11 }): Group {
  const group = new Group();
  const bag = material('plastic');
  const random = rand(params.seed);
  const count = Math.max(1, Math.round(params.count));

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random();
    const radius = count === 1 ? 0 : 0.24 + random() * 0.10;
    const r = 0.26 + random() * 0.05;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.8;
    const bodyH = r * 1.9;
    group.add(
      sphere(r, bag, { at: [x, bodyH / 2, z], scale: [1, 0.95, 0.92], segments: 12 }),
    );
    group.add(
      cyl(r * 0.42, r * 0.42, bag, {
        rTop: r * 0.14,
        at: [x, bodyH - r * 0.06, z],
        segments: 10,
      }),
    );
  }
  return group;
}

/** Storm-broken branch across the lane. */
export function buildDownedBranch(): Group {
  const group = new Group();
  const wood = material('wood');
  const foliage = material('foliage');
  const random = rand(5);

  // Main limb lying on the road; everything else hangs off it, and every piece
  // rests on y = 0 rather than hovering above it.
  const limb = cyl(0.075, 2.10, wood, { axis: 'x', at: [-0.10, 0.075, 0], segments: 8 });
  limb.rotation.y = 0.12;
  group.add(limb);

  const branches: Point2[] = [
    [-0.80, 0.50],
    [-0.25, -0.40],
    [0.35, 0.34],
    [0.70, -0.28],
  ];
  for (const [x, z] of branches) {
    const len = 0.42 + random() * 0.3;
    const r = 0.032;
    const twig = cyl(r, len, wood, { axis: 'x', at: [x + len * 0.28, r, z * 0.5], segments: 6 });
    twig.rotation.y = Math.atan2(z, 0.5);
    group.add(twig);
    const leafR = 0.20 + random() * 0.06;
    group.add(
      sphere(leafR, foliage, {
        at: [x + len * 0.5, leafR * 0.62, z * 0.8],
        scale: [1.2, 0.62, 1],
        segments: 8,
      }),
    );
  }
  // A forked limb propped up off the road — the part that actually protrudes
  // into a bumper rather than passing under the car.
  const fork = cyl(0.045, 0.72, wood, { axis: 'x', at: [0.72, 0.20, 0.12], segments: 6 });
  fork.rotation.z = 0.36;
  fork.rotation.y = -0.25;
  group.add(fork);
  group.add(
    sphere(0.22, foliage, { at: [1.05, 0.30, 0.02], scale: [1.1, 0.7, 1], segments: 8 }),
  );
  return group;
}
