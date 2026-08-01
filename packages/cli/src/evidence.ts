/**
 * Evidence integrity checks.
 *
 * A batch result is only admissible evidence when the concrete instance and the
 * trace were produced from the same `SimScenarioInput`. The join key is the
 * engine input hash: `sha256(canonicalJson(input))` in the instance manifest
 * must match `trace.header.inputHash`. If it does not, the trace metrics prove a
 * different scenario and the cell must not be accepted or promoted.
 */

import { contentHash, type SimTrace } from '@uniscenarios/sim-engine';

import type { InstanceFile } from './template-io.js';

export interface EvidenceHashIssue {
  readonly code:
    | 'instance_input_hash_mismatch'
    | 'trace_input_hash_mismatch'
    | 'instance_map_id_mismatch'
    | 'trace_map_id_mismatch'
    | 'instance_actor_ids_mismatch'
    | 'trace_actor_ids_mismatch'
    | 'trace_actor_tracks_mismatch'
    | 'matcher_index_digest_missing'
    | 'engine_graph_digest_missing'
    | 'trace_engine_graph_digest_mismatch'
    | 'trace_topology_alias_mismatch';
  readonly reason: string;
  readonly expected: string;
  readonly actual: string | null;
}

export interface EvidenceHashReport {
  readonly ok: boolean;
  readonly recomputedInputHash: string;
  readonly manifestInputHash: string | null;
  readonly traceInputHash: string | null;
  readonly inputActorIds: string[];
  readonly traceActorIds: string[];
  readonly traceTrackActorIds: string[];
  readonly actorIds: string[];
  readonly actorCount: number;
  readonly inputMapId: string;
  readonly manifestMapId: string | null;
  readonly traceMapId: string | null;
  readonly matcherIndexDigest: string | null;
  readonly manifestEngineGraphDigest: string | null;
  readonly traceEngineGraphDigest: string | null;
  readonly issues: EvidenceHashIssue[];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sortedUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').sort();
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function verifyEvidenceHashes(instance: InstanceFile, trace: SimTrace): EvidenceHashReport {
  const recomputedInputHash = contentHash(instance.input);
  const manifestInputHash = instance.manifest?.inputHash ?? null;
  const traceInputHash = trace.header?.inputHash ?? null;
  const inputActorIds = [...instance.input.actors.map((a) => a.id)].sort();
  const manifest = instance.manifest as unknown as Record<string, unknown> | undefined;
  const replayKey = manifest?.['replayKey'] as Record<string, unknown> | undefined;
  const manifestActors = manifest?.['actors'] as Array<Record<string, unknown>> | undefined;
  const manifestActorIds = sortedUniqueStrings(manifestActors?.map((actor) => actor['id']));
  const actorIds = sortedUniqueStrings(trace.header?.actorIds);
  const traceTrackActorIds = Object.keys(trace.ticks?.actors ?? {}).sort();
  const inputMapId = instance.input.mapId;
  const manifestMapId = stringOrNull(replayKey?.['mapId']);
  const traceMapId = stringOrNull(trace.header?.mapId);
  const matcherIndexDigest = stringOrNull(replayKey?.['matcherIndexDigest']);
  const manifestEngineGraphDigest = stringOrNull(replayKey?.['engineGraphDigest']);
  const traceEngineGraphDigest = stringOrNull(trace.header?.engineGraphDigest);
  const traceTopologyAlias = stringOrNull(trace.header?.topologyDigest);
  const issues: EvidenceHashIssue[] = [];

  if (manifestInputHash !== recomputedInputHash) {
    issues.push({
      code: 'instance_input_hash_mismatch',
      reason: 'instance manifest inputHash does not match sha256(canonicalJson(instance.input))',
      expected: recomputedInputHash,
      actual: manifestInputHash,
    });
  }
  if (traceInputHash !== recomputedInputHash) {
    issues.push({
      code: 'trace_input_hash_mismatch',
      reason: 'trace header inputHash does not match sha256(canonicalJson(instance.input))',
      expected: recomputedInputHash,
      actual: traceInputHash,
    });
  }

  if (manifestMapId !== inputMapId) {
    issues.push({
      code: 'instance_map_id_mismatch',
      reason: 'instance manifest replayKey.mapId must exactly match instance input.mapId',
      expected: inputMapId,
      actual: manifestMapId,
    });
  }
  if (traceMapId !== inputMapId) {
    issues.push({
      code: 'trace_map_id_mismatch',
      reason: 'trace header mapId must exactly match instance input.mapId',
      expected: inputMapId,
      actual: traceMapId,
    });
  }
  if (!sameStrings(manifestActorIds, inputActorIds)) {
    issues.push({
      code: 'instance_actor_ids_mismatch',
      reason: 'instance manifest actor ids must exactly match sorted instance input actor ids',
      expected: inputActorIds.join(','),
      actual: manifestActorIds.join(','),
    });
  }
  if (!sameStrings(actorIds, inputActorIds)) {
    issues.push({
      code: 'trace_actor_ids_mismatch',
      reason: 'trace header actorIds must exactly match sorted instance input actor ids',
      expected: inputActorIds.join(','),
      actual: actorIds.join(','),
    });
  }
  if (!sameStrings(traceTrackActorIds, inputActorIds)) {
    issues.push({
      code: 'trace_actor_tracks_mismatch',
      reason: 'trace tick actor tracks must exactly match sorted instance input actor ids',
      expected: inputActorIds.join(','),
      actual: traceTrackActorIds.join(','),
    });
  }

  // Matcher/map-intel and engine topology are separate provenance domains.
  // Only the engine digest may be joined to a trace; the matcher digest proves
  // site selection and must be present independently rather than substituted.
  if (matcherIndexDigest === null) {
    issues.push({
      code: 'matcher_index_digest_missing',
      reason: 'instance replay key must declare matcherIndexDigest separately from engine topology',
      expected: 'non-empty matcher/map-intel digest',
      actual: null,
    });
  }
  if (manifestEngineGraphDigest === null) {
    issues.push({
      code: 'engine_graph_digest_missing',
      reason: 'instance replay key must declare the engineGraphDigest used for simulation',
      expected: 'non-empty engine graph digest',
      actual: null,
    });
  }
  if (traceEngineGraphDigest !== manifestEngineGraphDigest) {
    issues.push({
      code: 'trace_engine_graph_digest_mismatch',
      reason: 'trace engineGraphDigest must match the instance replay key engineGraphDigest',
      expected: manifestEngineGraphDigest ?? '',
      actual: traceEngineGraphDigest,
    });
  }
  if (traceTopologyAlias !== traceEngineGraphDigest) {
    issues.push({
      code: 'trace_topology_alias_mismatch',
      reason: 'deprecated trace topologyDigest must remain an exact alias of engineGraphDigest',
      expected: traceEngineGraphDigest ?? '',
      actual: traceTopologyAlias,
    });
  }

  return {
    ok: issues.length === 0,
    recomputedInputHash,
    manifestInputHash,
    traceInputHash,
    inputActorIds,
    traceActorIds: actorIds,
    traceTrackActorIds,
    actorIds,
    actorCount: actorIds.length,
    inputMapId,
    manifestMapId,
    traceMapId,
    matcherIndexDigest,
    manifestEngineGraphDigest,
    traceEngineGraphDigest,
    issues,
  };
}
