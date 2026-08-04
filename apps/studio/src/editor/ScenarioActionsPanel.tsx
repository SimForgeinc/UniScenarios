import type { CSSProperties } from 'react';
import type { ValidationReport } from '@uniscenarios/scenario-model';
import { physicsReasonLabel, type PhysicsDisplaySummary } from '../playback/physics';

export interface ScenarioReadinessSummaryProps {
  validation: ValidationReport;
  physicsSummary: PhysicsDisplaySummary;
}

/** Shared authoring checks now presented inside the OpenSCENARIO workspace. */
export function ScenarioReadinessSummary({ validation, physicsSummary }: ScenarioReadinessSummaryProps): JSX.Element {
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  const warnings = validation.issues.filter((issue) => issue.severity !== 'error');
  return <div style={styles.grid} data-testid="openscenario-authoring-readiness">
    <section style={styles.section} aria-labelledby="template-validation-heading">
      <h2 id="template-validation-heading" style={styles.sectionTitle}>Template validation</h2>
      <div style={{ ...styles.verdict, color: validation.ok ? '#7edb9d' : '#ff8585' }}>
        {validation.ok ? '✓ v2 template is structurally valid' : `${errors.length} blocking issue${errors.length === 1 ? '' : 's'}`}
      </div>
      {validation.issues.length ? <ul style={styles.issues}>
        {[...errors, ...warnings].map((issue, index) => <li key={`${issue.path}:${index}`}>
          <code style={styles.path}>{issue.path || 'scenario'}</code> {issue.message}
        </li>)}
      </ul> : <p style={styles.hint}>Roles, choreography, triggers, and invariants pass schema validation.</p>}
    </section>

    <section style={styles.section} data-testid="physics-export-provenance" aria-labelledby="physics-provenance-heading">
      <h2 id="physics-provenance-heading" style={styles.sectionTitle}>Physics provenance</h2>
      <div style={styles.verdict}>
        {physicsSummary.legacyReplay ? 'Kinematic legacy replay' : `Dynamic v1 · ${physicsSummary.dynamicCount} actor${physicsSummary.dynamicCount === 1 ? '' : 's'}`}
      </div>
      {physicsSummary.actors.map((actor) => <div key={actor.id} style={styles.physicsRow}>
        <code style={styles.path}>{actor.label}</code>
        <span>{actor.mode === 'dynamic-v1' ? `dynamic-v1 · ${actor.profile ?? 'class profile'}` : actor.mode === 'fixed-static-v1' ? 'fixed-static-v1' : actor.mode === 'kinematic-v1' ? 'legacy kinematic-v1' : 'unknown'} · {physicsReasonLabel(actor.reason)}</span>
      </div>)}
      <p style={styles.hint}>The same per-actor backend and reason are retained in canonical trace diagnostics and trajectory-replay export provenance.</p>
    </section>
  </div>;
}

/**
 * Historical authoring-format promises from the retired drawer. They remain
 * visible here so consolidation does not silently imply support that does not
 * exist. Runnable/downloadable formats are controlled by the workspace profile
 * selector and Files section.
 */
export function PlannedAuthoringFormats(): JSX.Element {
  return <section style={styles.section} data-testid="openscenario-planned-formats" aria-labelledby="planned-formats-heading">
    <h2 id="planned-formats-heading" style={styles.sectionTitle}>Additional authoring formats</h2>
    <ExportChoice title="XML 1.4 · editable actions" detail="Preserves supported actions for editing; simulator behavior may vary." />
    <ExportChoice title="DSL 2.2 · editable actions" detail="Semantic DSL profile with an explicitly narrower supported subset." />
    <div style={styles.blocker}>
      <strong>Not connected yet</strong>
      <span>These formats remain fail-closed until the shared materialization result includes a clean semantic-loss report. Use the profile selector above for the currently supported trajectory and esmini bundles.</span>
    </div>
  </section>;
}

function ExportChoice({ title, detail }: { title: string; detail: string }): JSX.Element {
  return <div style={styles.exportChoice} aria-disabled="true">
    <span><strong>{title}</strong><small>{detail}</small></span>
    <span style={styles.ready}>Not supported</span>
  </div>;
}

const styles: Record<string, CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 12 },
  section: { padding: 15, border: '1px solid #30353e', borderRadius: 9, background: '#1a1d23', color: '#e9edf4' },
  sectionTitle: { margin: '0 0 9px', color: '#adb6c3', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' },
  verdict: { fontSize: 12, fontWeight: 650 },
  hint: { margin: '6px 0 0', color: '#8792a0', fontSize: 10, lineHeight: 1.5 },
  issues: { maxHeight: 240, overflowY: 'auto', margin: '8px 0 0', paddingLeft: 18, color: '#dba5a5', fontSize: 10 },
  path: { color: '#9ba7b7' },
  physicsRow: { display: 'grid', gridTemplateColumns: 'minmax(90px, 1fr) 2fr', gap: 8, padding: '5px 0', borderBottom: '1px solid #30343b', color: '#aeb6c2', fontSize: 9 },
  exportChoice: { width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: 9, border: '1px solid #373c44', borderRadius: 6, background: '#20242a', color: '#9ca6b3' },
  ready: { marginLeft: 'auto', flex: '0 0 auto', padding: '2px 5px', borderRadius: 999, background: '#3a3030', color: '#c99191', fontSize: 8, textTransform: 'uppercase' },
  blocker: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, padding: 9, border: '1px solid #62502f', borderRadius: 6, background: '#332b1f', color: '#e9c77d', fontSize: 10, lineHeight: 1.45 },
};
