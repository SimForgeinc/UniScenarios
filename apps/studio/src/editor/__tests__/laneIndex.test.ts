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

  it('does not treat a 91 degree cross street as the opposing lane', () => {
    const cross = LaneIndex.build({
      mapName: 'crossing',
      lanes: {
        ...syntheticTopology().lanes,
        '9:0:-3': {
          roadId: 9,
          section: 0,
          laneId: -3,
          laneType: 'driving',
          representativeWidthM: 3.5,
          // This centreline crosses the query point and travels at +91° in the
          // scene frame: just over perpendicular, but not an oncoming carriageway.
          polyline: [
            { x: 30, y: -1.75 },
            { x: 30 + 100 * Math.cos(91 * DEG), y: -1.75 + 100 * Math.sin(91 * DEG) },
          ],
        },
      },
    });
    // The cross street is the nearest centreline, but Tab is given the active
    // eastbound heading from the placement ghost; it must choose the true
    // westbound carriageway instead of the 91° crossing lane.
    expect(cross.nearest(30, 1.6, 20)!.lane.laneId).toBe(-3);
    const opposing = cross.nearestOpposing(30, 1.6, 0, 20)!;
    expect(opposing.lane.laneId).toBe(1);
    expect(Math.abs(headingDelta(0, opposing.headingRad)) / DEG).toBeCloseTo(180, 6);
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

  /**
   * Regression: a hit's heading must be the heading its own `s` resolves to.
   *
   * A point off the outside of a corner projects onto the *vertex* the two
   * segments share — clamped to `f = 1` on the incoming one and `f = 0` on the
   * outgoing one, both at the same distance. `s` is the same either way, so if
   * the hit reported the incoming segment's heading, a placement stored from it
   * would claim a lane anchor whose `poseAt(s)` points somewhere else, and the
   * car would jump the moment anything re-derived its pose.
   */
  it('reports the heading its own s resolves to, even on a corner vertex', () => {
    const bend = [];
    for (let i = 0; i <= 50; i += 5) bend.push({ x: i, y: 0 });
    for (let i = 5; i <= 50; i += 5) bend.push({ x: 50 + i * Math.cos(30 * DEG), y: -i * Math.sin(30 * DEG) });
    const bent = LaneIndex.build({
      mapName: 'bend',
      lanes: {
        '1:0:-1': {
          roadId: 1,
          section: 0,
          laneId: -1,
          laneType: 'driving',
          representativeWidthM: 3.5,
          polyline: bend,
        },
      },
    });
    const lane = bent.laneFor('1', 0, -1)!;
    // Straight in, 30° out (local +y is scene -z, so the turn reads negative):
    // the corner is a real 30° turn, so picking the wrong side of the vertex is
    // a 30° error.
    expect(bent.poseAt(lane, 49, 0).headingRad / DEG).toBeCloseTo(0, 6);
    expect(bent.poseAt(lane, 51, 0).headingRad / DEG).toBeCloseTo(-30, 6);

    // A point outside the corner: its nearest centreline point *is* the vertex.
    const hit = bent.nearest(50, -6, 20)!;
    expect(hit.s).toBeCloseTo(50, 6);
    const pose = bent.poseAt(hit.lane, hit.s, 0);
    expect(headingDelta(pose.headingRad, hit.headingRad) / DEG).toBeCloseTo(0, 9);
    expect(hit.x).toBeCloseTo(pose.x, 9);
    expect(hit.z).toBeCloseTo(pose.z, 9);
    // Same for the single-lane projection used by a drag.
    const projected = bent.project(lane, 50, -6);
    expect(
      headingDelta(bent.poseAt(lane, projected.s, 0).headingRad, projected.headingRad) / DEG,
    ).toBeCloseTo(0, 9);
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

if (existsSync(YALE)) describe('LaneIndex on Yale Street', () => {
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

  /**
   * The same invariant as the synthetic corner test, swept over the real
   * network: every hit `nearest` can return must agree with `poseAt(hit.s)`.
   * Before the fix this reached 3.3° on Yale Street's junction turns — enough to
   * fail the 2° placement gate on its own.
   */
  it('never reports a heading its own s disagrees with', () => {
    let worstDeg = 0;
    let worstPosM = 0;
    for (const lane of index.all) {
      for (const f of [0.02, 0.25, 0.5, 0.75, 0.98]) {
        // Probe from both sides, at a metre out: on a bend one of them lands on
        // the shared vertex.
        for (const t of [-1.2, 1.2]) {
          const probe = index.poseAt(lane, lane.length * f, t);
          const hit = index.nearest(probe.x, probe.z, 8);
          if (!hit) continue;
          const pose = index.poseAt(hit.lane, hit.s, 0);
          worstDeg = Math.max(worstDeg, Math.abs(headingDelta(pose.headingRad, hit.headingRad)) / DEG);
          worstPosM = Math.max(worstPosM, Math.hypot(hit.x - pose.x, hit.z - pose.z));
        }
      }
    }
    expect(worstDeg).toBeLessThan(1e-9);
    expect(worstPosM).toBeLessThan(1e-9);
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
else describe.skip('LaneIndex on Yale Street (fixture unavailable)', () => {
  it('requires the optional Yale topology fixture', () => {});
});
