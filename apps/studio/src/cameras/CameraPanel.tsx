import { useState, type CSSProperties } from 'react';
import type { CameraRegistry } from './controller';
import type { CameraPolicy, CameraPresentation } from './model';

export interface CameraPanelProps {
  registry: CameraRegistry;
  state: CameraPresentation;
  readOnly?: boolean;
}

/** Self-contained integration seam suitable for the Blender-style tool rail drawer. */
export function CameraPanel({ registry, state, readOnly = false }: CameraPanelProps) {
  const [signalId, setSignalId] = useState('');
  return (
    <section aria-label="Authored cameras" style={styles.panel}>
      <header style={styles.header}>
        <strong>Cameras</strong>
        <button disabled={readOnly} onClick={() => registry.addFromCurrent()} style={styles.primary}>+ Current view</button>
      </header>
      <label style={styles.label}>
        View policy
        <select value={state.policy} onChange={(event) => registry.setPolicy(event.target.value as CameraPolicy)} style={styles.input}>
          <option value="editor">Editor</option>
          <option value="authored">Authored camera</option>
          <option value="auto-incident">Auto incident</option>
          <option value="free">Free inspection</option>
        </select>
      </label>
      <div style={styles.signalRow}>
        <input value={signalId} onChange={(event) => setSignalId(event.target.value)} placeholder="Traffic signal id" style={styles.input} />
        <button disabled={readOnly || !signalId.trim()} onClick={() => { registry.addTrafficLightCamera(signalId.trim()); setSignalId(''); }}>Add signal view</button>
      </div>
      <div style={styles.list}>
        {state.cameras.length === 0 && <div style={styles.empty}>No authored cameras yet.</div>}
        {state.cameras.map((camera) => {
          const active = camera.id === state.activeCameraId;
          return (
            <article key={camera.id} style={{ ...styles.card, ...(active ? styles.active : {}) }}>
              <input
                aria-label={`Rename ${camera.name}`}
                defaultValue={camera.name}
                disabled={readOnly}
                onBlur={(event) => registry.rename(camera.id, event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                style={styles.name}
              />
              <div style={styles.meta}>{Math.round(camera.fov)}°{camera.attachment ? ` · ${camera.attachment.kind}` : ''}</div>
              <div style={styles.actions}>
                <button onClick={() => registry.activate(camera.id)}>View</button>
                <button disabled={readOnly} onClick={() => registry.updateFromCurrent(camera.id)}>Update</button>
                <button disabled={readOnly} onClick={() => registry.duplicate(camera.id)}>Duplicate</button>
                <button disabled={readOnly} onClick={() => registry.remove(camera.id)}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { width: 330, padding: 12, color: '#e9eef6', background: 'rgba(20,24,30,.96)', border: '1px solid #3b4654', borderRadius: 8 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  primary: { background: '#297fa6', color: 'white', border: '1px solid #55b8df', borderRadius: 4, padding: '6px 9px' },
  label: { display: 'grid', gap: 4, color: '#aeb9c7', fontSize: 12 },
  input: { minWidth: 0, color: '#eef4fa', background: '#11161c', border: '1px solid #465464', borderRadius: 4, padding: '6px 7px' },
  signalRow: { display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, marginTop: 9 },
  list: { display: 'grid', gap: 7, maxHeight: 360, overflow: 'auto', marginTop: 10 },
  empty: { color: '#8190a0', padding: 10, textAlign: 'center' },
  // Keep border longhands consistent: React warns when a render mixes the
  // `border` shorthand with the active-card `borderColor` override.
  card: { padding: 8, borderWidth: 1, borderStyle: 'solid', borderColor: '#343e4a', borderRadius: 5, background: '#191f27' },
  active: { borderColor: '#48b9e6', boxShadow: 'inset 3px 0 #48b9e6' },
  name: { width: '100%', boxSizing: 'border-box', color: '#f5f8fb', background: 'transparent', border: 0, fontWeight: 600 },
  meta: { color: '#8392a3', fontSize: 11, padding: '3px 2px 7px' },
  actions: { display: 'flex', gap: 5, flexWrap: 'wrap' },
};
