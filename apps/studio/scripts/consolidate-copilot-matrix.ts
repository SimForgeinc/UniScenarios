import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Row {
  provider: string; caseId: string; requestedModel: string; actualModel: string | null; reasoningEffort?: string;
  outcome: string; simulationPass: boolean; totalTokens: number | null; generationLatencyMs: number | null; totalLatencyMs: number;
  apiCalls: number | null; convergenceIterations?: number | null; imagesSent?: number | null; totalImageBytes?: number | null;
}
interface Artifact { startedAt?: string; completedAt?: string; requestedApiModel?: string; reasoningEffort?: string; rows?: Row[] }

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const root = path.resolve(repositoryRoot, process.argv[2] ?? 'research/evaluations/copilot-high-matrix-20260803');
const children = await readdir(root, { withFileTypes: true });
const artifacts: Array<{ id: string; data: Artifact }> = [];
for (const child of children) {
  if (!child.isDirectory()) continue;
  try {
    const data = JSON.parse(await readFile(path.join(root, child.name, 'results.json'), 'utf8')) as Artifact;
    if (Array.isArray(data.rows)) artifacts.push({ id: `${child.name}/results.json`, data });
  } catch { /* Incomplete experiment: represented by the registry, not fabricated as a result. */ }
}
const rows = artifacts.flatMap(({ id, data }) => (data.rows ?? []).map((row) => {
  // Original drafts, traces and screenshots remain in the per-run source
  // artifacts. The combined table is intentionally concise and metric-only.
  const { savedResult: _savedResult, ...summaryRow } = row as Row & { savedResult?: unknown };
  return { ...summaryRow, artifactId: id, reasoningEffort: row.reasoningEffort ?? data.reasoningEffort ?? 'default-or-unrecorded' };
}));
const summaries = [...group(rows, (row) => `${row.provider}|${row.actualModel ?? row.requestedModel}|${row.reasoningEffort}`)].map(([key, selected]) => {
  const [provider, model, effort] = key.split('|');
  const strictSuccess = selected.filter((row) => row.outcome === 'success').length;
  const correctRejections = selected.filter((row) => row.outcome === 'expected-rejection').length;
  const tokens = sum(selected.map((row) => row.totalTokens));
  const totalLatencyMs = sum(selected.map((row) => row.totalLatencyMs));
  return {
    provider, model, effort, runs: selected.length, strictSuccess, correctRejections,
    faithfulOutcomes: strictSuccess + correctRejections,
    fullSimulation: selected.filter((row) => row.simulationPass).length,
    falseAcceptances: selected.filter((row) => row.outcome === 'unexpected-generation').length,
    failures: selected.filter((row) => row.outcome === 'failure').length,
    calls: sum(selected.map((row) => row.apiCalls)), tokens,
    tokensPerStrictSuccess: strictSuccess ? Math.round(tokens / strictSuccess) : null,
    medianGenerationMs: median(selected.map((row) => row.generationLatencyMs)),
    totalLatencyPerStrictSuccessMs: strictSuccess ? Math.round(totalLatencyMs / strictSuccess) : null,
    medianIterations: median(selected.map((row) => row.convergenceIterations ?? null)),
    imagesSent: sum(selected.map((row) => row.imagesSent ?? null)), totalImageBytes: sum(selected.map((row) => row.totalImageBytes ?? null)),
  };
});
const controls = [
  'Frozen twenty-case Richmond Field Station corpus and executable semantic assertions',
  'One candidate, identical trusted map slot builder and canonical twenty-second simulator',
  'High reasoning effort, no model substitution, four-iteration maximum for iterative providers',
  'Single run per case; results are paired descriptive evidence, not confidence intervals',
];
const directModels = [...new Set(rows.filter((row) => row.provider === 'direct-llm').map((row) => row.actualModel ?? row.requestedModel))];
const lunaMethods = [...new Set(rows.filter((row) => (row.actualModel ?? row.requestedModel) === 'gpt-5.6-luna').map((row) => row.provider))];
const experiments = [
  { id: 'direct-model-high-20', title: 'Direct model capability baseline', hypothesis: 'Model choice changes semantic success under an otherwise identical one-pass native draft pipeline.', independentVariable: 'OpenAI model', controls, sampleCount: rows.filter((row) => row.provider === 'direct-llm' && row.reasoningEffort === 'high').length, status: directModels.length >= 3 ? 'complete' : 'running', models: directModels, providers: ['direct-llm'], artifacts: artifacts.filter((item) => item.id.startsWith('direct-')).map((item) => item.id) },
  { id: 'luna-architecture-high-20', title: 'Luna architecture comparison', hypothesis: 'Canonical simulator feedback and deterministic search improve faithful scenario authoring over a one-pass draft.', independentVariable: 'Generation architecture', controls, sampleCount: rows.filter((row) => (row.actualModel ?? row.requestedModel) === 'gpt-5.6-luna' && row.reasoningEffort === 'high').length, status: lunaMethods.length >= 5 ? 'complete' : 'running', models: ['gpt-5.6-luna'], providers: lunaMethods, artifacts: artifacts.filter((item) => item.id.includes('luna')).map((item) => item.id) },
  { id: 'terra-leading-method-high-20', title: 'Terra architecture interaction check', hypothesis: 'A leading architecture retains its advantage with the faster runner-up model.', independentVariable: 'Model × leading architecture interaction', controls, sampleCount: rows.filter((row) => (row.actualModel ?? row.requestedModel) === 'gpt-5.6-terra' && row.provider !== 'direct-llm').length, status: rows.some((row) => (row.actualModel ?? row.requestedModel) === 'gpt-5.6-terra' && row.provider !== 'direct-llm') ? 'complete' : 'planned', models: ['gpt-5.6-terra'], providers: [...new Set(rows.filter((row) => (row.actualModel ?? row.requestedModel) === 'gpt-5.6-terra' && row.provider !== 'direct-llm').map((row) => row.provider))], artifacts: artifacts.filter((item) => item.id.includes('terra') && !item.id.startsWith('direct-')).map((item) => item.id) },
  { id: 'corrected-terra-model-id', title: 'Correct Terra model access', hypothesis: 'The requested Terra model is accessible under its exact model identifier.', independentVariable: 'Exact model identifier spelling', controls: ['Same MichaelAgents OpenAI credential', 'Read-only model endpoint probe', 'No fallback'], sampleCount: 1, status: 'complete', models: ['gpt-5.6-terra'], providers: [], artifacts: [] },
] as const;

