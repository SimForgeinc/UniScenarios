import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CameraMode, CityViewer } from '@scenario-studio/city-renderer';

export interface LayerPanelProps {
  viewer: CityViewer | null;
  benchRunning: boolean;
  onBench: () => void;
}

/** Layer toggles + camera mode. Stub surface that the scenario tools grow into. */
export function LayerPanel({ viewer, benchRunning, onBench }: LayerPanelProps): JSX.Element {
  const [layers, setLayers] = useState({ city: true, vegetation: true, road: true });
  const [mode, setMode] = useState<CameraMode>('orbit');

  const toggle = (key: keyof typeof layers) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    viewer?.setLayerVisible(key, next[key]);
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
    position: 'absolute',
    top: 12,
    right: 12,
    width: 190,
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
