import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { clearLiveCopilotHistory, fetchCopilotHistory } from './client';
import type { CopilotGenerationHistoryEntry, CopilotGenerationHistoryResponse } from './historyTypes';
import type { CopilotCandidate, CopilotProviderId } from './types';

interface Props {
  readonly onRerun: (entry: CopilotGenerationHistoryEntry) => void;
  readonly onApply: (candidate: CopilotCandidate) => void;
}

const BASE_PROVIDERS: readonly CopilotProviderId[] = ['staged-rag', 'direct-llm', 'upstream-chat2scenic'];
function providerName(id: string): string {
  if (id === 'staged-rag') return 'Structured + retrieval';
  if (id === 'direct-llm') return 'Direct LLM';
  if (id === 'upstream-chat2scenic') return 'Upstream Chat2Scenic';
  return id.split('-').map((word) => word ? `${word[0]!.toUpperCase()}${word.slice(1)}` : '').join(' ');
}

export function CopilotComparisonView({ onRerun, onApply }: Props): JSX.Element {
  const [history, setHistory] = useState<CopilotGenerationHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('all');
  const [status, setStatus] = useState<'all' | 'matches' | 'mismatch' | 'failed'>('all');
  const load = (): void => { void fetchCopilotHistory().then(setHistory).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); };
  useEffect(load, []);

  const entries = history?.entries ?? [];
  const benchmark = entries.filter((entry) => entry.source === 'benchmark');
  const live = entries.filter((entry) => entry.source === 'live');
  const providers = [...new Set([...BASE_PROVIDERS, ...entries.map((entry) => entry.provider)])];
  const visible = entries.filter((entry) => (provider === 'all' || entry.provider === provider) && matchesStatus(entry, status));
  const groups = useMemo(() => groupEntries(visible), [visible]);
  const metrics = providers.map((id) => {
    const rows = benchmark.filter((entry) => entry.provider === id);
    return { id, runs: rows.length, simulations: rows.filter((entry) => entry.simulationPass).length, matches: rows.filter((entry) => entry.semanticPass).length, median: median(rows.map((entry) => entry.latencyMs).filter((value): value is number => value !== null)) };
  });

  return <div style={styles.root} data-testid="copilot-comparison-view">
    <section style={styles.explainer}>
      <strong>Generation comparison</strong>
      <span>“Runs successfully” means the draft completed simulation. “Matches request” means its executable behavior passed every semantic check. These are different.</span>
    </section>
    <div style={styles.metrics} aria-label="Benchmark summary">
      {metrics.map((metric) => <article key={metric.id} style={styles.metric}>
        <strong>{providerName(metric.id)}</strong><span>{metric.matches}/{metric.runs} match request</span><span>{metric.simulations}/{metric.runs} run successfully</span><small>{formatDuration(metric.median)} median generation</small>
      </article>)}
    </div>
    {benchmark.some((entry) => entry.caseId === 'unsupported-impossible' && entry.semanticPass === false && entry.simulationPass) ? <div style={styles.danger} data-testid="impossible-case-warning">
      <strong>Known false acceptance</strong><span>All methods produced a runnable draft for the impossible flying/teleport request. Runnable does not mean faithful or physically supported.</span>
    </div> : null}
    <div style={styles.filters}>
      <label>Method<select aria-label="Filter generation method" value={provider} onChange={(event) => setProvider(event.currentTarget.value)}><option value="all">All methods</option>{providers.map((id) => <option key={id} value={id}>{providerName(id)}</option>)}</select></label>
      <label>Status<select aria-label="Filter generation status" value={status} onChange={(event) => setStatus(event.currentTarget.value as typeof status)}><option value="all">All statuses</option><option value="matches">Matches request</option><option value="mismatch">Runs, but mismatches</option><option value="failed">Could not run</option></select></label>
      <span style={styles.count}>{visible.length} of {entries.length} generations</span>
      {live.length ? <button type="button" style={styles.clear} onClick={() => { void clearLiveCopilotHistory().then(load).catch((reason: unknown) => setError(String(reason))); }}>Clear {live.length} live runs</button> : null}
    </div>
    {error ? <div role="alert" style={styles.danger}>{error}</div> : null}
    {!history ? <div role="status" style={styles.loading}>Loading all generations…</div> : null}
    <div style={styles.groups}>
      {groups.map(([group, rows]) => <section key={group} style={styles.group} data-testid="copilot-generation-group">
        <header style={styles.groupHeader}><div><strong>{rows[0]?.caseTitle ?? 'Live generation'}</strong><p>{rows[0]?.prompt}</p></div><span>{rows[0]?.source === 'benchmark' ? 'Benchmark evidence' : 'Live session'}</span></header>
        <div style={styles.grid}>{providers.map((id) => {
          const methodRows = rows.filter((entry) => entry.provider === id);
          if (!methodRows.length) return provider === 'all' && rows[0]?.source === 'benchmark' ? <div key={id} style={styles.empty}><strong>{providerName(id)}</strong><span>Not recorded</span></div> : null;
          return methodRows.map((entry) => <GenerationCard key={entry.id} entry={entry} onRerun={onRerun} onApply={onApply} />);
        })}</div>
      </section>)}
    </div>
    {history ? <footer style={styles.footer}>Benchmark evidence is read-only and cannot be cleared. Historical drafts were intentionally not stored, so they cannot be opened directly. Re-run creates a new nondeterministic generation on the current map.</footer> : null}
  </div>;
}

