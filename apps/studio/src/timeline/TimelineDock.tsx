import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { Interaction, Verb } from '@uniscenarios/scenario-model';
import type { EditorController, EditorState } from '../editor/controller';
import type { StudioSessionApi } from '../session/useStudioSession';
import type { TraceOutcomeMarker, TimelineActorGroup, TimelineItem, TimelineTrackKind } from './model';
import { buildTimelineGroups, moveInteraction, newSpeedInteraction, triggerLabel } from './model';
import { createInteractionDraft, defaultTargetJson, draftFromInteraction, interactionFromDraft, type InteractionDraft } from './editor';

const TRACK_LABEL: Record<TimelineTrackKind, string> = { speed: 'Speed', actions: 'Actions' };
const TRACKS: readonly TimelineTrackKind[] = ['speed', 'actions'];

export interface TimelineSpeedSeries {
  readonly times: readonly number[];
  readonly kph: readonly number[];
}

export type TimelineClickSurface = 'actor-header' | 'speed-row' | 'actions-row';

export type TimelineActorIconKind = 'car' | 'truck' | 'bus' | 'motorcycle' | 'bicycle' | 'pedestrian' | 'object' | 'scooter' | 'animal';

export interface TimelineActorIcon {
  readonly kind: TimelineActorIconKind;
  readonly glyph: string;
  readonly label: string;
}

/** Catalog identity refines legacy roles whose broad actor class is only `car`. */
export function timelineActorIcon(actorClass: TimelineActorGroup['actorClass'], catalogId?: string): TimelineActorIcon {
  const catalog = catalogId?.toLowerCase() ?? '';
  let kind: TimelineActorIconKind;
  if (actorClass === 'static_object') kind = 'object';
  else if (actorClass === 'pedestrian') kind = 'pedestrian';
  else if (actorClass === 'bicycle' || /bicycle|cyclist/.test(catalog)) kind = 'bicycle';
  else if (actorClass === 'motorcycle' || /motorcycle|motorbike/.test(catalog)) kind = 'motorcycle';
  else if (actorClass === 'scooter') kind = 'scooter';
  else if (actorClass === 'animal') kind = 'animal';
  else if (actorClass === 'bus' || /(^|[._-])bus([._-]|$)|tram/.test(catalog)) kind = 'bus';
  else if (actorClass === 'truck' || actorClass === 'van' || /truck|van|lorry|ambulance|fire_engine/.test(catalog)) kind = 'truck';
  else kind = 'car';
  return {
    kind,
    glyph: { car: '🚗', truck: '🚚', bus: '🚌', motorcycle: '🏍', bicycle: '🚲', pedestrian: '🚶', object: '📦', scooter: '🛴', animal: '🐾' }[kind],
    label: { car: 'Car', truck: 'Truck or van', bus: 'Bus', motorcycle: 'Motorcycle', bicycle: 'Bicycle or cyclist', pedestrian: 'Pedestrian', object: 'Object or prop', scooter: 'Scooter', animal: 'Animal' }[kind],
  };
}

/** Camera intent is deliberately narrower than timeline selection/edit intent. */
export function cameraActorForTimelineClick(surface: TimelineClickSurface, actorId: string): string | null {
  return surface === 'actor-header' ? actorId : null;
}

export interface TimelineDockProps {
  controller: EditorController | null;
  editorState: EditorState | null;
  session: StudioSessionApi;
  outcomes?: readonly TraceOutcomeMarker[];
  achievedSpeeds?: Readonly<Record<string, TimelineSpeedSeries>>;
  rightInset?: number;
  drawerMode?: boolean;
  /** Only the actor-name affordance requests camera framing/details. */
  onActorInspect?: (actorId: string) => void;
  /** Lets the host dismiss actor-specific chrome after canonical deletion. */
  onActorDelete?: (actorId: string) => void;
  dashCameras?: readonly { id: string; label: string }[];
  selectedDashCameraId?: string | null;
  onDashCameraChange?: (id: string) => void;
  onCameraPlay?: () => void;
  onPlayPause?: () => void;
}

