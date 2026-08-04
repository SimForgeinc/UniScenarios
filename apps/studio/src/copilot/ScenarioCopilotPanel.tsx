import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { buildCopilotMapContext } from './mapContext';
import { generateScenarioCandidates } from './client';
import type { CopilotCandidate, CopilotGenerationResult, CopilotIntent, CopilotProgress, CopilotProviderId } from './types';
import type { EditorController } from '../editor/controller';
import type { MapEntry } from '../maps';

export interface CandidateValidation {
  readonly valid: boolean;
  readonly message: string;
  readonly actorCount: number;
  readonly durationS: number;
}

export interface ScenarioCopilotPanelProps {
  readonly controller: EditorController;
  readonly map: MapEntry;
  readonly onValidate: (candidate: CopilotCandidate) => Promise<CandidateValidation>;
  readonly onApply: (candidate: CopilotCandidate) => void;
  readonly onClose: () => void;
}

const STARTER = 'A sedan approaches a pedestrian who emerges from behind a stopped van. The pedestrian starts after four seconds and the sedan should brake to avoid a collision.';

export function ScenarioCopilotPanel({ controller, map, onValidate, onApply, onClose }: ScenarioCopilotPanelProps): JSX.Element {
  const [provider, setProvider] = useState<CopilotProviderId>('staged-rag');
  const [prompt, setPrompt] = useState(STARTER);
  const [progress, setProgress] = useState<CopilotProgress | null>(null);
  const [result, setResult] = useState<CopilotGenerationResult | null>(null);
  const [intentDraft, setIntentDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [validations, setValidations] = useState<Record<string, CandidateValidation | 'running'>>({});
  const abortRef = useRef<AbortController | null>(null);
  const mapContext = useMemo(() => buildCopilotMapContext(map, controller.laneIndex), [controller, map]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const generate = async (confirmedIntent?: CopilotIntent): Promise<void> => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy(true); setError(null); setResult(null); setValidations({});
    try {
      const generated = await generateScenarioCandidates({
        providerId: provider,
        prompt,
        mapContext,
        currentScenario: controller.doc.data,
        maxCandidates: 2,
        ...(confirmedIntent ? { confirmedIntent } : {}),
      }, { signal: abort.signal, onProgress: setProgress });
      setResult(generated);
      setIntentDraft(JSON.stringify(generated.intent, null, 2));
      setBusy(false);
      for (const candidate of generated.candidates) {
        setValidations((current) => ({ ...current, [candidate.id]: 'running' }));
        const validation = await onValidate(candidate).catch((reason: unknown) => ({ valid: false, message: reason instanceof Error ? reason.message : String(reason), actorCount: 0, durationS: 0 }));
        setValidations((current) => ({ ...current, [candidate.id]: validation }));
      }
    } catch (reason) {
      if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  };

  const regenerateIntent = (): void => {
    try {
      const parsed = JSON.parse(intentDraft) as CopilotIntent;
      void generate(parsed);
    } catch {
      setError('The edited intent must be valid JSON. Actor and restriction fields remain schema-checked on the server.');
    }
  };

  return <section style={styles.panel} aria-label="Scenario Copilot" data-testid="scenario-copilot-panel">
    <header style={styles.header}>
      <div><div style={styles.eyebrow}>CURRENT-MAP GENERATION</div><h2 style={styles.heading}>Scenario Copilot</h2></div>
      <button type="button" style={styles.close} onClick={onClose} aria-label="Close Scenario Copilot">×</button>
    </header>
    <div style={styles.mapLock}><span>◉</span><div><strong>{map.label}</strong><small>{mapContext.laneCount} driving lanes · {mapContext.placementSlots.length} bounded placement slots</small></div><span style={styles.lock}>Locked</span></div>
    <label style={styles.label}>Generation approach</label>
    <div style={styles.providers}>
      <button type="button" aria-pressed={provider === 'staged-rag'} style={{ ...styles.provider, ...(provider === 'staged-rag' ? styles.providerActive : {}) }} onClick={() => setProvider('staged-rag')}>
        <strong>Structured + retrieval</strong><small>Chat2Scenic-inspired staged pipeline</small>
      </button>
      <button type="button" aria-pressed={provider === 'direct-llm'} style={{ ...styles.provider, ...(provider === 'direct-llm' ? styles.providerActive : {}) }} onClick={() => setProvider('direct-llm')}>
        <strong>Direct native draft</strong><small>One model call into our typed format</small>
      </button>
    </div>
    <label style={styles.label} htmlFor="copilot-prompt">Describe the scenario</label>
    <textarea id="copilot-prompt" data-testid="scenario-copilot-prompt" style={styles.prompt} value={prompt} onChange={(event) => setPrompt(event.currentTarget.value)} disabled={busy} />
    <button type="button" data-testid="scenario-copilot-generate" style={styles.generate} disabled={busy || prompt.trim().length < 8} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate on this map'}</button>
    {progress ? <div role="status" style={styles.progress}><span>{progress.message}</span><span>{progress.completed}/{progress.total}</span></div> : null}
    {error ? <div role="alert" style={styles.error}>{error}</div> : null}
    {result ? <>
      <div style={styles.runMeta}><strong>{result.provider === 'staged-rag' ? 'Structured + retrieval' : 'Direct native draft'}</strong><span>{result.model}</span><span>{(result.metrics.latencyMs / 1000).toFixed(1)} s</span></div>
      {result.warnings.map((warning) => <div key={warning} style={styles.warning}>{warning}</div>)}
      <details style={styles.intent} open>
        <summary><strong>Review structured intent</strong> · editable before regeneration</summary>
        <textarea aria-label="Structured scenario intent" style={styles.intentEditor} value={intentDraft} onChange={(event) => setIntentDraft(event.currentTarget.value)} />
        <button type="button" style={styles.secondary} onClick={regenerateIntent}>Regenerate from edited intent</button>
      </details>
      <div style={styles.candidates}>
        {result.candidates.map((candidate) => {
          const validation = validations[candidate.id];
          return <article key={candidate.id} style={styles.card} data-testid="scenario-copilot-candidate">
            <div style={styles.cardTitle}><strong>{candidate.title}</strong><span>{candidate.scenarioDoc.roles.length} actors</span></div>
            <p>{candidate.summary}</p>
            <div style={validation === 'running' || !validation ? styles.validating : validation.valid ? styles.valid : styles.invalid}>
              {validation === 'running' || !validation ? 'Running canonical simulation…' : validation.message}
            </div>
            <div style={styles.provenance}>Map {candidate.provenance.mapId} · examples {candidate.provenance.retrievedExampleIds.join(', ') || 'none'} · {candidate.provenance.implementation}</div>
            <button type="button" data-testid="scenario-copilot-apply" style={styles.apply} disabled={!validation || validation === 'running' || !validation.valid} onClick={() => onApply(candidate)}>Apply & open in editor</button>
          </article>;
        })}
      </div>
    </> : null}
    <footer style={styles.caveat}>Clean-room adaptation. It preserves structured interpretation, owned-example retrieval, component stages, repair, map binding, and provenance without copying the CC BY-NC repository’s code, prompts, or data.</footer>
  </section>;
}

const styles: Record<string, CSSProperties> = {
  panel: { padding: 18, color: '#e9edf3', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, maxHeight: 'calc(100vh - 96px)', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #353b44', paddingBottom: 12 },
  eyebrow: { color: '#f28b36', fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }, heading: { margin: '3px 0 0', fontSize: 24 },
  close: { border: 0, background: 'transparent', color: '#aeb6c3', fontSize: 27, cursor: 'pointer' },
  mapLock: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: 11, border: '1px solid #3e596c', borderRadius: 9, background: '#152630' },
  lock: { color: '#77d9ff', fontSize: 12, fontWeight: 800 },
  label: { fontSize: 12, color: '#b7c0cc', fontWeight: 750 }, providers: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  provider: { color: '#dbe2eb', textAlign: 'left', padding: 10, display: 'flex', flexDirection: 'column', gap: 4, background: '#20242a', border: '1px solid #3b414b', borderRadius: 8, cursor: 'pointer' },
  providerActive: { borderColor: '#f28b36', background: '#2d261f' }, prompt: { minHeight: 108, resize: 'vertical', borderRadius: 8, padding: 11, color: '#f4f6f8', background: '#15181d', border: '1px solid #424954', font: 'inherit' },
  generate: { padding: '11px 14px', border: 0, borderRadius: 8, background: '#f27f2b', color: '#11151a', fontWeight: 850, cursor: 'pointer' },
  progress: { display: 'flex', justifyContent: 'space-between', color: '#9de5ff', background: '#132630', padding: 9, borderRadius: 7, fontSize: 12 },
  error: { padding: 10, borderRadius: 7, background: '#3b1e24', color: '#ffadb8' }, warning: { padding: 9, borderRadius: 7, background: '#382f1e', color: '#ffd786', fontSize: 12 },
  runMeta: { display: 'flex', gap: 10, flexWrap: 'wrap', color: '#aeb7c3', fontSize: 12 }, intent: { border: '1px solid #3a414b', borderRadius: 8, padding: 10, background: '#1b1f25' },
  intentEditor: { marginTop: 9, boxSizing: 'border-box', width: '100%', minHeight: 170, resize: 'vertical', background: '#101318', color: '#dce7f3', border: '1px solid #3c4652', borderRadius: 6, padding: 9, fontFamily: 'ui-monospace, monospace', fontSize: 11 },
  secondary: { marginTop: 8, padding: '7px 10px', borderRadius: 6, border: '1px solid #536170', background: '#28313b', color: '#e1e8ef', cursor: 'pointer' },
  candidates: { display: 'grid', gap: 10 }, card: { padding: 12, border: '1px solid #3d4650', borderRadius: 9, background: '#20242a' }, cardTitle: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  validating: { color: '#8edfff', fontSize: 12 }, valid: { color: '#79e2a3', fontSize: 12 }, invalid: { color: '#ff9d9d', fontSize: 12 },
  provenance: { marginTop: 8, color: '#8e98a6', fontSize: 10, overflowWrap: 'anywhere' }, apply: { marginTop: 10, width: '100%', padding: 9, border: 0, borderRadius: 7, background: '#2d8f55', color: '#effff5', fontWeight: 800, cursor: 'pointer' },
  caveat: { color: '#7f8997', fontSize: 10, lineHeight: 1.45, borderTop: '1px solid #303640', paddingTop: 10 },
};
