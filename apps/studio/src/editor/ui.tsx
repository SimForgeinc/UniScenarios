/**
 * Editor chrome: palette, inspector, status bar, map picker.
 *
 * These are the only React components that touch the editor, and they are
 * deliberately thin — every one of them reads {@link EditorState} and calls a
 * controller method. No component owns editing state, so a panel can never
 * disagree with the scene.
 *
 * The controller coalesces its notifications to one per animation frame, so a
 * pointer-move burst during a drag re-renders these at most once a frame; the
 * palette is memoised on the two props that actually change.
 */

import { memo, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { queryCatalog, type CatalogEntry, type CatalogId, type PropClass } from '@uniscenarios/prop-catalog';
import type { EditorController, EditorState } from './controller';
import type { ActorRecord } from './document';
import { MAPS, type MapEntry } from '../maps';

const ACCENT = '#2f6df6';
const PANEL_BG = 'rgba(12, 15, 20, 0.82)';
const BORDER = '1px solid rgba(255,255,255,0.08)';

/** Palette groups, in the order a scenario is usually built. */
const GROUPS: Array<{ label: string; classes: PropClass[] }> = [
  { label: 'Vehicles', classes: ['vehicle'] },
  { label: 'Pedestrians', classes: ['pedestrian'] },
  { label: 'Construction', classes: ['construction'] },
  { label: 'Occluders', classes: ['occluder'] },
  { label: 'Street furniture', classes: ['street'] },
  { label: 'Hazards', classes: ['hazard'] },
];

// ---------------------------------------------------------------- palette

export interface PaletteProps {
  placing: CatalogId | null;
  onPick: (id: CatalogId) => void;
}

/**
 * The catalog, grouped by class.
 *
 * Selecting an entry arms placement mode; selecting it again disarms it, so the
 * palette doubles as the mode indicator and never needs a separate "cancel"
 * affordance.
 */
export const Palette = memo(function Palette({ placing, onPick }: PaletteProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  return (
    <div style={styles.palette} data-testid="palette">
      <div style={styles.heading}>Catalog</div>
      <input
        type="search"
        value={filter}
        placeholder="filter…"
        onChange={(e) => setFilter(e.target.value)}
        style={styles.search}
        data-testid="palette-filter"
      />
      <div style={styles.paletteScroll}>
        {GROUPS.map((group) => {
          const entries = queryCatalog({ class: group.classes }).filter(
            (entry) =>
              needle === '' ||
              entry.label.toLowerCase().includes(needle) ||
              entry.id.toLowerCase().includes(needle),
          );
          if (entries.length === 0) return null;
          return (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={styles.groupLabel}>{group.label}</div>
              {entries.map((entry) => (
                <PaletteItem
                  key={entry.id}
                  entry={entry}
                  active={placing === entry.id}
                  onPick={onPick}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function PaletteItem({
  entry,
  active,
  onPick,
}: {
  entry: CatalogEntry;
  active: boolean;
  onPick: (id: CatalogId) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      title={entry.description}
      data-testid={`palette-${entry.id}`}
      data-active={active ? 'true' : undefined}
      style={{ ...styles.paletteItem, ...(active ? styles.paletteItemActive : null) }}
      onClick={() => onPick(entry.id as CatalogId)}
    >
      <span style={styles.paletteItemLabel}>{entry.label}</span>
      <span style={styles.paletteItemDims}>
        {entry.dims.l.toFixed(1)}×{entry.dims.w.toFixed(1)} m
      </span>
    </button>
  );
}

// -------------------------------------------------------------- map picker

export interface MapPickerProps {
  current: MapEntry;
  loading: boolean;
  onSelect: (map: MapEntry) => void;
}

/** Five maps, keyboard 1-5. Switching parks the current scenario and loads the other one. */
export function MapPicker({ current, loading, onSelect }: MapPickerProps): JSX.Element {
  return (
    <div style={styles.mapPicker} data-testid="map-picker">
      <div style={styles.heading}>Map</div>
      {MAPS.map((map, index) => {
        const active = map.id === current.id;
        return (
          <button
            key={map.id}
            type="button"
            data-testid={`map-${map.id}`}
            data-active={active ? 'true' : undefined}
            disabled={loading && !active}
            style={{ ...styles.mapItem, ...(active ? styles.mapItemActive : null) }}
            onClick={() => onSelect(map)}
          >
            <span style={styles.mapKey}>{index + 1}</span>
            <span style={styles.mapText}>
              <span style={styles.mapLabel}>{map.label}</span>
              <span style={styles.mapLocality}>{map.locality}</span>
            </span>
            {active && loading ? <span style={styles.mapSpinner}>…</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------- inspector

export interface InspectorProps {
  controller: EditorController;
  state: EditorState;
}

/**
 * The selected actor, in both representations.
 *
 * World pose and lane anchor are two views of one placement, so both are
 * editable and each rewrites the other: typing an `s` re-derives the world pose
 * from the lane polyline; typing an `x` re-projects onto the lane, or drops the
 * anchor (loudly) when the actor no longer lands on it.
 */
export function Inspector({ controller, state }: InspectorProps): JSX.Element | null {
  const selection = state.selection;
  if (selection.length === 0) return null;
  if (selection.length > 1) {
    return (
      <div style={styles.inspector} data-testid="inspector">
        <div style={styles.heading}>Selection</div>
        <div style={styles.note}>{selection.length} actors selected</div>
        <div style={styles.note}>G move · R rotate · ⌘D duplicate · ⌫ delete</div>
      </div>
    );
  }
  const actor = state.actors.find((a) => a.id === selection[0]);
  if (!actor) return null;
  return <SingleInspector controller={controller} actor={actor} />;
}

function SingleInspector({
  controller,
  actor,
}: {
  controller: EditorController;
  actor: ActorRecord;
}): JSX.Element {
  const headingDeg = (actor.headingRad * 180) / Math.PI;
  const laneLength = actor.laneRef ? controller.laneLength(actor.laneRef) : null;

  return (
    <div style={styles.inspector} data-testid="inspector">
      <div style={styles.heading}>Inspector</div>
      <TextField
        label="label"
        value={actor.label ?? ''}
        placeholder={actor.catalogId}
        testId="inspector-label"
        onCommit={(value) => controller.setLabel(actor.id, value)}
      />
      <div style={styles.kv}>
        <span style={styles.k}>catalog</span>
        <span style={styles.v}>{actor.catalogId}</span>
      </div>
      <div style={styles.kv}>
        <span style={styles.k}>kind</span>
        <span style={styles.v}>
          {actor.kind}
          {actor.source === 'prop' ? ' (prop)' : ''}
        </span>
      </div>
      <div style={styles.kv}>
        <span style={styles.k}>size</span>
        <span style={styles.v}>
          {actor.dims.l.toFixed(2)} × {actor.dims.w.toFixed(2)} × {actor.dims.h.toFixed(2)} m
        </span>
      </div>

      <div style={{ ...styles.heading, marginTop: 10 }}>World</div>
      <NumberField
        label="x"
        value={actor.x}
        step={0.1}
        testId="inspector-x"
        onCommit={(x) => controller.setWorldPose(actor.id, { x })}
      />
      <NumberField
        label="z"
        value={actor.z}
        step={0.1}
        testId="inspector-z"
        onCommit={(z) => controller.setWorldPose(actor.id, { z })}
      />
      <NumberField
        label="heading°"
        value={headingDeg}
        step={1}
        testId="inspector-heading"
        onCommit={(headingDeg2) => controller.setWorldPose(actor.id, { headingDeg: headingDeg2 })}
      />
      <div style={styles.kv}>
        <span style={styles.k}>y (ground)</span>
        <span style={styles.v}>{actor.y.toFixed(3)} m</span>
      </div>

      <div style={{ ...styles.heading, marginTop: 10 }}>Lane anchor</div>
      {actor.laneRef ? (
        <>
          <div style={styles.kv}>
            <span style={styles.k}>road / section</span>
            <span style={styles.v}>
              {actor.laneRef.roadId} / {actor.laneRef.section}
            </span>
          </div>
          <div style={styles.kv}>
            <span style={styles.k}>lane</span>
            <span style={styles.v}>{actor.laneRef.laneId}</span>
          </div>
          <NumberField
            label="s (m)"
            value={actor.laneRef.s}
            step={0.5}
            testId="inspector-s"
            onCommit={(s) => controller.setLanePose(actor.id, { s })}
          />
          <NumberField
            label="t (m)"
            value={actor.laneRef.t}
            step={0.1}
            testId="inspector-t"
            onCommit={(t) => controller.setLanePose(actor.id, { t })}
          />
          {laneLength === null ? null : (
            <div style={styles.note}>lane is {laneLength.toFixed(1)} m long</div>
          )}
          <div style={styles.note}>
            yaw vs lane {((actor.laneRef.headingOffsetRad * 180) / Math.PI).toFixed(1)}°
          </div>
        </>
      ) : (
        <div style={styles.note}>not anchored — free placement</div>
      )}
    </div>
  );
}

/** A number input that commits on Enter or blur, and reverts on Escape. */
function NumberField({
  label,
  value,
  step,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  testId: string;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(() => format(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(format(value));
  }, [value]);

  const commit = (): void => {
    const parsed = Number(draft);
    editing.current = false;
    if (Number.isFinite(parsed) && Math.abs(parsed - value) > 1e-9) onCommit(parsed);
    else setDraft(format(value));
  };

  return (
    <label style={styles.field}>
      <span style={styles.k}>{label}</span>
      <input
        type="number"
        step={step}
        value={draft}
        data-testid={testId}
        style={styles.input}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            editing.current = false;
            setDraft(format(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  testId,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  testId: string;
  onCommit: (value: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return (
    <label style={styles.field}>
      <span style={styles.k}>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        data-testid={testId}
        style={styles.input}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          editing.current = false;
          if (draft !== value) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

// -------------------------------------------------------------- status bar

export interface StatusBarProps {
  state: EditorState;
  mapLabel: string;
  loading: boolean;
  /** Includes materialized portable actors that are not editable scene records. */
  actorCount?: number;
}

/** One line: what mode you are in, what the modifiers do, what just happened. */
export function StatusBar({ state, mapLabel, loading, actorCount = state.actors.length }: StatusBarProps): JSX.Element {
  const chip =
    state.mode === 'placing'
      ? 'PLACE'
      : state.mode === 'grab'
        ? 'MOVE'
        : state.mode === 'rotate'
          ? 'ROTATE'
          : 'SELECT';
  const chipColor =
    state.mode === 'idle' ? '#4b5565' : state.valid || state.mode !== 'placing' ? ACCENT : '#c0392b';

  return (
    <div style={styles.statusBar} data-testid="status-bar">
      <span style={{ ...styles.chip, background: chipColor }} data-testid="status-mode">
        {chip}
      </span>
      <span style={styles.statusHint} data-testid="status-hint">
        {state.hint}
      </span>
      {state.rotationDeg === null ? null : (
        <span style={styles.readout} data-testid="status-rotation">
          {state.rotationDeg >= 0 ? '+' : ''}
          {state.rotationDeg.toFixed(1)}°
        </span>
      )}
      {state.laneLabel === null ? null : (
        <span style={styles.readout} data-testid="status-lane">
          {state.laneLabel}
        </span>
      )}
      {state.message === null ? null : (
        <span style={styles.statusMessage} data-testid="status-message">
          {state.message}
        </span>
      )}
      <span style={styles.spacer} />
      <span style={styles.readout} data-testid="status-count">
        {actorCount} actor{actorCount === 1 ? '' : 's'}
      </span>
      <span style={styles.readout} data-testid="status-save">
        {loading ? `loading ${mapLabel}…` : state.dirty ? 'saving…' : 'saved'}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ shared

export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return <div style={{ ...styles.panel, ...style }}>{children}</div>;
}

const styles: Record<string, CSSProperties> = {
  panel: {
    padding: '10px 12px',
    borderRadius: 10,
    background: PANEL_BG,
    border: BORDER,
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
  groupLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#5c6675',
    margin: '6px 0 3px',
  },

  palette: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
    padding: '10px 10px 8px',
    borderRadius: 10,
    background: PANEL_BG,
    border: BORDER,
    backdropFilter: 'blur(8px)',
    userSelect: 'none',
  },
  paletteScroll: { overflowY: 'auto', minHeight: 0, paddingRight: 2 },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    marginBottom: 6,
    padding: '4px 6px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: '#e6e9ef',
    font: 'inherit',
    fontSize: 12,
  },
  paletteItem: {
    display: 'flex',
    width: '100%',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
    padding: '4px 6px',
    marginBottom: 2,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'rgba(255,255,255,0.03)',
    color: '#d7dce4',
    font: 'inherit',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
  // Full shorthand, not `borderColor`: React warns (loudly, as a console error)
  // when a shorthand and its longhand are mixed across renders of one element.
  paletteItemActive: { background: ACCENT, border: `1px solid ${ACCENT}`, color: '#fff' },
  paletteItemLabel: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  paletteItemDims: {
    fontSize: 10,
    color: '#8a93a0',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },

  mapPicker: {
    padding: '10px 10px 8px',
    borderRadius: 10,
    background: PANEL_BG,
    border: BORDER,
    backdropFilter: 'blur(8px)',
    userSelect: 'none',
    marginBottom: 8,
  },
  mapItem: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px',
    marginBottom: 2,
    borderRadius: 6,
    border: '1px solid transparent',
    background: 'rgba(255,255,255,0.03)',
    color: '#d7dce4',
    font: 'inherit',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
  mapItemActive: { background: 'rgba(47,109,246,0.22)', border: `1px solid ${ACCENT}` },
  mapKey: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 15,
    height: 15,
    borderRadius: 4,
    background: 'rgba(255,255,255,0.08)',
    fontSize: 10,
    color: '#9aa3b0',
  },
  mapText: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  mapLabel: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  mapLocality: { fontSize: 10, color: '#6d7686' },
  mapSpinner: { marginLeft: 'auto', color: '#9aa3b0' },

  inspector: {
    padding: '10px 12px',
    borderRadius: 10,
    background: PANEL_BG,
    border: BORDER,
    backdropFilter: 'blur(8px)',
    marginBottom: 8,
  },
  kv: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '1px 0' },
  k: { color: '#7c8696', fontSize: 11 },
  v: {
    color: '#e6e9ef',
    fontVariantNumeric: 'tabular-nums',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  field: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 0' },
  input: {
    width: 96,
    padding: '3px 6px',
    borderRadius: 6,
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.05)',
    color: '#e6e9ef',
    font: 'inherit',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  note: { fontSize: 11, color: '#6d7686', marginTop: 4 },

  statusBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    background: 'rgba(8, 10, 14, 0.88)',
    borderTop: BORDER,
    font: '12px/1 ui-sans-serif, system-ui, sans-serif',
    color: '#c3cad4',
    userSelect: 'none',
  },
  chip: {
    padding: '3px 7px',
    borderRadius: 5,
    fontSize: 10,
    letterSpacing: 0.8,
    fontWeight: 600,
    color: '#fff',
  },
  statusHint: { color: '#8f98a6' },
  statusMessage: { color: '#ffb454' },
  readout: { color: '#7c8696', fontVariantNumeric: 'tabular-nums' },
  spacer: { flex: 1 },
};
