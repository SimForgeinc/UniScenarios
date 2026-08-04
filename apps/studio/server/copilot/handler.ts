import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CopilotGenerationRequest, CopilotGenerationResult, CopilotProgress, CopilotProviderId } from '../../src/copilot/types.js';
import { configuredOpenAI } from './openaiClient.js';
import { generateStagedScenario } from './stagedProvider.js';

export type CopilotServerProvider = (
  request: CopilotGenerationRequest,
  options?: { readonly signal?: AbortSignal; readonly onProgress?: (progress: CopilotProgress) => void },
) => Promise<CopilotGenerationResult>;

export interface CopilotHandlerOptions {
  readonly directProvider?: CopilotServerProvider;
}

export function createScenarioCopilotHandler(options: CopilotHandlerOptions = {}) {
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
        providers: options.directProvider ? ['staged-rag', 'direct-llm'] : ['staged-rag'],
        executionBoundary: 'server-only',
      });
      return;
    }
    if (req.method !== 'POST' || (path !== '/' && path !== '/generate')) {
      json(res, 404, { error: 'Not found' });
      return;
    }
    const abort = new AbortController();
    req.once('close', () => abort.abort());
    try {
      const request = parseRequest(await readBody(req));
      const provider = providerFor(request.providerId, options);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      const write = (value: unknown): void => { if (!res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
      const result = await provider(request, { signal: abort.signal, onProgress: (progress) => write({ type: 'progress', progress }) });
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

function providerFor(id: CopilotProviderId, options: CopilotHandlerOptions): CopilotServerProvider {
  if (id === 'staged-rag') return generateStagedScenario;
  if (id === 'direct-llm' && options.directProvider) return options.directProvider;
  throw new Error('The direct native provider is not installed in this build.');
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
  if (input.providerId !== 'staged-rag' && input.providerId !== 'direct-llm') throw new Error('Unknown Scenario Copilot provider.');
  if (typeof input.prompt !== 'string' || input.prompt.trim().length < 8 || input.prompt.length > 4_000) throw new Error('Describe the scenario in 8–4,000 characters.');
  if (!input.mapContext || typeof input.mapContext.mapId !== 'string' || !Array.isArray(input.mapContext.placementSlots)) throw new Error('A current-map context is required.');
  if (input.mapContext.placementSlots.length < 2 || input.mapContext.placementSlots.length > 64) throw new Error('Current-map placement slots must contain 2–64 entries.');
  return input as CopilotGenerationRequest;
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
