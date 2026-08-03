import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TemplateDocument, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import type { CityViewer } from '@uniscenarios/city-renderer';
import type { EditorController } from '../editor/controller';
import { autosaveName } from '../editor/document';
import { MAPS, type MapEntry } from '../maps';
import { VariationSearchClient } from './client';
import { PortableLiftError } from './client';
import { bindAcceptedVariation } from './portableBinding';
import { StudioPortableBindingAdapter } from './studioPortableBindingAdapter';
import { VariationProjectStore } from './store';
import { useVariationOverlay } from './VariationOverlay';
import type { PortableBindingAdapter, VariationCandidateResult, VariationSearchPayload } from './model';

export interface VariationsPanelProps {
  controller: EditorController;
  viewer: CityViewer | null;
  map: MapEntry;
  authoringEnabled: boolean;
  portableBindingAdapter?: PortableBindingAdapter;
  onOpenProject(map: MapEntry): void;
  onClose(): void;
}

export function VariationsPanel({ controller, viewer, map, authoringEnabled, portableBindingAdapter, onOpenProject, onClose }: VariationsPanelProps): JSX.Element {
  const client = useRef(new VariationSearchClient());
  const defaultAdapter = useRef(new StudioPortableBindingAdapter());
  const store = useRef(new VariationProjectStore());
  const [selectedMaps, setSelectedMaps] = useState(() => new Set(MAPS.map((item) => item.id)));
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<VariationSearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liftIssues, setLiftIssues] = useState<PortableLiftError['issues']>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const selected = useMemo(() => result?.candidates.find((item) => candidateKey(item) === selectedKey) ?? null, [result, selectedKey]);
  useVariationOverlay(viewer, selected?.preview ?? null);
  useEffect(() => () => client.current.cancel(), []);

  const search = async (resume = false): Promise<void> => {
    if (!authoringEnabled) return;
    setStatus('searching'); setError(null); setLiftIssues([]); setResult(null); setSelectedKey(null);
    try {
      const maps = MAPS.filter((item) => selectedMaps.has(item.id));
      const next = await client.current.search(controller.doc.data, map, maps, portableBindingAdapter ?? defaultAdapter.current, resume ? result?.resumeToken : undefined);
      setResult(next); setStatus('done');
      const first = next.candidates.find((item) => item.acceptance.status === 'accepted') ?? next.candidates[0];
      setSelectedKey(first ? candidateKey(first) : null);
    } catch (reason) {
      if ((reason as { name?: string })?.name === 'AbortError') return;
      if (reason instanceof PortableLiftError) setLiftIssues(reason.issues);
      setError(reason instanceof Error ? reason.message : String(reason)); setStatus('error');
    }
  };

  const reject = (item: VariationCandidateResult): void => {
    store.current.recordDecision({
      key: candidateKey(item), sourcePatternId: result!.patternId, mapId: item.candidate.mapId,
      siteId: item.candidate.site.siteId, decision: 'rejected', decidedAt: new Date().toISOString(),
      resumeToken: result!.resumeToken, reason: 'Rejected by author',
    });
    refresh((value) => value + 1);
  };

  const accept = async (item: VariationCandidateResult): Promise<void> => {
    if (item.acceptance.status !== 'accepted') return;
    const targetMap = MAPS.find((candidate) => candidate.id === item.candidate.mapId);
    if (!targetMap) throw new Error(`Map ${item.candidate.mapId} is not installed`);
    const template = bindAcceptedVariation(controller.doc.data, item, targetMap.label);
    // Parse before persistence. A malformed adapter result must never overwrite
    // the destination autosave.
    const checked = TemplateDocument.fromJSON(template);
    const projectName = `variation-${result!.patternId}-${item.candidate.site.siteId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120);
    const files = new WebTemplateFileStore();
    await files.write(projectName, checked);
    await files.write(autosaveName(targetMap.id), checked);
    const decision = {
      key: candidateKey(item), sourcePatternId: result!.patternId, mapId: targetMap.id,
      siteId: item.candidate.site.siteId, decision: 'accepted' as const, decidedAt: new Date().toISOString(),
      resumeToken: result!.resumeToken, projectName,
    };
    store.current.recordDecision(decision);
    store.current.saveProject({
      key: decision.key, name: projectName, mapId: targetMap.id, siteId: decision.siteId,
      sourcePatternId: decision.sourcePatternId, createdAt: decision.decidedAt, template,
      instance: item.instance, acceptance: item.acceptance,
    });
    await controller.doc.flush();
    onOpenProject(targetMap);
  };

  return (
    <aside style={styles.panel} aria-label="Scenario variations" data-testid="variations-panel">
      <header style={styles.header}>
        <div><div style={styles.eyebrow}>Portable scenario</div><strong>Find variations</strong></div>
        <button type="button" style={styles.close} aria-label="Close variations" onClick={onClose}>×</button>
      </header>
      <section style={styles.section}>
        <div style={styles.copy}>Find structurally equivalent locations, then materialize and simulate every candidate before it can be accepted.</div>
        <div style={styles.maps}>
          {MAPS.map((item) => <label key={item.id} style={styles.mapChoice}>
            <input type="checkbox" checked={selectedMaps.has(item.id)} onChange={() => setSelectedMaps((current) => {
              const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
            })} /> {item.label}
          </label>)}
        </div>
        <button type="button" data-testid="variation-search" style={styles.primary} disabled={!authoringEnabled || selectedMaps.size === 0 || status === 'searching'} onClick={() => void search()}>
          {status === 'searching' ? 'Matching and simulating…' : 'Find variations'}
        </button>
        {!authoringEnabled ? <div style={styles.blocker}>Stop playback before searching or accepting variations.</div> : null}
        {error ? <div style={styles.error}>{error}</div> : null}
        {liftIssues.length ? <div style={styles.liftIssues} data-testid="portable-lift-diagnostics">
          <strong>Portable lift blocked</strong>
          {liftIssues.map((issue, index) => <div key={`${issue.code}-${issue.path}-${index}`} style={issue.severity === 'error' ? styles.issueError : styles.issueWarning}>
            <code>{issue.path}</code> · {issue.code}: {issue.message}
            {issue.dependency ? <div style={styles.dependency}>Required: {issue.dependency}</div> : null}
          </div>)}
        </div> : null}
      </section>

      {result ? <section style={styles.section}>
        <div style={styles.summary} data-testid="variation-result-summary">
          {result.candidates.length === 0
            ? 'No transferable locations found. No fallback was used.'
            : `${result.candidates.length} deterministic candidate${result.candidates.length === 1 ? '' : 's'} · ${result.candidates.filter((item) => item.acceptance.status === 'accepted').length} passed every gate`}
        </div>
        <div style={styles.token}>resume {result.resumeToken.slice(0, 12)}</div>
        {result.candidates.length === 0 ? <ZeroMatches result={result} /> : null}
        {result.candidates.map((item) => {
          const key = candidateKey(item);
          const decision = store.current.decision(key);
          const active = key === selectedKey;
          const issues = item.acceptance.issues.filter((issue) => issue.severity !== 'info');
          return <article key={key} data-testid={`variation-candidate-${item.candidate.rank}`} style={{ ...styles.card, ...(active ? styles.cardActive : {}) }} onClick={() => setSelectedKey(key)}>
            <div style={styles.cardTop}><strong>#{item.candidate.rank} {mapLabel(item.candidate.mapId)}</strong><Status status={item.acceptance.status} /></div>
            <div style={styles.site}>{item.candidate.site.siteId}</div>
            <div style={styles.score}>{Math.round(item.candidate.equivalence.score * 100)}% structural · {item.candidate.site.frame.mirrored ? 'mirrored' : 'direct'} · {item.candidate.site.alternateFrames + 1} permutation(s)</div>
            <div style={styles.explain}>{item.candidate.equivalence.summary}</div>
            {item.error ? <div style={styles.error}>{item.error}</div> : null}
            {issues.slice(0, 4).map((issue, index) => <div key={`${issue.code}-${index}`} style={issue.severity === 'error' ? styles.issueError : styles.issueWarning}>
              <strong>{issue.code}</strong>{issue.path ? ` · ${issue.path}` : ''}: {issue.message}
            </div>)}
            {item.preview ? <div style={styles.preview}>Overlay: {item.preview.actors.length} actor routes · {item.preview.conflicts.length} conflict points · {item.preview.permutationKey}</div> : null}
            {decision ? <div style={styles.decision}>Previously {decision.decision} {new Date(decision.decidedAt).toLocaleString()}</div> : null}
            <div style={styles.actions}>
              <button type="button" data-testid={`variation-reject-${item.candidate.rank}`} style={styles.reject} onClick={(event) => { event.stopPropagation(); reject(item); }}>Reject</button>
              <button type="button" data-testid={`variation-accept-${item.candidate.rank}`} style={styles.accept} disabled={item.acceptance.status !== 'accepted' || !authoringEnabled} title={item.acceptance.status !== 'accepted' ? 'Materialization, simulation, behavior equivalence, or required checks did not pass' : 'Save and open this variation'} onClick={(event) => { event.stopPropagation(); void accept(item).catch((reason) => setError(String(reason))); }}>Accept &amp; open</button>
            </div>
          </article>;
        })}
      </section> : null}
    </aside>
  );
}

function ZeroMatches({ result }: { result: VariationSearchPayload }): JSX.Element {
  return <div style={styles.zero} data-testid="variation-zero-matches">{Object.entries(result.reports).map(([mapId, report]) => <div key={mapId}>
    <strong>{mapLabel(mapId)}</strong>: {report.failureSummary || `${report.matches} matches; ${report.rejected} rejected`}
    {report.warnings.map((warning) => <div key={warning} style={styles.issueWarning}>{warning}</div>)}
  </div>)}</div>;
}

function Status({ status }: { status: VariationCandidateResult['acceptance']['status'] }): JSX.Element {
  const color = status === 'accepted' ? '#75e69c' : status.startsWith('pending') ? '#facc15' : '#ff8585';
  return <span style={{ ...styles.badge, color }}>{status.replaceAll('_', ' ')}</span>;
}
function candidateKey(item: VariationCandidateResult): string { return `${item.candidate.site.anchorId}:${item.candidate.mapId}:${item.candidate.site.siteId}:${item.candidate.permutationKey}`; }
function mapLabel(id: string): string { return MAPS.find((map) => map.id === id)?.label ?? id; }

const styles: Record<string, CSSProperties> = {
  panel: { width: 430, height: '100%', boxSizing: 'border-box', overflowY: 'auto', color: '#e9edf4', background: 'rgba(24,27,32,.98)', border: '1px solid #3b3f47', borderRadius: 8, boxShadow: '0 18px 48px rgba(0,0,0,.52)' },
  header: { display: 'flex', alignItems: 'center', padding: '13px 14px 11px', borderBottom: '1px solid #373b43' },
  eyebrow: { color: '#f07f2f', fontSize: 9, fontWeight: 750, letterSpacing: .9, textTransform: 'uppercase' },
  close: { marginLeft: 'auto', width: 28, height: 28, border: 0, background: 'transparent', color: '#949ca8', fontSize: 22, cursor: 'pointer' },
  section: { padding: 13, borderBottom: '1px solid #343840' }, copy: { color: '#aeb6c2', fontSize: 11, marginBottom: 10 },
  maps: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }, mapChoice: { fontSize: 10, color: '#c7ccd4' },
  primary: { width: '100%', padding: '8px 10px', border: '1px solid #d76d25', borderRadius: 6, background: '#f07f2f', color: '#16181c', fontWeight: 750, cursor: 'pointer' },
  blocker: { marginTop: 8, color: '#e9c77d', fontSize: 10 }, error: { marginTop: 7, color: '#ff9b9b', fontSize: 10, whiteSpace: 'pre-wrap' },
  liftIssues: { marginTop: 8, padding: 8, border: '1px solid #74454a', borderRadius: 5, background: '#332327', fontSize: 10 },
  dependency: { marginTop: 2, color: '#e9c77d' },
  summary: { fontWeight: 650, marginBottom: 2 }, token: { color: '#77808d', font: '9px ui-monospace, monospace', marginBottom: 9 }, zero: { display: 'grid', gap: 7, color: '#aeb6c2', fontSize: 10 },
  card: { marginBottom: 9, padding: 10, border: '1px solid #3b4049', borderRadius: 7, background: '#20242a', cursor: 'pointer' }, cardActive: { borderColor: '#4bc0ff', boxShadow: '0 0 0 1px rgba(75,192,255,.25)' },
  cardTop: { display: 'flex', gap: 8, alignItems: 'center' }, badge: { marginLeft: 'auto', fontSize: 8, fontWeight: 800, textTransform: 'uppercase' },
  site: { marginTop: 2, color: '#818a97', font: '9px ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }, score: { marginTop: 5, color: '#c5ccd6', fontSize: 10 }, explain: { marginTop: 4, color: '#9ca5b2', fontSize: 10 },
  issueError: { marginTop: 5, color: '#ff9b9b', fontSize: 9 }, issueWarning: { marginTop: 5, color: '#edc778', fontSize: 9 }, preview: { marginTop: 6, color: '#69c7ef', fontSize: 9 }, decision: { marginTop: 6, color: '#b8a7e8', fontSize: 9 },
  actions: { display: 'flex', gap: 6, marginTop: 9 }, reject: { flex: 1, padding: 6, border: '1px solid #555b65', borderRadius: 5, background: '#2a2e35', color: '#d8dde5' }, accept: { flex: 2, padding: 6, border: '1px solid #43845b', borderRadius: 5, background: '#275239', color: '#baf2cd', fontWeight: 700 },
};
