import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { EditorController, EditorState } from './controller';
import type { ActorRecord } from './document';
import type { MapEntry } from '../maps';
import { physicsReasonLabel, physicsSummaryForTrace, type PhysicsDisplaySummary } from '@uniscenarios/playback';

const ACCENT = '#5b8cff';
const PANEL = '#202226';
const BORDER = '1px solid #34373d';

export function WorkspaceHeader({
  state,
  map,
  playback,
  openScenario = false,
  mapWorkspace = false,
  generationsOpen = false,
  settingsOpen,
  onSettings,
  onCopyScenario,
  onOpenScenario,
  onMapWorkspace,
  onGenerations,
  onAuthorWorkspace,
  physicsSummary = physicsSummaryForTrace(null),
}: {
  state: EditorState | null;
  map: MapEntry;
  playback: boolean;
  openScenario?: boolean;
  mapWorkspace?: boolean;
  generationsOpen?: boolean;
  settingsOpen: boolean;
  onSettings: () => void;
  onCopyScenario?: () => Promise<number>;
  onOpenScenario?: () => void;
  onMapWorkspace?: () => void;
  onGenerations?: () => void;
  onAuthorWorkspace?: () => void;
  physicsSummary?: PhysicsDisplaySummary;
}): JSX.Element {
  return (
    <header style={styles.header} data-testid="workspace-header">
      <div style={styles.brandMark}>U</div>
      <div style={styles.brand}>UniScenarios</div>
      <div style={styles.workspaceTabs} aria-label="Workspace">
        <button type="button" onClick={onAuthorWorkspace} style={{ ...styles.workspaceTab, ...(!openScenario && !mapWorkspace && !generationsOpen ? styles.workspaceTabActive : null) }}>
          Author
        </button>
        <button type="button" onClick={onOpenScenario} style={{ ...styles.workspaceTab, ...(openScenario ? styles.workspaceTabActive : null) }}>
          OpenSCENARIO
        </button>
        <button type="button" data-testid="map-workspace-tab" onClick={onMapWorkspace} style={{ ...styles.workspaceTab, ...(mapWorkspace ? styles.workspaceTabActive : null) }}>
          Map
        </button>
        <button type="button" data-testid="generations-workspace-tab" aria-current={generationsOpen ? 'page' : undefined} onClick={onGenerations} style={{ ...styles.workspaceTab, ...(generationsOpen ? styles.workspaceTabActive : null) }}>
          Generations
        </button>
      </div>
      <div style={styles.divider} />
      <div style={styles.sceneIdentity}>
        <span style={styles.sceneEyebrow}>{map.label}</span>
        <span style={styles.sceneName}>{state?.name ?? 'Loading scenario…'}</span>
      </div>
      <div style={styles.headerSpacer} />
      <PhysicsSummaryBadge summary={physicsSummary} />
      {!playback ? (
        <div style={styles.headerActions}>
          <span style={{ ...styles.saveState, color: state?.dirty ? '#f0b45f' : '#8f98a7' }}>
            <span style={{ ...styles.saveDot, background: state?.dirty ? '#f0b45f' : '#62b986' }} />
            {state?.dirty ? 'Saving' : 'Saved'}
          </span>
        </div>
      ) : null}
      <CopyScenarioButton onCopy={onCopyScenario} />
      <button
        type="button"
        aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
        aria-expanded={settingsOpen}
        aria-controls="studio-settings"
        title="Settings"
        onClick={onSettings}
        style={{ ...styles.settingsButton, ...(settingsOpen ? styles.settingsButtonActive : null) }}
      >
        <span aria-hidden="true">⚙</span><span>Settings</span>
      </button>
    </header>
  );
}

