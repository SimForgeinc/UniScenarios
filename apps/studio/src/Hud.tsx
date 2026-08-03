import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CityViewer, CityViewerStats } from '@uniscenarios/city-renderer';

/**
 * Kept structural so Studio remains compatible while older map bundles are
 * being replaced. Current CityViewer builds expose this as CameraDiagnostics.
 */
export interface CameraDiagnosticsSnapshot {
  ready: boolean;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  groundY: number | null;
  altitudeAgl: number | null;
  minAltitude: number | null;
  maxAltitude: number | null;
  viewDistance: number;
  fov: number;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    width: number;
    height: number;
  } | null;
  localBuildingMax: number | null;
  headroom: number | null;
  clamps: Record<'eyeX' | 'eyeY' | 'eyeZ' | 'targetX' | 'targetY' | 'targetZ', boolean>;
}

type DiagnosticViewer = CityViewer & {
  getCameraDiagnostics?: () => CameraDiagnosticsSnapshot;
};

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
  const [camera, setCamera] = useState<CameraDiagnosticsSnapshot | null>(null);

  useEffect(() => {
    if (!viewer) return;
    const diagnosticsViewer = viewer as DiagnosticViewer;
    const poll = () => {
      setStats(viewer.getStats());
      setCamera(diagnosticsViewer.getCameraDiagnostics?.() ?? null);
    };
    poll();
    // Diagnostics are intentionally sampled at 4 Hz, never in the render
    // loop, so leaving Debug Graphics open does not affect camera pacing.
    const id = setInterval(poll, 250);
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
      <Row label="display" value={`${stats.fps.toFixed(0)} fps`} accent={!stats.renderingSuspended && stats.fps < 45} />
      {stats.renderingSuspended ? <Row label="mode" value={`visuals off · UI ${stats.uiTicksPerSecond.toFixed(0)} Hz`} /> : null}
      <Row
        label="frame"
        value={`${stats.frameMsP50.toFixed(1)} ms  p95 ${stats.frameMsP95.toFixed(1)}  p99 ${stats.frameMsP99.toFixed(1)}`}
        accent={stats.frameMsP95 > 22}
      />
      <Row
        label="hitches"
        value={`>25 ${stats.frameTimeCounts.over25}  >50 ${stats.frameTimeCounts.over50}`}
        accent={stats.frameTimeCounts.over50 > 0}
      />
      <Row
        label="cpu"
        value={`render ${stats.phases.renderMsAvg.toFixed(1)}  upload ${stats.phases.uploadsMsAvg.toFixed(1)}`}
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
      <Row label="camera" value={stats.cameraMode === 'orbit' ? 'city' : 'free'} />
      <Row label="ground" value={stats.roadVisible ? 'visible' : 'loading'} accent={!stats.roadVisible} />
      <Row
        label="assets"
        value={stats.assetVariants.manifest
          ? `geo ${stats.assetVariants.loaded['geometry-only']} · ktx ${stats.assetVariants.loaded.ktx2} · source ${stats.assetVariants.loaded.original}${stats.assetVariants.fallbacks ? ` · ${stats.assetVariants.fallbacks} fallback` : ''}`
          : `source ${stats.assetVariants.loaded.original}`}
        accent={stats.assetVariants.fallbacks > 0}
      />
      {camera ? <CameraDiagnosticsReadout diagnostics={camera} /> : null}
    </div>
  );
}

export function CameraDiagnosticsReadout({
  diagnostics,
}: {
  diagnostics: CameraDiagnosticsSnapshot;
}): JSX.Element {
  const clampNames = Object.entries(diagnostics.clamps)
    .filter(([, active]) => active)
    .map(([name]) => name);
  return (
    <div style={styles.cameraDiagnostics} data-testid="camera-diagnostics">
      <div style={styles.sectionTitle}>camera constraints</div>
      <Row label="position xyz" value={formatVector(diagnostics.position)} />
      <Row label="target xyz" value={formatVector(diagnostics.target)} />
      <Row label="ground" value={formatMeters(diagnostics.groundY)} />
      <Row label="height AGL" value={formatMeters(diagnostics.altitudeAgl)} />
      <Row label="min altitude" value={formatMeters(diagnostics.minAltitude)} />
      <Row label="max altitude" value={formatMeters(diagnostics.maxAltitude)} />
      <Row label="view distance / fov" value={`${diagnostics.viewDistance.toFixed(1)} m / ${diagnostics.fov.toFixed(1)}°`} />
      <Row
        label="map width × height"
        value={diagnostics.bounds ? `${diagnostics.bounds.width.toFixed(1)} × ${diagnostics.bounds.height.toFixed(1)} m` : 'loading'}
      />
      <Row
        label="map x range"
        value={diagnostics.bounds ? `${diagnostics.bounds.minX.toFixed(1)} … ${diagnostics.bounds.maxX.toFixed(1)} m` : 'loading'}
      />
      <Row
        label="map z range"
        value={diagnostics.bounds ? `${diagnostics.bounds.minZ.toFixed(1)} … ${diagnostics.bounds.maxZ.toFixed(1)} m` : 'loading'}
      />
      <Row label="local building max" value={formatMeters(diagnostics.localBuildingMax)} />
      <Row label="headroom" value={formatMeters(diagnostics.headroom)} />
      <Row
        label="active clamps"
        value={!diagnostics.ready ? 'loading' : clampNames.length > 0 ? clampNames.join(', ') : 'none'}
        accent={clampNames.length > 0}
      />
    </div>
  );
}

function formatVector(value: readonly [number, number, number]): string {
  return value.map((coordinate) => coordinate.toFixed(1)).join(', ');
}

function formatMeters(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)} m`;
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
    // Position is the rail's business (see App.tsx); this is just a card.
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
  cameraDiagnostics: { marginTop: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,.08)' },
  sectionTitle: { marginBottom: 3, color: '#697485', fontSize: 9, letterSpacing: 0.7, textTransform: 'uppercase' },
};
