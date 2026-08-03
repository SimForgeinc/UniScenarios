import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { CameraMode, CityViewer } from '@uniscenarios/city-renderer';
import type { MapOverlayHandle, MapOverlayLayer } from './mapOverlays';
import { PerformancePanel } from './performance/PerformancePanel';
import { Hud } from './Hud';
import { DEFAULT_STUDIO_VIEW_SETTINGS, type StudioViewSettings } from './settings/model';

export interface SettingsPanelProps {
  viewer: CityViewer | null;
  /** `null` until the overlays have finished loading (they wait for map settle). */
  overlays: MapOverlayHandle | null;
  overlayError: string | null;
  settings: StudioViewSettings;
  onSettingsChange: (settings: StudioViewSettings) => void;
  onResetDefaults: () => void;
  onClose: () => void;
  benchRunning: boolean;
  onBench: () => void;
  /** Placed actors, from the editor. */
  actorCount: number;
  /** Driving lanes in the snapping index, or `null` before it is built. */
  laneCount: number | null;
}

const OVERLAY_LAYERS: readonly MapOverlayLayer[] = ['lanes', 'signals'];
const CAMERA_SENSITIVITIES = [
  ['horizontalLookSensitivity', 'Horizontal look speed'],
  ['verticalLookSensitivity', 'Vertical look speed'],
  ['middlePanSensitivity', 'Middle-drag pan speed'],
  ['rightPanSensitivity', 'Right-drag pan speed'],
  ['wheelZoomSensitivity', 'Wheel zoom speed'],
  ['keyboardMoveSensitivity', 'Keyboard movement speed'],
  ['keyboardTurnSensitivity', 'Keyboard turning speed'],
] as const;

