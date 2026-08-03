/// <reference lib="webworker" />

import { matchAnchorReport, normalizeDerivedMapIndex } from '@uniscenarios/anchor-matcher';
import { exportOpenScenarioXml14 } from '@uniscenarios/cli/asam/xml-1.4';
import { AsamExportError } from '@uniscenarios/cli/asam/types';
import { adaptTemplate, buildMapControlPlan, materializationSemanticLosses, materialize, materializeMapBound, parseMapSignalCatalog, type MapBundle, type MapControlPlan } from '@uniscenarios/scenario-materializer';
import {
  applyAmbientTraffic,
  buildLaneGraph,
  contentHash,
  pruneDanglingAfterInteractions,
  evaluateAmbientRobustness,
  evaluateIntentRubric,
  runSimulation,
  traceDigest,
  type AmbientTrafficProfile,
  type AmbientTrafficProvenance,
  type EvaluateFilters,
  type IntentRubricInput,
  type SimScenarioInput,
  type SimTrace,
  type TopologyIndex,
} from '@uniscenarios/sim-engine';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { ambientRobustnessGate } from '../ambient/robustnessGate';
import { createAmbientWorldPreviewInput } from '../ambient/worldPreview';
import type { OpenScenarioSnapshot, OpenScenarioSourceMapping } from '../openscenario/model';
import { selectPlayableSite } from './site-selection';
import { withEditablePhysicsDefault } from './physics';
import { emptyStaticColliderBundle, loadStaticMapCollidersBounded } from './staticMapColliders';
import type { StaticColliderDiagnostics } from './staticMapColliders';

export interface ScenarioWorkerMap {
  id: string;
  manifest: string;
  topology: string;
  derivedTopology: string;
  locations: string;
  xodr: string;
  signals: string;
}

export interface ScenarioWorkerRequest {
  id: number;
  template: ScenarioTemplateV2;
  map: ScenarioWorkerMap;
  ambientTraffic: AmbientTrafficProfile;
  /** Validated concrete authored evidence used as the immutable base for an editable world. */
  baseInstance?: {
    readonly manifest: Record<string, unknown>;
    readonly input: SimScenarioInput;
  };
  staticCollisionMode?: 'skip' | 'bounded';
  operation?: 'prepare' | 'ambient-preview' | 'robustness';
  evaluationFilters?: EvaluateFilters;
  /** Optional canonical intent rubric. Without it robustness is incomplete, never accepted. */
  intentRubric?: IntentRubricInput;
}

export interface AmbientRobustnessSummary {
  readonly version: 1;
  readonly baseInputHash: string;
  readonly baselineVerdict: string;
  readonly accepted: boolean;
  readonly overall: 'accepted' | 'rejected' | 'incomplete';
  readonly intent: {
    readonly status: 'evaluated' | 'not_evaluated';
    readonly baselineVerdict: 'accept' | 'reject' | null;
    readonly caseVerdicts: Readonly<Record<string, 'accept' | 'reject'>>;
  };
  readonly filters: EvaluateFilters;
  readonly cases: readonly {
    label: string;
    accepted: boolean;
    deterministic: boolean;
    authoredEventOrderPreserved: boolean;
    authoredNeverFiredPreserved: boolean;
    ambientCollisions: number;
    runtimeMs: number;
    generatedActors: number;
    profileHash: string;
    verdict: string;
    failures: readonly string[];
    warnings: readonly string[];
  }[];
}

export type ScenarioWorkerResponse =
  | { id: number; ok: true; kind: 'prepare'; instance: unknown; trace: SimTrace; siteId: string; ambientTraffic: AmbientTrafficProvenance; openScenario?: OpenScenarioSnapshot; mapCollisions: StaticColliderDiagnostics }
  | { id: number; ok: true; kind: 'robustness'; report: AmbientRobustnessSummary }
  | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<ScenarioWorkerRequest>): void => {
  const request = event.data;
  void prepare(request).then(
    (response) => scope.postMessage(response),
    (reason: unknown) => scope.postMessage({
      id: request.id,
      ok: false,
      error: reason instanceof Error ? reason.message : String(reason),
    } satisfies ScenarioWorkerResponse),
  );
};

