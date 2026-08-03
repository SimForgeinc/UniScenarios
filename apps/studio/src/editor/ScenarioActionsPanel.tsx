import type { CSSProperties } from 'react';
import type { EditorController } from './controller';
import { physicsReasonLabel, type PhysicsDisplaySummary } from '../playback/physics';

export interface ScenarioActionsPanelProps {
  controller: EditorController;
  physicsSummary: PhysicsDisplaySummary;
  onClose: () => void;
}

/**
 * Validation and export readiness live together because export must fail closed
 * on validation or semantic loss. Studio does not yet own the shared concrete
 * materialization result and lane graph, so the export controls deliberately
 * describe that dependency instead of producing a misleading partial file.
 */
export function ScenarioActionsPanel({ controller, physicsSummary, onClose }: ScenarioActionsPanelProps): JSX.Element {
  const report = controller.doc.validation;
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const warnings = report.issues.filter((issue) => issue.severity !== 'error');

  return (
    <aside style={styles.panel} aria-label="Validate and export" data-testid="scenario-actions-panel">
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Scenario readiness</div>
          <strong style={styles.title}>Validate &amp; export</strong>
        </div>
        <button type="button" aria-label="Close validate panel" style={styles.close} onClick={onClose}>×</button>
      </header>

      <section style={styles.section}>
        <div style={styles.sectionTitle}>Template validation</div>
        <div style={{ ...styles.verdict, color: report.ok ? '#7edb9d' : '#ff8585' }}>
          {report.ok ? '✓ v2 template is structurally valid' : `${errors.length} blocking issue${errors.length === 1 ? '' : 's'}`}
        </div>
        {report.issues.length ? (
          <ul style={styles.issues}>
            {[...errors, ...warnings].slice(0, 8).map((issue, index) => (
              <li key={`${issue.path}:${index}`}>
                <code style={styles.path}>{issue.path || 'scenario'}</code> {issue.message}
              </li>
            ))}
          </ul>
        ) : <div style={styles.hint}>Roles, choreography, triggers, and invariants pass schema validation.</div>}
      </section>

      <section style={styles.section} data-testid="physics-export-provenance">
        <div style={styles.sectionTitle}>Physics provenance</div>
        <div style={styles.verdict}>
          {physicsSummary.legacyReplay ? 'Kinematic legacy replay' : `Dynamic v1 · ${physicsSummary.dynamicCount} actor${physicsSummary.dynamicCount === 1 ? '' : 's'}`}
        </div>
        {physicsSummary.fallbackCount > 0 ? <div style={styles.physicsWarning} role="status">
          {physicsSummary.fallbackCount} actor{physicsSummary.fallbackCount === 1 ? '' : 's'} will use explicit kinematic fallback.
        </div> : null}
        {physicsSummary.actors.map((actor) => <div key={actor.id} style={styles.physicsRow}>
          <code style={styles.path}>{actor.label}</code>
          <span>{actor.mode === 'dynamic-v1' ? 'dynamic-v1' : actor.mode === 'kinematic-v1' ? 'kinematic-v1' : 'unknown'} · {physicsReasonLabel(actor.reason)}</span>
        </div>)}
        <div style={styles.hint}>The same per-actor backend and reason are retained in canonical trace diagnostics and trajectory-replay export provenance.</div>
      </section>

      <section style={styles.section}>
        <div style={styles.sectionTitle}>OpenSCENARIO export</div>
        <ExportChoice title="XML 1.4 · trajectory replay" detail="Highest deterministic playback fidelity; causal authoring intent is flattened." />
        <ExportChoice title="XML 1.4 · editable actions" detail="Preserves supported actions for editing; simulator behavior may vary." />
        <ExportChoice title="DSL 2.2 · editable actions" detail="Semantic DSL profile with an explicitly narrower supported subset." />
        <div style={styles.blocker} data-testid="export-dependency">
          <strong>Export pipeline not connected yet</strong>
          <span>
            Studio must receive a materialized SimScenarioInput and the matching LaneGraph from the same
            preparation run. Export remains disabled until that shared result includes a clean semantic-loss
            report; template validation alone is not enough.
          </span>
        </div>
      </section>
    </aside>
  );
}

function ExportChoice({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <button type="button" disabled style={styles.exportChoice} title="Waiting for Studio materialization">
      <span><strong>{title}</strong><small>{detail}</small></span>
      <span style={styles.ready}>Not ready</span>
    </button>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: { width: 370, height: '100%', boxSizing: 'border-box', overflowY: 'auto', color: '#e9edf4', background: 'rgba(24,27,32,.98)', border: '1px solid #3b3f47', borderRadius: 8, boxShadow: '0 18px 48px rgba(0,0,0,.52)' },
  header: { display: 'flex', alignItems: 'center', padding: '13px 14px 11px', borderBottom: '1px solid #373b43' },
  eyebrow: { color: '#f07f2f', fontSize: 9, fontWeight: 750, letterSpacing: .9, textTransform: 'uppercase' },
  title: { fontSize: 15 },
  close: { marginLeft: 'auto', width: 28, height: 28, border: 0, background: 'transparent', color: '#949ca8', fontSize: 22, cursor: 'pointer' },
  section: { padding: '13px 14px', borderBottom: '1px solid #343840' },
  sectionTitle: { marginBottom: 7, color: '#9099a7', fontSize: 10, fontWeight: 700, letterSpacing: .65, textTransform: 'uppercase' },
  verdict: { fontSize: 12, fontWeight: 650 },
  hint: { marginTop: 5, color: '#76808e', fontSize: 10 },
  issues: { margin: '8px 0 0', paddingLeft: 18, color: '#d29a9a', fontSize: 10 },
  path: { color: '#95a1b1' },
  exportChoice: { width: '100%', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '8px', border: '1px solid #373c44', borderRadius: 6, background: '#20242a', color: '#8d96a3', textAlign: 'left' },
  ready: { marginLeft: 'auto', flex: '0 0 auto', padding: '2px 5px', borderRadius: 999, background: '#3a3030', color: '#c99191', fontSize: 8, textTransform: 'uppercase' },
  blocker: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, padding: 9, border: '1px solid #62502f', borderRadius: 6, background: '#332b1f', color: '#e9c77d', fontSize: 10, lineHeight: 1.45 },
  physicsWarning: { margin: '7px 0', color: '#f2c078', fontSize: 10 },
  physicsRow: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) 2fr', gap: 8, padding: '5px 0', borderBottom: '1px solid #30343b', color: '#aeb6c2', fontSize: 9 },
};
