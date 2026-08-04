import type { DirectUsage } from './directTypes.js';

export interface DirectModelResponse {
  readonly text: string;
  readonly model: string;
  readonly requestId?: string;
  readonly usage: DirectUsage;
}

export interface DirectOpenAIClient {
  verifyModel(model: string, signal?: AbortSignal): Promise<boolean>;
  generate(args: {
    readonly model: string;
    readonly system: string;
    readonly user: string;
    readonly signal?: AbortSignal;
  }): Promise<DirectModelResponse>;
}

const DRAFT_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'description', 'actors', 'actions', 'reasoningSummary'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 2000 },
    reasoningSummary: { type: 'string', maxLength: 2000 },
    actors: {
      type: 'array', minItems: 1, maxItems: 32,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'label', 'catalogId', 'slotId', 'initialSpeedKph'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          label: { type: 'string', minLength: 1, maxLength: 200 },
          catalogId: { type: 'string', minLength: 1, maxLength: 200 },
          slotId: { type: 'string', minLength: 1, maxLength: 160 },
          initialSpeedKph: { type: 'number', minimum: 0, maximum: 160 },
        },
      },
    },
    actions: {
      type: 'array', maxItems: 128,
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'actorId', 'kind', 'startS', 'durationS', 'value', 'label'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          actorId: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
          kind: { type: 'string', enum: ['speed', 'changeLane', 'laneOffset'] },
          startS: { type: 'number', minimum: 0, maximum: 20 },
          durationS: { type: 'number', minimum: 0.1, maximum: 20 },
          value: { type: 'number' },
          label: { type: 'string', maxLength: 200 },
        },
      },
    },
  },
} as const;

interface ResponsesPayload {
  readonly id?: string;
  readonly model?: string;
  readonly output?: readonly {
    readonly type?: string;
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[];
  readonly output_text?: string;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly total_tokens?: number };
  readonly error?: { readonly message?: string };
}

function responseText(payload: ResponsesPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.length) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not contain structured output text');
}

/** Server-only client. The key is captured in a closure and never serialized. */
export function createOpenAIResponsesClient(options: {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
} = {}): DirectOpenAIClient {
  const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the Scenario Copilot server');
  const baseUrl = (options.baseUrl ?? process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
  const request = options.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

  return {
    async verifyModel(model, signal) {
      const response = await request(`${baseUrl}/models/${encodeURIComponent(model)}`, { headers, signal });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error(`OpenAI model-access probe failed (${response.status})`);
      return true;
    },
    async generate({ model, system, user, signal }) {
      const response = await request(`${baseUrl}/responses`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({
          model,
          input: [
            { role: 'system', content: [{ type: 'input_text', text: system }] },
            { role: 'user', content: [{ type: 'input_text', text: user }] },
          ],
          text: { format: { type: 'json_schema', name: 'uniscenarios_native_draft', strict: true, schema: DRAFT_JSON_SCHEMA } },
          max_output_tokens: 8_000,
        }),
      });
      const payload = await response.json() as ResponsesPayload;
      if (!response.ok) throw new Error(`OpenAI generation failed (${response.status}): ${payload.error?.message ?? 'unknown error'}`);
      return {
        text: responseText(payload),
        model: payload.model ?? model,
        ...(payload.id ? { requestId: payload.id } : {}),
        usage: {
          inputTokens: payload.usage?.input_tokens,
          outputTokens: payload.usage?.output_tokens,
          totalTokens: payload.usage?.total_tokens,
        },
      };
    },
  };
}

export async function resolveDirectModel(client: DirectOpenAIClient, requestedModel: string, signal?: AbortSignal): Promise<{
  readonly requestedModel: string;
  readonly actualModel: string;
  readonly substituted: boolean;
  readonly warning?: string;
}> {
  if (await client.verifyModel(requestedModel, signal)) return { requestedModel, actualModel: requestedModel, substituted: false };
  const fallback = process.env['OPENAI_SCENARIO_FALLBACK_MODEL']?.trim();
  if (!fallback) {
    throw new Error(`Requested OpenAI model "${requestedModel}" is not available. Configure OPENAI_SCENARIO_FALLBACK_MODEL explicitly to authorize a visible evaluation-only substitution.`);
  }
  if (!(await client.verifyModel(fallback, signal))) throw new Error(`Configured fallback OpenAI model "${fallback}" is not available`);
  return {
    requestedModel, actualModel: fallback, substituted: true,
    warning: `Requested model "${requestedModel}" was unavailable; evaluation used explicitly configured fallback "${fallback}".`,
  };
}