async function prepare(request: ScenarioWorkerRequest): Promise<ScenarioWorkerResponse> {
  if (request.operation === 'ambient-preview') {
    const [topology, derived, locations, xodr, signals] = await Promise.all([
      fetchJson(request.map.topology),
      fetchJson(request.map.derivedTopology),
      fetchJson(request.map.locations),
      fetchText(request.map.xodr),
      fetchJson(request.map.signals),
    ]);
    const topologyIndex = topology as TopologyIndex;
    const graph = buildLaneGraph(topologyIndex);
    const index = normalizeDerivedMapIndex(derived, {
      mapId: request.map.id,
      topology: topologyIndex as never,
      locations,
    });
    const bundle: MapBundle = {
      mapId: request.map.id,
      catalog: locations as MapBundle['catalog'],
      derived: derived as MapBundle['derived'],
      topology: topologyIndex,
      index,
      graph,
      signalCatalog: parseMapSignalCatalog(xodr, signals),
    };
    const base = withMapControls(createAmbientWorldPreviewInput(request.map.id), buildMapControlPlan(bundle));
    const ambient = applyAmbientTraffic(base, graph, request.ambientTraffic);
    const result = runSimulation(ambient.input, { graph, guards: 'throw' });
    const manifest = {
      instanceId: `ambient-world:${request.map.id}`,
      inputHash: contentHash(base),
      replayKey: { mapId: request.map.id, engineGraphDigest: graph.topologyDigest, siteId: 'ambient-world' },
      actors: [],
    };
    return {
      id: request.id,
      ok: true,
      kind: 'prepare',
      instance: ambientInstance(manifest, ambient.input, ambient.provenance),
      trace: result.trace,
      siteId: 'ambient-world',
      ambientTraffic: ambient.provenance,
      mapCollisions: emptyStaticColliderBundle('skipped', 'Ambient world preview does not require static map collision extraction.').diagnostics,
    };
  }
  const [topology, derived, locations, xodr, signals] = await Promise.all([
    fetchJson(request.map.topology),
    fetchJson(request.map.derivedTopology),
    fetchJson(request.map.locations),
    fetchText(request.map.xodr),
    fetchJson(request.map.signals),
  ]);
  const topologyIndex = topology as TopologyIndex;
  const index = normalizeDerivedMapIndex(derived, {
    mapId: request.map.id,
    topology: topologyIndex as never,
    locations,
  });
  const graph = buildLaneGraph(topologyIndex);
  // A t=0 authoring preview must never wait for map GLB inspection. Full
  // playback gets a bounded attempt and explicit diagnostics on fallback.
  const staticCollision = request.staticCollisionMode === 'skip'
    ? emptyStaticColliderBundle('skipped', 'Static map collision extraction is deferred until playback.')
    : await loadStaticMapCollidersBounded(request.map.manifest, topologyIndex);
  const bundle: MapBundle = {
    mapId: request.map.id,
    catalog: locations as MapBundle['catalog'],
    derived: derived as MapBundle['derived'],
    topology: topologyIndex,
    index,
    graph,
    signalCatalog: parseMapSignalCatalog(xodr, signals),
  };
  const mapControls = buildMapControlPlan(bundle);

  if (request.baseInstance) {
    if (request.baseInstance.input.mapId !== request.map.id) {
      throw new Error(`Verified base targets ${request.baseInstance.input.mapId}, not ${request.map.id}`);
    }
    // A verified bundle is replayed directly elsewhere. Reaching the worker
    // means the user requested a regenerated editable simulation: deterministically
    // migrate an unpinned legacy input to the current dynamic authoring default.
    const repaired = pruneDanglingAfterInteractions(request.baseInstance.input.interactions);
    const editableInput = withMapControls(withEditablePhysicsDefault({
      ...request.baseInstance.input,
      interactions: repaired.interactions,
    }), mapControls);
    const generated = applyAmbientTraffic(editableInput, graph, request.ambientTraffic, {
      maxAchievableDecelMps2: request.evaluationFilters?.maxAchievableDecelMps2,
    });
    const ambient = repaired.removed.length === 0 ? generated : {
      ...generated,
      provenance: {
        ...generated.provenance,
        warnings: [
          ...generated.provenance.warnings,
          ...repaired.removed.map((item) => `Removed stale concrete command ${item.interactionId}: after(${item.missingInteractionId}) has no source interaction.`),
        ],
      },
    };
    const result = runSimulation(ambient.input, { graph, guards: 'throw', staticColliders: staticCollision.colliders });
    const instance = ambientInstance(request.baseInstance.manifest, ambient.input, ambient.provenance);
    const replayKey = request.baseInstance.manifest['replayKey'] as Record<string, unknown> | undefined;
    return {
      id: request.id,
      ok: true,
      kind: 'prepare',
      instance,
      trace: result.trace,
      siteId: String(replayKey?.['siteId'] ?? 'verified-base'),
      ambientTraffic: ambient.provenance,
      mapCollisions: staticCollision.diagnostics,
      openScenario: createOpenScenarioSnapshot(request.template, instance, ambient.input, result.trace, graph, xodr),
    };
  }

  const isMapBound = request.template.roles.length > 0 && request.template.roles.every((role) => role.kind === 'scene_absolute');
  if (isMapBound) {
    const product = materializeMapBound(request.template, bundle, { drawIndex: -1 });
    if (!product.manifest.feasible) {
      const errors = product.manifest.issues.filter((issue) => issue.severity === 'error');
      throw new Error(`Scenario is not feasible: ${errors.map((issue) => issue.reason).join(' · ')}`);
    }
    const controlledInput = withMapControls(product.input, mapControls);
    const ambient = applyAmbientTraffic(controlledInput, graph, request.ambientTraffic, {
      maxAchievableDecelMps2: request.evaluationFilters?.maxAchievableDecelMps2,
    });
    if (request.operation === 'robustness') return robustnessResponse(request, controlledInput, graph);
    const result = runSimulation(ambient.input, { graph, guards: 'throw', staticColliders: staticCollision.colliders });
    const instance = ambientInstance(product.manifest, ambient.input, ambient.provenance);
    return {
      id: request.id,
      ok: true,
      kind: 'prepare',
      instance,
      trace: result.trace,
      siteId: product.manifest.replayKey.siteId,
      ambientTraffic: ambient.provenance,
      mapCollisions: staticCollision.diagnostics,
      openScenario: createOpenScenarioSnapshot(request.template, instance, ambient.input, result.trace, graph, xodr),
    };
  }

  const adapted = adaptTemplate(request.template);
  if (adapted.notes.length > 0) {
    throw new Error(`Scenario uses constructs the matcher cannot preserve: ${adapted.notes.map((note) => `${note.path}: ${note.reason}`).join(' · ')}`);
  }
  const report = matchAnchorReport(adapted.anchor, index, { roles: adapted.roles });
  if (!report.sites.some((candidate) => candidate.degradation.intentPreserved)) {
    const summary = Object.entries(report.failureSummary).map(([key, value]) => `${key}: ${value}`).join(', ');
    throw new Error(`No intent-preserving site matches this scenario on ${request.map.id}${summary ? ` (${summary})` : ''}`);
  }
  const selected = selectPlayableSite(report.sites, (candidate) => {
    const candidateProduct = materialize(request.template, bundle, candidate, { drawIndex: -1 });
    const semanticLosses = materializationSemanticLosses(candidateProduct.manifest.notes);
    if (semanticLosses.length > 0) {
      throw new Error(`materialization would lose authored semantics: ${semanticLosses.map((note) => `${note.path}: ${note.reason}`).join(' · ')}`);
    }
    if (!candidateProduct.manifest.feasible) {
      const errors = candidateProduct.manifest.issues.filter((issue) => issue.severity === 'error');
      throw new Error(`scenario is not feasible: ${errors.map((issue) => issue.reason).join(' · ')}`);
    }
    return candidateProduct;
  });
  const { site, product } = selected;
  const controlledInput = withMapControls(product.input, mapControls);
  const ambient = applyAmbientTraffic(controlledInput, graph, request.ambientTraffic, {
    maxAchievableDecelMps2: request.evaluationFilters?.maxAchievableDecelMps2,
  });
  if (request.operation === 'robustness') return robustnessResponse(request, controlledInput, graph);
  const result = runSimulation(ambient.input, { graph, guards: 'throw', staticColliders: staticCollision.colliders });
  const instance = ambientInstance(product.manifest, ambient.input, ambient.provenance);
  return {
    id: request.id,
    ok: true,
    kind: 'prepare',
    instance,
    trace: result.trace,
    siteId: site.siteId,
    ambientTraffic: ambient.provenance,
    mapCollisions: staticCollision.diagnostics,
    openScenario: createOpenScenarioSnapshot(request.template, instance, ambient.input, result.trace, graph, xodr),
  };
}