function GenerationCard({ entry, onRerun, onApply }: { entry: CopilotGenerationHistoryEntry; onRerun: Props['onRerun']; onApply: Props['onApply'] }): JSX.Element {
  const requested = entry.semanticPass === true;
  const runnable = entry.simulationPass === true;
  return <article style={{ ...styles.card, ...(requested ? styles.cardMatch : runnable ? styles.cardMismatch : styles.cardFailed) }} data-testid="copilot-generation-card">
    <header style={styles.cardHeader}><strong>{providerName(entry.provider)}</strong><span style={requested ? styles.badgeMatch : runnable ? styles.badgeMismatch : styles.badgeFailed}>{requested ? 'Matches request' : runnable ? 'Runnable · mismatch' : entry.simulationPass === false ? 'Could not run' : 'Not verified'}</span></header>
    <div style={styles.meta}>{entry.actualModel ?? 'model not recorded'} · {entry.mapId} · seed {entry.seed ?? 'not recorded'}</div>
    <div style={styles.checks}><Result label="Materialized" value={entry.materializationPass} /><Result label="Full 20s simulation" value={entry.simulationPass && entry.simulationDurationS === 20} /><Result label="Semantic checks" value={entry.semanticPass} /></div>
    <div style={styles.summary}><span>{entry.actorCount ?? 'not recorded'} actors</span><span>{entry.actionCount ?? 'not recorded'} actions</span><span>{entry.triggerSummary?.length ? entry.triggerSummary.join(', ') : 'triggers not recorded'}</span></div>
    {entry.provider === 'upstream-chat2scenic' ? <div style={styles.scenic}><Result label="Scenic compiled" value={entry.scenicCompilePass} /><Result label="Scenic sampled" value={entry.scenicSamplePass} /></div> : null}
    {entry.semanticAssertions?.length ? <div style={styles.assertions}>{entry.semanticAssertions.map((assertion) => <span key={assertion.id} style={assertion.pass ? styles.assertPass : styles.assertFail}>{assertion.pass ? '✓' : '✕'} {assertion.id}: {assertion.evidence}</span>)}</div> : <small>Semantic assertion details not recorded.</small>}
    {entry.diagnostic ? <div style={styles.diagnostic}><strong>{entry.failureCategory ?? 'Diagnostic'}</strong><span>{entry.diagnostic}</span></div> : null}
    <div style={styles.performance}><span>{formatDuration(entry.latencyMs)}</span><span>{entry.totalTokens?.toLocaleString() ?? 'not recorded'} tokens</span><span>{entry.apiCalls ?? 'not recorded'} calls</span><span>{entry.repairCount ?? 'not recorded'} repairs</span></div>
    {entry.intent ? <IntentSummary entry={entry} /> : <div style={styles.notRecorded}>Generated intent and actor details were not stored in this historical benchmark artifact.</div>}
    {entry.iterationTrace?.length ? <details style={styles.details}><summary>Iteration trace ({entry.iterationTrace.length})</summary><div style={styles.trace}>{entry.iterationTrace.map((iteration) => <article key={iteration.iteration} style={styles.traceStep}>{iteration.thumbnailDataUrl ? <img src={iteration.thumbnailDataUrl} alt={`Map preview after generation iteration ${iteration.iteration}`} style={styles.thumbnail} /> : null}<strong>Iteration {iteration.iteration}</strong><span>{iteration.summary}</span>{iteration.toolCalls.map((call, index) => <small key={`${call.name}-${index}`}>{call.status === 'success' ? '✓' : call.status === 'failure' ? '✕' : '—'} {call.name}: {call.summary}</small>)}</article>)}</div></details> : null}
    <details style={styles.details}><summary>Technical details & provenance</summary><dl><dt>Prompt</dt><dd>{entry.prompt}</dd><dt>Outcome</dt><dd>{entry.outcome ?? 'not recorded'}</dd><dt>Provenance</dt><dd><pre>{JSON.stringify(entry.provenance ?? 'not recorded', null, 2)}</pre></dd><dt>Generated Scenic</dt><dd><pre>{entry.generatedScenic ?? 'not recorded'}</pre></dd><dt>Direct typed draft</dt><dd><pre>{entry.directTypedDraft ? JSON.stringify(entry.directTypedDraft, null, 2) : 'not recorded'}</pre></dd></dl></details>
    {entry.candidate && entry.simulationPass ? <button type="button" style={styles.apply} onClick={() => onApply(entry.candidate!)}>Apply stored draft</button> : <button type="button" style={styles.rerun} onClick={() => onRerun(entry)}>Re-run & preview</button>}
    {entry.source === 'benchmark' ? <small style={styles.readOnly}>Historical evidence · read-only. Re-run is a new result.</small> : null}
  </article>;
}

