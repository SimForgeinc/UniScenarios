import { useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import type { EditorController, EditorState } from './controller';
import type { ActorRecord } from './document';
import type { MapEntry } from '../maps';
import { physicsReasonLabel, physicsSummaryForTrace, type PhysicsDisplaySummary } from '../playback/physics';

const ACCENT = '#5b8cff';
const PANEL = '#202226';
const BORDER = '1px solid #34373d';

export function WorkspaceHeader({
  controller,
  state,
  map,
  playback,
  openScenario = false,
  mapWorkspace = false,
  authoringEnabled,
  settingsOpen,
  onSettings,
  onOpenScenario,
  onMapWorkspace,
  onAuthorWorkspace,
  physicsSummary = physicsSummaryForTrace(null),
}: {
  controller: EditorController | null;
  state: EditorState | null;
  map: MapEntry;
  playback: boolean;
  openScenario?: boolean;
  mapWorkspace?: boolean;
  authoringEnabled: boolean;
  settingsOpen: boolean;
  onSettings: () => void;
  onOpenScenario?: () => void;
  onMapWorkspace?: () => void;
  onAuthorWorkspace?: () => void;
  physicsSummary?: PhysicsDisplaySummary;
}): JSX.Element {
  return (
    <header style={styles.header} data-testid="workspace-header">
      <div style={styles.brandMark}>U</div>
      <div style={styles.brand}>UniScenarios</div>
      <div style={styles.workspaceTabs} aria-label="Workspace">
        <button type="button" onClick={onAuthorWorkspace} style={{ ...styles.workspaceTab, ...(!openScenario && !mapWorkspace ? styles.workspaceTabActive : null) }}>
          Author
        </button>
        <button type="button" onClick={onOpenScenario} style={{ ...styles.workspaceTab, ...(openScenario ? styles.workspaceTabActive : null) }}>
          OpenSCENARIO
        </button>
        <button type="button" data-testid="map-workspace-tab" onClick={onMapWorkspace} style={{ ...styles.workspaceTab, ...(mapWorkspace ? styles.workspaceTabActive : null) }}>
          Map
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
          <HeaderButton
            label="Undo"
            shortcut="⌘Z"
            disabled={!authoringEnabled || !controller || !state?.canUndo}
            onClick={() => controller?.undo()}
          />
          <HeaderButton
            label="Redo"
            shortcut="⇧⌘Z"
            disabled={!authoringEnabled || !controller || !state?.canRedo}
            onClick={() => controller?.redo()}
          />
          <span style={{ ...styles.saveState, color: state?.dirty ? '#f0b45f' : '#8f98a7' }}>
            <span style={{ ...styles.saveDot, background: state?.dirty ? '#f0b45f' : '#62b986' }} />
            {state?.dirty ? 'Saving' : 'Saved'}
          </span>
        </div>
      ) : (
          <span style={styles.playbackBadge}>Read-only playback</span>
      )}
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

export function PhysicsSummaryBadge({ summary }: { summary: PhysicsDisplaySummary }): JSX.Element {
  if (summary.legacyReplay || summary.mode === 'kinematic-v1') {
    return <span style={styles.physicsBadgeLegacy} data-testid="active-physics-mode" title={summary.legacyReplay ? 'Recorded legacy route-following motion' : 'Kinematic-v1 was explicitly selected'}>
      Physics · {summary.legacyReplay ? 'Kinematic legacy' : 'Kinematic selected'}
    </span>;
  }
  const exceptions = summary.actors.filter((actor) => actor.mode !== 'dynamic-v1');
  return <details style={styles.physicsDetails} data-testid="physics-provenance">
    <summary
      style={styles.physicsBadgeDynamic}
      data-testid="active-physics-mode"
      aria-label={`Physics Dynamic${summary.fallbackCount ? `, ${summary.fallbackCount} kinematic fallback${summary.fallbackCount === 1 ? '' : 's'}` : ''}${summary.unknownCount ? `, ${summary.unknownCount} unknown` : ''}`}
    >
      Physics · Dynamic{summary.fallbackCount ? ` · ${summary.fallbackCount} fallback${summary.fallbackCount === 1 ? '' : 's'}` : ''}{summary.unknownCount ? ` · ${summary.unknownCount} unknown` : ''}
    </summary>
    <div style={styles.physicsPopover} role="status" aria-label="Per-actor physics backends">
      <strong>{summary.dynamicCount} dynamic · {summary.fallbackCount} kinematic fallback{summary.fallbackCount === 1 ? '' : 's'}</strong>
      {exceptions.length === 0 ? <span style={styles.physicsNote}>Every recorded actor uses dynamic-v1.</span> : exceptions.map((actor) => (
        <div key={actor.id} style={styles.physicsRow} data-testid={`physics-backend-${actor.id}`}>
          <span>{actor.label}</span>
          <small>{actor.mode === 'kinematic-v1' ? 'Kinematic fallback' : 'Unknown'} · {physicsReasonLabel(actor.reason)}</small>
        </div>
      ))}
    </div>
  </details>;
}

function HeaderButton({
  label,
  shortcut,
  disabled,
  onClick,
}: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      title={`${label} (${shortcut})`}
      disabled={disabled}
      onClick={onClick}
      style={{ ...styles.headerButton, ...(disabled ? styles.disabled : null) }}
    >
      {label}
    </button>
  );
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
  headerButton: {
    border: '1px solid transparent',
    borderRadius: 4,
    background: 'transparent',
    color: '#b7bdc7',
    padding: '4px 8px',
    font: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  saveState: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 10 },
  saveDot: { width: 6, height: 6, borderRadius: '50%' },
  playbackBadge: { color: '#9ba3af', fontSize: 11 },
  physicsBadgeDynamic: { color: '#a9e6c5', background: 'rgba(49, 145, 96, 0.18)', border: '1px solid rgba(94, 204, 143, 0.28)', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 700 },
  physicsBadgeLegacy: { color: '#f2c078', background: 'rgba(164, 106, 31, 0.18)', border: '1px solid rgba(225, 159, 70, 0.3)', borderRadius: 999, padding: '4px 8px', fontSize: 10, fontWeight: 700 },
  physicsDetails: { position: 'relative' },
  physicsPopover: { position: 'absolute', zIndex: 30, top: 30, right: 0, width: 300, display: 'flex', flexDirection: 'column', gap: 7, padding: 10, border: BORDER, borderRadius: 7, background: '#202226', boxShadow: '0 12px 30px rgba(0,0,0,.45)', color: '#dce2ea', fontSize: 10 },
  physicsNote: { color: '#8e98a6' },
  physicsRow: { display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6, borderTop: BORDER },
  settingsButton: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 6, border: '1px solid #34373d', borderRadius: 5, background: '#202226', color: '#b7bdc7', padding: '5px 8px', font: 'inherit', fontSize: 11, cursor: 'pointer' },
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
