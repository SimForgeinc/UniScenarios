import { Group, type Mesh, type MeshStandardMaterial } from 'three';

import {
  box,
  capsule,
  cyl,
  mirrored,
  type Point2,
  profile,
  sphere,
  type Vec3,
} from '../geometry.js';
import { material } from '../materials.js';

/**
 * Vehicles are built as a painted hull (a rounded side-view profile extruded
 * across the width) plus a glass greenhouse, wheels that touch the ground, and
 * light insets. Panel lines and badges are deliberately absent — at this
 * fidelity the silhouette and the dimensions are the product.
 */
export interface VehicleParams {
  /** Paint colour, any CSS hex string. */
  color: string;
}

/** Flat glass panel spanning the segment `a -> b` in the XY (side) plane. */
function panelAlong(
  a: Point2,
  b: Point2,
  thickness: number,
  width: number,
  mat: MeshStandardMaterial,
): Mesh {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const mesh = box([len, thickness, width], mat);
  mesh.rotation.z = angle;
  mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
  return mesh;
}

interface WheelOptions {
  radius: number;
  width: number;
  /** Axle centre X positions. */
  xs: readonly number[];
  /** Outer face of the tyre, |Z|. */
  z: number;
  /** Axles (by index into `xs`) that carry dual tyres. */
  dual?: readonly number[];
  segments?: number;
}

function addWheels(group: Group, opts: WheelOptions): void {
  const { radius, width } = opts;
  const tire = material('tire');
  const rim = material('rim');
  const segments = opts.segments ?? 18;
  opts.xs.forEach((x, index) => {
    const isDual = opts.dual?.includes(index) ?? false;
    const offsets = isDual
      ? [opts.z - width / 2, opts.z - width * 1.55]
      : [opts.z - width / 2];
    for (const off of offsets) {
      for (const sign of [1, -1]) {
        const z = off * sign;
        group.add(cyl(radius, width, tire, { axis: 'z', at: [x, radius, z], segments }));
        group.add(
          cyl(radius * 0.52, width * 0.55, rim, {
            axis: 'z',
            at: [x, radius, z + sign * width * 0.26],
            segments: Math.round(segments * 0.6),
          }),
        );
      }
    }
  });
}

interface CarSpec {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
  wheelWidth: number;
  axles: readonly [number, number];
  /** Painted hull, side view. */
  hull: readonly Point2[];
  hullRadius: number;
  /** Glass cabin, side view; its top edge should reach the roof. */
  glass: readonly Point2[];
  glassRadius: number;
  /** Painted roof cap laid over the glass: [xBack, xFront, thickness]. */
  roof: readonly [number, number, number];
  headlight: { x: number; y: number; z: number; w: number; h: number };
  taillight: { x: number; y: number; z: number; w: number; h: number };
  mirror?: { x: number; y: number };
  /** Dark bumper / valance strip height at each end. */
  bumper?: { y: number; h: number };
}

function buildCar(spec: CarSpec, params: VehicleParams): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const glassMat = material('glass');
  const plastic = material('plastic');

  group.add(profile(spec.hull, spec.width, paint, { radius: spec.hullRadius, bevel: 0.09 }));

  const glassWidth = spec.width - 0.16;
  group.add(profile(spec.glass, glassWidth, glassMat, { radius: spec.glassRadius, bevel: 0.05 }));

  const [roofBack, roofFront, roofThickness] = spec.roof;
  group.add(
    box([roofFront - roofBack, roofThickness, spec.width - 0.10], paint, {
      at: [(roofBack + roofFront) / 2, spec.height - roofThickness / 2, 0],
    }),
  );

  const hl = spec.headlight;
  group.add(...mirrored(hl.z, (z) => box([0.14, hl.h, hl.w], material('headlight'), { at: [hl.x, hl.y, z] })));
  const tl = spec.taillight;
  group.add(...mirrored(tl.z, (z) => box([0.12, tl.h, tl.w], material('taillight'), { at: [tl.x, tl.y, z] })));

  if (spec.bumper) {
    const { y, h } = spec.bumper;
    const front = spec.length / 2 - 0.06;
    group.add(box([0.14, h, spec.width - 0.16], plastic, { at: [front, y, 0] }));
    group.add(box([0.14, h, spec.width - 0.16], plastic, { at: [-front, y, 0] }));
  }

  if (spec.mirror) {
    const { x, y } = spec.mirror;
    group.add(
      ...mirrored(spec.width / 2 - 0.045, (z) =>
        box([0.09, 0.10, 0.09], plastic, { at: [x, y, z] }),
      ),
    );
  }

  addWheels(group, {
    radius: spec.wheelRadius,
    width: spec.wheelWidth,
    xs: spec.axles,
    z: spec.width / 2 - 0.015,
  });

  return group;
}

