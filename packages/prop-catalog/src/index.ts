/**
 * `@uniscenarios/prop-catalog` — the placeable-object library.
 *
 * Every object in the catalog is generated from `BufferGeometry` primitives at
 * runtime: no model files, no downloads, no licences to track. That keeps the
 * library parametric (a hedge run takes a length, a work zone takes a taper)
 * and tiny, and it means the visual bar is set by silhouette and dimensional
 * accuracy rather than by asset budget. Hi-fi meshes can be swapped in later
 * behind the same catalog ids.
 *
 * ```ts
 * import { buildProp, queryCatalog, buildWorkZone } from '@uniscenarios/prop-catalog';
 *
 * const van = buildProp('vehicle.van', { color: '#e8e9ea' });
 * van.position.set(x, groundY, z);          // ground-centred, +X forward
 *
 * const blockers = queryCatalog({ tags: ['occlusion:high'] });
 * scene.add(buildWorkZone({ length: 80, side: 'right' }));
 * ```
 */

export type {
  CatalogEntry,
  Dims,
  ParamValue,
  PropClass,
  PropTag,
} from './types.js';
export { PROP_CLASSES, PROP_TAGS } from './types.js';

export {
  CATALOG,
  CATALOG_IDS,
  type CatalogId,
  type CatalogQuery,
  getEntry,
  isCatalogId,
  queryCatalog,
} from './catalog.js';

export { BUILDER_IDS, buildProp, type PropParamMap } from './registry.js';

export {
  buildParkedRow,
  buildWorkZone,
  type ParkedRowParams,
  type WorkZoneCounts,
  type WorkZoneParams,
} from './composites.js';

export {
  catalogEntrySchema,
  catalogSchema,
  dimsSchema,
  parseCatalog,
} from './schema.js';

export {
  disposeMaterials,
  material,
  type MaterialKey,
  PALETTE,
  VEHICLE_COLORS,
  vehicleColor,
} from './materials.js';

// Direct builder access, for callers that want a specific parametric variant
// without going through the catalog defaults.
export type { VehicleParams } from './builders/vehicles.js';
export type { PedestrianParams } from './builders/pedestrians.js';
export type { RobotParams } from './builders/robots.js';
export type { DroneParams } from './builders/drones.js';
export type {
  ArrowBoardParams,
  BarrierParams,
  BarrierRunParams,
  ConeParams,
  FlaggerParams,
  SignParams,
  SpoilPileParams,
} from './builders/construction.js';
export type { RunParams } from './builders/street.js';
export type { TrashBagParams } from './builders/hazards.js';