export function TimelineDock({ controller, editorState, session, outcomes = [], achievedSpeeds = {}, rightInset = 16, drawerMode = false, onActorInspect, onActorDelete, dashCameras = [], selectedDashCameraId = null, onDashCameraChange, onCameraPlay, onPlayPause }: TimelineDockProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [selectedInteraction, setSelectedInteraction] = useState<string | null>(null);
  const [draft, setDraft] = useState<InteractionDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectedActor, setInspectedActor] = useState<string | null>(null);
  const [advancedDuration, setAdvancedDuration] = useState(false);
  const template = controller?.doc.data ?? null;
  const duration = template?.choreography.clipSeconds ?? session.state.duration;
  const groups = useMemo(() => template ? buildTimelineGroups(template) : [], [template]);
  const readonly = session.state.mode !== 'authoring';

  const inspectActor = (actorId: string): void => {
    const cameraActor = cameraActorForTimelineClick('actor-header', actorId);
    if (!cameraActor) return;
    setInspectedActor(cameraActor);
    onActorInspect?.(cameraActor);
  };

  useEffect(() => {
    if (!readonly) return;
    setDraft(null); setDraftError(null); setNotice(null);
  }, [readonly]);

  const selectItem = (item: TimelineItem): void => {
    setSelectedInteraction(item.interaction.id);
    setDraft(draftFromInteraction(item.interaction));
    setDraftError(null); setNotice(null);
    controller?.setSelection([item.actorId]);
  };

  const openNew = (actorId?: string, verb: Verb = 'speed', time = session.state.time): void => {
    if (!controller || readonly || groups.length === 0) {
      setNotice(!controller ? 'The scenario is still loading.' : readonly ? 'Actions are locked during playback. Press Escape to return to authoring.' : 'Add an actor before programming it.');
      return;
    }
    const actor = actorId ?? editorState?.selection.find((id) => groups.some((group) => group.actorId === id)) ?? groups[0]!.actorId;
    const existing = new Set(controller.doc.data.choreography.interactions.map((item) => item.id));
    let ordinal = existing.size + 1;
    let next = createInteractionDraft(actor, time, ordinal);
    while (existing.has(next.id)) next = createInteractionDraft(actor, time, ++ordinal);
    next.verb = verb;
    next.label = verb === 'speed' ? 'Set speed' : actionName(verb, JSON.parse(defaultTargetJson(verb, actor)) as Record<string, unknown>);
    next.targetJson = defaultTargetJson(verb, actor);
    setExpanded(true); setSelectedInteraction(null); setDraft(next); setDraftError(null); setNotice(null);
  };

  const saveDraft = (): void => {
    if (!controller || !draft || readonly) return;
    const result = interactionFromDraft(draft);
    if (!result.ok) { setDraftError(result.error); return; }
    if (selectedInteraction && controller.doc.data.choreography.interactions.some((item) => item.id === selectedInteraction)) controller.doc.replaceInteraction(selectedInteraction, result.interaction);
    else controller.doc.addInteraction(result.interaction);
    setSelectedInteraction(result.interaction.id); setDraft(draftFromInteraction(result.interaction)); setDraftError(null);
  };

  const addAt = (actorId: string, track: TimelineTrackKind, event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!controller || readonly || event.detail > 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, Math.min(duration, ((event.clientX - bounds.left) / bounds.width) * duration));
    if (track === 'actions') { openNew(actorId, 'changeLane', time); return; }
    addSpeedPoint(actorId, time);
  };

  const addSpeedPoint = (actorId: string, time = session.state.time): void => {
    if (!controller || readonly) return;
    const interaction = newSpeedInteraction(actorId, Math.max(0, Math.min(duration, time)), controller.doc.data.choreography.interactions.length + 1);
    controller.doc.addInteraction(interaction);
    selectItem({ interaction, actorId, track: 'speed', anchorTime: time, endTime: Math.min(duration, time + 1), unresolved: false });
  };

  const deleteSelected = (): void => {
    if (!controller || readonly || !selectedInteraction) return;
    controller.doc.removeInteraction(selectedInteraction); setSelectedInteraction(null); setDraft(null);
  };

  const deleteActor = (actorId: string): void => {
    if (!controller || readonly) return;
    const removedInteractionIds = new Set(controller.doc.data.choreography.interactions.filter((item) => item.actor === actorId).map((item) => item.id));
    controller.setSelection((editorState?.selection ?? []).filter((id) => id !== actorId));
    controller.doc.remove([actorId]);
    if (inspectedActor === actorId) setInspectedActor(null);
    if (selectedInteraction && removedInteractionIds.has(selectedInteraction)) {
      setSelectedInteraction(null);
      setDraft(null);
      setDraftError(null);
    }
    onActorDelete?.(actorId);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (readonly || isFormField(event.target)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedInteraction) { event.preventDefault(); deleteSelected(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? controller?.redo() : controller?.undo(); }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  });

  return <section style={{ ...styles.dock, width: drawerMode && !expanded ? 124 : '100%', height: drawerMode && !expanded ? 44 : '100%' }} data-testid="timeline-dock" data-layout={drawerMode ? 'drawer' : 'sidebar'}>
    <div style={styles.transport}>
      <strong style={styles.timelineTitle}>Timeline</strong>
      <button type="button" aria-label={session.state.mode === 'playing' ? 'Pause simulation' : 'Play simulation'} title="Play without changing the editor camera" style={styles.transportButton} onClick={onPlayPause ?? session.playPause} disabled={!controller || session.state.mode === 'preparing'} data-testid="session-play-pause">{session.state.mode === 'playing' ? '❚❚' : '▶'}</button>
      <button
        type="button"
        aria-label={session.state.mode === 'playing' ? 'Pause camera playback' : 'Play from dash camera'}
        title={dashCameras.length === 0 ? 'Add a dash camera to an actor to use Camera Play' : 'Play from the selected actor dash camera'}
        style={{ ...styles.transportButton, ...styles.cameraPlayButton }}
        onClick={session.state.mode === 'playing' ? session.playPause : onCameraPlay}
        disabled={!controller || session.state.mode === 'preparing' || dashCameras.length === 0 || !onCameraPlay}
        data-testid="session-camera-play"
      >{session.state.mode === 'playing' ? '❚❚' : '▣▶'}</button>
      {dashCameras.length > 1 ? <select
        aria-label="Dash camera for Camera Play"
        title="Dash camera for Camera Play"
        value={selectedDashCameraId ?? dashCameras[0]?.id ?? ''}
        disabled={readonly}
        onChange={(event) => onDashCameraChange?.(event.target.value)}
        style={styles.cameraSelect}
        data-testid="session-camera-select"
      >{dashCameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select> : null}
      {dashCameras.length === 0 ? <span style={styles.noCamera} data-testid="session-no-camera">No dash camera</span> : null}
      <span style={styles.time}>{session.state.time.toFixed(2)} / {duration.toFixed(2)} s</span>
      <input type="range" min={0} max={duration} step={0.01} value={session.state.time} disabled={session.state.mode === 'authoring' || session.state.mode === 'preparing' || session.state.mode === 'error'} onChange={(event) => session.seek(Number(event.target.value))} style={styles.scrubber} aria-label="Scenario time" data-testid="session-scrubber" />
      {drawerMode ? <button type="button" style={styles.collapse} aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'} onClick={() => setExpanded((value) => !value)}>{expanded ? '‹' : '›'}</button> : null}
    </div>
    {notice ? <div style={styles.notice} role="status">{notice}</div> : null}
    {session.state.error ? <div style={styles.error} role="alert"><strong>Simulation could not start.</strong> {session.state.error} Press Play to retry or Escape to reset.</div> : null}
    {expanded ? <div style={styles.timelineBody}>
      <div style={styles.labels}>
        <div style={styles.rulerLabel}>Actors</div>
        {groups.flatMap((group) => {
          const icon = timelineActorIcon(group.actorClass, group.catalogId);
          return [
            <div key={`${group.actorId}:actor`} style={{ ...styles.actorHeader, ...((inspectedActor === group.actorId || editorState?.selection.includes(group.actorId)) ? styles.actorSelected : null) }} data-compact={group.compact || undefined} data-testid={`timeline-actor-row-${group.actorId}`}>
              <button type="button" style={styles.actorLabel} onClick={() => inspectActor(group.actorId)} aria-label={`Select and frame ${group.label}`} data-testid={`timeline-actor-${group.actorId}`}>
                <span role="img" aria-label={`${icon.label} icon`} data-icon-kind={icon.kind} style={styles.actorIcon}>{icon.glyph}</span><span style={styles.actorName}>{group.label}</span>
              </button>
              {!readonly ? <button type="button" style={styles.actorDelete} aria-label={`Delete ${group.label}`} title={`Delete ${group.label}`} data-testid={`timeline-delete-actor-${group.actorId}`} onClick={(event) => { event.stopPropagation(); deleteActor(group.actorId); }}><span aria-hidden="true">🗑</span></button> : null}
            </div>,
            ...(group.compact ? [] : TRACKS.map((track) => <div key={`${group.actorId}:${track}`} style={styles.trackLabel}><span>{TRACK_LABEL[track]}</span><button type="button" style={styles.rowAdd} disabled={readonly} onClick={() => track === 'speed' ? addSpeedPoint(group.actorId) : openNew(group.actorId, 'changeLane')} aria-label={`Add ${track === 'speed' ? 'speed point' : 'action'} for ${group.label}`} data-testid={`timeline-add-${group.actorId}-${track}`}>＋</button></div>)),
            ...(!group.compact && advancedDuration ? [<div key={`${group.actorId}:duration`} style={styles.advancedLabel}>Active duration</div>] : []),
          ];
        })}
        <button type="button" style={styles.advancedToggle} onClick={() => setAdvancedDuration((value) => !value)}>{advancedDuration ? 'Hide' : 'Advanced'} active duration</button>
      </div>
      <div style={styles.canvas}>
        <Ruler duration={duration} />
        {groups.flatMap((group) => [
          <div key={`${group.actorId}:spacer`} style={styles.actorSpacer} data-compact={group.compact || undefined} data-testid={group.compact ? `timeline-object-${group.actorId}` : undefined} />,
          ...(group.compact ? [] : TRACKS.map((track) => <div key={`${group.actorId}:${track}`} style={styles.track} onDoubleClick={(event) => addAt(group.actorId, track, event)} data-testid={`timeline-${group.actorId}-${track}`}>
            {track === 'speed' ? <SpeedCurve group={group} duration={duration} initialKph={initialSpeedKph(template, group.actorId)} achieved={achievedSpeeds[group.actorId]} /> : null}
            {group.tracks[track].map((item) => <TimelineClip key={item.interaction.id} item={item} duration={duration} readonly={readonly} selected={selectedInteraction === item.interaction.id} onSelect={() => selectItem(item)} onMove={(time) => controller?.doc.replaceInteraction(item.interaction.id, moveInteraction(item.interaction, time))} onDelete={() => { controller?.doc.removeInteraction(item.interaction.id); setSelectedInteraction(null); setDraft(null); }} />)}
            {outcomes.filter((marker) => marker.actorId === group.actorId).map((marker, index) => <span key={`${marker.kind}:${index}`} title={marker.label ?? marker.kind} style={{ ...styles.outcome, left: `${(marker.time / duration) * 100}%` }} />)}
          </div>)),
          ...(!group.compact && advancedDuration ? [<div key={`${group.actorId}:duration`} style={styles.durationTrack}><span style={styles.durationBar}>Present for full scenario</span></div>] : []),
        ])}
        <div style={{ ...styles.playhead, left: `${(session.state.time / duration) * 100}%` }} />
      </div>
    </div> : null}
    {draft ? <InteractionEditor draft={draft} interaction={selectedInteraction ? template?.choreography.interactions.find((item) => item.id === selectedInteraction) : undefined} interactions={template?.choreography.interactions ?? []} roles={groups.map((group) => ({ id: group.actorId, label: group.label }))} error={draftError} readOnly={readonly} editing={selectedInteraction !== null} rightInset={rightInset} onChange={(patch) => { setDraft((current) => current ? { ...current, ...patch } : current); setDraftError(null); }} onSave={saveDraft} onDelete={deleteSelected} onClose={() => { setDraft(null); setDraftError(null); }} /> : null}
  </section>;
}

function InteractionEditor({ draft, interaction, interactions, roles, error, readOnly, editing, rightInset, onChange, onSave, onDelete, onClose }: { draft: InteractionDraft; interaction?: Interaction; interactions: readonly Interaction[]; roles: readonly { id: string; label: string }[]; error: string | null; readOnly: boolean; editing: boolean; rightInset: number; onChange: (patch: Partial<InteractionDraft>) => void; onSave: () => void; onDelete: () => void; onClose: () => void }): JSX.Element {
  const drawer = useRef<HTMLElement>(null);
  const number = (key: keyof InteractionDraft) => (event: ChangeEvent<HTMLInputElement>) => onChange({ [key]: Number(event.target.value) } as Partial<InteractionDraft>);
  const text = (key: keyof InteractionDraft) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ [key]: event.target.value } as Partial<InteractionDraft>);
  const setVerb = (verb: Verb): void => onChange({ verb, targetJson: defaultTargetJson(verb, draft.actor), label: verb === 'speed' ? 'Set speed' : actionName(verb, JSON.parse(defaultTargetJson(verb, draft.actor)) as Record<string, unknown>) });
  const applyPreset = (value: string): void => {
    const preset = actionPreset(value, draft.actor);
    onChange({ verb: preset.verb, targetJson: JSON.stringify(preset.target), label: preset.label });
  };
  const preset = actionPresetId(draft.verb, interaction?.target ?? safeObject(draft.targetJson));
  const target: Record<string, unknown> = interaction
    ? interaction.target as unknown as Record<string, unknown>
    : safeObject(draft.targetJson);
  const patchTarget = (patch: Record<string, unknown>): void => onChange({ targetJson: JSON.stringify({ ...safeObject(draft.targetJson), ...patch }) });
  return <aside ref={drawer} id="timeline-interaction-editor" role="dialog" aria-label={editing ? 'Edit timeline event' : 'Add timeline event'} style={{ ...styles.editor, right: Math.max(16, rightInset) }} onKeyDown={(event: ReactKeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} data-testid="interaction-editor">
    <div style={styles.editorHeader}><div><strong>{draft.verb === 'speed' ? 'Speed point' : 'Action'}</strong><div style={styles.editorContext}>{roles.find((role) => role.id === draft.actor)?.label ?? draft.actor}</div></div><button type="button" onClick={onClose} style={styles.close} aria-label="Close">×</button></div>
    {readOnly ? <div style={styles.readOnlyNotice}>Playback is active. Press Escape to edit.</div> : null}
    <label style={styles.field}><span>Actor</span><select value={draft.actor} onChange={text('actor')} disabled={readOnly} data-testid="interaction-actor">{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label>
    <label style={styles.field}><span>Row</span><select value={draft.verb === 'speed' || draft.verb === 'gap' ? 'speed' : 'actions'} onChange={(event) => setVerb(event.target.value === 'speed' ? 'speed' : 'changeLane')} disabled={readOnly}><option value="speed">Speed</option><option value="actions">Actions</option></select></label>
    {draft.verb === 'speed' ? <>
      <label style={styles.field}><span>Command</span><select value={draft.speedMode} onChange={text('speedMode')} disabled={readOnly} data-testid="speed-mode"><option value="absolute">Target speed</option><option value="delta">Change by</option><option value="factor">Multiply by</option><option value="stop">Stop</option><option value="resume">Resume route speed</option><option value="match">Match another actor</option></select></label>
      {!['stop','resume','match'].includes(draft.speedMode) ? <label style={styles.field}><span>{draft.speedMode === 'factor' ? 'Factor' : 'Speed (km/h)'}</span><input type="number" min={draft.speedMode === 'absolute' ? 0 : undefined} step={1} value={draft.speedValue} onChange={number('speedValue')} disabled={readOnly} data-testid="speed-value" /></label> : null}
      {draft.speedMode === 'match' ? <div style={styles.honestWarning}>Matching uses the existing advanced target. Open Advanced to edit its actor reference.</div> : null}
      <label style={styles.field}><span>Transition</span><select value={draft.dynamicsShape} onChange={text('dynamicsShape')} disabled={readOnly}><option value="linear">Linear</option><option value="step">Instant</option><option value="sinusoidal">Smooth</option><option value="cubic">Ease in/out</option></select></label>
      <label style={styles.field}><span>Duration (s)</span><input type="number" min={0.05} max={20} step={0.1} value={draft.dynamicsConstraint === 'time' ? draft.dynamicsValue : 1} onChange={(event) => onChange({ dynamicsConstraint: 'time', dynamicsValue: Number(event.target.value) })} disabled={readOnly} /></label>
    </> : draft.verb === 'gap' ? <>
      <div style={styles.sectionLabel}>Following behavior</div><label style={styles.field}><span>Leader</span><select value={String(target['role'] ?? draft.actor)} onChange={(event) => patchTarget({ role: event.target.value })} disabled={readOnly}>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label><label style={styles.field}><span>Gap (s)</span><input type="number" min={0.1} step={0.1} value={Number(target['value'] ?? 1.5)} onChange={(event) => patchTarget({ value: Number(event.target.value), unit: 'time' })} disabled={readOnly} /></label>
    </> : <>
      <label style={styles.field}><span>Action</span><select value={preset} onChange={(event) => applyPreset(event.target.value)} disabled={readOnly} data-testid="action-preset">
        {preset === 'random_turns' ? <option value="random_turns">Random turns</option> : null}
        <optgroup label="Driving"><option value="lane_left">Change lane left</option><option value="lane_right">Change lane right</option><option value="lane_offset">Drift / lane offset</option><option value="route">Change route</option><option value="follow">Follow at gap</option><option value="yield_on">Yield</option><option value="yield_off">Stop yielding</option></optgroup>
        <optgroup label="Signals & sound"><option value="indicator_left">Indicator left</option><option value="indicator_right">Indicator right</option><option value="indicator_hazard">Hazards</option><option value="indicator_off">Indicators off</option><option value="horn_on">Horn on</option><option value="horn_off">Horn off</option></optgroup>
        <optgroup label="Vehicle"><option value="door_left_open">Open left door</option><option value="door_left_close">Close left door</option><option value="door_right_open">Open right door</option><option value="door_right_close">Close right door</option></optgroup>
        <optgroup label="Pedestrian / cyclist"><option value="gesture_wave">Wave through</option><option value="gesture_halt">Halt gesture</option><option value="gesture_point">Point</option><option value="gesture_phone">Use phone</option><option value="gesture_none">Clear gesture</option></optgroup>
        <optgroup label="Advanced"><option value="active_present">Become present</option><option value="active_absent">Become absent</option><option value="custom">Existing advanced command</option></optgroup>
      </select></label>
      {preset === 'random_turns' ? <div style={styles.honestWarning}>Deterministic turns were resolved once when this actor was placed and saved as an exact lane list. Playback and export do not choose a new random route.</div> : null}
      {draft.verb === 'changeLane' ? <><label style={styles.field}><span>Direction</span><select value={Number(target['dk'] ?? 1) > 0 ? 'left' : 'right'} onChange={(event) => patchTarget({ mode: 'relative', dk: event.target.value === 'left' ? 1 : -1 })} disabled={readOnly}><option value="left">Left</option><option value="right">Right</option></select></label><label style={styles.field}><span>Duration (s)</span><input type="number" min={0.2} step={0.1} value={draft.dynamicsValue} onChange={number('dynamicsValue')} disabled={readOnly} /></label></> : null}
      {draft.verb === 'laneOffset' ? <label style={styles.field}><span>Lane fraction</span><input type="number" min={-1} max={1} step={0.05} value={Number(target['tFrac'] ?? 0.2)} onChange={(event) => patchTarget({ tFrac: Number(event.target.value), reference: 'lane_center' })} disabled={readOnly} /></label> : null}
      {preset === 'custom' ? <div style={styles.honestWarning}>This existing command has no simplified editor yet. Its meaning is preserved; use the Advanced section to inspect or edit it.</div> : null}
    </>}
    <label style={styles.field}><span>Time (s)</span><input type="number" min={0} max={20} step={0.1} value={draft.time} onChange={number('time')} disabled={readOnly || draft.triggerKind !== 'at'} data-testid="interaction-time" /></label>
    <label style={styles.field}><span>Name</span><input value={draft.label} onChange={text('label')} disabled={readOnly} /></label>
    <details style={styles.advancedDetails}><summary>Advanced trigger and command</summary>
      <label style={styles.field}><span>Trigger</span><select value={draft.triggerKind} onChange={text('triggerKind')} disabled={readOnly}><option value="at">At time</option><option value="after">After action</option><option value="when">When condition</option><option value="arrival">Arrival sync</option></select></label>
      {draft.triggerKind === 'after' ? <><label style={styles.field}><span>After</span><select value={draft.afterId} onChange={text('afterId')} disabled={readOnly}><option value="">Choose…</option>{interactions.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.label ?? item.id}</option>)}</select></label><label style={styles.field}><span>Delay (s)</span><input type="number" min={0} step={0.1} value={draft.delayS} onChange={number('delayS')} /></label></> : null}
      {draft.triggerKind === 'when' ? <><label style={styles.field}><span>Deadline</span><input type="number" min={0} max={20} step={0.1} value={draft.byLatest} onChange={number('byLatest')} /></label><label style={styles.fieldStack}><span>Typed condition (advanced)</span><textarea value={draft.conditionJson} onChange={text('conditionJson')} rows={3} /></label></> : null}
      {draft.triggerKind === 'arrival' ? <><label style={styles.field}><span>Sync with</span><select value={draft.syncWith} onChange={text('syncWith')}>{roles.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}</select></label><label style={styles.field}><span>Seconds</span><input type="number" step={0.1} value={draft.arrivalValue} onChange={number('arrivalValue')} /></label></> : null}
      {(preset === 'custom' || draft.speedMode === 'match' || draft.verb === 'route') ? <label style={styles.fieldStack}><span>Typed command (advanced)</span><textarea value={draft.targetJson} onChange={text('targetJson')} rows={4} /></label> : null}
    </details>
    {error ? <div style={styles.editorError} role="alert">{error}</div> : null}
    <div style={styles.editorActions}><button type="button" onClick={onSave} disabled={readOnly} style={styles.save} data-testid="save-interaction">{editing ? 'Update' : 'Add to timeline'}</button>{editing ? <button type="button" onClick={onDelete} disabled={readOnly} style={styles.delete}>Delete</button> : null}</div>
  </aside>;
}