const DEFAULT_COLOR = '#4a6b8a';

export function buildSedan(params: VehicleParams = { color: DEFAULT_COLOR }): Group {
  return buildCar(
    {
      length: 4.7,
      width: 1.82,
      height: 1.45,
      wheelRadius: 0.33,
      wheelWidth: 0.24,
      axles: [1.44, -1.42],
      hull: [
        [-2.35, 0.40],
        [-2.35, 0.96],
        [-2.02, 1.05],
        [1.28, 1.06],
        [2.10, 0.92],
        [2.35, 0.78],
        [2.35, 0.38],
        [2.02, 0.24],
        [-2.02, 0.24],
      ],
      hullRadius: 0.13,
      glass: [
        [-1.92, 1.00],
        [-1.22, 1.43],
        [0.38, 1.43],
        [1.30, 0.99],
      ],
      glassRadius: 0.14,
      roof: [-1.20, 0.36, 0.11],
      headlight: { x: 2.28, y: 0.72, z: 0.62, w: 0.34, h: 0.15 },
      taillight: { x: -2.31, y: 0.86, z: 0.66, w: 0.30, h: 0.14 },
      mirror: { x: 1.22, y: 1.05 },
      bumper: { y: 0.36, h: 0.22 },
    },
    params,
  );
}

export function buildHatchback(params: VehicleParams = { color: DEFAULT_COLOR }): Group {
  return buildCar(
    {
      length: 4.05,
      width: 1.75,
      height: 1.46,
      wheelRadius: 0.31,
      wheelWidth: 0.22,
      axles: [1.24, -1.30],
      hull: [
        [-2.02, 0.42],
        [-2.00, 1.10],
        [-1.80, 1.14],
        [1.02, 1.08],
        [1.72, 0.94],
        [2.02, 0.76],
        [2.02, 0.36],
        [1.74, 0.24],
        [-1.78, 0.24],
      ],
      hullRadius: 0.14,
      glass: [
        [-1.86, 1.06],
        [-1.52, 1.44],
        [0.22, 1.44],
        [1.08, 1.04],
      ],
      glassRadius: 0.12,
      roof: [-1.50, 0.20, 0.11],
      headlight: { x: 1.96, y: 0.72, z: 0.60, w: 0.32, h: 0.15 },
      taillight: { x: -1.98, y: 0.94, z: 0.62, w: 0.24, h: 0.24 },
      mirror: { x: 0.98, y: 1.06 },
      bumper: { y: 0.34, h: 0.22 },
    },
    params,
  );
}

