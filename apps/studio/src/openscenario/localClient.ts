import type { ExternalRunSnapshot } from '@uniscenarios/esmini-runner/contracts';
import { encodeTraceGz } from '@uniscenarios/sim-engine';
import type {
  OpenScenarioLocalBundle,
  OpenScenarioLocalRunEvidence,
  OpenScenarioSnapshot,
} from './model';

const API = '/api/local-openscenario';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Local OpenSCENARIO service returned HTTP ${response.status}`);
  return body;
}

export async function buildLocalEsminiBundle(
  snapshot: OpenScenarioSnapshot,
  mode: 'deterministic-trajectory' | 'supported-actions',
): Promise<OpenScenarioLocalBundle> {
  // Transfer canonical evidence as compressed bytes instead of stringifying
  // every 50 Hz column; the local boundary verifies its immutable digest.
  const compressed = await encodeTraceGz(snapshot.concrete.trace);
  let binary = '';
  for (let offset = 0; offset < compressed.length; offset += 0x8000) {
    binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
  }
  const requestSnapshot = { ...snapshot, concrete: { ...snapshot.concrete, trace: undefined, traceGzipBase64: btoa(binary) } };
  return json(`${API}/bundles`, { method: 'POST', body: JSON.stringify({ snapshot: requestSnapshot, mode }) });
}

export function submitLocalEsminiRun(bundleId: string): Promise<ExternalRunSnapshot> {
  return json(`${API}/runs`, { method: 'POST', body: JSON.stringify({ bundleId }) });
}

export function getLocalEsminiRun(jobId: string): Promise<OpenScenarioLocalRunEvidence> {
  return json(`${API}/runs/${encodeURIComponent(jobId)}`);
}

export async function cancelLocalEsminiRun(jobId: string): Promise<void> {
  await json(`${API}/runs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

export function waitForLocalEsminiRun(
  jobId: string,
  onUpdate: (evidence: OpenScenarioLocalRunEvidence) => void,
  signal: AbortSignal,
): Promise<OpenScenarioLocalRunEvidence> {
  return new Promise((resolve, reject) => {
    const poll = async (): Promise<void> => {
      if (signal.aborted) return reject(new DOMException('External run polling cancelled', 'AbortError'));
      try {
        const evidence = await getLocalEsminiRun(jobId);
        onUpdate(evidence);
        if (['succeeded', 'failed', 'cancelled', 'timed-out', 'rejected'].includes(evidence.snapshot.status)) return resolve(evidence);
        window.setTimeout(() => void poll(), 300);
      } catch (error) { reject(error); }
    };
    void poll();
  });
}
