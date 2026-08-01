/**
 * `@scenario-studio/xodr-tools` — OpenDRIVE georeferencing and map-overlay data
 * for Scenario Studio.
 *
 * Three layers, all renderer-agnostic:
 *
 * 1. {@link CoordinateFrame} — WGS84 <-> OpenDRIVE-local <-> y-up scene.
 * 2. Loaders — {@link loadLanePolygons}, {@link loadSignals}, {@link loadGzipJson}.
 * 3. Overlay builders — {@link buildLaneOverlay}, {@link buildSignalOverlay},
 *    pure functions returning `THREE.Object3D` trees.
 *
 * @example
 * ```ts
 * import {
 *   CoordinateFrame, fetchXodrHeader, loadGzipJson,
 *   loadLanePolygons, loadSignals, buildLaneOverlay, buildSignalOverlay,
 * } from '@scenario-studio/xodr-tools';
 *
 * const manifest = await (await fetch('/maps/yale/3d/manifest.json')).json();
 * const header = await fetchXodrHeader('/maps/yale/map.xodr');
 * const frame = new CoordinateFrame({
 *   projString: header.projString,
 *   extents: header.extents,
 * });
 *
 * const lanes = await loadLanePolygons('/maps/yale/lane-polygons.geojson.gz', frame);
 * const signals = await loadSignals('/maps/yale/signals.geojson.gz', frame);
 *
 * scene.add(buildLaneOverlay(lanes, { heightSampler }));
 * scene.add(buildSignalOverlay(signals, { heightSampler }));
 * ```
 *
 * @packageDocumentation
 */

export {
  parseXodrHeader,
  fetchXodrHeader,
  type XodrHeader,
  type MapExtents,
} from './header.js';

export {
  CoordinateFrame,
  type CoordinateFrameOptions,
  type CalibrationReport,
  type SceneBox,
  type SceneManifestLike,
  type Vec2,
  type Vec3,
  type Vec3Like,
} from './coordinate-frame.js';

export { loadGzipJson, decodeMaybeGzippedJson, isGzipped } from './gzip.js';

export type {
  Feature,
  FeatureCollection,
  Geometry,
  LineStringGeometry,
  MultiPolygonGeometry,
  PointGeometry,
  PolygonGeometry,
  Position,
} from './geojson.js';

export {
  loadLanePolygons,
  lanePolygonsFromGeoJson,
  type LanePolygon,
  type LanePolygonProperties,
} from './lanes.js';

export {
  loadSignals,
  signalsFromGeoJson,
  type SignalCategory,
  type SignalFeature,
  type SignalLoadOptions,
  type SignalProperties,
} from './signals.js';

export {
  buildLaneOverlay,
  laneIdForFace,
  type HeightSampler,
  type LaneOverlayOptions,
  type LaneOverlayUserData,
  type LaneRange,
} from './overlays/lanes.js';

export {
  buildSignalOverlay,
  SIGNAL_CATEGORY_COLORS,
  type SignalOverlayOptions,
  type SignalOverlayUserData,
} from './overlays/signals.js';