export function buildSuv(params: VehicleParams = { color: DEFAULT_COLOR }): Group {
  return buildCar(
    {
      length: 4.85,
      width: 1.95,
      height: 1.78,
      wheelRadius: 0.37,
      wheelWidth: 0.27,
      axles: [1.48, -1.42],
      hull: [
        [-2.425, 0.46],
        [-2.425, 1.20],
        [-2.20, 1.26],
        [1.36, 1.26],
        [2.18, 1.12],
        [2.425, 0.92],
        [2.425, 0.42],
        [2.14, 0.28],
        [-2.14, 0.28],
      ],
      hullRadius: 0.14,
      glass: [
        [-2.30, 1.20],
        [-2.10, 1.73],
        [0.28, 1.73],
        [1.40, 1.16],
      ],
      glassRadius: 0.13,
      roof: [-2.10, 0.26, 0.12],
      headlight: { x: 2.36, y: 0.98, z: 0.66, w: 0.36, h: 0.18 },
      taillight: { x: -2.38, y: 1.06, z: 0.70, w: 0.26, h: 0.30 },
      mirror: { x: 1.30, y: 1.26 },
      bumper: { y: 0.40, h: 0.26 },
    },
    params,
  );
}

export function buildPickup(params: VehicleParams = { color: DEFAULT_COLOR }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const plastic = material('plastic');
  const width = 2.03;

  // Lower body: one mass from the front bumper to the tailgate.
  group.add(
    profile(
      [
        [-2.95, 0.48],
        [-2.95, 1.12],
        [2.42, 1.12],
        [2.95, 1.00],
        [2.95, 0.46],
        [2.60, 0.30],
        [-2.60, 0.30],
      ],
      width,
      paint,
      { radius: 0.10, bevel: 0.09 },
    ),
  );
  // Hood.
  group.add(
    profile(
      [
        [0.62, 1.10],
        [0.62, 1.34],
        [2.44, 1.34],
        [2.86, 1.20],
        [2.86, 1.10],
      ],
      width - 0.06,
      paint,
      { radius: 0.07, bevel: 0.07 },
    ),
  );
  // Cab body below the beltline, then glass, then roof.
  group.add(
    profile(
      [
        [-0.72, 1.10],
        [-0.72, 1.44],
        [1.42, 1.44],
        [1.42, 1.10],
      ],
      width - 0.02,
      paint,
      { radius: 0.08, bevel: 0.08 },
    ),
  );
  group.add(
    profile(
      [
        [-0.66, 1.40],
        [-0.52, 1.90],
        [0.66, 1.90],
        [1.36, 1.38],
      ],
      width - 0.18,
      material('glass'),
      { radius: 0.10, bevel: 0.05 },
    ),
  );
  group.add(box([1.24, 0.06, width - 0.14], paint, { at: [0.06, 1.92, 0] }));

  // Bed: floor, side walls, tailgate. Rails sit at cab-shoulder height, which
  // is what makes a pickup read as a pickup rather than as a fastback.
  group.add(box([2.20, 0.05, width - 0.16], plastic, { at: [-1.83, 1.10, 0] }));
  group.add(
    ...mirrored(width / 2 - 0.05, (z) =>
      box([2.20, 0.44, 0.10], paint, { at: [-1.83, 1.32, z] }),
    ),
  );
  group.add(box([0.10, 0.44, width - 0.02], paint, { at: [-2.88, 1.32, 0] }));

  group.add(...mirrored(0.66, (z) => box([0.16, 0.20, 0.36], material('headlight'), { at: [2.85, 0.86, z] })));
  group.add(...mirrored(0.72, (z) => box([0.12, 0.26, 0.24], material('taillight'), { at: [-2.88, 1.24, z] })));
  group.add(box([0.16, 0.26, width - 0.10], plastic, { at: [2.87, 0.50, 0] }));
  group.add(box([0.16, 0.22, width - 0.10], plastic, { at: [-2.87, 0.56, 0] }));
  group.add(...mirrored(width / 2 - 0.06, (z) => box([0.10, 0.16, 0.11], plastic, { at: [1.26, 1.52, z] })));

  addWheels(group, {
    radius: 0.40,
    width: 0.30,
    xs: [1.86, -1.76],
    z: width / 2 - 0.02,
  });
  return group;
}

