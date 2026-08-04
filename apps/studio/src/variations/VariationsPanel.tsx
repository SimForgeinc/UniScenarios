import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
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
import type { EligibilityReport, PortableBindingAdapter, VariationCandidateResult, VariationFunnelCounts, VariationSearchPayload } from './model';
import { carlaConformanceEligibility, scenarioRevision } from './contracts';
import {
  DEFAULT_VARIATION_CANDIDATE_BUDGET,
  DEFAULT_VARIATION_WORKERS,
  MAX_VARIATION_CANDIDATE_BUDGET,
  deriveDefaultVariationPlan,
  loadVariationPreferences,
  saveVariationPreferences,
} from './planning';

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
  const analysisClient = useRef(new VariationSearchClient());
  const defaultAdapter = useRef(new StudioPortableBindingAdapter());
  const store = useRef(new VariationProjectStore());
  const persistedPreferences = useRef(loadVariationPreferences());
  const manualPreferences = useRef(persistedPreferences.current !== null);
  const defaultsApplied = useRef(new Set<string>());
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [eligibility, setEligibility] = useState<EligibilityReport | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const axisCombinations = 1;
  const [drawsPerLocation, setDrawsPerLocation] = useState(() => persistedPreferences.current?.drawsPerLocation ?? 1);
  const [candidateBudget, setCandidateBudget] = useState(() => persistedPreferences.current?.candidateBudget ?? DEFAULT_VARIATION_CANDIDATE_BUDGET);
  const [workerCount, setWorkerCount] = useState(() => persistedPreferences.current?.workerCount ?? DEFAULT_VARIATION_WORKERS);
  const [funnel, setFunnel] = useState<VariationFunnelCounts>({ enumerated: 0, materialized: 0, simulated: 0, gated: 0, deduplicated: 0, ranked: 0, verified: 0, failed: 0 });
  const [progressCandidates, setProgressCandidates] = useState<VariationCandidateResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<VariationSearchPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liftIssues, setLiftIssues] = useState<PortableLiftError['issues']>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const selected = useMemo(() => result?.candidates.find((item) => candidateKey(item) === selectedKey) ?? null, [result, selectedKey]);
  useVariationOverlay(viewer, selected?.preview ?? null);
  useEffect(() => () => { client.current.cancel(); analysisClient.current.cancel(); }, []);
  const revision = controller.state.revision;
  const sampledParameters = controller.doc.data.params.declarations.some((parameter) => parameter.type !== 'derived');
  useEffect(() => {
    client.current.cancel();
    setStatus((current) => current === 'searching' ? 'idle' : current);
  }, [revision, map.id]);
  useEffect(() => {
    setAnalysisStatus('loading'); setError(null);
    const handle = setTimeout(() => {
      void analysisClient.current.analyze(controller.doc.data, map, portableBindingAdapter ?? defaultAdapter.current, { axisCombinations, drawsPerLocation, candidateBudget }).then((report) => {
        if (report.sourceRevision !== scenarioRevision(controller.doc.data)) return;
        const defaultKey = `${report.sourceRevision}:${map.id}`;
        if (!manualPreferences.current && !defaultsApplied.current.has(defaultKey)) {
          defaultsApplied.current.add(defaultKey);
          const plan = deriveDefaultVariationPlan(report.locations.compatible, sampledParameters, candidateBudget);
          if (plan.drawsPerLocation !== drawsPerLocation || plan.candidateBudget !== candidateBudget) {
            setDrawsPerLocation(plan.drawsPerLocation);
            setCandidateBudget(plan.candidateBudget);
          }
        }
        setEligibility(report); setAnalysisStatus('ready');
      }).catch((reason) => {
        if ((reason as { name?: string })?.name === 'AbortError') return;
        setAnalysisStatus('error'); setError(reason instanceof Error ? reason.message : String(reason));
      });
    }, 220);
    return () => { clearTimeout(handle); };
  }, [revision, map.id, axisCombinations, drawsPerLocation, candidateBudget, sampledParameters, portableBindingAdapter]);

  const saveControls = (next: { drawsPerLocation: number; candidateBudget: number; workerCount: number }): void => {
    manualPreferences.current = true;
    saveVariationPreferences({ axisCombinations: 1, ...next });
  };

  const search = async (resume = false): Promise<void> => {
    if (!authoringEnabled) return;
    setStatus('searching'); setError(null); setLiftIssues([]); setResult(null); setSelectedKey(null); setProgressCandidates([]);
    try {
      const next = await client.current.search(controller.doc.data, map, [map], portableBindingAdapter ?? defaultAdapter.current, {
        ...(resume && (result?.resumeToken ?? eligibility?.resumeToken) ? { resumeToken: result?.resumeToken ?? eligibility?.resumeToken } : {}), workerCount, axisCombinations, drawsPerLocation, candidateBudget,
        onProgress: (progress) => {
          if (progress.sourceRevision !== scenarioRevision(controller.doc.data)) return;
          setFunnel(progress.counts);
          if (progress.candidate) setProgressCandidates((current) => [...current.filter((item) => candidateKey(item) !== candidateKey(progress.candidate!)), progress.candidate!].sort((a, b) => a.candidate.rank - b.candidate.rank));
        },
      });
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
      key: candidateKey(item), sourcePatternId: result?.patternId ?? eligibility?.patternId ?? 'variation', mapId: item.candidate.mapId,
      siteId: item.candidate.site.siteId, decision: 'rejected', decidedAt: new Date().toISOString(),
      resumeToken: result?.resumeToken ?? eligibility?.resumeToken ?? '', reason: globalThis.prompt?.('Why reject this candidate?', 'Not suitable for this campaign') ?? 'Rejected by author',
    });
    refresh((value) => value + 1);
  };

  const shortlist = (item: VariationCandidateResult): void => {
    store.current.recordDecision({ key: candidateKey(item), sourcePatternId: result?.patternId ?? eligibility?.patternId ?? 'variation', mapId: item.candidate.mapId,
      siteId: item.candidate.site.siteId, decision: 'shortlisted', decidedAt: new Date().toISOString(), resumeToken: result?.resumeToken ?? eligibility?.resumeToken ?? '' });
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
      siteId: item.candidate.site.siteId, decision: 'promoted' as const, decidedAt: new Date().toISOString(),
      resumeToken: result!.resumeToken, projectName,
    };
    store.current.recordDecision(decision);
    store.current.saveProject({
      key: decision.key, name: projectName, mapId: targetMap.id, siteId: decision.siteId,
      sourcePatternId: decision.sourcePatternId, createdAt: decision.decidedAt, template,
      instance: item.instance, acceptance: item.acceptance, lineage: item.lineage,
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
        <div style={styles.copy}>Instantly count compatible locations on {map.label}, then verify bounded candidates in parallel.</div>
        <div style={styles.currentMap}>Current map only · no other map assets are loaded</div>
        {analysisStatus === 'loading' ? <div style={styles.preflight}>Updating structural compatibility…</div> : null}
        {eligibility ? <EligibilityOverview report={eligibility} /> : null}
        <div style={styles.axes}>
          <label>Candidate budget <input aria-label="Candidate budget" type="number" min={1} max={MAX_VARIATION_CANDIDATE_BUDGET} value={candidateBudget} onChange={(event) => { const next = clamp(event.currentTarget.value, 1, MAX_VARIATION_CANDIDATE_BUDGET); setCandidateBudget(next); saveControls({ drawsPerLocation, candidateBudget: next, workerCount }); }} /></label>
          <label>Draws / location <input aria-label="Draws per location" type="number" min={1} max={32} value={drawsPerLocation} onChange={(event) => { const next = clamp(event.currentTarget.value, 1, 32); setDrawsPerLocation(next); saveControls({ drawsPerLocation: next, candidateBudget, workerCount }); }} /></label>
          <div style={styles.axisStatus}>Axis combinations <strong>1</strong><small>Typed axes not yet expanded</small></div>
          <label>Workers <select aria-label="Verification workers" value={workerCount} onChange={(event) => { const next = Number(event.currentTarget.value); setWorkerCount(next); saveControls({ drawsPerLocation, candidateBudget, workerCount: next }); }}><option value={2}>2</option><option value={3}>3</option><option value={4}>4 max</option></select></label>
        </div>
        {!sampledParameters ? <div style={styles.drawNotice}>This scenario has no sampled typed parameters, so extra draws would be identical. The default verifies one candidate per compatible location, capped by the candidate budget.</div> : null}
        <button type="button" data-testid="variation-search" style={styles.primary} disabled={!authoringEnabled || !eligibility?.locations.compatible || status === 'searching'} onClick={() => void search()}>
          {status === 'searching' ? 'Verifying candidates…' : 'Generate & verify'}
        </button>
        {status === 'searching' ? <button type="button" style={styles.cancel} onClick={() => { client.current.cancel(); setStatus('idle'); }}>Cancel</button> : null}
        {(result?.resumeToken ?? eligibility?.resumeToken) && status !== 'searching' && funnel.enumerated > funnel.simulated + funnel.failed ? <button type="button" style={styles.resume} onClick={() => void search(true)}>Resume checkpoint</button> : null}
        {(status === 'searching' || progressCandidates.length > 0) ? <Funnel counts={funnel} /> : null}
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

      {(result || progressCandidates.length > 0) ? <section style={styles.section} aria-live="polite">
        <div style={styles.summary} data-testid="variation-result-summary">
          {!result ? `${funnel.verified} verified so far` : result.candidates.length === 0
            ? 'No transferable locations found. No fallback was used.'
            : `${result.candidates.length} deterministic candidate${result.candidates.length === 1 ? '' : 's'} · ${result.candidates.filter((item) => item.acceptance.status === 'accepted').length} passed every gate`}
        </div>
        {result ? <div style={styles.token}>resume {result.resumeToken.slice(0, 12)}</div> : null}
        {result?.candidates.length === 0 ? <ZeroMatches result={result} /> : null}
        {(result?.candidates ?? progressCandidates).map((item) => {
          const key = candidateKey(item);
          const decision = store.current.decision(key);
          const active = key === selectedKey;
          const issues = item.acceptance.issues.filter((issue) => issue.severity !== 'info');
          return <article key={key} data-testid={`variation-candidate-${item.candidate.rank}`} style={{ ...styles.card, ...(active ? styles.cardActive : {}) }} onClick={() => setSelectedKey(key)}>
            <div style={styles.cardTop}><strong>#{item.candidate.rank} {mapLabel(item.candidate.mapId)}</strong><Status status={item.acceptance.status} /></div>
            {item.stage ? <div style={styles.stage}>{item.stage}</div> : null}
            <div style={styles.site}>{item.candidate.site.siteId}</div>
            <div style={styles.score}>{Math.round(item.candidate.equivalence.score * 100)}% structural · {item.candidate.site.frame.mirrored ? 'mirrored' : 'direct'} · {item.candidate.site.alternateFrames + 1} permutation(s)</div>
            <div style={styles.explain}>{item.candidate.equivalence.summary}</div>
            {item.error ? <div style={styles.error}>{item.error}</div> : null}
            {issues.slice(0, 4).map((issue, index) => <div key={`${issue.code}-${index}`} style={issue.severity === 'error' ? styles.issueError : styles.issueWarning}>
              <strong>{issue.code}</strong>{issue.path ? ` · ${issue.path}` : ''}: {issue.message}
            </div>)}
            {item.preview ? <div style={styles.preview}>Overlay: {item.preview.actors.length} actor routes · {item.preview.conflicts.length} conflict points · {item.preview.permutationKey}</div> : null}
            {decision ? <div style={styles.decision}>Previously {decision.decision} {new Date(decision.decidedAt).toLocaleString()}</div> : null}
            {item.acceptance.status === 'accepted' ? <div style={styles.carla}>{carlaConformanceEligibility({ candidate: item, reviewState: decision?.decision, currentRevision: scenarioRevision(controller.doc.data) }).message}</div> : null}
            <div style={styles.actions}>
              <button type="button" data-testid={`variation-reject-${item.candidate.rank}`} style={styles.reject} onClick={(event) => { event.stopPropagation(); reject(item); }}>Reject</button>
              <button type="button" style={styles.shortlist} disabled={item.acceptance.status !== 'accepted'} onClick={(event) => { event.stopPropagation(); shortlist(item); }}>Shortlist</button>
              <button type="button" data-testid={`variation-accept-${item.candidate.rank}`} style={styles.accept} disabled={item.acceptance.status !== 'accepted' || !authoringEnabled} title={item.acceptance.status !== 'accepted' ? 'Materialization, simulation, behavior equivalence, or required checks did not pass' : 'Promote into an editable scenario'} onClick={(event) => { event.stopPropagation(); void accept(item).catch((reason) => setError(String(reason))); }}>Promote &amp; open</button>
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
function EligibilityOverview({ report }: { report: EligibilityReport }): JSX.Element {
  return <div style={styles.overview} data-testid="variation-eligibility">
    <div style={styles.compatible}><strong>{report.locations.compatible}</strong><span>compatible locations</span></div>
    <div style={styles.breakdown}>{report.locations.exact} exact · {report.locations.degraded} degraded · {report.locations.rejected} rejected · {report.computedInMs} ms</div>
    <div style={styles.requirements}>{report.requirements.map((requirement) => <span key={`${requirement.kind}-${requirement.label}`} title={requirement.detail} style={styles.chip}>{requirement.label}: {requirement.detail}</span>)}</div>
    <div style={styles.formula}>{report.formula}</div>
    <div style={styles.structural}>Structural candidates only — simulation verification has not run.</div>
    {report.reasons.filter((reason) => !reason.code.endsWith('_MATCH')).slice(0, 3).map((reason) => <div key={reason.code} style={styles.reason}><strong>{reason.count}× {reason.code}</strong> · {reason.message}{reason.repair ? ` Repair: ${reason.repair}` : ''}</div>)}
  </div>;
}
function Funnel({ counts }: { counts: VariationFunnelCounts }): JSX.Element {
  return <div style={styles.funnel} data-testid="variation-funnel">Enumerated {counts.enumerated} → materialized {counts.materialized} → simulated {counts.simulated} → gated {counts.gated} → deduped {counts.deduplicated} → ranked {counts.ranked} → <strong>verified {counts.verified}</strong>{counts.failed ? ` · ${counts.failed} isolated failures` : ''}</div>;
}
function clamp(raw: string, min: number, max: number): number { return Math.max(min, Math.min(max, Math.floor(Number(raw) || min))); }
function candidateKey(item: VariationCandidateResult): string { return `${item.candidate.site.anchorId}:${item.candidate.mapId}:${item.candidate.site.siteId}:${item.candidate.permutationKey}`; }
function mapLabel(id: string): string { return MAPS.find((map) => map.id === id)?.label ?? id; }

const styles: Record<string, CSSProperties> = {
  panel: { width: 430, height: '100%', boxSizing: 'border-box', overflowY: 'auto', color: '#e9edf4', background: 'rgba(24,27,32,.98)', border: '1px solid #3b3f47', borderRadius: 8, boxShadow: '0 18px 48px rgba(0,0,0,.52)' },
  header: { display: 'flex', alignItems: 'center', padding: '13px 14px 11px', borderBottom: '1px solid #373b43' },
  eyebrow: { color: '#f07f2f', fontSize: 9, fontWeight: 750, letterSpacing: .9, textTransform: 'uppercase' },
  close: { marginLeft: 'auto', width: 28, height: 28, border: 0, background: 'transparent', color: '#949ca8', fontSize: 22, cursor: 'pointer' },
  section: { padding: 13, borderBottom: '1px solid #343840' }, copy: { color: '#aeb6c2', fontSize: 11, marginBottom: 10 },
  currentMap: { color: '#76c8ee', fontSize: 10, marginBottom: 8 }, preflight: { padding: 9, color: '#aeb6c2', background: '#20242a', borderRadius: 5, marginBottom: 8, fontSize: 10 },
  overview: { padding: 10, background: '#20242a', border: '1px solid #3b4049', borderRadius: 7, marginBottom: 10 }, compatible: { display: 'flex', alignItems: 'baseline', gap: 7, color: '#75e69c' }, breakdown: { marginTop: 3, color: '#aeb6c2', fontSize: 9 }, requirements: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }, chip: { padding: '3px 5px', border: '1px solid #4a515d', borderRadius: 9, color: '#cbd2dc', fontSize: 8 }, formula: { marginTop: 8, color: '#f0c177', fontSize: 10, fontWeight: 650 }, structural: { marginTop: 3, color: '#8f98a5', fontSize: 9 }, reason: { marginTop: 5, color: '#edc778', fontSize: 8 },
  axes: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 9, fontSize: 9, color: '#abb3bf' },
  axisStatus: { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' },
  drawNotice: { margin: '-2px 0 9px', color: '#8f98a5', fontSize: 9, lineHeight: 1.45 },
  primary: { width: '100%', padding: '8px 10px', border: '1px solid #d76d25', borderRadius: 6, background: '#f07f2f', color: '#16181c', fontWeight: 750, cursor: 'pointer' },
  cancel: { width: '100%', marginTop: 6, padding: 6, border: '1px solid #755', borderRadius: 5, background: '#35282a', color: '#ffb4b4' }, resume: { width: '100%', marginTop: 6, padding: 6, border: '1px solid #4b6075', borderRadius: 5, background: '#263441', color: '#b8dcff' }, funnel: { marginTop: 8, padding: 7, background: '#18252b', color: '#9bdcf5', borderRadius: 5, fontSize: 9 },
  blocker: { marginTop: 8, color: '#e9c77d', fontSize: 10 }, error: { marginTop: 7, color: '#ff9b9b', fontSize: 10, whiteSpace: 'pre-wrap' },
  liftIssues: { marginTop: 8, padding: 8, border: '1px solid #74454a', borderRadius: 5, background: '#332327', fontSize: 10 },
  dependency: { marginTop: 2, color: '#e9c77d' },
  summary: { fontWeight: 650, marginBottom: 2 }, token: { color: '#77808d', font: '9px ui-monospace, monospace', marginBottom: 9 }, zero: { display: 'grid', gap: 7, color: '#aeb6c2', fontSize: 10 },
  card: { marginBottom: 9, padding: 10, border: '1px solid #3b4049', borderRadius: 7, background: '#20242a', cursor: 'pointer' }, cardActive: { borderColor: '#4bc0ff', boxShadow: '0 0 0 1px rgba(75,192,255,.25)' },
  cardTop: { display: 'flex', gap: 8, alignItems: 'center' }, badge: { marginLeft: 'auto', fontSize: 8, fontWeight: 800, textTransform: 'uppercase' },
  site: { marginTop: 2, color: '#818a97', font: '9px ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis' }, score: { marginTop: 5, color: '#c5ccd6', fontSize: 10 }, explain: { marginTop: 4, color: '#9ca5b2', fontSize: 10 },
  stage: { marginTop: 2, color: '#7cccf0', fontSize: 8, textTransform: 'uppercase' }, issueError: { marginTop: 5, color: '#ff9b9b', fontSize: 9 }, issueWarning: { marginTop: 5, color: '#edc778', fontSize: 9 }, preview: { marginTop: 6, color: '#69c7ef', fontSize: 9 }, decision: { marginTop: 6, color: '#b8a7e8', fontSize: 9 }, carla: { marginTop: 6, padding: 5, background: '#282632', color: '#c8b9f5', fontSize: 8 },
  actions: { display: 'flex', gap: 6, marginTop: 9 }, reject: { flex: 1, padding: 6, border: '1px solid #555b65', borderRadius: 5, background: '#2a2e35', color: '#d8dde5' }, shortlist: { flex: 1, padding: 6, border: '1px solid #756c48', borderRadius: 5, background: '#3b3524', color: '#f4d98b' }, accept: { flex: 2, padding: 6, border: '1px solid #43845b', borderRadius: 5, background: '#275239', color: '#baf2cd', fontWeight: 700 },
};