function createOpenScenarioSnapshot(
  template: ScenarioTemplateV2,
  instance: unknown,
  input: SimScenarioInput,
  trace: SimTrace,
  graph: Parameters<typeof exportOpenScenarioXml14>[1]['graph'],
  xodr: string,
): OpenScenarioSnapshot {
  const manifest = (instance as { manifest: { instanceId: string } }).manifest;
  const templateHash = contentHash(template);
  const inputHash = contentHash(input);
  const filenameStem = template.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
  const mapping = sourceMapping(input);
  try {
    const result = exportOpenScenarioXml14(input, {
      graph,
      roadFile: `${input.mapId}.xodr`,
      executionMode: 'trajectory-replay',
      author: template.meta.author ?? 'UniScenarios Studio',
      description: template.meta.description || template.meta.name,
      provenance: { templateHash, inputHash, laneGraphDigest: graph.topologyDigest },
    });
    return {
      version: 1,
      source: { name: template.meta.name, templateHash, mapping },
      concrete: { input, inputHash, instanceId: manifest.instanceId, traceHash: traceDigest(trace), traceHeader: trace.header, trace },
      map: { id: input.mapId, roadFile: `${input.mapId}.xodr`, xodrDigest: graph.topologyDigest, laneGraphDigest: graph.topologyDigest },
      artifact: {
        state: 'ready',
        standard: 'ASAM OpenSCENARIO XML 1.4.0',
        profile: 'xml-1.4-trajectory-replay',
        intent: 'trajectory-replay',
        filename: `${filenameStem}.xosc`,
        mediaType: 'application/xml',
        content: result.content,
        capabilityReport: result.capabilityReport,
        warnings: result.warnings,
        issues: [],
      },
      validation: validationStages(true, result.warnings.length, input.mapId, graph.topologyDigest),
    };
  } catch (reason) {
    const issues = reason instanceof AsamExportError
      ? reason.issues
      : [{ code: 'export_failed', path: 'input', reason: reason instanceof Error ? reason.message : String(reason) }];
    return {
      version: 1,
      source: { name: template.meta.name, templateHash, mapping },
      concrete: { input, inputHash, instanceId: manifest.instanceId, traceHash: traceDigest(trace), traceHeader: trace.header, trace },
      map: { id: input.mapId, roadFile: `${input.mapId}.xodr`, xodrDigest: graph.topologyDigest, laneGraphDigest: graph.topologyDigest },
      artifact: {
        state: 'rejected',
        standard: 'ASAM OpenSCENARIO XML 1.4.0',
        profile: 'xml-1.4-trajectory-replay',
        intent: 'trajectory-replay',
        filename: `${filenameStem}.xosc`,
        mediaType: 'application/xml',
        content: null,
        capabilityReport: null,
        warnings: [],
        issues,
      },
      validation: validationStages(false, 0, input.mapId, graph.topologyDigest),
    };
  }
}

