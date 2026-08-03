import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildLaneGraph } from '../map/lane-graph.js';
import { buildDefaultPlacementRoute, buildFollowRoute, buildLanePathRoute, retargetToNeighbour } from '../map/route.js';
import type { TopologyIndex, TurnRelationName } from '../map/topology.js';

const MAPS = ['yale-street', 'belmont-research-center', 'el-camino-road', 'easterbrook-discovery-school', 'richmond-field-station'] as const;
const ASSET_ROOT = process.env.SCEN_DEV_ASSETS;

interface Coverage {
  map: string;
  drivingLanes: number;
  directedConnections: number;
  gates: number;
  straightGates: number;
  leftGates: number;
  rightGates: number;
  legalLaneChanges: number;
  branchPreservingLaneChanges: number;
  metadataIssues: string[];
  capabilityGaps: Record<string, number>;
  capabilityGapSamples: string[];
}

function load(map: string): TopologyIndex {
  if (!ASSET_ROOT) throw new Error('SCEN_DEV_ASSETS is required for the real-map topology contract');
  const path = join(ASSET_ROOT, map, 'topology-index.json.gz');
  if (!existsSync(path)) throw new Error(`missing required topology asset: ${path}`);
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as TopologyIndex;
}

function sweep(map: string): Coverage {
  const topology = load(map);
  const graph = buildLaneGraph(topology);
  const issues: string[] = [];
  const driving = graph.laneRsls().filter((rsl) => graph.geometry(rsl)?.lane.laneType === 'driving');
  let directedConnections = 0;
  let legalLaneChanges = 0;
  let branchPreservingLaneChanges = 0;

  for (const rsl of driving) {
    const lane = graph.requireGeometry(rsl).lane;
    for (const ref of [...lane.predecessors, ...lane.successors]) {
      if (!topology.lanes[ref]) issues.push(`${rsl}: dangling road connection ${ref}`);
    }
    for (const side of ['left', 'right'] as const) {
      const adjacent = lane.adjacentLanes?.[side];
      if (!adjacent?.laneRsl || !adjacent.sameDirection) continue;
      if (!topology.lanes[adjacent.laneRsl]) {
        issues.push(`${rsl}: dangling ${side} adjacency ${adjacent.laneRsl}`);
        continue;
      }
      for (const permission of adjacent.permissionIds) {
        if (!lane.laneChangePermissions?.some((candidate) => candidate.id === permission)) {
          issues.push(`${rsl}: dangling lane-change permission ${permission}`);
        }
      }
      const sampleS = graph.lengthOf(rsl) / 2;
      const neighbour = graph.lateralNeighbour(rsl, side, sampleS, true);
      if (neighbour?.rsl === adjacent.laneRsl) legalLaneChanges += 1;
    }

    const nominal = graph.nominalReversed(rsl);
    const directions = nominal === null ? [false, true] : [nominal];
    for (const reversed of directions) {
      const from = { rsl, reversed };
      for (const successor of graph.successors(from)) {
        if (graph.geometry(successor.rsl)?.lane.laneType !== 'driving') continue;
        directedConnections += 1;
        const built = buildLanePathRoute(graph, [rsl, successor.rsl]);
        if (!built.ok) issues.push(`${rsl}${reversed ? '#r' : '#f'} -> ${successor.rsl}: ${built.error.reason}`);
      }
    }
  }

  for (const gate of topology.gates) {
    if (!topology.lanes[gate.approachLaneRsl]) issues.push(`${gate.id}: missing approach ${gate.approachLaneRsl}`);
    if (!topology.lanes[gate.connectingLaneRsl]) issues.push(`${gate.id}: missing connector ${gate.connectingLaneRsl}`);
    for (const exit of gate.exitLaneRsls) {
      if (!topology.lanes[exit]) issues.push(`${gate.id}: missing exit ${exit}`);
      else if (!buildLanePathRoute(graph, [gate.approachLaneRsl, gate.connectingLaneRsl, exit]).ok) issues.push(`${gate.id}: disconnected approach/connector/exit ${exit}`);
    }
    const explicit = buildFollowRoute(graph, gate.approachLaneRsl, [gate.turnRelation as TurnRelationName], 80);
    if (!explicit.ok || !explicit.route.legs.some((leg) => leg.turnRelation === gate.turnRelation)) {
      issues.push(`${gate.id}: explicit ${gate.turnRelation} cannot select that movement class`);
    }
    if (gate.turnRelation === 'Straight') {
      const length = graph.lengthOf(gate.approachLaneRsl);
      const defaultRoute = buildDefaultPlacementRoute(graph, { startRsl: gate.approachLaneRsl, startStorageS: length / 2, requiredDownstreamM: 80 });
      if (!defaultRoute.ok || !defaultRoute.route.legs.some((leg) => leg.turnRelation === 'Straight')) {
        issues.push(`${gate.id}: default route did not preserve a labelled Straight movement`);
      }
    }

    const approach = graph.geometry(gate.approachLaneRsl)?.lane;
    if (!approach) continue;
    for (const side of ['left', 'right'] as const) {
      const adjacent = approach.adjacentLanes?.[side];
      if (!adjacent?.laneRsl || !adjacent.sameDirection) continue;
      const targetGate = topology.gates.find((candidate) => candidate.approachLaneRsl === adjacent.laneRsl && candidate.turnRelation === gate.turnRelation);
      if (!targetGate) continue;
      const source = buildFollowRoute(graph, gate.approachLaneRsl, [gate.turnRelation as TurnRelationName], 80);
      if (!source.ok) continue;
      const driverSide = graph.nominalReversed(gate.approachLaneRsl) === true
        ? (side === 'left' ? 'right' : 'left')
        : side;
      const changed = retargetToNeighbour(graph, source.route, Math.min(graph.lengthOf(gate.approachLaneRsl) / 2, source.route.lengthM / 3), driverSide, { legalOnly: true });
      if (changed?.route.legs.some((leg) => leg.turnRelation === gate.turnRelation)) branchPreservingLaneChanges += 1;
      else issues.push(`${gate.id}: ${side} lane change lost ${gate.turnRelation} branch intent`);
    }
  }

  const metadataIssues = issues.filter((item) => /dangling|missing (approach|connector|exit)/.test(item));
  const capabilityItems = issues.filter((item) => !metadataIssues.includes(item));
  const capabilityGaps = capabilityItems.reduce<Record<string, number>>((counts, item) => {
    const kind = item.includes('default route') ? 'default-straight'
      : item.includes('explicit ') ? 'explicit-turn-addressing'
        : item.includes('disconnected') ? 'gate-chain-disconnected'
          : item.includes('lane change lost') ? 'lane-change-branch-loss'
            : 'other';
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    map,
    drivingLanes: driving.length,
    directedConnections,
    gates: topology.gates.length,
    straightGates: topology.gates.filter((gate) => gate.turnRelation === 'Straight').length,
    leftGates: topology.gates.filter((gate) => gate.turnRelation === 'Left').length,
    rightGates: topology.gates.filter((gate) => gate.turnRelation === 'Right').length,
    legalLaneChanges,
    branchPreservingLaneChanges,
    metadataIssues: [...new Set(metadataIssues)].sort(),
    capabilityGaps,
    capabilityGapSamples: [...new Set(capabilityItems)].sort().slice(0, 12),
  };
}

describe.skipIf(!ASSET_ROOT)('real-map topology interaction contract', () => {
  it('sweeps every shipped map without silently dropping invalid metadata', () => {
    const coverage = MAPS.map(sweep);
    console.info(`TOPOLOGY_COVERAGE ${JSON.stringify(coverage)}`);
    expect(coverage.map((item) => item.map)).toEqual([...MAPS]);
    expect(coverage.flatMap((item) => item.metadataIssues)).toEqual([]);
  }, 120_000);
});
