interface OpenAIUsage { readonly input_tokens?: number; readonly output_tokens?: number; readonly total_tokens?: number }
interface OpenAIResponse { readonly output_text?: string; readonly output?: readonly { readonly content?: readonly { readonly type?: string; readonly text?: string }[] }[]; readonly usage?: OpenAIUsage }

export interface TextGeneration { readonly text: string; readonly model: string; readonly usage: { inputTokens: number; outputTokens: number; totalTokens: number } }

export class CopilotModelUnavailableError extends Error {
  constructor(readonly model: string, message: string) { super(message); }
}

export async function generateJsonText(input: {
  readonly apiKey: string;
  readonly model: string;
  readonly instructions: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
  readonly responseSchema?: { readonly name: string; readonly schema: Readonly<Record<string, unknown>> };
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}): Promise<TextGeneration> {
  const request = input.fetchImpl ?? fetch;
  const response = await request(`${(input.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/u, '')}/responses`, {
    method: 'POST',
    headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      instructions: input.responseSchema ? input.instructions : `${input.instructions}\nReturn valid lowercase json.`,
      input: input.prompt,
      max_output_tokens: 1800,
      text: { format: input.responseSchema
        ? { type: 'json_schema', name: input.responseSchema.name, strict: true, schema: input.responseSchema.schema }
        : { type: 'json_object' } },
    }),
    signal: input.signal,
  });
  const body = await response.json().catch(() => ({})) as OpenAIResponse & { error?: { message?: string; code?: string } };
  if (!response.ok) {
    const safeMessage = `${body.error?.code ?? `http_${response.status}`}: ${(body.error?.message ?? 'OpenAI request failed').slice(0, 300)}`;
    if (response.status === 400 || response.status === 404) throw new CopilotModelUnavailableError(input.model, safeMessage);
    throw new Error(safeMessage);
  }
  const text = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!text) throw new Error('OpenAI returned no structured text.');
  return {
    text,
    model: input.model,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0),
    },
  };
}

export function configuredOpenAI(): { apiKey: string | null; requestedModel: string; fallbackModel: string | null } {
  return {
    apiKey: process.env['OPENAI_API_KEY']?.trim() || null,
    requestedModel: process.env['UNISCENARIOS_COPILOT_MODEL']?.trim() || '5.6 LUNA',
    fallbackModel: process.env['UNISCENARIOS_COPILOT_FALLBACK_MODEL']?.trim() || null,
  };
}