function SpeedCurve({ group, duration, initialKph, achieved }: { group: TimelineActorGroup; duration: number; initialKph: number; achieved?: TimelineSpeedSeries }): JSX.Element {
  const authoredPoints = [{ t: 0, v: initialKph }, ...group.tracks.speed.flatMap((item) => speedValue(item.interaction, initialKph) === null ? [] : [{ t: item.anchorTime, v: speedValue(item.interaction, initialKph) as number }])];
  const lastAuthored = authoredPoints[authoredPoints.length - 1]!;
  const authored = lastAuthored.t < duration ? [...authoredPoints, { t: duration, v: lastAuthored.v }] : authoredPoints;
  const max = Math.max(10, ...authored.map((p) => p.v), ...(achieved?.kph ?? []));
  const points = authored.map((p) => `${(p.t / duration) * 100},${38 - (p.v / max) * 32}`).join(' ');
  const actual = achieved ? achieved.times.map((t, i) => `${(t / duration) * 100},${38 - ((achieved.kph[i] ?? 0) / max) * 32}`).join(' ') : '';
  return <svg viewBox="0 0 100 42" preserveAspectRatio="none" style={styles.speedSvg} aria-label="Authored speed curve">
    <polyline points={points} fill="none" stroke="#55a7ff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    {actual ? <polyline points={actual} fill="none" stroke="#7ee19f" strokeWidth="1" strokeDasharray="2 1" opacity=".9" vectorEffect="non-scaling-stroke" data-testid={`achieved-speed-${group.actorId}`} /> : null}
  </svg>;
}