export function CopyScenarioButton({ onCopy }: { onCopy?: () => Promise<number> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const copy = async (): Promise<void> => {
    if (!onCopy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      const bytes = await onCopy();
      const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
      setFeedback({ ok: true, text: `Scenario diagnostic copied · ${size}` });
    } catch (reason) {
      setFeedback({ ok: false, text: reason instanceof Error ? reason.message : 'Could not copy the scenario diagnostic.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return <div style={styles.copyScenarioWrap}>
    <style>{'@media (max-width: 820px) { .copy-scenario-label { display: none; } }'}</style>
    <button
      type="button"
      data-testid="copy-scenario"
      aria-label="Copy scenario diagnostic"
      title="Copy scenario diagnostic for support or chat"
      disabled={!onCopy || busy}
      onClick={() => void copy()}
      style={{ ...styles.settingsButton, ...styles.copyScenarioButton, ...(!onCopy || busy ? styles.disabled : null) }}
    >
      <span aria-hidden="true">⧉</span>
      <span className="copy-scenario-label">{busy ? 'Copying…' : 'Copy scenario'}</span>
    </button>
    {feedback ? <span
      role="status"
      aria-live="polite"
      data-testid="copy-scenario-status"
      style={{ ...styles.copyScenarioStatus, color: feedback.ok ? '#b7efce' : '#ffb4bc' }}
    >{feedback.text}</span> : null}
  </div>;
}

export function PhysicsSummaryBadge({ summary }: { summary: PhysicsDisplaySummary }): JSX.Element | null {
  if (summary.legacyReplay || summary.mode === 'kinematic-v1') {
    return <span style={styles.physicsBadgeLegacy} data-testid="active-physics-mode" title={summary.legacyReplay ? 'Recorded legacy route-following motion' : 'Kinematic-v1 was explicitly selected'}>
      Physics · {summary.legacyReplay ? 'Kinematic legacy' : 'Kinematic selected'}
    </span>;
  }
  const exceptions = summary.actors.filter((actor) => actor.mode === null || actor.mode === 'kinematic-v1');
  if (exceptions.length === 0) return null;
  const profileCounts = [...summary.actors.reduce((counts, actor) => {
    if (actor.mode !== 'dynamic-v1' || !actor.profile) return counts;
    counts.set(actor.profile, (counts.get(actor.profile) ?? 0) + 1);
    return counts;
  }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b));
  return <details style={styles.physicsDetails} data-testid="physics-provenance">
    <summary
      style={styles.physicsBadgeLegacy}
      data-testid="active-physics-mode"
      aria-label={`Physics mixed, ${exceptions.length} exceptional actor${exceptions.length === 1 ? '' : 's'}`}
    >
      Physics · Mixed · {exceptions.length} exception{exceptions.length === 1 ? '' : 's'}
    </summary>
    <div style={styles.physicsPopover} role="status" aria-label="Per-actor physics backends">
      <strong>{summary.dynamicCount} class-native dynamic · {summary.staticCount} fixed</strong>
      {profileCounts.length ? <span style={styles.physicsNote}>Profiles · {profileCounts.map(([profile, count]) => `${profile} ${count}`).join(' · ')}</span> : null}
      {exceptions.map((actor) => (
        <div key={actor.id} style={styles.physicsRow} data-testid={`physics-backend-${actor.id}`}>
          <span>{actor.label}</span>
          <small>{actor.mode === 'kinematic-v1' ? 'Legacy kinematic' : 'Unknown'} · {physicsReasonLabel(actor.reason)}</small>
        </div>
      ))}
    </div>
  </details>;
}

export function Outliner({
  controller,
  state,
}: {
  controller: EditorController;
  state: EditorState;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const actors = useMemo(
    () =>
      state.actors.filter((actor) => {
        if (!needle) return true;
        return `${actor.label ?? ''} ${actor.catalogId} ${actor.kind}`.toLowerCase().includes(needle);
      }),
    [state.actors, needle],
  );

  const select = (event: MouseEvent, actor: ActorRecord): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const selected = state.selection.includes(actor.id);
      controller.setSelection(
        selected ? state.selection.filter((id) => id !== actor.id) : [...state.selection, actor.id],
      );
    } else {
      controller.setSelection([actor.id]);
    }
  };

  return (
    <section style={styles.outliner} data-testid="outliner">
      <div style={styles.panelHeader}>
        <span>Scene Collection</span>
        <span style={styles.countBadge}>{state.actors.length}</span>
      </div>
      <div style={styles.outlinerSearchWrap}>
        <span style={styles.searchGlyph}>⌕</span>
        <input
          type="search"
          value={query}
          placeholder="Search actors"
          aria-label="Search actors"
          onChange={(event) => setQuery(event.target.value)}
          style={styles.outlinerSearch}
        />
      </div>
      <div style={styles.outlinerTree}>
        <div style={styles.collectionRow}>
          <span style={styles.disclosure}>▾</span>
          <span style={styles.collectionIcon}>◇</span>
          <span>Actors</span>
        </div>
        {actors.length === 0 ? (
          <div style={styles.emptyState}>{state.actors.length ? 'No matching actors' : 'Place an actor to begin'}</div>
        ) : (
          actors.map((actor) => {
            const selected = state.selection.includes(actor.id);
            return (
              <button
                type="button"
                key={actor.id}
                data-selected={selected || undefined}
                style={{ ...styles.actorRow, ...(selected ? styles.actorRowSelected : null) }}
                onClick={(event) => select(event, actor)}
              >
                <span style={styles.treeGuide} />
                <span style={{ ...styles.actorIcon, color: kindColor(actor) }}>{kindGlyph(actor)}</span>
                <span style={styles.actorName}>{actor.label || actor.catalogId}</span>
                <span style={styles.actorKind}>{actor.kind}</span>
              </button>
            );
          })
        )}
      </div>
      {state.selection.length ? (
        <div style={styles.outlinerFooter}>
          <span>{state.selection.length} selected</span>
          <button type="button" style={styles.textButton} onClick={() => controller.setSelection([])}>
            Clear
          </button>
        </div>
      ) : null}
    </section>
  );
}

function kindGlyph(actor: ActorRecord): string {
  if (actor.kind === 'vehicle') return '▱';
  if (actor.kind === 'pedestrian') return '●';
  return '◆';
}

function kindColor(actor: ActorRecord): string {
  if (actor.kind === 'vehicle') return '#67a2ff';
  if (actor.kind === 'pedestrian') return '#f1b15d';
  return '#9b88e8';
}

const styles: Record<string, CSSProperties> = {
  header: {
    position: 'absolute',
    zIndex: 20,
    inset: '0 0 auto 0',
    height: 42,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    boxSizing: 'border-box',
    background: '#17191d',
    borderBottom: BORDER,
    boxShadow: '0 3px 12px rgba(0,0,0,0.25)',
    userSelect: 'none',
  },
  brandMark: {
    width: 23,
    height: 23,
    display: 'grid',
    placeItems: 'center',
    borderRadius: 5,
    background: '#f07f2f',
    color: '#fff',
    fontSize: 12,
    fontWeight: 800,
  },
  brand: { fontSize: 12, fontWeight: 650, color: '#e8ebf0', letterSpacing: 0.1 },
  workspaceTabs: { display: 'flex', height: '100%', marginLeft: 14 },
  workspaceTab: {
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    borderTop: 0,
    borderLeft: 0,
    borderRight: 0,
    background: 'transparent',
    fontFamily: 'inherit',
    cursor: 'pointer',
    color: '#7f8793',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  workspaceTabActive: { color: '#e7eaf0', borderBottomColor: '#f07f2f', background: '#202226' },
  divider: { width: 1, height: 18, background: '#34373d', margin: '0 4px' },
  sceneIdentity: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  sceneEyebrow: { color: '#717986', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.7 },
  sceneName: { color: '#d5d9e0', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerSpacer: { flex: 1 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 4 },
  saveState: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 10 },
  saveDot: { width: 6, height: 6, borderRadius: '50%' },
  physicsBadgeLegacy: { color: '#f2c078', background: 'rgba(164, 106, 31, 0.18)', border: '1px solid rgba(225, 159, 70, 0.3)', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 700 },
  physicsDetails: { position: 'relative' },
  physicsPopover: { position: 'absolute', zIndex: 30, top: 30, right: 0, width: 300, display: 'flex', flexDirection: 'column', gap: 7, padding: 10, border: BORDER, borderRadius: 7, background: '#202226', boxShadow: '0 12px 30px rgba(0,0,0,.45)', color: '#dce2ea', fontSize: 10 },
  physicsNote: { color: '#8e98a6' },
  physicsRow: { display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6, borderTop: BORDER },
  settingsButton: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6, borderWidth: 1, borderStyle: 'solid', borderColor: '#34373d', borderRadius: 5, background: '#202226', color: '#b7bdc7', padding: '5px 8px', font: 'inherit', fontSize: 11, cursor: 'pointer' },
  copyScenarioWrap: { position: 'relative', display: 'flex', alignItems: 'center' },
  copyScenarioButton: { marginLeft: 2, whiteSpace: 'nowrap' },
  copyScenarioStatus: { position: 'absolute', zIndex: 40, top: 34, right: 0, width: 'max-content', maxWidth: 310, padding: '7px 9px', border: '1px solid #414851', borderRadius: 6, background: 'rgba(24,27,32,.98)', boxShadow: '0 8px 24px rgba(0,0,0,.35)', fontSize: 10, pointerEvents: 'none' },
  settingsButtonActive: { color: '#fff', borderColor: '#f07f2f', background: '#34261d' },
  disabled: { opacity: 0.32, cursor: 'default' },
  outliner: {
    display: 'flex',
    flexDirection: 'column',
    maxHeight: 280,
    minHeight: 118,
    marginBottom: 8,
    borderRadius: 7,
    overflow: 'hidden',
    background: PANEL,
    border: BORDER,
    boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
  },
  panelHeader: {
    height: 30,
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 9px',
    background: '#292b30',
    borderBottom: BORDER,
    color: '#c5cad2',
    fontSize: 10,
    fontWeight: 650,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  countBadge: { marginLeft: 'auto', color: '#747d8a', fontVariantNumeric: 'tabular-nums' },
  outlinerSearchWrap: { position: 'relative', padding: '6px 7px 4px' },
  searchGlyph: { position: 'absolute', left: 14, top: 8, color: '#68717e', fontSize: 14, pointerEvents: 'none' },
  outlinerSearch: {
    width: '100%',
    height: 25,
    boxSizing: 'border-box',
    padding: '3px 7px 3px 25px',
    borderRadius: 4,
    border: '1px solid #393c43',
    background: '#17191d',
    color: '#d8dce3',
    font: 'inherit',
    fontSize: 11,
    outline: 'none',
  },
  outlinerTree: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 5px 6px' },
  collectionRow: { display: 'flex', alignItems: 'center', gap: 5, height: 23, padding: '0 4px', color: '#c6cbd4', fontSize: 11 },
  disclosure: { color: '#7f8792', fontSize: 9 },
  collectionIcon: { color: '#f0a259' },
  actorRow: {
    width: '100%',
    height: 24,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 6px',
    border: 0,
    borderRadius: 3,
    background: 'transparent',
    color: '#bfc5ce',
    font: 'inherit',
    fontSize: 11,
    textAlign: 'left',
    cursor: 'pointer',
  },
  actorRowSelected: { background: '#355b8c', color: '#fff' },
  treeGuide: { width: 14, height: '100%', borderRight: '1px solid #34373d' },
  actorIcon: { width: 12, textAlign: 'center', fontSize: 10 },
  actorName: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actorKind: { color: '#6f7783', fontSize: 9, textTransform: 'uppercase' },
  emptyState: { padding: '16px 12px 18px 31px', color: '#68717e', fontSize: 11 },
  outlinerFooter: { display: 'flex', alignItems: 'center', padding: '5px 8px', borderTop: BORDER, color: '#77808d', fontSize: 10 },
  textButton: { marginLeft: 'auto', padding: 0, border: 0, background: 'transparent', color: ACCENT, font: 'inherit', fontSize: 10, cursor: 'pointer' },
};
