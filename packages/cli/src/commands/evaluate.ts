/**
 * `uniscenarios evaluate <trace> [--filter critical|negative-control|all]`.
 *
 * The reject filters, applied to a trace. `--filter negative-control` is not a
 * different set of filters — it is the same set with `trivially_safe` demoted
 * from a rejection to a tag, because the taxonomy deliberately contains
 * scenarios whose whole point is that nothing happens.
 */

import { evaluateTrace, type EvaluateFilters } from '@uniscenarios/sim-engine';

import { CliError, EXIT } from '../errors.js';
import { emit, emitLines, fixed, pad } from '../output.js';
import { readTraceFile } from '../template-io.js';
import { metricsSummary } from './simulate.js';

export type EvaluateFilterMode = 'critical' | 'negative-control' | 'all';

export interface EvaluateOptions {
  readonly file: string;
  readonly filter: EvaluateFilterMode;
  readonly trivialTtcS?: number | undefined;
  readonly rejectCollisions: boolean;
  readonly pretty: boolean;
}

export function filtersFor(
  mode: EvaluateFilterMode,
  extra: { trivialTtcS?: number | undefined; rejectCollisions?: boolean } = {},
): EvaluateFilters {
  return {
    ...(mode === 'negative-control' ? { negativeControl: true } : {}),
    ...(extra.trivialTtcS === undefined ? {} : { trivialTtcS: extra.trivialTtcS }),
    ...(extra.rejectCollisions ? { rejectCollisions: true } : {}),
  };
}

/** `critical` / `trivially-safe` / `infeasible` — the batch's headline buckets. */
export function criticalityBand(
  verdict: 'accept' | 'reject',
  findings: ReadonlyArray<{ code: string }>,
): 'critical' | 'trivially-safe' | 'no-interaction' | 'unavoidable' | 'out-of-window' | 'never-fired' {
  if (verdict === 'accept') return 'critical';
  const codes = new Set(findings.map((f) => f.code));
  if (codes.has('no_interaction')) return 'no-interaction';
  if (codes.has('trivially_safe')) return 'trivially-safe';
  if (codes.has('physically_unavoidable')) return 'unavoidable';
  if (codes.has('never_fired')) return 'never-fired';
  if (codes.has('out_of_window')) return 'out-of-window';
  return 'trivially-safe';
}

export async function evaluate(options: EvaluateOptions): Promise<number> {
  if (!['critical', 'negative-control', 'all'].includes(options.filter)) {
    throw new CliError('bad_value', `--filter must be critical | negative-control | all`, {
      path: '--filter',
    });
  }
  const trace = await readTraceFile(options.file);
  const evaluation = evaluateTrace(
    trace,
    filtersFor(options.filter, {
      trivialTtcS: options.trivialTtcS,
      rejectCollisions: options.rejectCollisions,
    }),
  );
  const band = criticalityBand(evaluation.verdict, evaluation.findings);

  const payload = {
    file: options.file,
    mapId: trace.header.mapId,
    metricSubject: trace.header.metricSubject,
    filter: options.filter,
    verdict: evaluation.verdict,
    band,
    tags: evaluation.tags,
    findings: evaluation.findings,
    summary: evaluation.summary,
    metrics: metricsSummary(trace),
  };

  if (!options.pretty) {
    emit(payload, options);
  } else {
    const lines = [
      `${options.file}: ${evaluation.verdict.toUpperCase()} (${band})`,
      `minTTC ${fixed(evaluation.summary.minTTC)} s at t=${fixed(evaluation.summary.minTTCt)} s · requiredDecelMax ${fixed(
        evaluation.summary.requiredDecelMax,
      )} m/s² · collisions ${evaluation.summary.collisions} · neverFired ${evaluation.summary.neverFired}`,
    ];
    if (evaluation.tags.length > 0) lines.push(`tags: ${evaluation.tags.join(', ')}`);
    if (evaluation.findings.length > 0) {
      lines.push('', 'findings:');
      for (const f of evaluation.findings) lines.push(`  ${pad(f.code, 26)}${f.reason}`);
    }
    emitLines(lines);
  }

  // A rejection is a *finding*, not a command failure: the caller asked whether
  // this instance passes, and it got a definite answer.
  return evaluation.verdict === 'accept' ? EXIT.ok : EXIT.validationFindings;
}
