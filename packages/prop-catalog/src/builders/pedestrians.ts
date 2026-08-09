import { Group, type Mesh } from 'three';

import { box, capsule, type Point2, profile, sphere } from '../geometry';
import { material, type MaterialKey } from '../materials';

/**
 * Humans are capsule-and-slab figures at anthropometrically correct heights.
 * A pedestrian's job in a scenario is to be the right size in the right place
 * with a readable pose — a walking figure has a stride, a standing one does
 * not — so proportions are driven off `height` rather than hand-placed.
 */
export interface PedestrianParams {
  /** Overall stature, metres. Adults ~1.75, children ~1.20. */
  height: number;
  /** `walking` splays the limbs into a mid-stride pose. */
  pose: 'standing' | 'walking';
  shirtColor?: string;
  pantsColor?: string;
  skinColor?: string;
}

export interface HumanoidOptions {
  height: number;
  pose: 'standing' | 'walking';
  /** Head radius as a fraction of height; children are top-heavy. */
  headRatio?: number;
  shirt?: { key: MaterialKey; color?: string };
  pants?: { key: MaterialKey; color?: string };
  skinColor?: string;
  /** Extra torso layer (hi-vis vest) drawn over the shirt. */
  vest?: boolean;
  /** Right-arm (−Z side) shoulder pitch in radians, for holding things. */
  rightArmPitch?: number;
}