function TimelineClip({ item, duration, readonly, selected, onSelect, onMove, onDelete }: { item: TimelineItem; duration: number; readonly: boolean; selected: boolean; onSelect: () => void; onMove: (time: number) => void; onDelete: () => void }): JSX.Element {
  const left = (item.anchorTime / duration) * 100;
  const width = item.track === 'speed' ? 3 : Math.max(3, ((item.endTime - item.anchorTime) / duration) * 100);
  const drag = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    onSelect(); if (readonly || event.button !== 0) return;
    const track = event.currentTarget.parentElement; if (!track) return;
    const move = (pointer: MouseEvent): void => {
      const bounds = track.getBoundingClientRect();
      onMove(Math.max(0, Math.min(duration, ((pointer.clientX - bounds.left) / bounds.width) * duration)));
    };
    window.addEventListener('mouseup', move, { once: true });
  };
  return <button type="button" onMouseDown={drag} onDoubleClick={(event) => { event.stopPropagation(); if (!readonly) onDelete(); }} title={`${actionLabel(item.interaction)} · ${triggerLabel(item.interaction.trigger)}${item.unresolved ? ' · condition shown at its deadline' : ''}`} data-trigger={item.interaction.trigger.kind} data-testid={`timeline-item-${item.interaction.id}`} style={{ ...styles.clip, ...triggerStyle(item.interaction), left: `${left}%`, width: `${width}%`, ...(selected ? styles.clipSelected : null) }}><span>{triggerGlyph(item.interaction)} {actionLabel(item.interaction)}</span></button>;
}

