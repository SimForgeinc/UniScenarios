/**
 * Production map traffic-signal binding.
 *
 * RoadRunner's checked-in OpenDRIVE files provide physical head ids,
 * controller membership, junction/controller sequence order and concrete gate
 * geometry, but not authoritative phase durations. We therefore preserve the
 * real ids and movement bindings while marking the deterministic timing plan
 * as `synthetic-default`. An unsignalized map returns an empty catalog and the
 * materializer does not invent signal programs for it.
 */

import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import type { MatchedSite } from '@uniscenarios/anchor-matcher';
import type { SignalProgram, TopologyGate } from '@uniscenarios/sim-engine';

import type { MapBundle } from './maps.js';

export interface MapSignalHead {
  readonly id: string;
  readonly roadId: string;
  readonly s: number;
  readonly dynamic: boolean;
}

export interface MapSignalController {
  readonly id: string;
  readonly sequence: number;
  readonly signalIds: readonly string[];
}

export interface MapSignalJunction {
  readonly junctionId: string;
  readonly controllerIds: readonly string[];
}

export interface MapSignalCatalog {
  readonly heads: readonly MapSignalHead[];
  readonly controllers: readonly MapSignalController[];
  readonly junctions: readonly MapSignalJunction[];
}

export interface SiteSignalPlan {
  readonly junctionId: string | null;
  readonly programs: readonly SignalProgram[];
  /** Physical map head id → concrete engine program id. */
  readonly programByHeadId: ReadonlyMap<string, string>;
  /** Junction connecting lane → concrete engine program ids. */
  readonly programsByConnectingLane: ReadonlyMap<string, readonly string[]>;
  readonly timingSource: 'synthetic-default' | 'none';
}

interface SignalGeoJson {
  readonly features?: Array<{
    readonly properties?: {
      readonly id?: unknown;
      readonly road_id?: unknown;
      readonly s?: unknown;
      readonly signal_category?: unknown;
      readonly dynamic?: unknown;
    };
  }>;
}

/** Common junction-cycle offset: keeps every head synchronized while placing
 * ordinary 15–20 s incident clips across at least one fallback transition. */
export const SYNTHETIC_SIGNAL_OFFSET_S = 23;

function attrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of text.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*"([^"]*)"/g)) {
    out[match[1]!] = match[2]!;
  }
  return out;
}

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Parse only the small controller seam needed by the CLI; no XML mutation. */
export function parseMapSignalCatalog(xodr: string, geojson: SignalGeoJson): MapSignalCatalog {
  const heads = (geojson.features ?? [])
    .map((feature): MapSignalHead | null => {
      const p = feature.properties ?? {};
      if (p.signal_category !== 'traffic_light' || (p.dynamic !== 'yes' && p.dynamic !== true)) return null;
      const id = String(p.id ?? '');
      const roadId = String(p.road_id ?? '');
      if (!id || !roadId) return null;
      return { id, roadId, s: finite(p.s), dynamic: true };
    })
    .filter((head): head is MapSignalHead => head !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  const controllers: MapSignalController[] = [];
  for (const match of xodr.matchAll(/<controller\b([^>]*)>([\s\S]*?)<\/controller>/g)) {
    const a = attrs(match[1]!);
    if (!a['id']) continue;
    const signalIds = [...match[2]!.matchAll(/<control\b([^>]*)\/?\s*>/g)]
      .map((entry) => attrs(entry[1]!)['signalId'])
      .filter((id): id is string => Boolean(id));
    controllers.push({ id: a['id'], sequence: finite(a['sequence']), signalIds: [...new Set(signalIds)].sort() });
  }
  controllers.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));

  const junctions: MapSignalJunction[] = [];
  for (const match of xodr.matchAll(/<junction\b([^>]*)>([\s\S]*?)<\/junction>/g)) {
    const a = attrs(match[1]!);
    if (!a['id']) continue;
    const controllerIds = [...match[2]!.matchAll(/<controller\b([^>]*)\/?\s*>/g)]
      .map((entry) => attrs(entry[1]!)['id'])
      .filter((id): id is string => Boolean(id));
    if (controllerIds.length > 0) {
      junctions.push({ junctionId: a['id'], controllerIds: [...new Set(controllerIds)] });
    }
  }
  junctions.sort((a, b) => a.junctionId.localeCompare(b.junctionId));
  return { heads, controllers, junctions };
}

export async function loadMapSignalCatalog(xodrFile: string, signalsFile: string): Promise<MapSignalCatalog> {
  const [xodr, signalBytes] = await Promise.all([readFile(xodrFile, 'utf8'), readFile(signalsFile)]);
  const plain = signalBytes[0] === 0x1f && signalBytes[1] === 0x8b ? gunzipSync(signalBytes) : signalBytes;
  return parseMapSignalCatalog(xodr, JSON.parse(plain.toString('utf8')) as SignalGeoJson);
}

function coalescePhases(
  phases: Array<{ phase: 'green' | 'yellow' | 'red'; durationS: number }>,
): Array<{ phase: 'green' | 'yellow' | 'red'; durationS: number }> {
  const out: Array<{ phase: 'green' | 'yellow' | 'red'; durationS: number }> = [];
  for (const phase of phases) {
    const previous = out[out.length - 1];
    if (previous?.phase === phase.phase) previous.durationS += phase.durationS;
    else out.push({ ...phase });
  }
  return out;
}

