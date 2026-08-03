/// <reference lib="webworker" />

import {
  finalizeVariationAcceptance,
  inferPortableSitePattern,
  matchAnchorReport,
  normalizeDerivedMapIndex,
  searchScenarioVariations,
  type MatchedSite,
  type VariationIssue,
} from '@uniscenarios/anchor-matcher';
import { adaptTemplate, bindPortableVariation, materialize, parseMapSignalCatalog, type MapBundle } from '@uniscenarios/scenario-materializer';
import { buildLaneGraph, runSimulation, type SimTrace, type TopologyIndex } from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { behaviorSignature, requiredBehaviorChecksPassed, variationPreview } from './behavior';
import type {
  PortableVariationBinding,
  VariationCandidateResult,
  VariationMapSource,
  VariationSearchPayload,
} from './model';

export interface VariationWorkerRequest {
  id: number;
  template: ScenarioTemplateV2;
  sourceMap: VariationMapSource;
  maps: VariationMapSource[];
  /** Supplied by the upcoming map-bound portable adapter. Never synthesized here. */
  portableBinding?: PortableVariationBinding;
  resumeToken?: string;
}

export type VariationWorkerResponse =
  | { id: number; ok: true; result: VariationSearchPayload }
  | { id: number; ok: false; error: string; issues?: VariationIssue[] };

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<VariationWorkerRequest>): void => {
  void search(event.data).then(
    (result) => scope.postMessage({ id: event.data.id, ok: true, result } satisfies VariationWorkerResponse),
    (reason: unknown) => scope.postMessage({
      id: event.data.id,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    } satisfies VariationWorkerResponse),
  );
};

