/**
 * Occluder footprints for `props[]`.
 *
 * `@scenario-studio/prop-catalog` owns the real dimensions, but it depends on
 * three.js — importing it here would drag a renderer into the headless CLI for
 * the sake of three numbers per prop. So the length/width/height of the props
 * that can actually *occlude* are mirrored here, and a template can always
 * override them with `extensions.dims`.
 *
 * These values are copied from `packages/prop-catalog/src/catalog.ts`; the CLI
 * test suite pins the pairs it uses so a drift shows up as a failing test
 * rather than as a silently wrong reveal-to-conflict metric.
 */

export interface PropDims {
  readonly l: number;
  readonly w: number;
  readonly h: number;
}

export const PROP_DIMS: Readonly<Record<string, PropDims>> = {
  'vehicle.sedan': { l: 4.7, w: 1.82, h: 1.45 },
  'vehicle.hatchback': { l: 4.05, w: 1.75, h: 1.46 },
  'vehicle.suv': { l: 4.85, w: 1.95, h: 1.78 },
  'vehicle.pickup': { l: 5.9, w: 2.03, h: 1.95 },
  'vehicle.van': { l: 5.3, w: 2.0, h: 2.4 },
  'vehicle.box_truck': { l: 7.6, w: 2.44, h: 3.4 },
  'vehicle.semi_truck': { l: 20.1, w: 2.6, h: 4.1 },
  'vehicle.bus': { l: 12.2, w: 2.55, h: 3.2 },
  'vehicle.motorcycle': { l: 2.1, w: 0.75, h: 1.23 },
  'vehicle.bicycle': { l: 1.75, w: 0.5, h: 1.71 },
};

/** Fallback footprint by catalog-id family, for ids not mirrored above. */
export function propDims(catalogId: string, override?: Partial<PropDims>): PropDims {
  const base = PROP_DIMS[catalogId] ?? (catalogId.startsWith('vehicle.')
    ? { l: 4.7, w: 1.82, h: 1.45 }
    : { l: 1, w: 1, h: 1 });
  return {
    l: override?.l ?? base.l,
    w: override?.w ?? base.w,
    h: override?.h ?? base.h,
  };
}
