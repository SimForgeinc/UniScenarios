import type { AsamCapabilityReport, AsamExportIssue, AsamExportWarning } from '@uniscenarios/cli/asam/types';
import type { SimScenarioInput, SimTrace } from '@uniscenarios/sim-engine';
import type { ExternalRunResult } from '@uniscenarios/esmini-runner/contracts';
import type { TraceComparisonReport } from '@uniscenarios/trace-comparator';

export type OpenScenarioValidationStatus = 'passed' | 'failed' | 'pending' | 'not-run' | 'unavailable';

export interface OpenScenarioValidationStage {
  readonly id: 'internal-model' | 'xml-profile' | 'official-xsd' | 'dependencies' | 'external-execution' | 'behavior-parity';
  readonly label: string;
  readonly status: OpenScenarioValidationStatus;
  readonly detail: string;
}

export interface OpenScenarioSourceMapping {
  readonly sourcePath: string;
  readonly sourceId: string;
  readonly exportKind: 'entity' | 'event' | 'trajectory' | 'signal' | 'property';
  readonly exportName: string;
  readonly selector: string;
}

export interface OpenScenarioSnapshot {
  readonly version: 1;
  readonly source: {
    readonly name: string;
    readonly templateHash: string;
    readonly mapping: readonly OpenScenarioSourceMapping[];
  };
  readonly concrete: {
    /** The exact materialized input used for canonical playback and export. */
    readonly input: SimScenarioInput;
    readonly inputHash: string;
    readonly instanceId: string;
    readonly traceHash: string;
    readonly traceHeader: SimTrace['header'];
    /** Exact canonical evidence retained for local external comparison. */
    readonly trace: SimTrace;
  };
  readonly map: {
    readonly id: string;
    readonly roadFile: string;
    readonly xodrDigest: string;
    readonly laneGraphDigest: string;
  };
  readonly artifact: {
    readonly state: 'ready' | 'rejected';
    readonly standard: 'ASAM OpenSCENARIO XML 1.4.0';
    readonly profile: 'xml-1.4-trajectory-replay';
    readonly intent: 'trajectory-replay';
    readonly filename: string;
    readonly mediaType: 'application/xml';
    readonly content: string | null;
    readonly capabilityReport: AsamCapabilityReport | null;
    readonly warnings: readonly AsamExportWarning[];
    readonly issues: readonly AsamExportIssue[];
  };
  readonly validation: readonly OpenScenarioValidationStage[];
  /** Populated only by the external runner API; never synthesized in Studio. */
  readonly external?: {
    readonly run: ExternalRunResult;
    readonly comparison?: TraceComparisonReport;
  };
}

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
  readonly manifest: import('@uniscenarios/cli').EsminiBundleManifest;
  readonly capability: import('@uniscenarios/cli').EsminiCompatibilityReport;
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