export function buildVan(params: VehicleParams = { color: '#e8e9ea' }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const glassMat = material('glass');
  const plastic = material('plastic');
  const width = 2.0;

  group.add(
    profile(
      [
        [-2.65, 0.34],
        [-2.65, 2.32],
        [-2.42, 2.40],
        [0.58, 2.40],
        [1.72, 1.56],
        [2.36, 1.30],
        [2.65, 1.06],
        [2.65, 0.44],
        [2.34, 0.30],
        [-2.34, 0.30],
      ],
      width,
      paint,
      { radius: 0.11, bevel: 0.09 },
    ),
  );
  // Windscreen laid on the raked face, plus cab side glass.
  const screen = panelAlong([0.74, 2.24], [1.56, 1.66], 0.05, width - 0.26, glassMat);
  group.add(screen);
  group.add(
    ...mirrored(width / 2 - 0.01, (z) =>
      box([0.92, 0.52, 0.05], glassMat, { at: [0.30, 1.84, z] }),
    ),
  );
  // Rear doors: a dark seam and handles read as the cargo end.
  group.add(box([0.05, 1.60, 0.06], plastic, { at: [-2.62, 1.35, 0] }));
  group.add(...mirrored(0.70, (z) => box([0.10, 0.22, 0.30], material('taillight'), { at: [-2.60, 1.98, z] })));
  group.add(...mirrored(0.72, (z) => box([0.14, 0.20, 0.32], material('headlight'), { at: [2.58, 0.90, z] })));
  group.add(box([0.16, 0.26, width - 0.14], plastic, { at: [2.57, 0.50, 0] }));
  group.add(...mirrored(width / 2 - 0.05, (z) => box([0.10, 0.20, 0.10], plastic, { at: [1.62, 1.76, z] })));

  addWheels(group, { radius: 0.36, width: 0.26, xs: [1.74, -1.58], z: width / 2 - 0.02 });
  return group;
}

export function buildBoxTruck(params: VehicleParams = { color: '#5a6068' }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const bodyMat = material('safetyWhite');
  const plastic = material('plastic');
  const steel = material('steel');
  const width = 2.44;

  // Chassis rails under the cargo body.
  group.add(box([6.6, 0.20, width - 0.60], steel, { at: [-0.4, 0.86, 0] }));

  // Cab.
  group.add(
    profile(
      [
        [1.42, 0.66],
        [1.42, 2.58],
        [3.46, 2.58],
        [3.78, 2.30],
        [3.78, 0.96],
        [3.52, 0.66],
      ],
      width - 0.06,
      paint,
      { radius: 0.14, bevel: 0.09 },
    ),
  );
  group.add(panelAlong([3.48, 2.48], [3.66, 1.62], 0.06, width - 0.30, material('glass')));
  group.add(
    ...mirrored(width / 2 - 0.04, (z) => box([0.70, 0.60, 0.05], material('glass'), { at: [2.30, 1.94, z] })),
  );
  group.add(...mirrored(0.86, (z) => box([0.14, 0.24, 0.34], material('headlight'), { at: [3.74, 1.08, z] })));
  group.add(box([0.18, 0.30, width - 0.20], plastic, { at: [3.70, 0.62, 0] }));

  // Cargo body + roll-up door.
  group.add(
    profile(
      [
        [-3.80, 1.02],
        [-3.80, 3.40],
        [1.28, 3.40],
        [1.28, 1.02],
      ],
      width,
      bodyMat,
      { radius: 0.10, bevel: 0.05 },
    ),
  );
  group.add(box([0.06, 2.10, width - 0.24], material('metal'), { at: [-3.79, 2.12, 0] }));
  group.add(box([0.10, 0.12, width - 0.30], steel, { at: [-3.76, 0.60, 0] }));
  group.add(...mirrored(0.98, (z) => box([0.08, 0.18, 0.18], material('taillight'), { at: [-3.79, 1.16, z] })));

  addWheels(group, {
    radius: 0.46,
    width: 0.28,
    xs: [2.86, -2.10],
    z: width / 2 - 0.02,
    dual: [1],
  });
  return group;
}

