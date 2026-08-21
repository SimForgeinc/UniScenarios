import type { OpenScenarioSnapshot } from '@uniscenarios/openscenario';
import type { TraceComparisonReport } from '@uniscenarios/trace-comparator';

export type {
  OpenScenarioSnapshot,
  OpenScenarioSourceMapping,
  OpenScenarioValidationStage,
  OpenScenarioValidationStatus,
} from '@uniscenarios/openscenario';

export type OpenScenarioExportProfile = 'native-1.4' | 'esmini-1.3-trajectory' | 'esmini-1.3-actions';

export interface OpenScenarioLocalArtifact {
  readonly artifactId: string;
  readonly name: string;
  readonly kind: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly authoritative: boolean;
  readonly downloadUrl: string;
}

export interface OpenScenarioLocalBundle {
  readonly bundleId: string;
  readonly profile: Exclude<OpenScenarioExportProfile, 'native-1.4'>;
  readonly standard: 'ASAM OpenSCENARIO XML 1.3.1 · esmini compatibility';
  readonly behaviorParityScope: 'semantic-actions' | 'motion-only';
  readonly filename: string;
  readonly xml: string;
  readonly manifest: import('@uniscenarios/openscenario/node').EsminiBundleManifest;
  readonly capability: import('@uniscenarios/openscenario/export').EsminiCompatibilityReport;
  readonly xsd: { readonly valid: true; readonly digest: string };
  readonly downloadUrl: string;
}

export interface OpenScenarioLocalRunEvidence {
  readonly snapshot: import('@uniscenarios/esmini-runner/contracts').ExternalRunSnapshot;
  readonly comparison?: TraceComparisonReport;
  readonly comparisonUi?: import('@uniscenarios/trace-comparator').ComparisonUiModel;
  readonly dualTrace?: import('@uniscenarios/trace-comparator').DualTracePlaybackData;
  readonly artifacts: readonly OpenScenarioLocalArtifact[];
  readonly sampleCount?: number;
  readonly unsupportedSemantics: readonly string[];
}

export type OpenScenarioWorkspaceState =
  | { readonly status: 'empty'; readonly reason: string }
  | { readonly status: 'loading'; readonly sourceHash: string }
  | { readonly status: 'error'; readonly sourceHash: string; readonly message: string }
  | { readonly status: 'ready'; readonly sourceHash: string; readonly snapshot: OpenScenarioSnapshot };

export function downloadSnapshotFile(snapshot: OpenScenarioSnapshot, kind: 'xml' | 'capability' | 'manifest' | 'input'): void {
  let name: string;
  let type: string;
  let content: string;
  if (kind === 'xml') {
    if (!snapshot.artifact.content) return;
    name = snapshot.artifact.filename;
    type = snapshot.artifact.mediaType;
    content = snapshot.artifact.content;
  } else if (kind === 'capability') {
    name = snapshot.artifact.filename.replace(/\.xosc$/, '.capabilities.json');
    type = 'application/json';
    content = JSON.stringify(snapshot.artifact.capabilityReport, null, 2);
  } else if (kind === 'input') {
    name = snapshot.artifact.filename.replace(/\.xosc$/, '.input.json');
    type = 'application/json';
    content = JSON.stringify(snapshot.concrete.input, null, 2);
  } else {
    name = snapshot.artifact.filename.replace(/\.xosc$/, '.export-manifest.json');
    type = 'application/json';
    content = JSON.stringify({ version: snapshot.version, source: snapshot.source, concrete: snapshot.concrete, map: snapshot.map, artifact: { ...snapshot.artifact, content: undefined }, validation: snapshot.validation }, null, 2);
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
