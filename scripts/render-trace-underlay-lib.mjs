/**
 * Map underlay for the deterministic trace renderer.
 *
 * Pure functions from a parsed `topology-index.json.gz` (and optionally
 * `derived/locations.json.gz`) to SVG layer strings, so a vision judge sees
 * roads instead of boxes on a grid. Lane centrelines are painted as strokes of
 * their representative width, coloured by laneType; junction internal lanes get
 * a wider surface coat underneath so junction areas read as continuous asphalt;
 * driving lanes get thin offset boundary lines; crosswalk anchors (when the
 * derived locations file exists) get zebra stripes.
 *
 * Everything here is deterministic: lanes and crosswalks are sorted by id, no
 * clock, no randomness, and the SVG text depends only on the inputs.
 */

/** Fill colours per topology laneType. Driving must read as road against #101820. */
export const LANE_STYLES = {
  driving: { fill: '#6e7987' },
  shoulder: { fill: '#3c4550' },
  parking: { fill: '#4e5a66' },
  biking: { fill: '#46685a' },
  sidewalk: { fill: '#7b7364' },
};

/** Anything the topology names that we have no dedicated style for. */
export const LANE_STYLE_FALLBACK = { fill: '#4a525c' };

/** Junction surface coat: subtle, no border, wider than the lane itself. */
export const JUNCTION_SURFACE_FILL = '#5a646f';
export const JUNCTION_SURFACE_WIDTH_FACTOR = 1.9;

export const BOUNDARY_STROKE = '#d9dee5';
export const CROSSWALK_STRIPE_FILL = '#e8ecf1';

/** Paint order: below everything else, sidewalks under driving so kerb lines stay visible. */
const NON_DRIVING_ORDER = ['shoulder', 'parking', 'sidewalk', 'biking'];

const CROSSWALK_BAND_M = 3.0; // stripe length along the lane direction
const CROSSWALK_STRIPE_M = 0.6; // stripe width across
const CROSSWALK_PITCH_M = 1.2; // stripe repeat across

/**
 * Normalize a parsed topology-index document into a draw-ready model.
 * Lanes sorted by rsl; each lane carries a bbox padded by its painted
 * half-width so viewport culling is a plain rectangle test.
 */
export function underlayFromTopology(topology, locationsDoc = null) {
  const lanes = [];
  for (const key of Object.keys(topology.lanes ?? {}).sort()) {
    const lane = topology.lanes[key];
    const pts = lane.polyline ?? [];
    if (pts.length < 2) continue;
    const widthM = Math.max(0.3, lane.representativeWidthM ?? 3.0);
    const isJunction = lane.isJunction === true;
    const pad = (widthM / 2) * (isJunction ? JUNCTION_SURFACE_WIDTH_FACTOR : 1) + 0.5;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    lanes.push({
      rsl: lane.rsl ?? key,
      laneType: lane.laneType ?? 'unknown',
      isJunction,
      widthM,
      pts,
      bbox: { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad },
    });
  }
  return {
    mapName: topology.mapName ?? null,
    lanes,
    crosswalks: locationsDoc ? crosswalksFromLocations(locationsDoc) : [],
  };
}

/**
 * Crosswalk anchors from a derived locations document. The scene frame is the
 * 3D one (x, height, z); the trace/topology world is (x, -z) — the same
 * convention `render-trace.mjs` already uses for occluder OBBs.
 */
