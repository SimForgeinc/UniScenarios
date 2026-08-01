/**
 * Lane index behaviour, on a synthetic map where every answer is known by hand
 * and on the real Yale Street topology when `dev-assets/` is present.
 *
 * The synthetic fixture is deliberately axis-aligned so that the local -> scene
 * transform, the arc length and the OpenDRIVE direction rule can each be
 * asserted against a number rather than against the implementation.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { LaneIndex, advanceAlongTravel, headingDelta, normalizeHeading } from '../laneIndex';

const DEG = Math.PI / 180;

/**
 * Two straight lanes of a two-way street plus a sidewalk that must not be
 * snapped to.
 *
 * Local frame is x-east / y-north, so a lane running east has its polyline
 * along +x. Lane `-1` (negative id) travels along +s; lane `1` travels against
 * it, i.e. westward.
 */
function syntheticTopology(): Parameters<typeof LaneIndex.build>[0] {
  const eastbound = [];
  const westbound = [];
  const walk = [];
  for (let i = 0; i <= 100; i += 5) {
    eastbound.push({ x: i, y: -1.75 });
    westbound.push({ x: i, y: 1.75 });
    walk.push({ x: i, y: 6 });
  }
  return {
    mapName: 'synthetic',
    source: { xodrSha256: 'deadbeef' },
    lanes: {
      '7:0:-1': {
        roadId: 7,
        section: 0,
        laneId: -1,
        laneType: 'driving',
        speedLimitKph: 50,
        representativeWidthM: 3.5,
        polyline: eastbound,
      },
      '7:0:1': {
        roadId: 7,
        section: 0,
        laneId: 1,
        laneType: 'driving',
        speedLimitKph: 50,
        representativeWidthM: 3.5,
        polyline: westbound,
      },
      '7:0:2': {
        roadId: 7,
        section: 0,
        laneId: 2,
        laneType: 'sidewalk',
        representativeWidthM: 2,
        polyline: walk,
      },
    },
  };
}

