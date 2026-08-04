import { AuthoredActorLimitError, MAX_AUTHORED_ACTORS, type ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { MapEntry } from '../maps';
import type { PortableBindingAdapter, EligibilityReport, VariationProgress, VariationSearchPayload, PortableVariationBinding, VariationCandidateResult } from './model';
import type { PortableLiftIssue } from '@uniscenarios/scenario-materializer';
import type { VariationWorkerRequest, VariationWorkerResponse } from './variation-worker';
import { scenarioRevision } from './contracts';
import { DEFAULT_VARIATION_CANDIDATE_BUDGET, enumerateVariationCandidates } from './planning';

export interface VariationSearchOptions {
  resumeToken?: string;
  workerCount?: number;
  axisCombinations?: number;
  drawsPerLocation?: number;
  candidateBudget?: number;
  onProgress?: (progress: VariationProgress) => void;
}

export class VariationSearchClient {
  private workers: Worker[] = [];
  private analysisWorker: Worker | null = null;
  private sequence = 0;
  private pendingRejects = new Set<(reason: Error) => void>();
  private checkpoints = new Map<string, Map<number, VariationCandidateResult>>();

  async analyze(
    template: ScenarioTemplateV2,
    sourceMap: MapEntry,
    adapter?: PortableBindingAdapter,
    axes: { axisCombinations?: number; drawsPerLocation?: number; candidateBudget?: number } = {},
  ): Promise<EligibilityReport> {
    if (template.roles.length > MAX_AUTHORED_ACTORS) throw new AuthoredActorLimitError(template.roles.length);
    const started = performance.now();
    const revision = scenarioRevision(template);
    const source = mapSource(sourceMap);
    const portableBinding = await this.binding(template, source, adapter);
    const worker = this.analysisWorker ?? (this.analysisWorker = new Worker(new URL('./variation-worker.ts', import.meta.url), { type: 'module' }));
    const response = await this.call(worker, {
      id: ++this.sequence, kind: 'analyze', sourceRevision: revision, template, sourceMap: source,
      axisCombinations: axes.axisCombinations ?? 1, drawsPerLocation: axes.drawsPerLocation ?? 1,
      candidateBudget: axes.candidateBudget ?? DEFAULT_VARIATION_CANDIDATE_BUDGET,
      ...(portableBinding ? { portableBinding } : {}),
    });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== 'analyze') throw new Error('Variation worker returned the wrong response stage');
    return { ...response.report, computedInMs: Math.round((performance.now() - started) * 100) / 100 };
  }

  async search(
    template: ScenarioTemplateV2,
    sourceMap: MapEntry,
    _maps: readonly MapEntry[],
    adapter?: PortableBindingAdapter,
    resumeOrOptions?: string | VariationSearchOptions,
  ): Promise<VariationSearchPayload> {
    if (template.roles.length > MAX_AUTHORED_ACTORS) throw new AuthoredActorLimitError(template.roles.length);
    this.cancel();
    const options: VariationSearchOptions = typeof resumeOrOptions === 'string' ? { resumeToken: resumeOrOptions } : resumeOrOptions ?? {};
    const sourceRevision = scenarioRevision(template);
    const source = mapSource(sourceMap);
    const binding = await this.binding(template, source, adapter);
    const analyzer = this.createWorker();
    const analyzeResponse = await this.call(analyzer, {
      id: ++this.sequence, kind: 'analyze', sourceRevision, template, sourceMap: source,
      axisCombinations: options.axisCombinations ?? 1, drawsPerLocation: options.drawsPerLocation ?? 1,
      candidateBudget: options.candidateBudget ?? DEFAULT_VARIATION_CANDIDATE_BUDGET,
      ...(binding ? { portableBinding: binding } : {}),
    });
    if (!analyzeResponse.ok) throw new Error(analyzeResponse.error);
    if (analyzeResponse.kind !== 'analyze') throw new Error('Variation analysis response was malformed');
    const eligibility = analyzeResponse.report;
    const planKey = `${eligibility.axisCombinations}:${eligibility.drawsPerLocation}:${eligibility.candidateBudget}`;
    const jobId = `${sourceRevision}:${eligibility.resumeToken ?? 'new'}:${planKey}`;
    const checkpointKey = jobId;
    const resumed = options.resumeToken === eligibility.resumeToken ? this.checkpoints.get(checkpointKey) : undefined;
    const results = new Map<number, VariationCandidateResult>(resumed ?? []);
    const prior = [...results.values()];
    const eligibleCandidates = enumerateVariationCandidates(
      eligibility.candidates.filter((candidate) => candidate.equivalence.eligibleForMaterialization),
      eligibility.drawsPerLocation,
      eligibility.candidateBudget,
    );
    const counts = { enumerated: eligibleCandidates.length, materialized: prior.filter((item) => item.instance).length, simulated: prior.filter((item) => item.trace).length, gated: prior.length, deduplicated: prior.length, ranked: prior.length, verified: prior.filter((item) => item.acceptance.status === 'accepted').length, failed: prior.filter((item) => item.stage === 'failed').length };
    options.onProgress?.({ jobId, sourceRevision, counts: { ...counts } });
    const baselineResponse = await this.call(analyzer, {
      id: ++this.sequence, kind: 'baseline', sourceRevision, template, sourceMap: source,
      ...(binding ? { portableBinding: binding } : {}),
    });
    this.release(analyzer);
    if (!baselineResponse.ok) throw new Error(baselineResponse.error);
    if (baselineResponse.kind !== 'baseline') throw new Error('Variation baseline response was malformed');

    const workerCount = Math.max(2, Math.min(4, options.workerCount ?? 4));
    const queue = eligibleCandidates.filter((planned) => !results.has(planned.candidate.rank)).sort((a, b) => a.candidate.rank - b.candidate.rank);
    const runners = Array.from({ length: Math.min(workerCount, Math.max(1, queue.length)) }, async () => {
      const worker = this.createWorker();
      try {
        while (queue.length) {
          const planned = queue.shift();
          if (!planned) break;
          const { candidate, drawIndex } = planned;
          const pending: VariationCandidateResult = {
            candidate,
            acceptance: { status: 'pending_materialization', candidate, requiredChecksPassed: false, issues: [], resumeToken: eligibility.resumeToken ?? '' },
            stage: 'materializing',
          };
          options.onProgress?.({ jobId, sourceRevision, counts: { ...counts }, candidate: pending });
          const response = await this.call(worker, {
            id: ++this.sequence, kind: 'verify', sourceRevision, template, sourceMap: source, candidate,
            drawIndex,
            sourceBehavior: baselineResponse.sourceBehavior, patternId: eligibility.patternId ?? 'variation',
            ...(binding ? { portableBinding: binding } : {}),
          });
          if (!response.ok || response.kind !== 'verify') {
            counts.failed++; counts.gated++;
            const failed = { ...pending, stage: 'failed' as const, error: response.ok ? 'Malformed verification response' : response.error };
            results.set(candidate.rank, failed);
            this.checkpoints.set(checkpointKey, new Map(results));
            options.onProgress?.({ jobId, sourceRevision, counts: { ...counts }, candidate: failed });
            continue;
          }
          counts.materialized += response.result.instance ? 1 : 0;
          counts.simulated += response.result.trace ? 1 : 0;
          counts.gated++;
          if (response.result.acceptance.status === 'accepted') counts.verified++;
          else counts.failed++;
          results.set(candidate.rank, response.result);
          this.checkpoints.set(checkpointKey, new Map(results));
          options.onProgress?.({ jobId, sourceRevision, counts: { ...counts }, candidate: response.result });
        }
      } finally {
        this.release(worker);
      }
    });
    await Promise.all(runners);
    counts.deduplicated = results.size;
    counts.ranked = results.size;
    options.onProgress?.({ jobId, sourceRevision, counts: { ...counts } });
    return {
      sourceBehavior: baselineResponse.sourceBehavior,
      sourceSite: baselineResponse.sourceSite,
      patternId: eligibility.patternId ?? 'variation',
      resumeToken: eligibility.resumeToken ?? '',
      candidates: [...results.values()].sort((a, b) => a.candidate.rank - b.candidate.rank),
      issues: eligibility.issues,
      reports: { [sourceMap.id]: { matches: eligibility.locations.compatible, rejected: eligibility.locations.rejected, failureSummary: eligibility.reasons.filter((reason) => reason.code !== 'EXACT_STRUCTURAL_MATCH').map((reason) => reason.message).join(' · '), warnings: [] } },
    };
  }

  cancel(): void {
    this.sequence++;
    const error = new DOMException('Variation search was canceled', 'AbortError');
    for (const reject of this.pendingRejects) reject(error);
    this.pendingRejects.clear();
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.analysisWorker?.terminate();
    this.analysisWorker = null;
  }

  private async binding(template: ScenarioTemplateV2, source: ReturnType<typeof mapSource>, adapter?: PortableBindingAdapter): Promise<PortableVariationBinding | undefined> {
    const result = adapter ? await adapter.bind(template, source) : { ok: true, issues: [] };
    if (!result.ok) throw new PortableLiftError(result.issues);
    if (result.binding?.template.roles.some((role) => role.kind === 'scene_absolute')) {
      throw new Error('Portable binding adapter returned scene_absolute roles; refusing to send map coordinates to variation search');
    }
    return result.binding;
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('./variation-worker.ts', import.meta.url), { type: 'module' });
    this.workers.push(worker);
    return worker;
  }

  private release(worker: Worker): void {
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    worker.terminate();
  }

  private call(worker: Worker, request: VariationWorkerRequest): Promise<VariationWorkerResponse> {
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { this.pendingRejects.delete(fail); worker.removeEventListener('message', message); worker.removeEventListener('error', crash); };
      const message = (event: MessageEvent<VariationWorkerResponse>) => {
        if (event.data.id !== request.id) return;
        cleanup(); resolve(event.data);
      };
      const crash = (event: ErrorEvent) => fail(new Error(event.message || 'Variation worker failed'));
      this.pendingRejects.add(fail);
      worker.addEventListener('message', message);
      worker.addEventListener('error', crash);
      worker.postMessage(request);
    });
  }
}

export class PortableLiftError extends Error {
  readonly issues: PortableLiftIssue[];
  constructor(issues: PortableLiftIssue[]) {
    super(issues.length ? issues.map((issue) => `${issue.path}: ${issue.message}${issue.dependency ? ` (${issue.dependency})` : ''}`).join('\n') : 'The authored scene could not be lifted into a portable scenario.');
    this.name = 'PortableLiftError'; this.issues = issues;
  }
}

function mapSource(map: MapEntry) {
  return { id: map.id, label: map.label, topology: map.topology, derivedTopology: map.derivedTopology, locations: map.locations, xodr: map.xodr, signals: map.signals };
}
