import { Group } from 'three';

import { box, capsule, cone, cyl, sphere } from '../geometry.js';
import { material } from '../materials.js';

/**
 * Animals in the carriageway.
 *
 * `ACTOR_CLASSES` has carried `animal` since v2 but the catalog had no model to
 * put behind it, so "a deer runs into the road" was authored either with a
 * hand-written bounding box or — worse — with `pedestrian.adult_walking`, which
 * is invisible to every trajectory- or top-down-based check and teaches a
 * perception model that an animal looks like a person.
 *
 * All three entries are the same quadruped assembly at different scales, which
 * is the honest level of fidelity here: what a scenario needs from an animal is
 * a correct silhouette and a correct footprint, and the difference between a
 * deer and a dog at 30 m is size, stance and head carriage, not fur.
 *
 * Convention as everywhere else: `+X` is the direction the animal faces, the
 * bounding box is centred on the origin in X and Z, and the hooves sit on
 * `y = 0`.
 */

/** Every animal takes a coat colour; the rest of the shape is fixed per species. */
export interface AnimalParams {
  color: string;
}

interface QuadrupedSpec {
  /** Straight section of the barrel capsule, metres (total body = this + 2r). */
  bodyLength: number;
  bodyRadius: number;
  /** Ground to belly. */
  legLength: number;
  legRadius: number;
  /** Half-spacing of the legs across the body. */
  trackHalf: number;
  /** Neck run, and its pitch above horizontal (a grazing head is ~0). */
  neckLength: number;
  neckPitchRad: number;
  neckRadius: number;
  headLength: number;
  headRadius: number;
  /** Ear length and how far apart the ears sit. */
  earLength: number;
  earHalfSpacing: number;
  /** Ears carried upright (deer, cat) or hanging (dog). */
  earPitchRad: number;
  tailLength: number;
  tailRadius: number;
  tailPitchRad: number;
  /** Antlers are what makes a deer read as a deer in silhouette. */
  antlerLength?: number;
}