async function search(request: VariationWorkerRequest): Promise<VariationSearchPayload> {
  const sources = [...new Map(request.maps.map((map) => [map.id, map])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
  const bundles = new Map<string, MapBundle>();
  await Promise.all(sources.map(async (map) => bundles.set(map.id, await loadBundle(map))));
  const sourceBundle = bundles.get(request.sourceMap.id) ?? await loadBundle(request.sourceMap);
  const binding = request.portableBinding ?? bindAlreadyPortable(request.template, sourceBundle);
  if (!binding) {
    throw new Error('This scene is map-bound and has no portable binding yet. Run the map-bound → portable adapter; Studio will not infer transfer semantics from world positions.');
  }
  if (binding.sourceSite.topologyDigest !== sourceBundle.index.topologyDigest) {
    throw new Error(`Source topology is stale (${binding.sourceSite.topologyDigest} != ${sourceBundle.index.topologyDigest}). Rebind the authored location before searching.`);
  }

  const sourceProduct = materialize(binding.template, sourceBundle, binding.sourceSite, { drawIndex: -1 });
  if (!sourceProduct.manifest.feasible) {
    throw new Error('Source scenario cannot establish a feasible simulation baseline.');
  }
  const sourceTrace = runSimulation(sourceProduct.input, { graph: sourceBundle.graph, guards: 'throw' }).trace;
  const sourceBehavior = behaviorSignature(sourceTrace);
  const requiredRoles = binding.template.roles.filter((role) => role.essentiality === 'required').map((role) => role.id);
  const adapted = adaptTemplate(binding.template);
  const pattern = inferPortableSitePattern(binding.sourceSite, sourceBundle.index, {
    requiredRoles,
    authoredAnchor: adapted.anchor,
  });
  const result = searchScenarioVariations(pattern, [...bundles.values()].map((bundle) => bundle.index), {
    roles: adapted.roles,
    requiredRoles,
  });
  // A resume token identifies topology + dependencies. Supplying an older token
  // is allowed and clearly reported by the new token rather than silently using
  // stale results.
  const candidateResults: VariationCandidateResult[] = [];
  for (const candidate of result.candidates) {
    if (candidate.site.siteId === binding.sourceSite.siteId && candidate.mapId === binding.sourceSite.mapId) continue;
    const bundle = bundles.get(candidate.mapId)!;
    if (!candidate.equivalence.eligibleForMaterialization) {
      candidateResults.push({
        candidate,
        acceptance: finalizeVariationAcceptance({ candidate, materializationSucceeded: false }),
      });
      continue;
    }
    try {
      // Candidate-specific topology stays in this separate binding. The
      // coordinate-free template is never mutated with destination facts.
      const bound = bindPortableVariation(binding.template, candidate.site);
      const product = materialize(bound.template, bundle, bound.site, { drawIndex: -1 });
      const materializationIssues: VariationIssue[] = product.manifest.notes.map((note) => ({
        code: 'behavior_mismatch', stage: 'materialize', severity: 'warning', path: note.path,
        mapId: candidate.mapId, siteId: candidate.site.siteId, message: note.reason,
        retryable: true, dependency: `repair portable materialization at ${note.path}`,
      }));
      if (!product.manifest.feasible) {
        candidateResults.push({
          candidate,
          acceptance: finalizeVariationAcceptance({
            candidate, materializationSucceeded: false, materializationIssues,
          }),
          error: materializationIssues.map((issue) => issue.message).join(' · ') || 'materialization was infeasible',
        });
        continue;
      }
      const trace = runSimulation(product.input, { graph: bundle.graph, guards: 'throw' }).trace;
      const behavior = behaviorSignature(trace);
      const acceptance = finalizeVariationAcceptance({
        candidate,
        materializationSucceeded: true,
        sourceBehavior,
        candidateBehavior: behavior,
        requiredChecksPassed: requiredBehaviorChecksPassed(trace),
        materializationIssues,
      });
      const conflicts = candidate.site.bindings.flatMap((item) => item.conflict
        ? [{ x: item.conflict.point.x, z: -item.conflict.point.y, role: item.role }]
        : []);
      candidateResults.push({
        candidate,
        acceptance,
        behavior,
        instance: {
          kind: 'scenario-instance', version: 1,
          manifest: product.manifest as unknown as Record<string, unknown>,
          input: product.input,
        },
        trace,
        preview: variationPreview(trace, conflicts, candidate.site.frame.mirrored, candidate.permutationKey),
      });
    } catch (error) {
      candidateResults.push({
        candidate,
        acceptance: finalizeVariationAcceptance({ candidate, materializationSucceeded: false }),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    sourceBehavior,
    sourceSite: binding.sourceSite,
    patternId: pattern.patternId,
    resumeToken: result.resumeToken,
    candidates: candidateResults,
    issues: result.issues,
    reports: Object.fromEntries(Object.entries(result.reportsByMap).map(([mapId, report]) => [mapId, {
      matches: report.sites.length,
      rejected: report.rejected.length,
      failureSummary: report.failureSummary,
      warnings: report.warnings,
    }])),
  };
}

function bindAlreadyPortable(template: ScenarioTemplateV2, bundle: MapBundle): PortableVariationBinding | null {
  if (template.roles.length === 0 || template.roles.some((role) => role.kind === 'scene_absolute')) return null;
  const adapted = adaptTemplate(template);
  if (adapted.notes.length) {
    throw new Error(`Portable binding is incomplete: ${adapted.notes.map((note) => `${note.path}: ${note.reason}`).join(' · ')}`);
  }
  const report = matchAnchorReport(adapted.anchor, bundle.index, { roles: adapted.roles });
  const sourceSite = report.sites.find((site) => site.degradation.intentPreserved);
  if (!sourceSite) throw new Error(`The authored source location no longer matches: ${report.failureSummary || 'zero intent-preserving sites'}`);
  return { template, sourceSite };
}

async function loadBundle(map: VariationMapSource): Promise<MapBundle> {
  const [topology, derived, locations, xodr, signals] = await Promise.all([
    fetchJson(map.topology), fetchJson(map.derivedTopology), fetchJson(map.locations), fetchText(map.xodr), fetchJson(map.signals),
  ]);
  const topologyIndex = topology as TopologyIndex;
  const index = normalizeDerivedMapIndex(derived, { mapId: map.id, topology: topologyIndex as never, locations });
  return {
    mapId: map.id,
    catalog: locations as MapBundle['catalog'],
    derived: derived as MapBundle['derived'],
    topology: topologyIndex,
    index,
    graph: buildLaneGraph(topologyIndex),
    signalCatalog: parseMapSignalCatalog(xodr, signals),
  };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decode gzip map artifacts');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function fetchJson(url: string): Promise<any> { return JSON.parse(new TextDecoder().decode(await fetchBytes(url))); }
async function fetchText(url: string): Promise<string> { return new TextDecoder().decode(await fetchBytes(url)); }
