import type { CopilotGenerationRequest, CopilotGenerationResult, CopilotProgress } from './types';
import type { CopilotGenerationHistoryResponse } from './historyTypes';

export async function generateScenarioCandidates(
  request: CopilotGenerationRequest,
  options: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void } = {},
): Promise<CopilotGenerationResult> {
  const response = await fetch('/api/scenario-copilot/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Scenario Copilot request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: CopilotGenerationResult | null = null;
  for (;;) {
    const next = await reader.read();
    pending += decoder.decode(next.value, { stream: !next.done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: 'progress'; progress: CopilotProgress } | { type: 'result'; result: CopilotGenerationResult } | { type: 'error'; error: string };
      if (event.type === 'progress') options.onProgress?.(event.progress);
      else if (event.type === 'result') result = event.result;
      else throw new Error(event.error);
    }
    if (next.done) break;
  }
  if (!result) throw new Error('Scenario Copilot ended without a result.');
  return result;
}

export async function fetchCopilotHistory(signal?: AbortSignal): Promise<CopilotGenerationHistoryResponse> {
  const response = await fetch('/api/scenario-copilot/history', { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Could not load generation history (${response.status}).`);
  return response.json() as Promise<CopilotGenerationHistoryResponse>;
}

export async function clearLiveCopilotHistory(): Promise<void> {
  const response = await fetch('/api/scenario-copilot/history/live', { method: 'DELETE' });
  if (!response.ok) throw new Error(`Could not clear live history (${response.status}).`);
}

export async function updateLiveCopilotValidation(runId: string, candidateId: string, validation: { valid: boolean; message: string; actorCount: number; durationS: number }): Promise<void> {
  await fetch('/api/scenario-copilot/history/validation', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, candidateId, validation }),
  });
}
