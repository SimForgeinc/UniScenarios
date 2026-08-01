import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CameraMode, CityViewer } from '@uniscenarios/city-renderer';
import type { MapOverlayHandle, MapOverlayLayer } from './mapOverlays';

export interface LayerPanelProps {
  viewer: CityViewer | null;
  /** `null` until the overlays have finished loading (they wait for map settle). */
  overlays: MapOverlayHandle | null;
  overlayError: string | null;
  overlayDefaults: Record<MapOverlayLayer, boolean>;
  benchRunning: boolean;
  onBench: () => void;
  /** Placed actors, from the editor. */
  actorCount: number;
  /** Driving lanes in the snapping index, or `null` before it is built. */
  laneCount: number | null;
}

const OVERLAY_LAYERS: readonly MapOverlayLayer[] = ['lanes', 'signals'];

/** Layer toggles + camera mode. Stub surface that the scenario tools grow into. */
export function LayerPanel({
  viewer,
  overlays,
  overlayError,
  overlayDefaults,
  benchRunning,
  onBench,
  actorCount,
  laneCount,
}: LayerPanelProps): JSX.Element {
  const [layers, setLayers] = useState({ city: true, vegetation: true, road: true });
  const [overlayLayers, setOverlayLayers] = useState(overlayDefaults);
  const [mode, setMode] = useState<CameraMode>('orbit');

  const toggle = (key: keyof typeof layers) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    viewer?.setLayerVisible(key, next[key]);
  };

  // Pure visibility flip — the overlay geometry is built once and kept.
  const toggleOverlay = (key: MapOverlayLayer) => {
    const value = !overlayLayers[key];
    setOverlayLayers({ ...overlayLayers, [key]: value });
    overlays?.setVisible(key, value);
  };

  return (
    <div style={styles.panel} data-testid="layer-panel">
      <div style={styles.heading}>Layers</div>
      {(['city', 'vegetation', 'road'] as const).map((key) => (
        <label key={key} style={styles.check}>
          <input type="checkbox" checked={layers[key]} onChange={() => toggle(key)} />
          <span>{key}</span>
        </label>
      ))}

      <div style={{ ...styles.heading, marginTop: 10 }}>Map overlays</div>
      {OVERLAY_LAYERS.map((key) => (
        <label
          key={key}
          style={{ ...styles.check, opacity: overlays ? 1 : 0.45 }}
          title={overlays ? undefined : 'loads after the map settles'}
        >
          <input
            type="checkbox"
            data-testid={`overlay-${key}`}
            checked={overlayLayers[key]}
            disabled={!overlays}
            onChange={() => toggleOverlay(key)}
          />
          <span>{key}</span>
        </label>
      ))}
      <div style={styles.hint}>
        {overlayError
          ? `overlay error: ${overlayError}`
          : overlays
            ? `${overlays.stats.laneCount} lanes · ${overlays.stats.signalCount} signals · ${overlays.stats.signalDrawCalls} draws`
            : 'loading after map settle…'}
      </div>

      <div style={{ ...styles.heading, marginTop: 10 }}>Scenario</div>
      <div style={styles.hint}>
        {`${actorCount} placed · ${laneCount === null ? 'lane index loading…' : `${laneCount} driving lanes`}`}
      </div>

      <div style={{ ...styles.heading, marginTop: 10 }}>Camera</div>
      <div style={styles.buttons}>
        {(['orbit', 'fly'] as const).map((value) => (
          <button
            key={value}
            type="button"
            style={{ ...styles.button, ...(mode === value ? styles.buttonActive : null) }}
            onClick={() => {
              setMode(value);
              viewer?.setCameraMode(value);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div style={styles.hint}>
        {mode === 'orbit' ? 'drag rotate · right-drag pan · wheel zoom' : 'click to look · WASD/QE · shift boost'}
      </div>

      <button
        type="button"
        style={{ ...styles.button, width: '100%', marginTop: 10 }}
        disabled={!viewer || benchRunning}
        onClick={onBench}
      >
        {benchRunning ? 'benchmarking…' : 'run benchmark'}
      </button>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    // Position is the rail's business (see App.tsx); this is just a card.
    marginBottom: 8,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'rgba(12, 15, 20, 0.72)',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(8px)',
    userSelect: 'none',
  },
  heading: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: '#7c8696',
    marginBottom: 6,
  },
  check: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', cursor: 'pointer' },
  buttons: { display: 'flex', gap: 6 },
  button: {
    flex: 1,
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e6e9ef',
    font: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
  buttonActive: { background: '#2f6df6', borderColor: '#2f6df6' },
  hint: { marginTop: 6, fontSize: 11, color: '#6d7686' },
};