export function buildSemiTruck(params: VehicleParams = { color: '#8f2f2f' }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const trailerMat = material('safetyWhite');
  const steel = material('steel');
  const chrome = material('chrome');
  const plastic = material('plastic');
  const width = 2.6;

  // --- Tractor (conventional day/sleeper cab), nose at +X.
  group.add(box([5.0, 0.22, width - 0.70], steel, { at: [7.2, 0.95, 0] }));
  group.add(
    profile(
      [
        [5.40, 1.06],
        [5.40, 3.42],
        [7.70, 3.42],
        [7.70, 2.16],
        [9.62, 2.16],
        [9.92, 1.96],
        [9.92, 1.06],
      ],
      width - 0.10,
      paint,
      { radius: 0.14, bevel: 0.10 },
    ),
  );
  // Windscreen + cab side glass.
  group.add(panelAlong([7.62, 3.24], [7.78, 2.40], 0.07, width - 0.42, material('glass')));
  group.add(
    ...mirrored(width / 2 - 0.10, (z) => box([0.90, 0.62, 0.05], material('glass'), { at: [6.90, 2.86, z] })),
  );
  // Grille, bumper, headlights, stacks, fuel tanks.
  group.add(box([0.10, 0.80, width - 0.50], chrome, { at: [9.94, 1.56, 0] }));
  group.add(box([0.20, 0.42, width - 0.24], chrome, { at: [9.92, 1.02, 0] }));
  group.add(...mirrored(1.04, (z) => box([0.14, 0.24, 0.34], material('headlight'), { at: [9.90, 1.44, z] })));
  group.add(
    ...mirrored(width / 2 - 0.12, (z) => cyl(0.09, 2.30, chrome, { at: [5.52, 2.35, z], segments: 12 })),
  );
  group.add(
    ...mirrored(width / 2 - 0.35, (z) =>
      cyl(0.34, 1.10, chrome, { axis: 'x', at: [7.10, 1.02, z], segments: 16 }),
    ),
  );

  // --- Trailer (53 ft box) riding on the fifth wheel.
  group.add(
    profile(
      [
        [-9.98, 1.32],
        [-9.98, 4.10],
        [5.42, 4.10],
        [5.42, 1.32],
      ],
      width,
      trailerMat,
      { radius: 0.10, bevel: 0.06 },
    ),
  );
  group.add(box([15.4, 0.22, width - 0.50], steel, { at: [-2.3, 1.20, 0] }));
  group.add(box([0.08, 2.40, width - 0.20], material('metal'), { at: [-10.02, 2.60, 0] }));
  group.add(box([0.14, 0.14, width - 0.30], steel, { at: [-10.04, 0.62, 0] }));
  group.add(...mirrored(1.06, (z) => box([0.10, 0.22, 0.22], material('taillight'), { at: [-10.04, 1.10, z] })));
  // Landing gear.
  group.add(
    ...mirrored(0.78, (z) => box([0.14, 1.05, 0.14], steel, { at: [3.10, 0.62, z] })),
  );
  group.add(...mirrored(0.78, (z) => box([0.34, 0.10, 0.20], steel, { at: [3.10, 0.06, z] })));
  // Mud flaps behind the bogie.
  group.add(...mirrored(1.02, (z) => box([0.04, 0.46, 0.42], plastic, { at: [-9.40, 0.32, z] })));

  addWheels(group, {
    radius: 0.52,
    width: 0.30,
    xs: [8.90, 5.86, 4.90, -8.30, -9.10],
    z: width / 2 - 0.02,
    dual: [1, 2, 3, 4],
  });
  return group;
}