/** Capsule between two side-view joints at a given Z. */
function limb(
  from: Point2,
  to: Point2,
  radius: number,
  mat: ReturnType<typeof material>,
  z: number,
): Mesh {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const span = Math.hypot(dx, dy);
  const mesh = capsule(radius, Math.max(span - 2 * radius, 0.01), mat, { segments: 10 });
  mesh.rotation.z = Math.atan2(dy, dx) + Math.PI / 2;
  mesh.position.set((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z);
  return mesh;
}

/** The shared figure used by pedestrians and by the work-zone flagger. */
export function buildHumanoid(opts: HumanoidOptions): Group {
  const h = opts.height;
  const group = new Group();
  const skin = material('skin', opts.skinColor);
  const shirt = material(opts.shirt?.key ?? 'shirt', opts.shirt?.color);
  const pants = material(opts.pants?.key ?? 'pants', opts.pants?.color);
  const shoe = material('plastic');

  const headR = h * (opts.headRatio ?? 0.066);
  const headY = h - headR;
  const shoulderY = h - headR * 2 - h * 0.045;
  const hipY = h * 0.52;
  const torsoW = h * 0.195;
  const torsoD = h * 0.135;
  const armR = h * 0.031;
  const legR = h * 0.044;
  const stride = opts.pose === 'walking' ? h * 0.17 : 0;
  const footL = h * 0.15;
  const footH = h * 0.04;

  // Torso: a rounded slab, wider than deep.
  group.add(
    profile(
      [
        [-torsoD / 2, hipY],
        [-torsoD / 2, shoulderY],
        [torsoD / 2, shoulderY],
        [torsoD / 2, hipY - h * 0.02],
      ],
      torsoW,
      shirt,
      { radius: torsoD * 0.42, bevel: torsoD * 0.35 },
    ),
  );
  if (opts.vest) {
    group.add(
      profile(
        [
          [-torsoD / 2 - 0.012, hipY + h * 0.05],
          [-torsoD / 2 - 0.012, shoulderY - h * 0.01],
          [torsoD / 2 + 0.012, shoulderY - h * 0.01],
          [torsoD / 2 + 0.012, hipY + h * 0.04],
        ],
        torsoW + 0.03,
        material('vest'),
        { radius: torsoD * 0.3, bevel: torsoD * 0.25 },
      ),
    );
  }
  // Hips.
  group.add(
    profile(
      [
        [-torsoD / 2, hipY - h * 0.09],
        [-torsoD / 2, hipY + h * 0.01],
        [torsoD / 2, hipY + h * 0.01],
        [torsoD / 2, hipY - h * 0.09],
      ],
      torsoW * 0.88,
      pants,
      { radius: torsoD * 0.35, bevel: torsoD * 0.3 },
    ),
  );
  // Neck + head.
  group.add(capsule(h * 0.032, h * 0.03, skin, { at: [0, shoulderY + h * 0.02, 0], segments: 10 }));
  group.add(sphere(headR, skin, { at: [0, headY, 0], segments: 16 }));
  group.add(
    sphere(headR * 1.02, material('hair'), {
      at: [-headR * 0.12, headY + headR * 0.22, 0],
      scale: [1, 0.66, 1],
      segments: 14,
    }),
  );

  // Legs: front/back swap sign so a walking figure reads as mid-stride.
  const legZ = torsoW * 0.26;
  const ankleY = footH + legR * 0.4;
  for (const sign of [1, -1] as const) {
    const forward = sign * stride;
    const kneeX = forward * 0.55;
    group.add(limb([0, hipY], [kneeX, hipY * 0.52], legR, pants, sign * legZ));
    group.add(limb([kneeX, hipY * 0.52], [forward, ankleY], legR * 0.85, pants, sign * legZ));
    const foot = box([footL, footH, legR * 2.1], shoe, {
      at: [forward + footL * 0.22, footH / 2, sign * legZ],
    });
    const tilt = sign * (opts.pose === 'walking' ? 0.12 : 0);
    foot.rotation.z = tilt;
    // A tilted heel would otherwise dig into the road: lift by the exact
    // half-diagonal of the rotated box so the lowest corner lands on y = 0.
    foot.position.y = (footL / 2) * Math.abs(Math.sin(tilt)) + (footH / 2) * Math.cos(tilt);
    group.add(foot);
  }

  // Arms: mirrored swing, or one arm raised when holding a paddle.
  const armZ = torsoW / 2 + armR * 0.6;
  const shoulder: Point2 = [0, shoulderY - h * 0.02];
  const swing = opts.pose === 'walking' ? h * 0.11 : h * 0.012;
  const armLen = h * 0.31;
  for (const sign of [1, -1] as const) {
    const z = sign * armZ;
    const pitch = sign === -1 && opts.rightArmPitch !== undefined ? opts.rightArmPitch : undefined;
    if (pitch !== undefined) {
      const elbow: Point2 = [
        shoulder[0] + Math.sin(pitch) * armLen * 0.55,
        shoulder[1] - Math.cos(pitch) * armLen * 0.55,
      ];
      const hand: Point2 = [elbow[0] + Math.sin(pitch) * armLen * 0.5, elbow[1]];
      group.add(limb(shoulder, elbow, armR, shirt, z));
      group.add(limb(elbow, hand, armR * 0.85, skin, z));
      continue;
    }
    const elbow: Point2 = [shoulder[0] - sign * swing, shoulder[1] - armLen * 0.55];
    const hand: Point2 = [shoulder[0] - sign * swing * 1.7, shoulder[1] - armLen];
    group.add(limb(shoulder, elbow, armR, shirt, z));
    group.add(limb(elbow, hand, armR * 0.85, skin, z));
  }
  return group;
}

export function buildAdultPedestrian(
  params: PedestrianParams = { height: 1.75, pose: 'standing' },
): Group {
  return buildHumanoid({
    height: params.height,
    pose: params.pose,
    shirt: { key: 'shirt', color: params.shirtColor },
    pants: { key: 'pants', color: params.pantsColor },
    skinColor: params.skinColor,
  });
}

export function buildChildPedestrian(
  params: PedestrianParams = { height: 1.2, pose: 'standing' },
): Group {
  return buildHumanoid({
    height: params.height,
    pose: params.pose,
    headRatio: 0.082,
    shirt: { key: 'shirt', color: params.shirtColor ?? '#c9762a' },
    pants: { key: 'pants', color: params.pantsColor ?? '#39404a' },
    skinColor: params.skinColor,
  });
}

export function buildTrafficMarshal(
  params: PedestrianParams = { height: 1.82, pose: 'standing' },
): Group {
  const group = buildHumanoid({
    height: params.height,
    pose: params.pose,
    shirt: { key: 'shirt', color: '#27384d' },
    pants: { key: 'pants', color: '#27384d' },
    skinColor: params.skinColor,
    vest: true,
    rightArmPitch: 1.35,
  });
  group.add(box([0.18, 0.08, 0.68], material('safetyWhite'), { at: [0.20, params.height - 0.16, 0] }));
  // Raised directing arm shifts the visual envelope forward; re-centre the
  // complete figure on the placement origin so snapping/collision agree.
  group.position.x = -0.20;
  return group;
}
