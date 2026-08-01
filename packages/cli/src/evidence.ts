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
    | 'trace_actor_ids_mismatch';
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
  readonly actorIds: string[];
  readonly actorCount: number;
  readonly issues: EvidenceHashIssue[];
}

export function verifyEvidenceHashes(instance: InstanceFile, trace: SimTrace): EvidenceHashReport {
  const recomputedInputHash = contentHash(instance.input);
  const manifestInputHash = instance.manifest?.inputHash ?? null;
  const traceInputHash = trace.header?.inputHash ?? null;
  const inputActorIds = [...instance.input.actors.map((a) => a.id)].sort();
  const actorIds = [...(trace.header?.actorIds ?? Object.keys(trace.ticks?.actors ?? {}))].sort();
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

  if (JSON.stringify(actorIds) !== JSON.stringify(inputActorIds)) {
    issues.push({
      code: 'trace_actor_ids_mismatch',
      reason: 'trace header actorIds must exactly match sorted instance input actor ids',
      expected: inputActorIds.join(','),
      actual: actorIds.join(','),
    });
  }

  return {
    ok: issues.length === 0,
    recomputedInputHash,
    manifestInputHash,
    traceInputHash,
    inputActorIds,
    traceActorIds: actorIds,
    actorIds,
    actorCount: actorIds.length,
    issues,
  };
}