function IntentSummary({ entry }: { entry: CopilotGenerationHistoryEntry }): JSX.Element {
  const intent = entry.intent!;
  return <details style={styles.details}><summary>Generated content</summary><div style={styles.intent}><strong>{intent.scenario}</strong><span>Outcome: {intent.desiredOutcome}</span><span>Actors: {[intent.ego, ...intent.adversaries, ...intent.contextActors].map((actor) => `${actor.catalogId} (${actor.role}: ${actor.behavior})`).join(' · ')}</span><span>Relations: {intent.spatialRelations.join(', ') || 'none recorded'}</span><span>Restrictions: {intent.restrictions.join(', ') || 'none recorded'}</span></div></details>;
}

function Result({ label, value }: { label: string; value: boolean | null }): JSX.Element { return <span style={value === true ? styles.pass : value === false ? styles.fail : styles.unknown}>{value === true ? '✓' : value === false ? '✕' : '—'} {label}</span>; }
function matchesStatus(entry: CopilotGenerationHistoryEntry, status: 'all' | 'matches' | 'mismatch' | 'failed'): boolean { return status === 'all' || (status === 'matches' ? entry.semanticPass === true : status === 'mismatch' ? entry.simulationPass === true && entry.semanticPass !== true : entry.simulationPass === false); }
function groupEntries(entries: readonly CopilotGenerationHistoryEntry[]): Array<[string, CopilotGenerationHistoryEntry[]]> { const map = new Map<string, CopilotGenerationHistoryEntry[]>(); for (const entry of entries) { const key = entry.caseId ? `benchmark:${entry.caseId}` : `live:${entry.id}`; map.set(key, [...(map.get(key) ?? []), entry]); } return [...map.entries()]; }
function median(values: readonly number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? null; }
function formatDuration(ms: number | null): string { return ms === null ? 'not recorded' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`; }

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12 }, explainer: { display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 9, background: '#162832', color: '#bcecff', fontSize: 12 }, metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(155px,1fr))', gap: 8 }, metric: { display: 'flex', flexDirection: 'column', gap: 3, padding: 10, borderRadius: 8, background: '#20252c', border: '1px solid #3b444f', fontSize: 11 }, danger: { display: 'flex', flexDirection: 'column', gap: 3, padding: 11, border: '1px solid #a34c54', borderRadius: 8, background: '#3b2025', color: '#ffc3c8', fontSize: 12 }, filters: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }, count: { marginLeft: 'auto', color: '#9ca8b6', fontSize: 11 }, clear: { border: '1px solid #68515a', borderRadius: 6, background: '#2d2328', color: '#ffc4cf', padding: '7px 9px' }, loading: { padding: 20, textAlign: 'center', color: '#9de5ff' }, groups: { display: 'grid', gap: 12 }, group: { border: '1px solid #3b434d', borderRadius: 10, overflow: 'hidden', background: '#191d22' }, groupHeader: { display: 'flex', justifyContent: 'space-between', gap: 10, padding: 12, background: '#242a31' }, grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 1, overflowX: 'auto', background: '#353d46' }, card: { padding: 11, background: '#1c2026', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }, cardMatch: { borderTop: '3px solid #4fd48b' }, cardMismatch: { borderTop: '3px solid #f0b44c' }, cardFailed: { borderTop: '3px solid #e8737d' }, cardHeader: { display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'flex-start' }, badgeMatch: { color: '#73e6a4', fontSize: 9 }, badgeMismatch: { color: '#ffd077', fontSize: 9 }, badgeFailed: { color: '#ff949e', fontSize: 9 }, meta: { fontSize: 9, color: '#8894a3' }, checks: { display: 'flex', flexWrap: 'wrap', gap: 5 }, scenic: { display: 'flex', gap: 6, padding: 6, background: '#332a1d', borderRadius: 5 }, pass: { color: '#73e6a4', fontSize: 10 }, fail: { color: '#ff929d', fontSize: 10 }, unknown: { color: '#8f9aa8', fontSize: 10 }, summary: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 10, color: '#cbd3dc' }, assertions: { display: 'flex', flexDirection: 'column', gap: 3 }, assertPass: { color: '#79dba0', fontSize: 10 }, assertFail: { color: '#ffab82', fontSize: 10 }, diagnostic: { display: 'flex', flexDirection: 'column', gap: 2, padding: 7, borderRadius: 5, background: '#34251f', color: '#ffc18c', fontSize: 10 }, performance: { display: 'flex', gap: 8, flexWrap: 'wrap', color: '#aab5c2', fontSize: 9 }, notRecorded: { padding: 7, borderRadius: 5, background: '#252a31', color: '#9ca6b2', fontSize: 10 }, details: { fontSize: 10, color: '#b8c4d1' }, intent: { display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6 }, trace: { display: 'grid', gap: 6, paddingTop: 6 }, traceStep: { display: 'flex', flexDirection: 'column', gap: 3, padding: 7, background: '#252b33', borderRadius: 6 }, thumbnail: { width: '100%', maxHeight: 150, objectFit: 'cover', borderRadius: 5 }, apply: { padding: 8, border: 0, borderRadius: 6, background: '#2c9358', color: 'white', fontWeight: 800 }, rerun: { padding: 8, border: '1px solid #56809d', borderRadius: 6, background: '#203543', color: '#bcecff', fontWeight: 750 }, readOnly: { color: '#87929f' }, empty: { padding: 12, background: '#1b1f24', color: '#77828f', display: 'flex', flexDirection: 'column', gap: 5 }, footer: { padding: 10, borderTop: '1px solid #343b44', color: '#8994a2', fontSize: 10, lineHeight: 1.4 },
};
