import { useState, type CSSProperties, type ChangeEvent } from 'react';
import type { PlaybackController, PlaybackState } from './controller';
import { PlaybackLoadError, readPlaybackFiles, type PlaybackBundle } from './model';

export interface PlaybackPanelProps {
  bundle: PlaybackBundle | null;
  controller: PlaybackController | null;
  state: PlaybackState | null;
  onImport: (bundle: PlaybackBundle) => void;
  onClear: () => void;
}

export function PlaybackPanel({
  bundle,
  controller,
  state,
  onImport,
  onClear,
}: PlaybackPanelProps): JSX.Element {
  const [instanceFile, setInstanceFile] = useState<File | null>(null);
  const [traceFile, setTraceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (setter: (file: File | null) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    setter(event.target.files?.[0] ?? null);
    setError(null);
  };

  const load = async (): Promise<void> => {
    if (!instanceFile || !traceFile) {
      setError('Choose both a concrete instance and its matching trace.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      onImport(await readPlaybackFiles(instanceFile, traceFile));
    } catch (reason) {
      setError(
        reason instanceof PlaybackLoadError || reason instanceof Error
          ? reason.message
          : String(reason),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={styles.panel} data-testid="playback-panel">
      <div style={styles.heading}>Import playback</div>
      {!bundle ? (
        <>
          <FileRow
            label="instance"
            accept=".json,.instance.json,application/json"
            name={instanceFile?.name ?? null}
            onChange={choose(setInstanceFile)}
            testId="instance-file"
          />
          <FileRow
            label="trace"
            accept=".json,.gz,.trace.json,.trace.json.gz,application/json,application/gzip"
            name={traceFile?.name ?? null}
            onChange={choose(setTraceFile)}
            testId="trace-file"
          />
          <button
            type="button"
            style={styles.primary}
            disabled={loading || !instanceFile || !traceFile}
            onClick={() => void load()}
            data-testid="load-playback"
          >
            {loading ? 'validating…' : 'load instance + trace'}
          </button>
        </>
      ) : (
        <>
          <div style={styles.identity} data-testid="playback-identity">
            <strong>{bundle.instance.manifest.instanceId}</strong>
            <span>{bundle.instance.input.mapId}</span>
            <span>{bundle.actors.length} actors · {bundle.source.traceName}</span>
            <code title={bundle.instance.manifest.inputHash} style={styles.hash}>
              {bundle.instance.manifest.inputHash}
            </code>
          </div>
          <div style={styles.transport}>
            <button
              type="button"
              style={styles.play}
              disabled={!controller || !state}
              onClick={() => controller?.toggle()}
              data-testid="play-pause"
            >
              {state?.playing ? 'Pause' : 'Play'}
            </button>
            <span style={styles.time} data-testid="playback-time">
              {(state?.time ?? bundle.startTime).toFixed(2)} / {bundle.endTime.toFixed(2)} s
            </span>
          </div>
          <input
            type="range"
            min={bundle.startTime}
            max={bundle.endTime}
            step="0.001"
            value={state?.time ?? bundle.startTime}
            disabled={!controller}
            onChange={(event) => controller?.seek(Number(event.target.value))}
            style={styles.slider}
            aria-label="Trace time"
            data-testid="timeline"
          />
          <div style={styles.hint}>
            {state
              ? `${state.visibleActorCount}/${state.actorCount} visible · trace drives real actor transforms`
              : 'switching to scenario map…'}
          </div>
          {state && state.signalCount > 0 ? (
            <div style={styles.signals} data-testid="playback-signals">
              <strong>
                {state.renderedSignalHeadCount}/{state.signalHeadCount} signal head{state.signalHeadCount === 1 ? '' : 's'} rendered
              </strong>
              <span>
                {state.signalPhases.green} green · {state.signalPhases.yellow} yellow · {state.signalPhases.red} red
              </span>
              <small>{state.signalTimingSources.join(', ')} timing</small>
            </div>
          ) : null}
          <button type="button" style={styles.clear} onClick={onClear}>
            close playback
          </button>
        </>
      )}
      {error ? (
        <pre style={styles.error} role="alert" data-testid="playback-error">{error}</pre>
      ) : null}
    </section>
  );
}

function FileRow({
  label,
  accept,
  name,
  onChange,
  testId,
}: {
  label: string;
  accept: string;
  name: string | null;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  testId: string;
}): JSX.Element {
  return (
    <label style={styles.fileRow}>
      <span>{label}</span>
      <input type="file" accept={accept} onChange={onChange} data-testid={testId} style={styles.fileInput} />
      <small title={name ?? undefined}>{name ?? 'choose file…'}</small>
    </label>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    marginTop: 8,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(12, 15, 20, 0.82)',
    border: '1px solid rgba(255,255,255,0.1)',
    backdropFilter: 'blur(8px)',
  },
  heading: {
    marginBottom: 8,
    color: '#8f98a6',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fileRow: { display: 'grid', gridTemplateColumns: '58px 1fr', alignItems: 'center', gap: 4, marginBottom: 7 },
  fileInput: { width: 126, minWidth: 0, color: '#aeb6c3', fontSize: 10 },
  primary: {
    width: '100%',
    padding: '6px 8px',
    border: 0,
    borderRadius: 6,
    background: '#2f6df6',
    color: 'white',
    font: 'inherit',
    cursor: 'pointer',
  },
  identity: { display: 'flex', flexDirection: 'column', gap: 2, color: '#aeb6c3', fontSize: 11 },
  hash: { overflow: 'hidden', textOverflow: 'ellipsis', color: '#6f91d8', whiteSpace: 'nowrap' },
  transport: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 },
  play: {
    minWidth: 58,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid #2f6df6',
    background: '#2f6df6',
    color: 'white',
    font: 'inherit',
    cursor: 'pointer',
  },
  time: { marginLeft: 'auto', color: '#e6e9ef', fontVariantNumeric: 'tabular-nums', fontSize: 11 },
  slider: { width: '100%', margin: '8px 0 0', accentColor: '#2f6df6' },
  hint: { color: '#737d8d', fontSize: 10 },
  signals: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    marginTop: 6,
    padding: '5px 6px',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.045)',
    color: '#aeb6c3',
    fontSize: 10,
  },
  clear: {
    width: '100%',
    marginTop: 8,
    padding: '4px 7px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'transparent',
    color: '#aeb6c3',
    font: 'inherit',
    cursor: 'pointer',
  },
  error: {
    margin: '8px 0 0',
    maxHeight: 150,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    color: '#ff9b9b',
    font: '10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  },
};
