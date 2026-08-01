/**
 * Catalog vocabulary.
 *
 * ## Conventions every builder in this package obeys
 *
 * - **Units**: metres. Every dimension is the real-world dimension of the thing
 *   being represented; semantic correctness beats visual fidelity.
 * - **Frame**: y-up (the scene frame `city-renderer` and `xodr-tools` use).
 *   `+X` is the object's facing / run direction, `+Z` is its left-to-right
 *   extent. A vehicle drives towards `+X`; a sign faces `+X`; a barrier or
 *   hedge *run* extends along `+X`.
 * - **Origin**: ground-centre. The bounding box of a built prop is centred on
 *   the origin in X and Z and starts at `y = 0` (wheels/feet/base touch the
 *   ground plane), so placement is `group.position.set(x, groundY, z)` plus a
 *   yaw about Y — no per-prop offsets to remember.
 * - **Dims**: `l` is the extent along X, `w` along Z, `h` along Y.
 */

/** Broad semantic bucket. Agents filter on this first, then on tags. */
export type PropClass =
  | 'vehicle'
  | 'pedestrian'
  | 'construction'
  | 'occluder'
  | 'hazard'
  | 'street';

export const PROP_CLASSES: readonly PropClass[] = [
  'vehicle',
  'pedestrian',
  'construction',
  'occluder',
  'hazard',
  'street',
] as const;

/**
 * Machine-usable tag vocabulary. Free-form strings are rejected by the schema
 * so that an agent picking props by tag can rely on a closed set.
 *
 * - `occlusion:*` — how much of the road scene this thing hides. `high` blocks
 *   a whole lane's sightline (semi trailer, box truck, bus shelter), `medium`
 *   hides a crossing pedestrian (van, dumpster, hedge), `low` is a low object
 *   you can see over (cone, debris).
 * - `vru` — vulnerable road user (pedestrian, cyclist, motorcyclist).
 * - `workzone` — belongs to a temporary traffic control setup.
 * - `roadway` / `roadside` / `sidewalk` — where the thing is normally placed.
 * - `mobile` — has wheels and can legitimately be given a velocity.
 * - `parkable` — sensible member of a parked row.
 * - `run` — parametric linear element (length is a build parameter).
 * - `debris` — unexpected object in the travelled way.
 * - `large-vehicle` — heavy vehicle, wide turning envelope.
 */
export type PropTag =
  | 'occlusion:high'
  | 'occlusion:medium'
  | 'occlusion:low'
  | 'vru'
  | 'workzone'
  | 'roadway'
  | 'roadside'
  | 'sidewalk'
  | 'mobile'
  | 'parkable'
  | 'run'
  | 'debris'
  | 'large-vehicle';

export const PROP_TAGS: readonly PropTag[] = [
  'occlusion:high',
  'occlusion:medium',
  'occlusion:low',
  'vru',
  'workzone',
  'roadway',
  'roadside',
  'sidewalk',
  'mobile',
  'parkable',
  'run',
  'debris',
  'large-vehicle',
] as const;

/** Extents in metres: `l` along +X (facing), `w` along Z, `h` along Y. */
export interface Dims {
  l: number;
  w: number;
  h: number;
}

/** Build parameters are plain JSON so the catalog can round-trip as data. */
export type ParamValue = number | string | boolean;

export interface CatalogEntry {
  /** Stable `<class>.<name>` identifier. The contract other packages hold. */
  readonly id: string;
  /** Human label for pickers. */
  readonly label: string;
  readonly class: PropClass;
  /**
   * One sentence, written for an LLM choosing props for a scenario: what it is
   * and what it is useful for in a driving scene.
   */
  readonly description: string;
  /** Real-world extents of the default build, metres. */
  readonly dims: Dims;
  readonly tags: readonly PropTag[];
  /** Parameters the builder is called with when none are supplied. */
  readonly defaultParams: Readonly<Record<string, ParamValue>>;
}
