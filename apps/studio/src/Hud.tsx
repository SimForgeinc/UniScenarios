import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CityViewer, CityViewerStats } from '@scenario-studio/city-renderer';

const MB = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  return `${(bytes / MB).toFixed(0)} MB`;
}

function formatCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(0);
}

/** Live performance/streaming readout. Polled, not per-frame — it must not cost frames. */
export function Hud({ viewer }: { viewer: CityViewer | null }): JSX.Element | null {
  const [stats, setStats] = useState<CityViewerStats | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const id = setInterval(() => setStats(viewer.getStats()), 250);
    return () => clearInterval(id);
  }, [viewer]);

  if (!stats) {
    return (
      <div style={styles.panel} data-testid="hud">
        <div style={styles.title}>loading map…</div>
      </div>
    );
  }

  const streaming = stats.loading + stats.queued + stats.uploading;
  return (
    <div style={styles.panel} data-testid="hud">
      <Row label="fps" value={stats.fps.toFixed(0)} accent={stats.fps < 45} />
      <Row
        label="frame"
        value={`${stats.frameMsAvg.toFixed(1)} ms  p95 ${stats.frameMsP95.toFixed(1)}`}
        accent={stats.frameMsP95 > 22}
      />
      <Row label="draws" value={formatCount(stats.drawCalls)} />
      <Row label="tris" value={formatCount(stats.triangles)} />
      <Row label="tiles" value={`${stats.residentTiles} (${stats.residentAssets} lods)`} />
      <Row
        label="resident"
        value={`${formatBytes(stats.residentBytes)} / ${formatBytes(stats.byteBudget)}`}
        accent={stats.residentBytes > stats.byteBudget}
      />
      <Row
        label="stream"
        value={
          streaming === 0
            ? 'idle'
            : `${stats.loading}L ${stats.queued}Q ${stats.uploading}U +${formatBytes(stats.pendingBytes)}`
        }
      />
      <Row
        label="heap"
        value={stats.jsHeapMB === null ? 'n/a' : `${stats.jsHeapMB.toFixed(0)} MB`}
      />
      <Row label="camera" value={stats.cameraMode} />
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={{ ...styles.value, color: accent ? '#ffb454' : '#e6e9ef' }}>{value}</span>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 12,
    left: 12,
    minWidth: 210,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(12, 15, 20, 0.72)',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(8px)',
    font: '12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
    pointerEvents: 'none',
    userSelect: 'none',
  },
  title: { color: '#8a93a0' },
  row: { display: 'flex', justifyContent: 'space-between', gap: 16 },
  label: { color: '#7c8696' },
  value: { fontVariantNumeric: 'tabular-nums' },
};
