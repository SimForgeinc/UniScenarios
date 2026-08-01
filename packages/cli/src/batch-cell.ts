/**
 * One batch cell, start to finish: materialize → simulate → evaluate.
 *
 * Lives in its own module because it runs in two places — inline in the parent
 * process (`--concurrency 1`, and every test) and inside a worker thread — and
 * those two paths must be the same code or the batch stops being reproducible.
 */

import path from 'node:path';

import { runSimulation, traceDigest } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

import { criticalityBand, filtersFor, type EvaluateFilterMode } from './commands/evaluate.js';
import { metricsSummary } from './commands/simulate.js';
import { evaluateTrace } from '@uniscenarios/sim-engine';
import { loadMap } from './maps.js';
import { verifyEvidenceHashes, type EvidenceHashReport } from './evidence.js';
import { checkInvariants, type InvariantResidualReport } from './invariants.js';
import { materialize } from './materialize.js';
import { findSite } from './sites.js';
import { writeJsonFile, writeTraceFile } from './template-io.js';
import { toStructuredError } from './errors.js';

export interface CellCoords {
  readonly mapId: string;
  readonly siteId: string;
  readonly drawIndex: number;
}

export interface CellOptions extends CellCoords {
  readonly outDir: string;
  readonly writeTrace: boolean;
  readonly filter: EvaluateFilterMode;
  readonly trivialTtcS?: number | undefined;
}

export interface CellResult extends CellCoords {
  readonly instanceId: string;
  readonly status: 'ok' | 'error';
  readonly feasible: boolean;
  readonly verdict: 'accept' | 'reject' | null;
  readonly band: string | null;
  readonly tags: string[];
  readonly findings: Array<{ code: string; reason: string }>;
  readonly invariants: InvariantResidualReport[];
  readonly evidence: EvidenceHashReport;
  readonly metrics: Record<string, unknown> | null;
  readonly siteScore: number;
  readonly siteVerdict: string;
  readonly paramSeed: string;
  readonly params: Record<string, number>;
  readonly inputHash: string | null;
  readonly traceDigest: string | null;
  readonly instanceFile: string | null;
  readonly traceFile: string | null;
  readonly issues: Array<{ code: string; severity: string; reason: string }>;
  readonly error?: { code: string; reason: string; path?: string };
}

export function cellPaths(outDir: string, coords: CellCoords): {
  instance: string;
  trace: string;
  result: string;
} {
  const dir = path.join(outDir, coords.mapId, coords.siteId);
  const stem = `draw-${String(coords.drawIndex).padStart(3, '0')}`;
  return {
    instance: path.join(dir, `${stem}.instance.json`),
    trace: path.join(dir, `${stem}.trace.json.gz`),
    result: path.join(dir, `${stem}.result.json`),
  };
}

/** Run one cell. Never throws: a failure is a recorded cell, not a dead batch. */
export async function runCell(
  template: ScenarioTemplateV2,
  options: CellOptions,
): Promise<CellResult> {
  const paths = cellPaths(options.outDir, options);
  const base = {
    mapId: options.mapId,
    siteId: options.siteId,
    drawIndex: options.drawIndex,
    instanceId: `${options.siteId}#${options.drawIndex}`,
  };
  try {
    const { bundle, site } = await findSite(template, options.mapId, options.siteId);
    const { input, manifest } = materialize(template, bundle, site, {
      drawIndex: options.drawIndex,
    });
    await writeJsonFile(paths.instance, {
      kind: 'scenario-instance',
      version: 1,
      manifest,
      input,
    });

    const run = runSimulation(input, { graph: bundle.graph, guards: 'collect' });
    if (options.writeTrace) await writeTraceFile(paths.trace, run.trace);

    const evaluation = evaluateTrace(
      run.trace,
      filtersFor(
        template.meta.negativeControl ? 'negative-control' : options.filter,
        { trivialTtcS: options.trivialTtcS },
      ),
    );
    const speedLimitKph = bundle.index.lanes[site.frame.entryLaneRsl]?.speedLimitKph ?? null;
    const invariants = checkInvariants({
      template,
      trace: run.trace,
      scope: {
        params: manifest.params.values,
        clip: { seconds: run.trace.header.clipSeconds },
        ...(speedLimitKph === null ? {} : { lane: { speedLimitKph } }),
      },
      arrival: manifest.arrival,
      speedLimitKph,
    });
    const invariantViolations = invariants.filter(
      (r) => r.status === 'violated' && r.essentiality === 'required',
    );
    const evidence = verifyEvidenceHashes({ kind: 'scenario-instance', version: 1, manifest, input }, run.trace);
    const findings: Array<{ code: string; reason: string }> = evaluation.findings.map((f) => ({ code: f.code, reason: f.reason }));
    if (!evidence.ok) {
      findings.push(...evidence.issues.map((i) => ({ code: i.code, reason: i.reason })));
    }
    if (invariantViolations.length > 0) {
      findings.push(
        ...invariantViolations.map((r) => ({
          code: 'invariant_violated',
          reason: `${r.id}: ${r.reason}`,
        })),
      );
    }
    const verdict = invariantViolations.length > 0 || !evidence.ok ? 'reject' : evaluation.verdict;

    const result: CellResult = {
      ...base,
      status: 'ok',
      feasible: manifest.feasible,
      verdict,
      band: !evidence.ok
        ? 'evidence-mismatch'
        : invariantViolations.length > 0
          ? 'invariant'
          : criticalityBand(evaluation.verdict, evaluation.findings),
      tags: [
        ...evaluation.tags,
        ...(!evidence.ok ? ['evidence_mismatch'] : []),
        ...(invariantViolations.length > 0 ? ['invariant_violated'] : []),
      ],
      findings,
      invariants,
      evidence,
      metrics: metricsSummary(run.trace),
      siteScore: site.score,
      siteVerdict: site.degradation.verdict,
      paramSeed: manifest.replayKey.paramSeed,
      params: manifest.params.values,
      inputHash: manifest.inputHash,
      traceDigest: traceDigest(run.trace),
      instanceFile: paths.instance,
      traceFile: options.writeTrace ? paths.trace : null,
      issues: [...manifest.issues, ...run.issues].map((i) => ({
        code: i.code,
        severity: i.severity,
        reason: i.reason,
      })),
    };
    await writeJsonFile(paths.result, result);
    return result;
  } catch (error) {
    const structured = toStructuredError(error);
    const result: CellResult = {
      ...base,
      status: 'error',
      feasible: false,
      verdict: null,
      band: 'infeasible',
      tags: [],
      findings: [],
      invariants: [],
      evidence: {
        ok: false,
        recomputedInputHash: '',
        manifestInputHash: null,
        traceInputHash: null,
        inputActorIds: [],
        traceActorIds: [],
        traceTrackActorIds: [],
        actorIds: [],
        actorCount: 0,
        inputMapId: options.mapId,
        manifestMapId: null,
        traceMapId: null,
        matcherIndexDigest: null,
        manifestEngineGraphDigest: null,
        traceEngineGraphDigest: null,
        issues: [],
      },
      metrics: null,
      siteScore: 0,
      siteVerdict: 'infeasible',
      paramSeed: '',
      params: {},
      inputHash: null,
      traceDigest: null,
      instanceFile: null,
      traceFile: null,
      issues: [],
      error: structured,
    };
    await writeJsonFile(paths.result, result).catch(() => undefined);
    return result;
  }
}

export { loadMap };