function Ruler({ duration }: { duration: number }): JSX.Element { return <div style={styles.ruler}>{Array.from({ length: Math.floor(duration / 5) + 1 }, (_, i) => i * 5).map((tick) => <span key={tick} style={{ ...styles.tick, left: `${(tick / duration) * 100}%` }}>{tick}s</span>)}</div>; }

function actionPreset(id: string, actor: string): { verb: Verb; target: Record<string, unknown>; label: string } {
  const presets: Record<string, { verb: Verb; target: Record<string, unknown>; label: string }> = {
    lane_left: { verb: 'changeLane', target: { mode: 'relative', dk: 1 }, label: 'Change lane left' }, lane_right: { verb: 'changeLane', target: { mode: 'relative', dk: -1 }, label: 'Change lane right' }, lane_offset: { verb: 'laneOffset', target: { tFrac: 0.2, reference: 'lane_center' }, label: 'Drift in lane' }, route: { verb: 'route', target: { mode: 'acquire', pose: { laneOffset: 0, s: 0, tFrac: 0, headingOffsetRad: 0 } }, label: 'Change route' }, follow: { verb: 'gap', target: { role: actor, value: 1.5, unit: 'time' }, label: 'Follow vehicle' }, yield_on: { verb: 'set', target: { key: 'rules.yield', value: true }, label: 'Yield' }, yield_off: { verb: 'set', target: { key: 'rules.yield', value: false }, label: 'Stop yielding' },
    indicator_left: set('lights.indicator','left','Indicator left'), indicator_right: set('lights.indicator','right','Indicator right'), indicator_hazard: set('lights.indicator','hazard','Hazards'), indicator_off: set('lights.indicator','off','Indicators off'), horn_on: set('audio.horn',true,'Horn on'), horn_off: set('audio.horn',false,'Horn off'), door_left_open: set('doors.left','opening','Open left door'), door_left_close: set('doors.left','closing','Close left door'), door_right_open: set('doors.right','opening','Open right door'), door_right_close: set('doors.right','closing','Close right door'), gesture_wave: set('pose.gesture','wave_through','Wave through'), gesture_halt: set('pose.gesture','halt','Halt gesture'), gesture_point: set('pose.gesture','point','Point'), gesture_phone: set('pose.gesture','phone','Use phone'), gesture_none: set('pose.gesture','none','Clear gesture'), active_present: { verb: 'exist', target: { state: 'present' }, label: 'Become present' }, active_absent: { verb: 'exist', target: { state: 'absent' }, label: 'Become absent' },
  };
  return presets[id] ?? presets.lane_left!;
}
function set(key: string, value: unknown, label: string): { verb: 'set'; target: Record<string, unknown>; label: string } { return { verb: 'set', target: { key, value }, label }; }
function actionPresetId(verb: Verb, target: Record<string, unknown>): string {
  if (verb === 'changeLane') return Number(target['dk'] ?? 1) > 0 ? 'lane_left' : 'lane_right';
  if (verb === 'laneOffset') return 'lane_offset'; if (verb === 'route') return target['mode'] === 'lanePath' ? 'random_turns' : 'route'; if (verb === 'gap') return 'follow';
  if (verb === 'exist') return target['state'] === 'present' ? 'active_present' : 'active_absent';
  if (verb !== 'set') return 'custom';
  const key = String(target['key']); const value = target['value'];
  const found = ['indicator_left','indicator_right','indicator_hazard','indicator_off','horn_on','horn_off','door_left_open','door_left_close','door_right_open','door_right_close','gesture_wave','gesture_halt','gesture_point','gesture_phone','gesture_none','yield_on','yield_off'].find((id) => { const p = actionPreset(id, ''); return p.target['key'] === key && p.target['value'] === value; });
  return found ?? 'custom';
}
function actionName(verb: Verb, target: Record<string, unknown>): string { const preset = actionPresetId(verb, target); return preset === 'random_turns' ? 'Random turns' : actionPreset(preset, '').label || verb; }
function actionLabel(interaction: Interaction): string { return interaction.label || actionName(interaction.verb, interaction.target as Record<string, unknown>); }
function safeObject(json: string): Record<string, unknown> { try { const value = JSON.parse(json) as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } }
function speedValue(interaction: Interaction, current: number): number | null { if (interaction.verb !== 'speed') return null; const t = interaction.target; if (t.mode === 'absolute') return typeof t.valueKph === 'number' ? t.valueKph : null; if (t.mode === 'stop') return 0; if (t.mode === 'delta') return typeof t.deltaKph === 'number' ? Math.max(0, current + t.deltaKph) : null; if (t.mode === 'factor') return typeof t.factor === 'number' ? current * t.factor : null; return null; }
function initialSpeedKph(template: { roles: readonly { id: string; initialSpeedKph?: unknown }[] } | null, actorId: string): number { const value = template?.roles.find((role) => role.id === actorId)?.initialSpeedKph; return typeof value === 'number' ? value : 0; }
function isFormField(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement; }
function triggerGlyph(interaction: Interaction): string { return interaction.trigger.kind === 'at' ? '◆' : interaction.trigger.kind === 'after' ? '↳' : interaction.trigger.kind === 'when' ? '◇' : '◎'; }
function triggerStyle(interaction: Interaction): CSSProperties { if (interaction.trigger.kind === 'at') return { background: interaction.verb === 'speed' ? '#286aa8' : '#3276c8', borderColor: '#68a8ed' }; if (interaction.trigger.kind === 'after') return { background: '#6750a4', borderColor: '#9e85e5' }; if (interaction.trigger.kind === 'when') return { background: '#8d5b22', borderColor: '#d89a51', borderStyle: 'dashed' }; return { background: '#166f70', borderColor: '#55b9ba', borderRadius: 999 }; }
const styles: Record<string, CSSProperties> = {
  dock: { position: 'relative', zIndex: 18, overflow: 'hidden', borderRadius: 0, background: 'rgba(23,25,29,.99)', borderRight: '1px solid #3a3e46', boxShadow: '5px 0 24px rgba(0,0,0,.28)', transition: 'width 140ms ease, height 140ms ease', boxSizing: 'border-box' }, transport: { position: 'relative', zIndex: 4, minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid #343841', background: '#1d2025' }, timelineTitle: { color: '#eef2f7', fontSize: 11, letterSpacing: .3 }, transportButton: { flex: '0 0 30px', width: 30, height: 28, borderRadius: 5, border: '1px solid #c66b2c', background: '#8d451b', color: '#fff', cursor: 'pointer' }, cameraPlayButton: { width: 38, flexBasis: 38, borderColor: '#4388c7', background: '#245b89', fontSize: 10 }, cameraSelect: { minWidth: 80, maxWidth: 140, height: 26, border: '1px solid #424b57', borderRadius: 4, background: '#272c33', color: '#dce2ea', fontSize: 9 }, noCamera: { color: '#788391', fontSize: 9, whiteSpace: 'nowrap' }, time: { flex: '0 0 88px', color: '#dfe4eb', fontSize: 10, fontVariantNumeric: 'tabular-nums' }, scrubber: { minWidth: 55, flex: 1, accentColor: '#f07f2f' }, collapse: { flex: '0 0 22px', width: 22, height: 26, border: 0, borderRadius: 4, background: '#292d34', color: '#aab3c1', cursor: 'pointer' }, notice: { position: 'absolute', zIndex: 8, top: 44, left: 8, right: 8, padding: '7px 10px', background: '#4c371b', color: '#ffd89a', fontSize: 10 }, error: { padding: '3px 10px', color: '#ff8d8d', fontSize: 10, background: '#471d24' },
  timelineBody: { height: 'calc(100% - 72px)', minHeight: 180, display: 'grid', gridTemplateColumns: '142px minmax(248px, 1fr)', overflow: 'auto', scrollbarColor: '#4b515b #202329' }, labels: { position: 'sticky', left: 0, zIndex: 3, background: '#202329', borderRight: '1px solid #3a3e46' }, rulerLabel: { position: 'sticky', top: 0, zIndex: 3, height: 24, padding: '5px 8px', boxSizing: 'border-box', color: '#798290', fontSize: 10, background: '#202329' }, actorHeader: { position: 'sticky', left: 0, height: 30, boxSizing: 'border-box', color: '#e0e4eb', background: '#292d34', borderTop: '1px solid #3a3e46', display: 'flex', alignItems: 'center' }, actorLabel: { minWidth: 0, flex: 1, height: 29, padding: '4px 2px 4px 7px', border: 0, color: 'inherit', fontSize: 10, fontWeight: 600, cursor: 'pointer', background: 'transparent', display: 'flex', alignItems: 'center', gap: 5, textAlign: 'left' }, actorIcon: { flex: '0 0 16px', width: 16, textAlign: 'center', fontSize: 12 }, actorName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, actorDelete: { flex: '0 0 25px', width: 25, height: 24, padding: 0, marginRight: 3, border: '1px solid transparent', borderRadius: 4, background: 'transparent', color: '#d99aa4', cursor: 'pointer', fontSize: 12, lineHeight: 1 }, actorSelected: { color: '#fff', background: '#354b69' }, trackLabel: { height: 48, padding: '4px 6px 4px 14px', boxSizing: 'border-box', borderBottom: '1px solid #2c3037', color: '#aeb7c4', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, rowAdd: { width: 25, height: 25, border: '1px solid #46596e', borderRadius: 5, background: '#273748', color: '#83baf0', cursor: 'pointer', fontSize: 16, lineHeight: 1 }, advancedLabel: { height: 24, padding: '5px 8px 5px 14px', boxSizing: 'border-box', color: '#707986', fontSize: 9 }, advancedToggle: { margin: 7, padding: 4, border: '1px solid #363b43', borderRadius: 4, background: 'transparent', color: '#747e8c', fontSize: 9, cursor: 'pointer' },
  canvas: { position: 'relative', minWidth: 248, backgroundImage: 'linear-gradient(to right, rgba(255,255,255,.055) 1px, transparent 1px)', backgroundSize: '25% 100%' }, ruler: { position: 'sticky', top: 0, zIndex: 4, height: 24, borderBottom: '1px solid #424751', background: '#1c1f24' }, tick: { position: 'absolute', top: 4, color: '#87909d', fontSize: 9 }, actorSpacer: { height: 30, background: 'rgba(255,255,255,.035)', borderTop: '1px solid #3a3e46' }, track: { position: 'relative', height: 48, borderBottom: '1px solid #2c3037' }, speedSvg: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: .85, pointerEvents: 'none' }, clip: { position: 'absolute', zIndex: 2, top: 12, height: 24, minWidth: 16, maxWidth: 132, padding: '0 5px', borderWidth: 1, borderStyle: 'solid', borderRadius: 4, color: '#fff', fontSize: 9, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'ew-resize' }, clipSelected: { outline: '2px solid #fff', outlineOffset: 1 }, outcome: { position: 'absolute', zIndex: 3, top: 5, width: 3, height: 38, background: '#ff5e7a', opacity: .65 }, durationTrack: { position: 'relative', height: 24, borderBottom: '1px solid #2c3037' }, durationBar: { position: 'absolute', left: 4, right: 4, top: 6, height: 12, borderRadius: 3, background: '#324035', color: '#83a98b', fontSize: 8, textAlign: 'center' }, playhead: { position: 'absolute', zIndex: 5, top: 0, bottom: 0, width: 1, background: '#ff8551', pointerEvents: 'none', boxShadow: '0 0 4px #ff8551' },
  editor: { position: 'fixed', zIndex: 32, bottom: 104, width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 136px)', overflowY: 'auto', padding: 14, boxSizing: 'border-box', borderRadius: 8, background: '#22262d', border: '1px solid #555c68', boxShadow: '0 12px 36px rgba(0,0,0,.55)', fontSize: 10 }, editorHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, color: '#eef2f7', fontSize: 13 }, editorContext: { marginTop: 3, color: '#9ba4b2', fontSize: 10, fontWeight: 400 }, readOnlyNotice: { marginBottom: 9, padding: 7, borderRadius: 4, background: '#4c371b', color: '#ffd89a' }, close: { border: 0, background: 'transparent', color: '#aab3c1', fontSize: 18, cursor: 'pointer' }, field: { display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: 7, marginBottom: 7, color: '#aab3c1' }, fieldStack: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 7, color: '#9ba4b2' }, sectionLabel: { margin: '9px 0 7px', color: '#e1e6ed', fontWeight: 600 }, honestWarning: { margin: '5px 0 8px', padding: 7, borderRadius: 4, background: '#3c3425', color: '#e7c889', lineHeight: 1.4 }, advancedDetails: { marginTop: 10, padding: 8, border: '1px solid #3d424b', borderRadius: 5, color: '#909aa8' }, editorError: { marginTop: 6, padding: 6, borderRadius: 4, background: '#4c2027', color: '#ff9ba9' }, editorActions: { display: 'flex', gap: 6, marginTop: 10 }, save: { flex: 1, padding: '7px 8px', border: '1px solid #5aa2e8', borderRadius: 5, background: '#286aa8', color: '#fff', cursor: 'pointer' }, delete: { padding: '7px 8px', border: '1px solid #83404a', borderRadius: 5, background: '#52252c', color: '#ffabb8', cursor: 'pointer' },
};
