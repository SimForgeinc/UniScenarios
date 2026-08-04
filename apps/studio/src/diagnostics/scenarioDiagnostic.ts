import type { ValidationReport, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { canonicalJson, contentHash } from '@uniscenarios/sim-engine';
import {
  ambientSignalCycleSettingsFromExtensions,
  ambientTrafficProfileFromExtensions,
} from '../ambient/model';
import { ambientTrafficProviderFromExtensions } from '../ambient/provider';
import type { MapEntry } from '../maps';
import type { QualityPresetId } from '../performance/quality';
import type { StudioCameraControlSettings } from '../settings/model';

export const SCENARIO_DIAGNOSTIC_SCHEMA_VERSION = 1;
export const SCENARIO_DIAGNOSTIC_HEADER = 'UNISCENARIOS_SCENARIO_DIAGNOSTIC_V1';

const SENSITIVE_KEY = /(authorization|cookie|credential|password|secret|session(?:id)?|token|api[_-]?key)/i;
const ABSOLUTE_LOCAL_PATH = /^(?:file:\/\/|\/(?:Users|home|private|Volumes|var\/folders)\/|[A-Za-z]:\\)/;
const BEARER_VALUE = /^Bearer\s+[A-Za-z0-9._~+/-]+=*$/i;

export interface ScenarioDiagnosticRequest {
  readonly scenario: ScenarioTemplateV2;
  readonly revision: number;
  readonly map: MapEntry;
  readonly currentXodrSha256?: string | null;
  readonly validation: ValidationReport;
  readonly graphicsPreset: QualityPresetId;
  readonly cameraControls: StudioCameraControlSettings;
  readonly buildCommit?: string | null;
}

export interface ScenarioDiagnosticResult {
  readonly text: string;
  readonly bytes: number;
  readonly scenarioDigest: string;
  readonly diagnosticContentDigest: string;
}

function sanitize(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (ABSOLUTE_LOCAL_PATH.test(value) || BEARER_VALUE.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([childKey, child]) => [childKey, sanitize(child, childKey)]));
  }
  return value;
}

function safeCommit(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^[0-9a-f]{7,64}$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function stablePrettyJson(value: unknown): string {
  return JSON.stringify(JSON.parse(canonicalJson(value)), null, 2);
}

/**
 * Produce a compact, deterministic support artifact. It deliberately contains
 * the committed canonical document but no trace, generated candidates, binary
 * map data, browser storage, local paths, or credentials.
 */
export function createScenarioDiagnostic(request: ScenarioDiagnosticRequest): ScenarioDiagnosticResult {
  const scenarioDigest = contentHash(request.scenario);
  const extensions = request.scenario.extensions;
  const trafficProfile = ambientTrafficProfileFromExtensions(extensions);
  const trafficProvider = ambientTrafficProviderFromExtensions(extensions);
  const acceleratedSignalCycles = ambientSignalCycleSettingsFromExtensions(extensions).acceleratedSignalCycles;
  const mapDescriptor = {
    id: request.map.id,
    label: request.map.label,
    manifest: request.map.manifest,
    topology: request.map.topology,
    signals: request.map.signals,
  };
  const core = sanitize({
    app: {
      appVersion: request.scenario.meta.appVersion,
      buildCommit: safeCommit(request.buildCommit),
    },
    diagnosticOnly: true,
    durationSeconds: request.scenario.choreography.clipSeconds,
    importSupported: false,
    kind: 'uniscenarios-scenario-diagnostic',
    map: {
      id: request.map.id,
      name: request.map.label,
      locality: request.map.locality,
      contentHashes: {
        currentXodrSha256: request.currentXodrSha256 ?? undefined,
        authoredXodrSha256: request.scenario.sourceMap?.xodrSha256,
        registryDescriptorSha256: contentHash(mapDescriptor),
      },
    },
    reproduction: {
      cameraControls: request.cameraControls,
      graphicsPreset: request.graphicsPreset,
      traffic: {
        acceleratedSignalCycles,
        densityVehiclesPerKm: trafficProfile.densityVehiclesPerKm,
        engine: trafficProvider,
        profile: trafficProfile,
      },
    },
    revision: request.revision,
    redactionPolicy: 'credentials-and-local-paths',
    scenario: request.scenario,
    scenarioDigest,
    schemaVersion: SCENARIO_DIAGNOSTIC_SCHEMA_VERSION,
    validation: request.validation,
  });
  const diagnosticContentDigest = contentHash(core);
  const payload = { ...(core as Record<string, unknown>), diagnosticContentDigest };
  const text = `${SCENARIO_DIAGNOSTIC_HEADER}\n\`\`\`json\n${stablePrettyJson(payload)}\n\`\`\``;
  return {
    text,
    bytes: new TextEncoder().encode(text).byteLength,
    scenarioDigest,
    diagnosticContentDigest,
  };
}

export interface ClipboardEnvironment {
  readonly clipboard?: { writeText(text: string): Promise<void> } | null;
  readonly document?: Pick<Document, 'body' | 'createElement' | 'execCommand'> | null;
}

function browserClipboardEnvironment(): ClipboardEnvironment {
  let clipboard: ClipboardEnvironment['clipboard'] = null;
  try {
    clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard;
  } catch {
    clipboard = null;
  }
  return {
    clipboard,
    document: typeof document === 'undefined' ? null : document,
  };
}

/** Clipboard API first, then a short-lived selectable textarea fallback. */
export async function copyScenarioDiagnosticText(
  text: string,
  environment: ClipboardEnvironment = browserClipboardEnvironment(),
): Promise<'clipboard' | 'fallback'> {
  if (environment.clipboard?.writeText) {
    try {
      await environment.clipboard.writeText(text);
      return 'clipboard';
    } catch {
      // Permission-denied embedded contexts can still support execCommand.
    }
  }
  const doc = environment.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') throw new Error('Clipboard access is unavailable in this browser.');
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-10000px';
  textarea.style.top = '0';
  doc.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    if (!doc.execCommand('copy')) throw new Error('The browser refused the copy operation.');
    return 'fallback';
  } finally {
    textarea.remove();
  }
}