export function buildBus(params: VehicleParams = { color: '#2f5b45' }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const glassMat = material('glass');
  const plastic = material('plastic');
  const width = 2.55;

  group.add(
    profile(
      [
        [-6.10, 0.56],
        [-6.10, 3.02],
        [-5.86, 3.20],
        [5.86, 3.20],
        [6.10, 2.98],
        [6.10, 0.76],
        [5.84, 0.56],
      ],
      width,
      paint,
      { radius: 0.26, bevel: 0.12 },
    ),
  );
  // Side window band, windscreen, rear screen.
  group.add(
    ...mirrored(width / 2 - 0.028, (z) => box([10.6, 1.00, 0.05], glassMat, { at: [-0.2, 2.36, z] })),
  );
  group.add(box([0.06, 1.32, width - 0.34], glassMat, { at: [6.08, 2.32, 0] }));
  group.add(box([0.06, 1.02, width - 0.42], glassMat, { at: [-6.09, 2.34, 0] }));
  // Doors on the kerb side (+Z), front and centre.
  group.add(
    box([1.10, 1.94, 0.05], plastic, { at: [4.60, 1.60, width / 2 - 0.004] }),
  );
  group.add(box([1.10, 1.94, 0.05], plastic, { at: [-0.60, 1.60, width / 2 - 0.004] }));
  group.add(box([0.16, 0.28, width - 0.24], plastic, { at: [6.02, 0.72, 0] }));
  group.add(...mirrored(0.94, (z) => box([0.12, 0.26, 0.30], material('headlight'), { at: [6.04, 0.96, z] })));
  group.add(...mirrored(0.98, (z) => box([0.10, 0.28, 0.26], material('taillight'), { at: [-6.05, 1.10, z] })));
  // Roof HVAC pod, kept inside the catalogued height.
  group.add(box([3.20, 0.16, width - 0.70], material('metal'), { at: [1.20, 3.14, 0] }));

  addWheels(group, {
    radius: 0.50,
    width: 0.30,
    xs: [4.20, -3.60],
    z: width / 2 - 0.04,
    dual: [1],
  });
  return group;
}

export function buildMotorcycle(params: VehicleParams = { color: '#25282c' }): Group {
  const group = new Group();
  const paint = material('paint', params.color);
  const plastic = material('plastic');
  const chrome = material('chrome');
  const metal = material('metal');
  const r = 0.32;

  for (const x of [0.72, -0.72]) {
    group.add(cyl(r, 0.13, material('tire'), { axis: 'z', at: [x, r, 0], segments: 18 }));
    group.add(cyl(r * 0.5, 0.15, material('rim'), { axis: 'z', at: [x, r, 0], segments: 12 }));
  }
  // Frame, tank, seat.
  group.add(
    profile(
      [
        [-0.62, 0.60],
        [-0.60, 0.80],
        [0.10, 0.86],
        [0.46, 0.80],
        [0.44, 0.58],
        [-0.10, 0.50],
      ],
      0.34,
      paint,
      { radius: 0.09, bevel: 0.06 },
    ),
  );
  group.add(box([0.58, 0.10, 0.30], plastic, { at: [-0.42, 0.88, 0] }));
  // Engine block, exhaust, fork, bars, headlight.
  group.add(box([0.36, 0.30, 0.30], metal, { at: [0.02, 0.44, 0] }));
  group.add(
    ...mirrored(0.13, (z) => cyl(0.045, 0.80, chrome, { axis: 'x', at: [-0.35, 0.36, z], segments: 10 })),
  );
  group.add(
    ...mirrored(0.11, (z) => cyl(0.035, 0.70, chrome, { at: [0.66, 0.68, z], rot: [0, 0, -0.30], segments: 10 })),
  );
  group.add(cyl(0.022, 0.72, chrome, { axis: 'z', at: [0.62, 1.02, 0], segments: 10 }));
  group.add(sphere(0.11, material('headlight'), { at: [0.72, 0.92, 0], segments: 12 }));
  group.add(box([0.10, 0.10, 0.06], material('taillight'), { at: [-0.72, 0.78, 0] }));
  // Mirrors set the catalogued height.
  group.add(
    ...mirrored(0.30, (z) => box([0.04, 0.09, 0.13], plastic, { at: [0.58, 1.19, z] })),
  );
  group.add(...mirrored(0.30, (z) => cyl(0.012, 0.18, chrome, { at: [0.58, 1.10, z], segments: 8 })));
  return group;
}

