import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LANE_STYLES,
  crosswalksFromLocations,
  offsetPolyline,
  underlayFromTopology,
  underlaySvgLayers,
  viewportBounds,
} from '../render-trace-underlay-lib.mjs';

/** Minimal topology-index shape: two driving lanes, one sidewalk, one junction-internal lane. */
function topology() {
  return {
    schemaVersion: 3,
    mapName: 'test-map_20260101',
    lanes: {
      // Intentionally NOT in sorted order: draw order must come from sorting, not object order.
      '2:0:-1': {
        rsl: '2:0:-1',
        laneType: 'sidewalk',
        isJunction: false,
        representativeWidthM: 2.0,
        polyline: [{ x: 0, y: 6 }, { x: 40, y: 6 }],
      },
      '1:0:-1': {
        rsl: '1:0:-1',
        laneType: 'driving',
        isJunction: false,
        representativeWidthM: 3.5,
        polyline: [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      },
      '9:0:1': {
        rsl: '9:0:1',
        laneType: 'driving',
        isJunction: true,
        junctionId: '7',
        representativeWidthM: 3.5,
        polyline: [{ x: 40, y: 0 }, { x: 50, y: 5 }],
      },
      // Far away: must be culled from a viewport centred at the origin.
      '3:0:-1': {
        rsl: '3:0:-1',
        laneType: 'driving',
        isJunction: false,
        representativeWidthM: 3.5,
        polyline: [{ x: 5000, y: 5000 }, { x: 5040, y: 5000 }],
      },
    },
    junctions: { 7: { junctionId: '7', internalLaneRsls: ['9:0:1'] } },
  };
}

function locations() {
  return {
    locations: [
      {
        id: 'loc_b',
        type: 'crosswalk',
        anchor: {
          scene: { x: 20, y: 0.5, z: -1.5 },
          road: { headingRad: 0, rsl: '1:0:-1' },
        },
        extent: { radiusM: 6 },
      },
      // Non-crosswalk entries are ignored.
      { id: 'loc_x', type: 'junction', anchor: { scene: { x: 0, y: 0, z: 0 } }, extent: { radiusM: 4 } },
      // Sorted by id: loc_a before loc_b in the output.
      {
        id: 'loc_a',
        type: 'crosswalk',
        anchor: {
          scene: { x: 10, y: 0.5, z: 0 },
          road: { headingRad: 0, rsl: '1:0:-1' },
        },
        extent: { radiusM: 5 },
      },
    ],
  };
}

const CAMERA = { x: 20, y: 0 };
const VIEW = { camera: CAMERA, scale: 8, width: 960, height: 600 };

function project(p) {
  return { x: 480 + (p.x - CAMERA.x) * 8, y: 300 - (p.y - CAMERA.y) * 8 };
}

test('underlayFromTopology sorts lanes, keeps type/width/junction facts, computes width-padded bboxes', () => {
  const u = underlayFromTopology(topology());
  assert.deepEqual(u.lanes.map((l) => l.rsl), ['1:0:-1', '2:0:-1', '3:0:-1', '9:0:1']);
  const drive = u.lanes.find((l) => l.rsl === '1:0:-1');
  assert.equal(drive.laneType, 'driving');
  assert.equal(drive.widthM, 3.5);
  // bbox padded by at least half the painted width, so culling can use it directly.
  assert.ok(drive.bbox.minY <= -1.75 && drive.bbox.maxY >= 1.75);
  assert.equal(u.mapName, 'test-map_20260101');
});

test('viewport culling drops far lanes and keeps near ones', () => {
  const u = underlayFromTopology(topology());
  const bounds = viewportBounds(VIEW);
  const visible = u.lanes.filter((l) => l.bbox.minX <= bounds.maxX && l.bbox.maxX >= bounds.minX && l.bbox.minY <= bounds.maxY && l.bbox.maxY >= bounds.minY);
  assert.deepEqual(visible.map((l) => l.rsl), ['1:0:-1', '2:0:-1', '9:0:1']);
});

test('offsetPolyline shifts left of travel by +offset', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const left = offsetPolyline(pts, 1.75);
  // heading +x, left is +y.
  assert.ok(Math.abs(left[0].y - 1.75) < 1e-9 && Math.abs(left[1].y - 1.75) < 1e-9);
  const right = offsetPolyline(pts, -1.75);
  assert.ok(Math.abs(right[0].y + 1.75) < 1e-9);
});

test('crosswalksFromLocations maps scene z to world -z, sorts by id, ignores non-crosswalks', () => {
  const cws = crosswalksFromLocations(locations());
  assert.deepEqual(cws.map((c) => c.id), ['loc_a', 'loc_b']);
  const b = cws.find((c) => c.id === 'loc_b');
  assert.equal(b.x, 20);
  assert.equal(b.y, 1.5); // -z
  assert.equal(b.halfSpanM, 6);
});

test('underlaySvgLayers is deterministic, layered junction->surfaces->boundaries, and culled', () => {
  const u = underlayFromTopology(topology(), locations());
  const layers1 = underlaySvgLayers(u, VIEW, project).join('\n');
  const layers2 = underlaySvgLayers(u, VIEW, project).join('\n');
  assert.equal(layers1, layers2);
  // Junction surface paint appears before the driving fill of the same junction lane.
  const jx = layers1.indexOf('underlay-junction');
  const dx = layers1.indexOf('underlay-lane-driving');
  const sx = layers1.indexOf('underlay-lane-sidewalk');
  const bx = layers1.indexOf('underlay-boundary');
  const cx = layers1.indexOf('underlay-crosswalk');
  assert.ok(jx >= 0 && dx >= 0 && sx >= 0 && bx >= 0 && cx >= 0, `all layer kinds present: ${[jx, dx, sx, bx, cx]}`);
  assert.ok(jx < sx && sx < dx && dx < bx && bx < cx, `order junction<sidewalk<driving<boundary<crosswalk: ${[jx, sx, dx, bx, cx]}`);
  // The far lane must not be painted.
  assert.ok(!layers1.includes('5000'), 'culled lane leaked into svg');
  // Every lane type paints with its registered style.
  assert.ok(layers1.includes(LANE_STYLES.driving.fill));
  assert.ok(layers1.includes(LANE_STYLES.sidewalk.fill));
});

test('underlaySvgLayers works without locations (no crosswalk layer, no throw)', () => {
  const u = underlayFromTopology(topology());
  const layers = underlaySvgLayers(u, VIEW, project).join('\n');
  assert.ok(!layers.includes('underlay-crosswalk'));
  assert.ok(layers.includes('underlay-lane-driving'));
});