function buildQuadruped(spec: QuadrupedSpec, params: AnimalParams): Group {
  const group = new Group();
  const coat = material('fur', params.color);
  const dark = material('fur', '#33302b');

  const bellyY = spec.legLength;
  const barrelY = bellyY + spec.bodyRadius;

  // Barrel: a capsule laid along +X, so the body has rounded chest and rump
  // rather than the boxy silhouette a cylinder would give.
  group.add(
    capsule(spec.bodyRadius, spec.bodyLength, coat, {
      at: [0, barrelY, 0],
      rot: [0, 0, Math.PI / 2],
      scale: [1, 1, 0.95],
      segments: 12,
    }),
  );

  // Legs. Front pair under the chest, rear pair under the rump; each is a
  // tapered upper and a thin lower so the stance reads at distance.
  const halfBody = spec.bodyLength / 2 + spec.bodyRadius * 0.55;
  for (const x of [halfBody, -halfBody]) {
    for (const z of [spec.trackHalf, -spec.trackHalf]) {
      group.add(
        cyl(spec.legRadius * 1.5, bellyY * 0.55, coat, {
          rTop: spec.legRadius,
          at: [x, bellyY * 0.72, z],
          segments: 8,
        }),
      );
      group.add(
        cyl(spec.legRadius * 0.72, bellyY * 0.5, coat, {
          rTop: spec.legRadius,
          at: [x, bellyY * 0.25, z],
          segments: 8,
        }),
      );
      group.add(box([spec.legRadius * 2.2, spec.legRadius * 0.9, spec.legRadius * 1.8], dark, {
        at: [x, spec.legRadius * 0.45, z],
      }));
    }
  }

  // Neck and head, pitched up off the shoulder.
  const neckBase: [number, number, number] = [halfBody * 0.86, barrelY + spec.bodyRadius * 0.35, 0];
  const dx = Math.cos(spec.neckPitchRad) * spec.neckLength;
  const dy = Math.sin(spec.neckPitchRad) * spec.neckLength;
  const neck = cyl(spec.neckRadius * 1.25, spec.neckLength, coat, {
    rTop: spec.neckRadius,
    at: [neckBase[0] + dx / 2, neckBase[1] + dy / 2, 0],
    segments: 10,
  });
  neck.rotation.z = -(Math.PI / 2 - spec.neckPitchRad);
  group.add(neck);

  const headX = neckBase[0] + dx;
  const headY = neckBase[1] + dy;
  group.add(
    capsule(spec.headRadius, spec.headLength, coat, {
      at: [headX + spec.headLength * 0.28, headY, 0],
      rot: [0, 0, Math.PI / 2 - 0.25],
      scale: [1, 1, 0.85],
      segments: 10,
    }),
  );
  group.add(sphere(spec.headRadius * 0.42, dark, {
    at: [headX + spec.headLength * 0.72, headY - spec.headLength * 0.2, 0],
    segments: 8,
  }));

  // Ears.
  for (const z of [spec.earHalfSpacing, -spec.earHalfSpacing]) {
    const ear = capsule(spec.headRadius * 0.32, spec.earLength, coat, {
      at: [
        headX - spec.headRadius * 0.1,
        headY + Math.cos(spec.earPitchRad) * spec.earLength * 0.5 + spec.headRadius * 0.4,
        z,
      ],
      scale: [0.55, 1, 1],
      segments: 8,
    });
    ear.rotation.x = z > 0 ? -spec.earPitchRad : spec.earPitchRad;
    group.add(ear);
  }

  // Antlers: a beam plus three tines per side. Cheap, and it is the whole
  // silhouette cue that separates a deer from a large dog.
  if (spec.antlerLength) {
    for (const z of [spec.earHalfSpacing * 0.7, -spec.earHalfSpacing * 0.7]) {
      const antlerMat = material('fur', '#8a7c62');
      const beam = cyl(0.018, spec.antlerLength, antlerMat, {
        rTop: 0.008,
        at: [headX - spec.headRadius * 0.2, headY + spec.antlerLength * 0.45, z],
        segments: 6,
      });
      beam.rotation.x = z > 0 ? -0.28 : 0.28;
      beam.rotation.z = -0.22;
      group.add(beam);
      for (let i = 0; i < 3; i += 1) {
        const tine = cyl(0.011, spec.antlerLength * (0.38 - i * 0.07), antlerMat, {
          rTop: 0.005,
          at: [
            headX - spec.headRadius * 0.2 + spec.antlerLength * (0.06 + i * 0.09),
            headY + spec.antlerLength * (0.5 + i * 0.16),
            z * (1 + i * 0.12),
          ],
          segments: 6,
        });
        tine.rotation.z = -0.6;
        group.add(tine);
      }
    }
  }

  // Tail.
  const tail = cyl(spec.tailRadius, spec.tailLength, coat, {
    rTop: spec.tailRadius * 0.6,
    at: [
      -halfBody - Math.cos(spec.tailPitchRad) * spec.tailLength * 0.5,
      barrelY + Math.sin(spec.tailPitchRad) * spec.tailLength * 0.5,
      0,
    ],
    segments: 8,
  });
  tail.rotation.z = Math.PI / 2 - spec.tailPitchRad;
  group.add(tail);

  return group;
}

/**
 * Adult white-tailed deer, standing broadside with its head up.
 *
 * The reference large animal: heavy enough to be a real collision, tall enough
 * that its body sits in the windscreen rather than under the bumper, and the
 * animal that dominates real animal-strike statistics.
 */
export function buildDeer(params: AnimalParams = { color: '#9c7b52' }): Group {
  return buildQuadruped(
    {
      bodyLength: 0.88,
      bodyRadius: 0.24,
      legLength: 0.72,
      legRadius: 0.042,
      trackHalf: 0.15,
      neckLength: 0.42,
      neckPitchRad: 1.02,
      neckRadius: 0.075,
      headLength: 0.24,
      headRadius: 0.085,
      earLength: 0.16,
      earHalfSpacing: 0.12,
      earPitchRad: 0.75,
      tailLength: 0.2,
      tailRadius: 0.05,
      tailPitchRad: 0.5,
      antlerLength: 0.26,
    },
    params,
  );
}

