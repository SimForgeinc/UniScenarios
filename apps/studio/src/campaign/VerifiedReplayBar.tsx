import type { CSSProperties } from 'react';
import type { PlaybackState } from '@uniscenarios/playback';
import type { PlaybackCameraOption } from '../playback/PlaybackPanel';

export interface VerifiedReplayPresentation {
  readonly current: number;
  readonly start: number;
  readonly end: number;
  readonly percent: number;
  readonly status: 'Playing' | 'Paused' | 'Complete';
}

export function verifiedReplayKeyboardAction(input: {
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;
  readonly modified: boolean;
  readonly editable: boolean;
}): 'toggle' | 'stop' | null {
  if (input.repeat || input.modified || input.editable) return null;
  if (input.code === 'Space') return 'toggle';
  if (input.key === 'Escape') return 'stop';
  return null;
}

export function verifiedReplayPresentation(
  state: Pick<PlaybackState, 'time' | 'startTime' | 'endTime' | 'playing'> | null,
  fallback: { readonly startTime: number; readonly endTime: number },
): VerifiedReplayPresentation {
  const start = state?.startTime ?? fallback.startTime;
  const end = state?.endTime ?? fallback.endTime;
  const current = Math.max(start, Math.min(end, state?.time ?? start));
  const duration = Math.max(0, end - start);
  const percent = duration === 0 ? 100 : ((current - start) / duration) * 100;
  return {
    current,
    start,
    end,
    percent,
    status: current >= end ? 'Complete' : state?.playing ? 'Playing' : 'Paused',
  };
}

export function VerifiedReplayBar({
  title,
  state,
  startTime,
  endTime,
  onToggle,
  onStop,
  cameraOptions,
  onCameraChange,
}: {
  title: string;
  state: PlaybackState | null;
  startTime: number;
  endTime: number;
  onToggle: () => void;
  onStop: () => void;
  cameraOptions: readonly PlaybackCameraOption[];
  onCameraChange: (option: PlaybackCameraOption) => void;
}): JSX.Element {
  const replay = verifiedReplayPresentation(state, { startTime, endTime });
  const complete = replay.status === 'Complete';
  const toggleLabel = complete ? 'Replay verified scenario' : replay.status === 'Playing' ? 'Pause verified replay' : 'Resume verified replay';

  return (
    <section style={styles.bar} aria-label={`Verified replay: ${title}`} data-testid="campaign-replay-bar">
      <div style={styles.identity}>
        <span style={styles.eyebrow}>Verified read-only replay</span>
        <strong style={styles.title}>{title}</strong>
      </div>
      <div style={styles.transport}>
        <div style={styles.readoutRow}>
          <span
            style={{ ...styles.status, ...(complete ? styles.complete : null) }}
            role="status"
            aria-live="polite"
            data-testid="verified-replay-state"
          >{replay.status}</span>
          <output style={styles.time} aria-label="Verified replay time" data-testid="verified-replay-time">
            {replay.current.toFixed(2)} / {replay.end.toFixed(2)} s
          </output>
        </div>
        <div
          role="progressbar"
          aria-label="Verified replay progress"
          aria-valuemin={replay.start}
          aria-valuemax={replay.end}
          aria-valuenow={replay.current}
          aria-valuetext={`${replay.current.toFixed(2)} of ${replay.end.toFixed(2)} seconds, ${replay.status.toLowerCase()}`}
          style={styles.progressTrack}
          data-testid="verified-replay-progress"
        >
          <span style={{ ...styles.progressFill, width: `${replay.percent}%` }} />
        </div>
      </div>
      <div style={styles.actions}>
        <label style={styles.cameraLabel}>
          <span>Camera</span>
          <select
            aria-label="Playback camera"
            value={state?.cameraSelectionId ?? 'all-actors'}
            disabled={!state}
            onChange={(event) => {
              const option = cameraOptions.find((item) => item.id === event.target.value);
              if (option) onCameraChange(option);
            }}
          >
            {cameraOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          {state?.cameraReason ? <small style={styles.cameraReason}>{state.cameraReason}</small> : null}
        </label>
        <span style={styles.keyboardHint} aria-hidden="true">Space pause/resume · Esc stop</span>
        <button
          type="button"
          style={styles.toggle}
          aria-label={toggleLabel}
          onClick={onToggle}
          disabled={!state}
          data-testid="verified-replay-toggle"
        >{complete ? '↻ Replay' : replay.status === 'Playing' ? 'Ⅱ Pause' : '▶ Resume'}</button>
        <button type="button" style={styles.stop} onClick={onStop} data-testid="verified-replay-stop">
          ■ Stop &amp; return to Gallery
        </button>
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  bar: {
    position: 'absolute', zIndex: 22, top: 12, left: 64, right: 16,
    display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 2fr) auto',
    alignItems: 'center', gap: 16, padding: '9px 12px', border: '1px solid #464c56',
    borderRadius: 8, background: 'rgba(22,25,30,.96)', boxShadow: '0 8px 24px rgba(0,0,0,.4)',
  },
  identity: { minWidth: 0 },
  eyebrow: { display: 'block', color: '#56c28b', fontSize: 8, fontWeight: 750, textTransform: 'uppercase', letterSpacing: .8 },
  title: { display: 'block', overflow: 'hidden', color: '#e9edf3', fontSize: 11, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  transport: { minWidth: 0 },
  readoutRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 4 },
  status: { color: '#f0b36f', fontSize: 9, fontWeight: 750, textTransform: 'uppercase', letterSpacing: .6 },
  complete: { color: '#56c28b' },
  time: { color: '#f2f5f9', fontSize: 11, fontVariantNumeric: 'tabular-nums' },
  progressTrack: { display: 'block', height: 5, overflow: 'hidden', borderRadius: 999, background: '#343a43' },
  progressFill: { display: 'block', height: '100%', borderRadius: 999, background: '#f07f2f', transition: 'width 80ms linear' },
  actions: { display: 'flex', alignItems: 'center', gap: 7 },
  cameraLabel: { display: 'flex', alignItems: 'center', gap: 5, color: '#9ba5b3', fontSize: 8, whiteSpace: 'nowrap' },
  cameraReason: { maxWidth: 180, overflow: 'hidden', color: '#8792a0', fontSize: 8, textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  keyboardHint: { color: '#7f8997', fontSize: 8, whiteSpace: 'nowrap' },
  toggle: { padding: '7px 10px', border: '1px solid #596271', borderRadius: 6, background: '#303640', color: '#eef2f7', font: 'inherit', fontSize: 10, cursor: 'pointer' },
  stop: { padding: '7px 10px', border: '1px solid #d36d29', borderRadius: 6, background: '#9f471b', color: '#fff5ec', font: 'inherit', fontSize: 10, cursor: 'pointer' },
};