/** Deterministic fallback cycle derived from controller sequence membership. */
export function defaultPhasesForHead(
  headId: string,
  controllers: readonly MapSignalController[],
): Array<{ phase: 'green' | 'yellow' | 'red'; durationS: number }> {
  if (controllers.length <= 1) {
    // The source declares no competing sequence. Keep the head observable and
    // useful for trigger/export testing without claiming this is field timing.
    return [
      { phase: 'green', durationS: 27 },
      { phase: 'yellow', durationS: 3 },
      { phase: 'red', durationS: 30 },
    ];
  }
  const raw: Array<{ phase: 'green' | 'yellow' | 'red'; durationS: number }> = [];
  for (let index = 0; index < controllers.length; index += 1) {
    const active = controllers[index]!.signalIds.includes(headId);
    const nextActive = controllers[(index + 1) % controllers.length]!.signalIds.includes(headId);
    if (!active) raw.push({ phase: 'red', durationS: 15 });
    else if (nextActive) raw.push({ phase: 'green', durationS: 15 });
    else raw.push({ phase: 'green', durationS: 12 }, { phase: 'yellow', durationS: 3 });
  }
  return coalescePhases(raw);
}

function stopLineFor(bundle: MapBundle, gate: TopologyGate): { rsl: string; s: number; connectingLaneRsls: string[] } | null {
  const geometry = bundle.graph.geometry(gate.approachLaneRsl);
  if (!geometry) return null;
  const reversed = bundle.graph.nominalReversed(gate.approachLaneRsl) ?? false;
  return {
    rsl: gate.approachLaneRsl,
    // One metre before the downstream endpoint, expressed in storage s.
    s: reversed ? Math.min(1, geometry.lengthM) : Math.max(0, geometry.lengthM - 1),
    connectingLaneRsls: [gate.connectingLaneRsl],
  };
}

/** Bind the site's real map heads/controllers to engine programs and movements. */
export function buildSiteSignalPlan(bundle: MapBundle, site: MatchedSite): SiteSignalPlan {
  const junctionId = site.frame.origin.mapFeatureId.startsWith('junction:')
    ? site.frame.origin.mapFeatureId.slice('junction:'.length)
    : null;
  const none = (): SiteSignalPlan => ({
    junctionId,
    programs: [],
    programByHeadId: new Map(),
    programsByConnectingLane: new Map(),
    timingSource: 'none',
  });
  if (!junctionId) return none();
  const junction = bundle.signalCatalog.junctions.find((candidate) => candidate.junctionId === junctionId);
  if (!junction) return none();
  const controllerById = new Map(bundle.signalCatalog.controllers.map((controller) => [controller.id, controller]));
  const controllers = junction.controllerIds
    .map((id) => controllerById.get(id))
    .filter((controller): controller is MapSignalController => controller !== undefined)
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
  if (controllers.length === 0) return none();

  const selectedHeadIds = new Set(controllers.flatMap((controller) => controller.signalIds));
  const heads = bundle.signalCatalog.heads.filter((head) => selectedHeadIds.has(head.id));
  if (heads.length === 0) return none();
  const gates = bundle.topology.gates.filter((gate) => gate.junctionId === junctionId);
  const programByHeadId = new Map<string, string>();
  const programsByConnectingLane = new Map<string, string[]>();
  const programs: SignalProgram[] = [];

  for (const head of heads) {
    const matchingGates = gates.filter(
      (gate) => String(bundle.topology.lanes[gate.connectingLaneRsl]?.roadId ?? '') === head.roadId,
    );
    const stopLines = matchingGates
      .map((gate) => stopLineFor(bundle, gate))
      .filter((line): line is NonNullable<typeof line> => line !== null)
      .filter(
        (line, index, all) =>
          all.findIndex((candidate) => candidate.rsl === line.rsl && candidate.connectingLaneRsls[0] === line.connectingLaneRsls[0]) === index,
      )
      .sort((a, b) => a.rsl.localeCompare(b.rsl) || a.connectingLaneRsls[0]!.localeCompare(b.connectingLaneRsls[0]!));
    const id = `signal:${head.id}`;
    const controllerIds = controllers.filter((controller) => controller.signalIds.includes(head.id)).map((controller) => controller.id);
    programs.push({
      id,
      phases: defaultPhasesForHead(head.id, controllers),
      offsetS: SYNTHETIC_SIGNAL_OFFSET_S,
      loop: true,
      stopLines,
      mapBinding: {
        junctionId,
        controllerIds,
        headIds: [head.id],
        timingSource: 'synthetic-default',
      },
    });
    programByHeadId.set(head.id, id);
    for (const gate of matchingGates) {
      const existing = programsByConnectingLane.get(gate.connectingLaneRsl);
      if (existing) existing.push(id);
      else programsByConnectingLane.set(gate.connectingLaneRsl, [id]);
    }
  }
  for (const ids of programsByConnectingLane.values()) ids.sort();
  programs.sort((a, b) => a.id.localeCompare(b.id));
  return { junctionId, programs, programByHeadId, programsByConnectingLane, timingSource: 'synthetic-default' };
}