const combined = { schemaVersion: 2, generatedAt: new Date().toISOString(), controls, artifacts: artifacts.map((item) => item.id), summaries, rows };
await writeFile(path.join(root, 'results.json'), `${JSON.stringify(combined, null, 2)}\n`, 'utf8');
await writeFile(path.join(root, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt: combined.generatedAt, experiments }, null, 2)}\n`, 'utf8');
await writeFile(path.join(root, 'results.csv'), toCsv(rows), 'utf8');
await writeFile(path.join(root, 'evaluation.md'), report(summaries, controls, artifacts.map((item) => item.id)), 'utf8');
console.log(`Consolidated ${rows.length} controlled runs from ${artifacts.length} artifacts at ${root}`);

function group<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> { const out = new Map<string, T[]>(); for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]); return out; }
function sum(values: readonly (number | null | undefined)[]): number { return values.reduce<number>((total, value) => total + (typeof value === 'number' && Number.isFinite(value) ? value : 0), 0); }
function median(values: readonly (number | null)[]): number | null { const sorted = values.filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b); if (!sorted.length) return null; const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2); }
function toCsv(values: readonly Record<string, unknown>[]): string { const columns = [...new Set(values.flatMap((row) => Object.keys(row)))]; const quote = (value: unknown): string => `"${String(value ?? '').replaceAll('"', '""')}"`; return `${columns.map(quote).join(',')}\n${values.map((row) => columns.map((column) => quote(typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column])).join(',')).join('\n')}\n`; }
function report(values: readonly Record<string, unknown>[], fixedControls: readonly string[], artifactIds: readonly string[]): string {
  const raw = [...values].sort((a, b) => Number(b['strictSuccess']) - Number(a['strictSuccess']) || Number(a['falseAcceptances']) - Number(b['falseAcceptances']))[0];
  const safe = values.filter((item) => Number(item['falseAcceptances']) === 0).sort((a, b) => Number(b['faithfulOutcomes']) - Number(a['faithfulOutcomes']) || Number(a['tokens']) - Number(b['tokens']))[0];
  const efficient = values.filter((item) => Number(item['strictSuccess']) > 0).sort((a, b) => Number(a['tokensPerStrictSuccess']) - Number(b['tokensPerStrictSuccess']))[0];
  const lines = ['# Scenario Copilot controlled high-effort matrix', '', '## Findings', '',
    `- **Highest positive-case coverage:** ${raw?.['provider']} with ${raw?.['model']} (${raw?.['strictSuccess']}/20), but it falsely accepted ${raw?.['falseAcceptances']} negative controls.`,
    `- **Best safety-conscious result:** ${safe?.['provider']} with ${safe?.['model']} (${safe?.['strictSuccess']} positive cases + ${safe?.['correctRejections']} correct rejections; zero false accepts).`,
    `- **Lowest tokens per strict success:** ${efficient?.['provider']} with ${efficient?.['model']} (${efficient?.['tokensPerStrictSuccess']} tokens), with only ${efficient?.['strictSuccess']}/20 positive cases; this is not the capability winner.`,
    '- Direct-model comparison: Luna led raw coverage by one case; Terra was substantially faster and used fewer tokens. Terra became the overall safety-conscious winner when paired with iterative simulator feedback.',
    '', '## Controls', '', ...fixedControls.map((item) => `- ${item}`), '', '## Capability and efficiency', '', '| Method | Model | Runs | Strict success | Correct rejects | False accepts | Full sim | Calls | Tokens | Tokens / strict success | Latency / strict success | Median generation |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const value of values) lines.push(`| ${value['provider']} | ${value['model']} | ${value['runs']} | ${value['strictSuccess']} | ${value['correctRejections']} | ${value['falseAcceptances']} | ${value['fullSimulation']} | ${value['calls']} | ${value['tokens']} | ${value['tokensPerStrictSuccess'] ?? '—'} | ${value['totalLatencyPerStrictSuccessMs'] ?? '—'} ms | ${value['medianGenerationMs']} ms |`);
  lines.push('', '## Caveats', '', '- A single generation was run per case and condition; stochastic variance is not estimated.', '- Direct high-effort model baselines are comparable to one another. Older default-effort results are displayed separately and are not pooled into this matrix.', '- Image cost is unknown unless the provider reports it; encoded image bytes are recorded instead.', '- Passing structural semantic assertions does not prove visual realism or regulatory correctness.', '', '## Source artifacts', '', ...artifactIds.map((item) => `- \`${item}\``), '');
  return `${lines.join('\n')}\n`;
}