/**
 * Loose large dog, trotting stance.
 *
 * The medium animal: low enough to be hidden by a parked car, fast enough to
 * cross a lane inside a reaction time, and the one an ADS most often has to
 * decide about in a residential street.
 */
export function buildDog(params: AnimalParams = { color: '#a8834f' }): Group {
  return buildQuadruped(
    {
      bodyLength: 0.4,
      bodyRadius: 0.15,
      legLength: 0.34,
      legRadius: 0.032,
      trackHalf: 0.1,
      neckLength: 0.15,
      neckPitchRad: 0.72,
      neckRadius: 0.07,
      headLength: 0.19,
      headRadius: 0.078,
      earLength: 0.11,
      earHalfSpacing: 0.075,
      earPitchRad: 2.4,
      tailLength: 0.24,
      tailRadius: 0.028,
      tailPitchRad: 0.7,
    },
    params,
  );
}

/**
 * Cat, low crouched run.
 *
 * The small animal: the case where braking or swerving is the wrong answer, and
 * the one that is genuinely hard to see against asphalt at night.
 */
export function buildCat(params: AnimalParams = { color: '#5c5750' }): Group {
  return buildQuadruped(
    {
      bodyLength: 0.26,
      bodyRadius: 0.075,
      legLength: 0.10,
      legRadius: 0.017,
      trackHalf: 0.048,
      neckLength: 0.05,
      neckPitchRad: 0.18,
      neckRadius: 0.042,
      headLength: 0.08,
      headRadius: 0.05,
      earLength: 0.05,
      earHalfSpacing: 0.04,
      earPitchRad: 0.35,
      tailLength: 0.22,
      tailRadius: 0.016,
      tailPitchRad: 0.9,
    },
    params,
  );
}

/**
 * Raccoon, low nocturnal amble.
 *
 * Between cat and dog in bulk but carried lower: the classic small-animal
 * night hazard at the kerb line.
 */
export function buildRaccoon(params: AnimalParams = { color: '#666b70' }): Group {
  return buildQuadruped(
    {
      bodyLength: 0.32,
      bodyRadius: 0.115,
      legLength: 0.16,
      legRadius: 0.024,
      trackHalf: 0.075,
      neckLength: 0.09,
      neckPitchRad: 0.35,
      neckRadius: 0.055,
      headLength: 0.13,
      headRadius: 0.062,
      earLength: 0.06,
      earHalfSpacing: 0.05,
      earPitchRad: 0.6,
      tailLength: 0.28,
      tailRadius: 0.03,
      tailPitchRad: 0.5,
    },
    params,
  );
}

/**
 * Adult goose: the flock-crossing hazard near parks, ponds and campuses.
 * Not a quadruped, so it gets its own small assembly; same conventions
 * (+X facing, box centred in X/Z, feet on y = 0).
 */
export function buildGoose(params: AnimalParams = { color: '#d8d8cf' }): Group {
  const group = new Group();
  const feather = material('safetyWhite', params.color);
  const dark = material('plastic');
  const orange = material('safetyOrange');
  group.add(sphere(0.25, feather, { at: [-0.08, 0.42, 0], scale: [1.1, 0.96, 1], name: 'body' }));
  group.add(cyl(0.055, 0.43, dark, { at: [0.22, 0.61, 0], rot: [0, 0, -0.28], name: 'neck' }));
  group.add(sphere(0.09, dark, { at: [0.28, 0.79, 0], name: 'head' }));
  group.add(cone(0.045, 0.18, orange, { at: [0.39, 0.78, 0], rot: [0, 0, -Math.PI / 2], name: 'beak' }));
  for (const z of [-0.08, 0.08]) {
    group.add(cyl(0.014, 0.27, orange, { at: [-0.02, 0.14, z], name: 'leg' }));
    group.add(box([0.18, 0.02, 0.07], orange, { at: [0.03, 0.01, z], name: 'foot' }));
  }
  group.add(box([0.86, 0.015, 0.5], feather, { at: [0, 0.0075, 0], name: 'footprint-envelope' }));
  return group;
}
