import { useEffect, useState, type CSSProperties } from 'react';
import type { CityViewer } from '@uniscenarios/city-renderer';

export type WorldLoadingStage = 'renderer' | 'road' | 'editor' | 'ready' | 'error';

export function worldLoadingStage(input: {
  viewerReady: boolean;
  roadVisible: boolean;
  editorReady: boolean;
  error: string | null;
}): WorldLoadingStage {
  if (input.error) return 'error';
  if (!input.viewerReady) return 'renderer';
  if (!input.roadVisible) return 'road';
  if (!input.editorReady) return 'editor';
  return 'ready';
}

export function WorldLoadingOverlay({ viewer, mapLabel, editorReady, error }: {
  viewer: CityViewer | null;
  mapLabel: string;
  editorReady: boolean;
  error: string | null;
}): JSX.Element | null {
  const [stream, setStream] = useState(() => {
    const stats = viewer?.getStats();
    return {
      roadVisible: stats?.roadVisible ?? false,
      background: (stats?.loading ?? 0) + (stats?.queued ?? 0) + (stats?.uploading ?? 0),
      error: stats?.streamingError ?? null,
    };
  });

  useEffect(() => {
    if (!viewer) {
      setStream({ roadVisible: false, background: 0, error: null });
      return;
    }
    const refresh = (): void => {
      const stats = viewer.getStats();
      setStream({
        roadVisible: stats.roadVisible,
        background: stats.loading + stats.queued + stats.uploading,
        error: stats.streamingError,
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 150);
    return () => window.clearInterval(interval);
  }, [viewer]);

  const combinedError = error ?? stream.error;
  const stage = worldLoadingStage({ viewerReady: viewer !== null, roadVisible: stream.roadVisible, editorReady, error: combinedError });
  if (stage === 'ready') {
    if (stream.background === 0) return null;
    return <div style={styles.backgroundStatus} role="status" aria-live="polite" data-testid="world-background-streaming" data-stage="background">
      World ready · loading {stream.background} detail {stream.background === 1 ? 'item' : 'items'}
    </div>;
  }

  const copy = stage === 'renderer'
    ? { title: `Opening ${mapLabel}`, detail: 'Starting the world renderer', progress: 18 }
    : stage === 'road'
      ? { title: `Loading ${mapLabel}`, detail: 'Streaming the road surface and 3D world', progress: 56 }
      : stage === 'editor'
        ? { title: 'Preparing the editor', detail: 'Building roads, lanes, and placement tools', progress: 86 }
        : { title: 'World could not finish loading', detail: combinedError ?? 'Unknown loading error', progress: 100 };

  return (
    <div
      style={styles.scrim}
      role={stage === 'error' ? 'alert' : 'status'}
      aria-live={stage === 'error' ? 'assertive' : 'polite'}
      aria-busy={stage !== 'error'}
      data-testid="world-loading-status"
      data-stage={stage}
    >
      <div style={styles.card}>
        <div style={styles.eyebrow}>WORLD</div>
        <div style={styles.titleRow}>
          {stage !== 'error' ? <span className="world-loading-spinner" style={styles.spinner} aria-hidden="true" /> : null}
          <strong style={stage === 'error' ? styles.errorTitle : styles.title}>{copy.title}</strong>
        </div>
        <div style={styles.detail}>{copy.detail}</div>
        <div style={styles.track} aria-hidden="true">
          <div
            className={stage === 'error' ? undefined : 'world-loading-progress'}
            style={{ ...styles.progress, width: `${copy.progress}%`, ...(stage === 'error' ? styles.errorProgress : null) }}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  backgroundStatus: {
    position: 'absolute', right: 14, bottom: 14, zIndex: 34, pointerEvents: 'none',
    border: '1px solid rgba(142,157,177,.22)', borderRadius: 6,
    background: 'rgba(19,23,29,.88)', color: '#aeb8c6', padding: '6px 9px', fontSize: 10,
  },
  scrim: {
    position: 'absolute',
    inset: 0,
    zIndex: 35,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
    background: 'radial-gradient(circle at 50% 45%, rgba(17,22,28,.52), rgba(7,9,12,.88))',
    backdropFilter: 'blur(2px)',
  },
  card: {
    width: 'min(360px, calc(100% - 48px))',
    boxSizing: 'border-box',
    padding: '20px 22px 18px',
    border: '1px solid rgba(142,157,177,.28)',
    borderRadius: 12,
    background: 'rgba(19,23,29,.94)',
    boxShadow: '0 24px 70px rgba(0,0,0,.5)',
    color: '#edf1f7',
  },
  eyebrow: { marginBottom: 10, color: '#788494', fontSize: 9, fontWeight: 750, letterSpacing: '.16em' },
  titleRow: { display: 'flex', alignItems: 'center', gap: 10 },
  title: { fontSize: 15, fontWeight: 680, letterSpacing: '-.01em' },
  errorTitle: { fontSize: 15, fontWeight: 680, color: '#ffb3b3' },
  detail: { marginTop: 7, color: '#99a4b3', fontSize: 11, lineHeight: 1.45 },
  spinner: {
    width: 14,
    height: 14,
    boxSizing: 'border-box',
    border: '2px solid rgba(240,127,47,.22)',
    borderTopColor: '#f07f2f',
    borderRadius: '50%',
  },
  track: { height: 3, marginTop: 16, overflow: 'hidden', borderRadius: 3, background: 'rgba(255,255,255,.08)' },
  progress: { height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #d96625, #f39a58)', transition: 'width 220ms ease' },
  errorProgress: { background: '#d96a6a' },
};