export function buildBicycle(params: VehicleParams = { color: '#2f4f74' }): Group {
  const group = new Group();
  const frameMat = material('paint', params.color);
  const chrome = material('chrome');
  const r = 0.34;

  for (const x of [0.53, -0.53]) {
    group.add(cyl(r, 0.05, material('tire'), { axis: 'z', at: [x, r, 0], segments: 22 }));
    group.add(cyl(r * 0.12, 0.06, material('rim'), { axis: 'z', at: [x, r, 0], segments: 10 }));
    // Spoke suggestion: a thin disc keeps the wheel readable at distance.
    group.add(cyl(r - 0.035, 0.012, material('metal'), { axis: 'z', at: [x, r, 0], segments: 22 }));
  }
  const tube = (a: Vec3, b: Vec3): Mesh => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const mesh = cyl(0.022, len, frameMat, { segments: 8 });
    mesh.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0);
    return mesh;
  };
  const bb: Vec3 = [0.0, 0.28, 0];
  const seatTop: Vec3 = [-0.24, 0.92, 0];
  const headTop: Vec3 = [0.40, 1.00, 0];
  const headBottom: Vec3 = [0.50, 0.66, 0];
  group.add(tube(bb, seatTop), tube(bb, headBottom), tube(seatTop, headTop), tube(headTop, headBottom));
  group.add(tube([-0.53, 0.34, 0], seatTop), tube([-0.53, 0.34, 0], bb));
  group.add(tube(headBottom, [0.53, 0.34, 0]));
  group.add(cyl(0.018, 0.50, chrome, { axis: 'z', at: [0.40, 1.02, 0], segments: 8 }));
  group.add(box([0.24, 0.05, 0.14], material('plastic'), { at: [-0.26, 0.95, 0] }));
  group.add(
    ...mirrored(0.09, (z) => box([0.14, 0.03, 0.06], material('plastic'), { at: [0.0, 0.16, z] })),
  );
  return group;
}

/** Bicycle plus a seated rider — the catalog's cyclist. */
export function buildCyclist(params: VehicleParams = { color: '#2f4f74' }): Group {
  const group = buildBicycle(params);
  const skin = material('skin');
  const shirt = material('shirt');
  const pants = material('pants');

  const rider = new Group();
  // Hips on the saddle (0.95), torso leaning to the bars, head at ~1.70 — the
  // stature of a seated adult, not a scaled-down standing one.
  rider.add(capsule(0.155, 0.40, shirt, { at: [-0.02, 1.24, 0], rot: [0, 0, 0.42] }));
  rider.add(capsule(0.075, 0.10, skin, { at: [0.13, 1.50, 0], rot: [0, 0, 0.35] }));
  rider.add(sphere(0.115, skin, { at: [0.17, 1.58, 0], segments: 14 }));
  rider.add(box([0.24, 0.08, 0.22], material('safetyWhite'), { at: [0.18, 1.67, 0] }));
  // Arms out to the handlebar; legs folded onto the cranks.
  rider.add(
    ...mirrored(0.17, (z) => capsule(0.052, 0.30, shirt, { at: [0.16, 1.32, z], rot: [0, 0, 0.72] })),
  );
  rider.add(
    ...mirrored(0.17, (z) => capsule(0.045, 0.20, skin, { at: [0.34, 1.13, z], rot: [0, 0, 0.55] })),
  );
  rider.add(
    ...mirrored(0.11, (z) => capsule(0.075, 0.26, pants, { at: [-0.10, 0.80, z], rot: [0, 0, -0.55] })),
  );
  rider.add(
    ...mirrored(0.11, (z) => capsule(0.06, 0.24, pants, { at: [0.02, 0.46, z], rot: [0, 0, 0.35] })),
  );
  rider.add(
    ...mirrored(0.11, (z) => box([0.17, 0.05, 0.09], material('plastic'), { at: [0.06, 0.28, z] })),
  );
  group.add(rider);
  return group;
}