/** Layer toggles + camera mode. Stub surface that the scenario tools grow into. */
export function SettingsPanel({
  viewer,
  overlays,
  overlayError,
  settings,
  onSettingsChange,
  onResetDefaults,
  onClose,
  benchRunning,
  onBench,
  actorCount,
  laneCount,
}: SettingsPanelProps): JSX.Element {
  const [mode, setMode] = useState<CameraMode>('orbit');

  const toggle = (key: keyof StudioViewSettings['layers']) => {
    onSettingsChange({ ...settings, layers: { ...settings.layers, [key]: !settings.layers[key] } });
  };

  // Pure visibility flip — the overlay geometry is built once and kept.
  const toggleOverlay = (key: MapOverlayLayer) => {
    onSettingsChange({ ...settings, overlays: { ...settings.overlays, [key]: !settings.overlays[key] } });
  };

  return (
    <aside style={styles.panel} data-testid="settings-panel" aria-label="Settings">
      <div style={styles.panelHeader}>
        <div>
          <div style={styles.eyebrow}>Studio</div>
          <div style={styles.title}>Settings</div>
        </div>
        <button type="button" aria-label="Close settings" style={styles.close} onClick={onClose}>×</button>
      </div>

      <div style={styles.heading}>Scene visibility</div>
      {(['city', 'vegetation', 'road'] as const).map((key) => (
        <label key={key} style={styles.check}>
          <input type="checkbox" checked={settings.layers[key]} onChange={() => toggle(key)} />
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
            checked={settings.overlays[key]}
            disabled={!overlays}
            onChange={() => toggleOverlay(key)}
          />
          <span>{key === 'lanes' ? 'Road overlay' : 'Traffic-light overlay'}</span>
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

      <div style={{ ...styles.heading, marginTop: 10 }}>Controls</div>
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
            {value === 'orbit' ? 'city' : 'free'}
          </button>
        ))}
      </div>
      <div style={styles.hint}>
        {mode === 'orbit'
          ? 'WASD pan · Q/E look · left-drag look · middle/right-drag pan · wheel zoom'
          : 'click to look · WASD/QE · shift boost'}
      </div>
      <div data-testid="camera-control-preferences">
        {([
          ['reverseHorizontalLook', 'Reverse horizontal look'],
          ['reverseVerticalLook', 'Reverse vertical look'],
          ['reversePanDirection', 'Reverse pan direction'],
        ] as const).map(([key, label]) => (
          <label key={key} style={styles.check}>
            <input
              type="checkbox"
              data-testid={`camera-control-${key}`}
              checked={settings.controls[key]}
              onChange={() => onSettingsChange({
                ...settings,
                controls: { ...settings.controls, [key]: !settings.controls[key] },
              })}
            />
            <span>{label}</span>
          </label>
        ))}
        <div style={styles.hint}>
          Reverse look affects left-drag and free-camera mouse look. Reverse pan affects middle/right drag only.
          Q/E direction and WASD direction stay unchanged.
        </div>
        <div style={styles.sensitivityList} data-testid="camera-sensitivity-controls">
          {CAMERA_SENSITIVITIES.map(([key, label]) => (
            <label key={key} style={styles.sensitivity}>
              <span style={styles.sensitivityLabel}>{label}</span>
              <input
                type="range"
                min={25}
                max={300}
                step={5}
                value={settings.controls[key]}
                aria-label={label}
                data-testid={`camera-sensitivity-${key}`}
                onChange={(event) => onSettingsChange({
                  ...settings,
                  controls: { ...settings.controls, [key]: Number(event.target.value) },
                })}
                style={styles.sensitivityRange}
              />
              <output style={styles.sensitivityValue}>{settings.controls[key]}%</output>
            </label>
          ))}
        </div>
        <div style={styles.hint}>
          Keyboard movement controls WASD in both modes. Keyboard turning controls Q/E while using the city camera.
        </div>
        <button
          type="button"
          data-testid="reset-camera-controls"
          style={{ ...styles.button, width: '100%', marginTop: 8 }}
          onClick={() => onSettingsChange({
            ...settings,
            controls: { ...DEFAULT_STUDIO_VIEW_SETTINGS.controls },
          })}
        >
          Reset camera controls
        </button>
      </div>

      <PerformancePanel
        viewer={viewer}
        overlays={overlays}
        actorCount={actorCount}
        diagnosticsEnabled={settings.debugGraphics}
      />

      <div style={styles.debugSection}>
        <label style={styles.debugToggle}>
          <span>
            <strong>Debug graphics</strong>
            <small>FPS, frame pacing, render counters and viewport helpers</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            data-testid="debug-graphics-toggle"
            checked={settings.debugGraphics}
            onChange={() => onSettingsChange({ ...settings, debugGraphics: !settings.debugGraphics })}
          />
        </label>
        {settings.debugGraphics ? (
          <div data-testid="debug-diagnostics">
            <div data-testid="camera-effective-sensitivities" style={styles.sensitivityDebug}>
              {CAMERA_SENSITIVITIES.map(([key, label]) => `${label}: ${settings.controls[key]}%`).join(' · ')}
            </div>
            <button
              type="button"
              data-testid="reset-camera-constraints"
              style={{ ...styles.button, width: '100%', marginTop: 10 }}
              disabled={!viewer || typeof (viewer as CityViewer & { resetCamera?: () => void }).resetCamera !== 'function'}
              onClick={() => (viewer as CityViewer & { resetCamera?: () => void } | null)?.resetCamera?.()}
            >
              Reset camera / constraints
            </button>
            <button
              type="button"
              style={{ ...styles.button, width: '100%', marginTop: 10 }}
              disabled={!viewer || benchRunning}
              onClick={onBench}
            >
              {benchRunning ? 'benchmarking…' : 'run benchmark'}
            </button>
            <Hud viewer={viewer} />
          </div>
        ) : null}
      </div>
      <button type="button" style={styles.reset} onClick={onResetDefaults}>Reset defaults</button>
    </aside>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    height: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
    padding: '14px',
    borderRadius: 10,
    background: 'rgba(20, 23, 29, 0.98)',
    border: '1px solid rgba(255,255,255,0.08)',
    backdropFilter: 'blur(8px)',
    userSelect: 'none',
  },
  panelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  eyebrow: { color: '#737d8d', fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  title: { color: '#eef2f7', fontSize: 17, fontWeight: 680 },
  close: { border: 0, background: 'transparent', color: '#9da6b4', fontSize: 22, cursor: 'pointer' },
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
  sensitivityList: { display: 'grid', gap: 8, marginTop: 12 },
  sensitivity: { display: 'grid', gridTemplateColumns: '1fr 92px 42px', alignItems: 'center', gap: 7 },
  sensitivityLabel: { color: '#cbd1da', fontSize: 11 },
  sensitivityRange: { width: '100%', accentColor: '#f28b32' },
  sensitivityValue: { color: '#aab2bf', fontSize: 10, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  sensitivityDebug: { marginTop: 9, color: '#7f8998', fontSize: 10, lineHeight: 1.5 },
  debugSection: { marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.08)' },
  debugToggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' },
  reset: { width: '100%', marginTop: 16, padding: '7px 9px', borderRadius: 6, border: '1px solid rgba(255,255,255,.12)', background: 'transparent', color: '#aab2bf', font: 'inherit', cursor: 'pointer' },
};