describe('normalizeHeading / headingDelta', () => {
  it('folds into (-pi, pi]', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeHeading(-Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeHeading(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(normalizeHeading(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 12);
  });

  it('takes the short way round', () => {
    expect(headingDelta(170 * DEG, -170 * DEG) / DEG).toBeCloseTo(20, 9);
    expect(headingDelta(-170 * DEG, 170 * DEG) / DEG).toBeCloseTo(-20, 9);
  });
});

describe('LaneIndex', () => {
  const index = LaneIndex.build(syntheticTopology());

  it('indexes only driving lanes and maps local -> scene', () => {
    expect(index.stats.lanes).toBe(2);
    expect(index.stats.totalLanes).toBe(3);
    const lane = index.laneFor('7', 0, -1)!;
    expect(lane).toBeDefined();
    expect(lane.length).toBeCloseTo(100, 9);
    // local (x, y) -> scene (x, -y): the eastbound lane at local y = -1.75 is
    // at scene z = +1.75.
    const pose = index.poseAt(lane, 0, 0);
    expect(pose.x).toBeCloseTo(0, 9);
    expect(pose.z).toBeCloseTo(1.75, 9);
  });

  it('derives travel heading from the OpenDRIVE lane-id sign', () => {
    // Negative id runs along +s: eastward, heading 0.
    expect(index.poseAt(index.laneFor('7', 0, -1)!, 50, 0).headingRad).toBeCloseTo(0, 9);
    // Positive id runs against +s: westward, heading pi.
    expect(Math.abs(index.poseAt(index.laneFor('7', 0, 1)!, 50, 0).headingRad)).toBeCloseTo(
      Math.PI,
      9,
    );
  });

  it('places a lateral offset to the left of travel', () => {
    const east = index.laneFor('7', 0, -1)!;
    // Heading 0 (+X): left is -Z.
    const left = index.poseAt(east, 50, 1);
    expect(left.x).toBeCloseTo(50, 9);
    expect(left.z).toBeCloseTo(0.75, 9);
    const west = index.laneFor('7', 0, 1)!;
    // Heading pi (-X): left is +Z.
    const other = index.poseAt(west, 50, 1);
    expect(other.z).toBeCloseTo(-0.75, 9);
  });

  it('finds the nearest centreline and reports a signed offset', () => {
    // 0.5 m north of the eastbound centreline is 0.5 m to its left.
    const hit = index.nearest(30, 1.25, 20)!;
    expect(hit.lane.laneId).toBe(-1);
    expect(hit.s).toBeCloseTo(30, 6);
    expect(hit.t).toBeCloseTo(0.5, 6);
    expect(hit.distance).toBeCloseTo(0.5, 6);
    expect(hit.headingRad).toBeCloseTo(0, 9);
    // Round trip: the hit point plus its offset is the query point.
    const back = index.poseAt(hit.lane, hit.s, hit.t);
    expect(back.x).toBeCloseTo(30, 6);
    expect(back.z).toBeCloseTo(1.25, 6);
  });

  it('returns nothing beyond the search radius', () => {
    expect(index.nearest(30, 500, 30)).toBeNull();
    expect(index.nearest(30, 500, 600)).not.toBeNull();
  });

  it('flips to the opposing lane on demand', () => {
    const hit = index.nearest(30, 1.6, 20)!;
    expect(hit.lane.laneId).toBe(-1);
    const opposing = index.nearestOpposing(30, 1.6, hit.headingRad, 20)!;
    expect(opposing.lane.laneId).toBe(1);
    expect(Math.abs(headingDelta(hit.headingRad, opposing.headingRad))).toBeCloseTo(Math.PI, 6);
    // The predicate is "opposes the heading I give you", so asking from the
    // westbound heading hands back the eastbound lane again — which is what
    // makes Tab a toggle rather than a one-way trip.
    expect(index.nearestOpposing(30, 1.6, opposing.headingRad, 20)!.lane.laneId).toBe(-1);
    // Nothing at all when the radius excludes every candidate.
    expect(index.nearestOpposing(30, 1.6, hit.headingRad, 0.05)).toBeNull();
  });

  it('projects onto one specific lane, clamped to its extent', () => {
    const east = index.laneFor('7', 0, -1)!;
    expect(index.project(east, 30, 1.75).s).toBeCloseTo(30, 6);
    expect(index.project(east, -40, 1.75).s).toBe(0);
    expect(index.project(east, 400, 1.75).s).toBeCloseTo(100, 6);
  });

  it('advances along travel, not along storage order', () => {
    const east = index.laneFor('7', 0, -1)!;
    const west = index.laneFor('7', 0, 1)!;
    expect(advanceAlongTravel(east, 50, 10)).toBeCloseTo(60, 9);
    expect(advanceAlongTravel(west, 50, 10)).toBeCloseTo(40, 9);
    // Clamped to the lane.
    expect(advanceAlongTravel(east, 95, 20)).toBeCloseTo(100, 9);
    expect(advanceAlongTravel(east, 5, -20)).toBe(0);
  });

  it('clamps the lateral offset to what fits in the lane', () => {
    const east = index.laneFor('7', 0, -1)!;
    expect(index.lateralLimit(east, 0)).toBeCloseTo(1.75, 9);
    expect(index.lateralLimit(east, 1.82)).toBeCloseTo(0.84, 9);
    expect(index.lateralLimit(east, 6)).toBe(0);
  });

  it('rejects a topology with no lanes of the requested type', () => {
    expect(() => LaneIndex.build(syntheticTopology(), { laneTypes: ['motorway'] })).toThrow(
      /no lanes/,
    );
  });
});

// --------------------------------------------------------------- real data

const YALE = fileURLToPath(
  new URL('../../../../../dev-assets/yale-street/topology-index.json.gz', import.meta.url),
);

describe.skipIf(!existsSync(YALE))('LaneIndex on Yale Street', () => {
  const topology = JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(readFileSync(YALE)))));
  const index = LaneIndex.build(topology);

  it('indexes the driving network', () => {
    expect(index.stats.totalLanes).toBe(1141);
    // 622 driving lanes in the file; two are sub-metre stubs the snapper skips.
    expect(index.stats.lanes).toBe(620);
    expect(index.stats.segments).toBeGreaterThan(20_000);
    expect(index.stats.buildMs).toBeLessThan(200);
  });

  it('agrees with the index own adjacency about which way lanes run', () => {
    // The direction rule (negative lane id runs along +s) is load-bearing for
    // every vehicle placement, so it is checked against a second source: the
    // topology file's own `sameDirection` flags on adjacent lanes.
    let checked = 0;
    for (const lane of index.all) {
      const record = topology.lanes[lane.rsl];
      for (const side of ['left', 'right']) {
        const adjacent = record.adjacentLanes?.[side];
        if (!adjacent?.laneRsl) continue;
        const other = index.lane(adjacent.laneRsl);
        if (!other) continue;
        const a = index.poseAt(lane, lane.length / 2, 0).headingRad;
        const b = index.poseAt(other, other.length / 2, 0).headingRad;
        expect(Math.cos(a - b) > 0).toBe(adjacent.sameDirection);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('answers a nearest query from the centre of every lane', () => {
    for (const lane of index.all) {
      const mid = index.poseAt(lane, lane.length / 2, 0);
      const hit = index.nearest(mid.x, mid.z, 30);
      expect(hit).not.toBeNull();
      // The nearest centreline to a point *on* a centreline is at distance ~0.
      expect(hit!.distance).toBeLessThan(0.01);
    }
  });

  it('round-trips (s, t) through the scene frame', () => {
    // On the centreline the round trip is exact. Off it, it cannot be: a point
    // offset along the normal of a *curved* lane re-projects to a slightly
    // different s (the offset arc is longer or shorter than the centre one), so
    // the tolerance there is a curvature allowance, not slop.
    let worstOffsetS = 0;
    let worstOffsetT = 0;
    for (const lane of index.all.slice(0, 200)) {
      for (const f of [0.1, 0.5, 0.9]) {
        const s = lane.length * f;
        const on = index.poseAt(lane, s, 0);
        const centre = index.project(lane, on.x, on.z);
        expect(centre.s).toBeCloseTo(s, 3);
        expect(centre.t).toBeCloseTo(0, 6);
        for (const t of [-1, 0.75]) {
          const pose = index.poseAt(lane, s, t);
          const back = index.project(lane, pose.x, pose.z);
          worstOffsetS = Math.max(worstOffsetS, Math.abs(back.s - s));
          worstOffsetT = Math.max(worstOffsetT, Math.abs(back.t - t));
        }
      }
    }
    // Measured worst over the first 200 lanes: 45 cm of s and 9 cm of t, both
    // on the tightest junction turns, both for a full metre of lateral offset.
    // The offset arc is a different length from the centre one and its nearest
    // segment is not always the one it came from, so the error scales with
    // 1/radius and with |t|. It is geometry, not slop — and it does not reach
    // the user, because the editor re-projects drag *targets* (points it did
    // not offset), never poses it produced itself.
    expect(worstOffsetS).toBeLessThan(0.6);
    expect(worstOffsetT).toBeLessThan(0.12);
  });
});
