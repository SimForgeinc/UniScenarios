/**
 * Browser-safe occluder footprints for `props[]`.
 *
 * `@uniscenarios/prop-catalog` owns the real dimensions, but it depends on
 * three.js — importing it here would drag a renderer into the headless CLI for
 * the sake of three numbers per prop. So the length/width/height of the full
 * catalog are mirrored here, and a template can always override them with
 * `extensions.dims`.
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
  'vehicle.ambulance': { l: 6.1, w: 2.1, h: 2.65 },
  'vehicle.tram': { l: 30, w: 2.65, h: 3.5 },
  'vehicle.mobility_scooter': { l: 1.35, w: 0.68, h: 1.35 },
  'pedestrian.adult_standing': { l: 0.32, w: 0.5, h: 1.75 },
  'pedestrian.adult_walking': { l: 0.85, w: 0.5, h: 1.75 },
  'pedestrian.child_standing': { l: 0.24, w: 0.35, h: 1.2 },
  'pedestrian.child_walking': { l: 0.58, w: 0.35, h: 1.2 },
  'pedestrian.traffic_marshal': { l: 0.72, w: 0.68, h: 1.88 },
  'construction.traffic_cone': { l: 0.36, w: 0.36, h: 0.7 },
  'construction.channelizer_drum': { l: 0.58, w: 0.58, h: 1.07 },
  'construction.barricade_type3': { l: 0.62, w: 2.44, h: 1.66 },
  'construction.jersey_barrier': { l: 3.05, w: 0.61, h: 0.81 },
  'construction.jersey_barrier_run': { l: 12.2, w: 0.61, h: 0.81 },
  'construction.sign_road_work': { l: 0.9, w: 1.73, h: 2.21 },
  'construction.flagger': { l: 0.73, w: 0.7, h: 2.19 },
  'construction.arrow_board': { l: 3.45, w: 2.44, h: 2.53 },
  'construction.excavator': { l: 5.15, w: 2.24, h: 2.71 },
  'construction.portable_toilet': { l: 1.24, w: 1.22, h: 2.26 },
  'construction.spoil_pile': { l: 2.6, w: 2.55, h: 0.9 },
  'construction.temporary_stop_sign': { l: 0.82, w: 0.92, h: 2.16 },
  'construction.portable_signal': { l: 1.45, w: 1.2, h: 3.25 },
  'construction.long_pipe': { l: 8, w: 0.62, h: 0.62 },
  'occluder.dumpster': { l: 1.9, w: 1.52, h: 1.25 },
  'occluder.covered_car': { l: 4.58, w: 1.93, h: 1.48 },
  'occluder.hedge_run': { l: 6, w: 0.8, h: 1.2 },
  'occluder.fence_run': { l: 6, w: 0.065, h: 1.8 },
  'street.mailbox_cluster': { l: 0.54, w: 0.98, h: 1.52 },
  'street.bus_shelter': { l: 4, w: 1.6, h: 2.5 },
  'street.food_cart': { l: 1.84, w: 1, h: 2.18 },
  'street.shopping_cart': { l: 1.05, w: 0.65, h: 1.05 },
  'hazard.tire_debris': { l: 0.74, w: 0.56, h: 0.24 },
  'hazard.cardboard_box': { l: 0.58, w: 0.44, h: 0.47 },
  'hazard.trash_bags': { l: 1.02, w: 0.93, h: 0.58 },
  'hazard.downed_branch': { l: 2.44, w: 1.2, h: 0.45 },
};

export interface PropBehavior { readonly collidable: boolean; readonly occluder: boolean }

/** Physical defaults for semantic campaign props; authored extensions still override collision. */
export const PROP_BEHAVIOR: Readonly<Record<string, PropBehavior>> = {
  'construction.traffic_cone': { collidable: true, occluder: true },
  'construction.channelizer_drum': { collidable: true, occluder: true },
  'construction.excavator': { collidable: true, occluder: true },
  'construction.barricade_type3': { collidable: true, occluder: true },
  'construction.jersey_barrier': { collidable: true, occluder: true },
  'construction.jersey_barrier_run': { collidable: true, occluder: true },
  'construction.temporary_stop_sign': { collidable: true, occluder: true },
  'construction.portable_signal': { collidable: true, occluder: true },
  'construction.long_pipe': { collidable: true, occluder: true },
  'street.shopping_cart': { collidable: true, occluder: true },
};

export function propBehavior(catalogId: string): PropBehavior {
  return PROP_BEHAVIOR[catalogId] ?? { collidable: false, occluder: true };
}

/**
 * Is this a catalog id this package can resolve to real dimensions?
 *
 * `propDims` deliberately falls back for unknown ids so non-Studio consumers stay parseable, and the
 * original note said "renderers reject them loudly". Headless authoring never reaches a renderer, so
 * for an agent the fallback is silent: a template carrying `vehicle.boxTruck` (which does not exist —
 * the real id is `vehicle.box_truck`) validates with exit 0 and materialises at 4.70 x 1.82 x 1.45,
 * i.e. a sedan. An occluder that silently becomes a sedan deletes the point of the scenario, which is
 * pitfall 4 in docs/research/retargeting.md: resolve assets against the catalog at author time and
 * fail loud. Author-time surfaces must call this and refuse unknown ids.
 */
export function isKnownPropCatalogId(catalogId: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROP_DIMS, catalogId);
}

/** Every id this package can resolve, sorted — suitable for a "did you mean" repair hint. */
export function knownPropCatalogIds(): string[] {
  return Object.keys(PROP_DIMS).sort();
}

/** Unknown ids remain parseable for non-Studio consumers; renderers reject them loudly. */
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