/** Preserve authored control programs verbatim and fill only missing physical
 * map controls. This keeps authored signal overrides stable while allowing
 * ambient traffic elsewhere in the city to obey the same real heads. */
function withMapControls(input: SimScenarioInput, controls: MapControlPlan): SimScenarioInput {
  const signalIds = new Set(input.signalPrograms.map((program) => program.id));
  const roadControlIds = new Set(input.roadControls.map((control) => control.id));
  return {
    ...input,
    signalPrograms: [
      ...input.signalPrograms,
      ...controls.signalPrograms.filter((program) => !signalIds.has(program.id)),
    ],
    roadControls: [
      ...input.roadControls,
      ...controls.roadControls.filter((control) => !roadControlIds.has(control.id)),
    ],
  };
}

function validationStages(exported: boolean, warnings: number, mapId: string, graphDigest: string): OpenScenarioSnapshot['validation'] {
  return [
    { id: 'internal-model', label: 'Concrete model', status: 'passed', detail: 'Materialized input and canonical trace passed strict Studio playback validation.' },
    { id: 'xml-profile', label: 'XML 1.4 export profile', status: exported ? 'passed' : 'failed', detail: exported ? `Fail-closed trajectory profile generated${warnings ? ` with ${warnings} warning(s)` : ''}.` : 'Unsupported or invalid semantics rejected the artifact.' },
    { id: 'official-xsd', label: 'Official ASAM XSD', status: exported ? 'pending' : 'not-run', detail: exported ? 'Awaiting pinned official schema validation.' : 'No XML artifact to validate.' },
    { id: 'dependencies', label: 'Dependencies', status: 'pending', detail: `Full ${mapId}.xodr must resolve to lane graph ${graphDigest}.` },
    { id: 'external-execution', label: 'External execution', status: 'not-run', detail: 'No pinned external runner result is attached to this immutable snapshot.' },
    { id: 'behavior-parity', label: 'Behavior parity', status: 'not-run', detail: 'Requires an external trace before quantitative comparison.' },
  ];
}

