import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CopilotGenerationRequest, CopilotGenerationResult, CopilotProgress, CopilotProviderId } from '../../src/copilot/types.js';
import { configuredOpenAI } from './openaiClient.js';
import { CopilotMapContextSchema } from './directTypes.js';
import { generateStagedScenario } from './stagedProvider.js';
import { CopilotHistoryStore } from './historyStore.js';

export type CopilotServerProvider = (
  request: CopilotGenerationRequest,
  options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void },
) => Promise<CopilotGenerationResult>;

export interface CopilotHandlerOptions {
  readonly directProvider?: CopilotServerProvider;
  readonly upstreamProvider?: CopilotServerProvider;
  readonly simulationAgentProvider?: CopilotServerProvider;
  readonly simulationAgentVisionProvider?: CopilotServerProvider;
  readonly verifiedTemplateSearchProvider?: CopilotServerProvider;
}

export function createScenarioCopilotHandler(options: CopilotHandlerOptions = {}) {
  const history = new CopilotHistoryStore();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const rawPath = (req.url ?? '/').split('?')[0];
    const path = rawPath.startsWith('/api/scenario-copilot')
      ? rawPath.slice('/api/scenario-copilot'.length) || '/'
      : rawPath;
    if (req.method === 'GET' && (path === '/' || path === '/capabilities')) {
      const config = configuredOpenAI();
      json(res, 200, {
        credentialConfigured: config.apiKey !== null,
        requestedModel: config.requestedModel,
        fallbackConfigured: config.fallbackModel !== null,
        providers: [
          'staged-rag',
          ...(options.directProvider ? ['direct-llm'] : []),
          ...(options.upstreamProvider ? ['upstream-chat2scenic'] : []),
          ...(options.simulationAgentProvider ? ['simulation-agent'] : []),
          ...(options.simulationAgentVisionProvider ? ['simulation-agent-vision'] : []),
          ...(options.verifiedTemplateSearchProvider ? ['verified-template-search'] : []),
        ],
        executionBoundary: 'server-only',
      });
      return;
    }
    if (req.method === 'GET' && path === '/history') {
      json(res, 200, history.list());
      return;
    }
    if (req.method === 'DELETE' && path === '/history/live') {
      history.clearLive();
      json(res, 200, { cleared: true });
      return;
    }
    if (req.method === 'POST' && path === '/history/validation') {
      try {
        const body = await readBody(req) as { runId?: unknown; candidateId?: unknown; validation?: unknown };
        const validation = parseValidation(body.validation);
        if (typeof body.runId !== 'string' || typeof body.candidateId !== 'string') throw new Error('A run and candidate are required.');
        json(res, history.updateValidation(body.runId, body.candidateId, validation) ? 200 : 404, { updated: true });
      } catch (error) { json(res, 400, { error: safeError(error) }); }
      return;
    }
    if (req.method !== 'POST' || (path !== '/' && path !== '/generate')) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    const abort = new AbortController();
    // IncomingMessage `close` also fires after a normally-completed request
    // body on recent Node versions. Aborting there makes any provider slower
    // than the body upload fail immediately. Only an actually aborted request
    // or a response socket closed before completion cancels generation.
    req.once('aborted', () => abort.abort());
    res.once('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const request = parseRequest(await readBody(req));
      const provider = providerFor(request.providerId, options);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      const write = (value: unknown): void => { if (!res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
      const result = await provider(request, { signal: abort.signal, onProgress: (progress) => write({ type: 'progress', progress }) });
      history.record(request, result);
      write({ type: 'result', result });
      res.end();
    } catch (error) {
      const message = safeError(error);
      if (!res.headersSent) json(res, 400, { error: message });
      else {
        res.write(`${JSON.stringify({ type: 'error', error: message })}\n`);
        res.end();
      }
    }
  };
}

function parseValidation(value: unknown): { valid: boolean; message: string; actorCount: number; durationS: number } {
  if (!value || typeof value !== 'object') throw new Error('Validation result is required.');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.valid !== 'boolean' || typeof candidate.message !== 'string') throw new Error('Invalid validation result.');
  return {
    valid: candidate.valid, message: candidate.message.slice(0, 500),
    actorCount: typeof candidate.actorCount === 'number' ? candidate.actorCount : 0,
    durationS: typeof candidate.durationS === 'number' ? candidate.durationS : 0,
  };
}

function providerFor(id: CopilotProviderId, options: CopilotHandlerOptions): CopilotServerProvider {
  if (id === 'staged-rag') return generateStagedScenario;
  if (id === 'direct-llm' && options.directProvider) return options.directProvider;
  if (id === 'upstream-chat2scenic' && options.upstreamProvider) return options.upstreamProvider;
  if (id === 'simulation-agent' && options.simulationAgentProvider) return options.simulationAgentProvider;
  if (id === 'simulation-agent-vision' && options.simulationAgentVisionProvider) return options.simulationAgentVisionProvider;
  if (id === 'verified-template-search' && options.verifiedTemplateSearchProvider) return options.verifiedTemplateSearchProvider;
  throw new Error(`Scenario Copilot provider "${id}" is not installed in this build.`);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > 512 * 1024) throw new Error('Scenario Copilot request exceeds 512 KiB.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseRequest(value: unknown): CopilotGenerationRequest {
  if (!value || typeof value !== 'object') throw new Error('Scenario Copilot request must be an object.');
  const input = value as Partial<CopilotGenerationRequest>;
  if (input.providerId !== 'staged-rag' && input.providerId !== 'direct-llm' && input.providerId !== 'upstream-chat2scenic' && input.providerId !== 'simulation-agent' && input.providerId !== 'simulation-agent-vision' && input.providerId !== 'verified-template-search') throw new Error('Unknown Scenario Copilot provider.');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 8 || input.prompt.length > 4_000) throw new Error('Describe the scenario in 8–4,000 characters.');
  if (!input.mapContext) throw new Error('A current-map context is required.');
  const mapContext = CopilotMapContextSchema.parse(input.mapContext);
  return { ...input, mapContext } as CopilotGenerationRequest;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}