export function crosswalksFromLocations(locationsDoc) {
  const out = [];
  for (const loc of locationsDoc.locations ?? []) {
    if (loc.type !== 'crosswalk') continue;
    const scene = loc.anchor?.scene;
    if (!scene || typeof scene.x !== 'number' || typeof scene.z !== 'number') continue;
    out.push({
      id: loc.id ?? loc.handle ?? 'crosswalk',
      x: scene.x,
      y: -scene.z,
      headingRad: loc.anchor?.road?.headingRad ?? 0,
      halfSpanM: Math.min(12, Math.max(2, loc.extent?.radiusM ?? 4)),
    });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** World-space rectangle the camera can see, padded so wide strokes at the rim still paint. */
export function viewportBounds({ camera, scale, width, height }, marginM = 2) {
  const halfW = width / 2 / scale + marginM;
  const halfH = height / 2 / scale + marginM;
  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

function inView(lane, b) {
  return lane.bbox.minX <= b.maxX && lane.bbox.maxX >= b.minX && lane.bbox.minY <= b.maxY && lane.bbox.maxY >= b.minY;
}

/**
 * Offset a polyline perpendicular to travel: positive = left of travel
 * (+90° from segment heading), using averaged segment normals at interior
 * points. Good enough for lane boundaries at rendering scale.
 */
export function offsetPolyline(pts, offsetM) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // left normal of (dx, dy) is (-dy, dx)
    out[i] = { x: pts[i].x + (-dy / len) * offsetM, y: pts[i].y + (dx / len) * offsetM };
  }
  return out;
}

function screenPolyline(pts, project) {
  const parts = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 1) {
    const s = project(pts[i]);
    parts[i] = `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
  }
  return parts.join(' ');
}

function strokeLayer(cls, pts, project, color, widthPx, opacity, dash = null) {
  return (
    `<polyline class="${cls}" points="${screenPolyline(pts, project)}" fill="none" stroke="${color}"` +
    ` stroke-width="${widthPx.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"` +
    `${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  );
}

/** World-space corner list of one zebra stripe rectangle. */
function stripeCorners(cw, alongOffsetM) {
  // Band axis (walking direction) is perpendicular to the lane heading.
  const hx = Math.cos(cw.headingRad);
  const hy = Math.sin(cw.headingRad);
  const px = -hy; // band axis unit
  const py = hx;
  const cxx = cw.x + px * alongOffsetM;
  const cyy = cw.y + py * alongOffsetM;
  const halfLane = CROSSWALK_BAND_M / 2; // stripe long side, along lane heading
  const halfStripe = CROSSWALK_STRIPE_M / 2; // stripe short side, along band
  return [
    { x: cxx + hx * halfLane + px * halfStripe, y: cyy + hy * halfLane + py * halfStripe },
    { x: cxx + hx * halfLane - px * halfStripe, y: cyy + hy * halfLane - py * halfStripe },
    { x: cxx - hx * halfLane - px * halfStripe, y: cyy - hy * halfLane - py * halfStripe },
    { x: cxx - hx * halfLane + px * halfStripe, y: cyy - hy * halfLane + py * halfStripe },
  ];
}

/**
 * SVG layer strings for everything visible from the camera, in paint order:
 * junction surfaces → non-driving lanes → driving lanes → driving boundaries →
 * crosswalk stripes. `project` maps world points to screen points.
 */
export function underlaySvgLayers(underlay, view, project) {
  const { scale } = view;
  const bounds = viewportBounds(view, 14);
  const layers = [];

  const visible = underlay.lanes.filter((lane) => inView(lane, bounds));

  // 1. Junction surface coats.
  for (const lane of visible) {
    if (!lane.isJunction) continue;
    layers.push(
      strokeLayer(
        'underlay-junction',
        lane.pts,
        project,
        JUNCTION_SURFACE_FILL,
        Math.max(1, lane.widthM * JUNCTION_SURFACE_WIDTH_FACTOR * scale),
        '1',
      ),
    );
  }

  // 2. Non-driving lanes, in fixed type order.
  for (const type of NON_DRIVING_ORDER) {
    const style = LANE_STYLES[type] ?? LANE_STYLE_FALLBACK;
    for (const lane of visible) {
      if (lane.laneType !== type) continue;
      layers.push(
        strokeLayer(`underlay-lane-${type}`, lane.pts, project, style.fill, Math.max(1, lane.widthM * scale), '1'),
      );
    }
  }
  // Unstyled types still paint, in sorted-lane order, so nothing silently vanishes.
  for (const lane of visible) {
    if (lane.laneType === 'driving' || NON_DRIVING_ORDER.includes(lane.laneType)) continue;
    layers.push(
      strokeLayer(
        `underlay-lane-${lane.laneType}`,
        lane.pts,
        project,
        LANE_STYLE_FALLBACK.fill,
        Math.max(1, lane.widthM * scale),
        '1',
      ),
    );
  }

  // 3. Driving lanes (junction internals included: their surface coat is already below).
  for (const lane of visible) {
    if (lane.laneType !== 'driving') continue;
    layers.push(
      strokeLayer(
        'underlay-lane-driving',
        lane.pts,
        project,
        LANE_STYLES.driving.fill,
        Math.max(1, lane.widthM * scale),
        '1',
      ),
    );
  }

  // 4. Boundary lines on non-junction driving lanes (junction interiors stay unmarked, like real asphalt).
  for (const lane of visible) {
    if (lane.laneType !== 'driving' || lane.isJunction) continue;
    for (const side of [1, -1]) {
      layers.push(
        strokeLayer(
          'underlay-boundary',
          offsetPolyline(lane.pts, side * (lane.widthM / 2)),
          project,
          BOUNDARY_STROKE,
          1.2,
          '0.6',
        ),
      );
    }
  }

  // 5. Crosswalk zebra stripes.
  for (const cw of underlay.crosswalks) {
    if (cw.x < bounds.minX || cw.x > bounds.maxX || cw.y < bounds.minY || cw.y > bounds.maxY) continue;
    const stripes = Math.max(1, Math.floor((2 * cw.halfSpanM) / CROSSWALK_PITCH_M));
    const start = -((stripes - 1) / 2) * CROSSWALK_PITCH_M;
    for (let i = 0; i < stripes; i += 1) {
      const corners = stripeCorners(cw, start + i * CROSSWALK_PITCH_M);
      layers.push(
        `<polygon class="underlay-crosswalk" points="${screenPolyline(corners, project)}" fill="${CROSSWALK_STRIPE_FILL}" opacity="0.55"/>`,
      );
    }
  }

  return layers;
}

// --- actor glyphs ------------------------------------------------------------

/** Disc-rendered kinds: class must be legible to a vision judge at ~5 px. */
const DISC_KINDS = new Map([
  ['pedestrian', '#ff5a5f'],
  ['bicycle', '#e67e22'],
  ['cyclist', '#e67e22'],
  ['scooter', '#e67e22'],
  ['animal', '#d98f4a'],
  ['sidewalk_robot', '#b48fd9'],
  ['drone', '#b48fd9'],
]);

const MOTORCYCLE_FILL = '#c07fe8';
const EGO_FILL = '#45a3ff';
const STATIC_FILL = '#ffc166';
const VEHICLE_FILL = '#84d65a';

/**
 * Shape and color for one actor, from `trace.header.actorMetadata[id].kind`
 * (authoritative; pass `null` for pre-metadata traces, which keeps the legacy
 * literal-id behavior: only 'ped' was ever a disc). Precedence: ego blue >
 * disc-class color > static amber > motorcycle violet > vehicle green.
 * Static VRUs keep their class color — the class is what the judge must see.
 */
export function actorGlyph(id, kind, isStatic) {
  if (id === 'ego') return { shape: 'box', color: EGO_FILL };
  const resolved = kind ?? (id === 'ped' ? 'pedestrian' : null);
  const disc = resolved === null ? undefined : DISC_KINDS.get(resolved);
  if (disc !== undefined) return { shape: 'disc', color: disc };
  if (isStatic) return { shape: 'box', color: STATIC_FILL };
  if (resolved === 'motorcycle') return { shape: 'box', color: MOTORCYCLE_FILL };
  return { shape: 'box', color: VEHICLE_FILL };
}

// --- emergency light state -----------------------------------------------------

/**
 * Latest `lights.emergency` value for `actorId` at or before `t`, from the
 * trace's `state_set` events. 'off' when never set. The engine records the
 * event when a `set(lights.emergency)` interaction fires, so this is the
 * authoritative runtime state, not the authored intent.
 */
export function emergencyLightStateAt(events, actorId, t) {
  let state = 'off';
  let stateT = -Infinity;
  for (const e of events ?? []) {
    if (e.kind !== 'state_set' || e.actorId !== actorId || e.key !== 'lights.emergency') continue;
    if (e.t > t || e.t < stateT) continue;
    state = String(e.value);
    stateT = e.t;
  }
  return state;
}

/** Deterministic 4 Hz flash phase from frame time: 0 or 1, no wall clock. */
export function emergencyFlashPhase(t) {
  return Math.floor(t / 0.25) % 2 === 0 ? 0 : 1;
}