function sourceMapping(input: SimScenarioInput): OpenScenarioSourceMapping[] {
  const id = (prefix: string, raw: string): string => {
    let stem = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!stem || /^[0-9]/.test(stem)) stem = `id_${stem || 'unnamed'}`;
    return `${prefix}_${stem}`;
  };
  return [
    ...input.actors.flatMap((actor, index) => [
      { sourcePath: `actors.${index}`, sourceId: actor.id, exportKind: 'entity' as const, exportName: id('actor', actor.id), selector: `ScenarioObject[name="${id('actor', actor.id)}"]` },
      { sourcePath: `actors.${index}.route`, sourceId: actor.id, exportKind: 'trajectory' as const, exportName: id('trajectory', actor.id), selector: `Trajectory[name="${id('trajectory', actor.id)}"]` },
    ]),
    ...input.interactions.map((interaction, index) => ({ sourcePath: `interactions.${index}`, sourceId: interaction.id, exportKind: 'event' as const, exportName: id('interaction', interaction.id), selector: `Event[name="${id('interaction', interaction.id)}"]` })),
    ...input.signalPrograms.map((program, index) => ({ sourcePath: `signalPrograms.${index}`, sourceId: program.id, exportKind: 'signal' as const, exportName: program.id, selector: `TrafficSignalController[name="${program.id}"]` })),
  ];
}

function robustnessResponse(
  request: ScenarioWorkerRequest,
  input: SimScenarioInput,
  graph: Parameters<typeof evaluateAmbientRobustness>[1],
): ScenarioWorkerResponse {
  const filters = request.evaluationFilters ?? {};
  const report = evaluateAmbientRobustness(input, graph, undefined, {
    filters,
    now: () => performance.now(),
  });
  const baselineIntent = request.intentRubric
    ? evaluateIntentRubric(report.baselineTrace, request.intentRubric)
    : null;
  const caseIntent = request.intentRubric
    ? Object.fromEntries(report.cases.map((item) => [item.label, evaluateIntentRubric(item.trace, request.intentRubric!).verdict])) as Record<string, 'accept' | 'reject'>
    : {};
  const gate = ambientRobustnessGate(report.accepted, baselineIntent ? {
    baseline: baselineIntent.verdict,
    cases: caseIntent,
  } : null);
  return {
    id: request.id,
    ok: true,
    kind: 'robustness',
    report: {
      version: 1,
      baseInputHash: report.baseInputHash,
      baselineVerdict: report.baselineEvaluation.verdict,
      accepted: gate.accepted,
      overall: gate.overall,
      intent: {
        status: request.intentRubric ? 'evaluated' : 'not_evaluated',
        baselineVerdict: baselineIntent?.verdict ?? null,
        caseVerdicts: caseIntent,
      },
      filters,
      cases: report.cases.map((item) => ({
        label: item.label,
        accepted: item.accepted,
        deterministic: item.deterministic,
        authoredEventOrderPreserved: item.authoredEventOrderPreserved,
        authoredNeverFiredPreserved: item.authoredNeverFiredPreserved,
        ambientCollisions: item.ambientCollisions,
        runtimeMs: item.runtimeMs,
        generatedActors: item.provenance.actors.length,
        profileHash: item.provenance.profileHash,
        verdict: item.evaluation.verdict,
        failures: item.failures,
        warnings: item.provenance.warnings,
      })),
    },
  };
}

function ambientInstance(
  baseManifest: Record<string, any>,
  input: SimScenarioInput,
  provenance: AmbientTrafficProvenance,
): unknown {
  const authored = new Map((baseManifest['actors'] as Array<Record<string, unknown>>).map((actor) => [actor['id'], actor]));
  const actors = input.actors.map((actor) => authored.get(actor.id) ?? {
    id: actor.id,
    actorKind: actor.kind,
    roleKind: 'ambient',
    laneRsl: actor.initial.laneRef?.rsl ?? null,
    spawnS: actor.initial.laneRef?.s ?? 0,
    initialSpeedMps: actor.initial.speedMps,
    bindingStatus: 'generated',
  });
  return {
    kind: 'scenario-instance',
    version: 1,
    manifest: {
      ...baseManifest,
      inputHash: provenance.generatedInputHash,
      instanceId: `${String(baseManifest['instanceId'])}@ambient:${provenance.profileHash.slice(0, 12)}`,
      actors,
      ambientTraffic: provenance,
      ambientBaseInputHash: provenance.baseInputHash,
    },
    input,
    ambientTraffic: provenance,
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

async function fetchJson(url: string): Promise<any> {
  return JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
}

async function fetchText(url: string): Promise<string> {
  return new TextDecoder().decode(await fetchBytes(url));
}
