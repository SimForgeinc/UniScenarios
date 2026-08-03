import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { Interaction } from '@uniscenarios/scenario-model';
import type { EditorController, EditorState } from '../editor/controller';
import type { EditorDocument } from '../editor/document';
import type { StudioSessionApi } from '../session/useStudioSession';
import { actionsForActor, definitionForInteraction, interactionForAction, type ActionDefinition } from './actions';
import { buildTimelineGroups, conflictingAction, moveInteraction, triggerLabel, type TimelineActorGroup, type TimelineItem, type TraceOutcomeMarker } from './model';

export interface TimelineSpeedSeries { readonly times: readonly number[]; readonly kph: readonly number[]; }
export type TimelineClickSurface = 'actor-header' | 'speed-row' | 'actions-row';
export type TimelineActorIconKind = 'car' | 'truck' | 'bus' | 'motorcycle' | 'bicycle' | 'pedestrian' | 'object' | 'scooter' | 'animal';
export interface TimelineActorIcon { readonly kind: TimelineActorIconKind; readonly glyph: string; readonly label: string; }
export function timelineActorIcon(actorClass: TimelineActorGroup['actorClass'], catalogId?: string): TimelineActorIcon {
  const catalog = catalogId?.toLowerCase() ?? ''; let kind: TimelineActorIconKind;
  if (actorClass === 'static_object') kind = 'object'; else if (actorClass === 'pedestrian') kind = 'pedestrian'; else if (actorClass === 'bicycle' || /bicycle|cyclist/.test(catalog)) kind = 'bicycle'; else if (actorClass === 'motorcycle' || /motorcycle|motorbike/.test(catalog)) kind = 'motorcycle'; else if (actorClass === 'scooter') kind = 'scooter'; else if (actorClass === 'animal') kind = 'animal'; else if (actorClass === 'bus' || /(^|[._-])bus([._-]|$)|tram/.test(catalog)) kind = 'bus'; else if (actorClass === 'truck' || actorClass === 'van' || /truck|van|lorry|ambulance|fire_engine/.test(catalog)) kind = 'truck'; else kind = 'car';
  return { kind, glyph: { car: '🚗', truck: '🚚', bus: '🚌', motorcycle: '🏍', bicycle: '🚲', pedestrian: '🚶', object: '📦', scooter: '🛴', animal: '🐾' }[kind], label: { car: 'Car', truck: 'Truck or van', bus: 'Bus', motorcycle: 'Motorcycle', bicycle: 'Bicycle or cyclist', pedestrian: 'Pedestrian', object: 'Object or prop', scooter: 'Scooter', animal: 'Animal' }[kind] };
}
export function cameraActorForTimelineClick(surface: TimelineClickSurface, actorId: string): string | null { return surface === 'actor-header' ? actorId : null; }

export interface TimelineDockProps { controller: EditorController | null; editorState: EditorState | null; session: StudioSessionApi; outcomes?: readonly TraceOutcomeMarker[]; achievedSpeeds?: Readonly<Record<string, TimelineSpeedSeries>>; rightInset?: number; drawerMode?: boolean; onActorInspect?: (actorId: string) => void; onActorDelete?: (actorId: string) => void; dashCameras?: readonly { id: string; label: string }[]; selectedDashCameraId?: string | null; onDashCameraChange?: (id: string) => void; onCameraPlay?: () => void; onPlayPause?: () => void; }
interface ActionEditorState { actorId: string; definitionId: string; time: number; duration: number; targetSpeed: number; editingId: string | null; }
export interface TimelineActionDraft extends ActionEditorState {}
export type TimelineActionOutcome = 'pending' | 'executed' | 'missed';
export function timelineActionOutcome(markers: readonly TraceOutcomeMarker[], interactionId: string): TimelineActionOutcome {
  const marker = [...markers].reverse().find((item) => item.interactionId === interactionId);
  if (!marker) return 'pending';
  return marker.kind === 'trigger_fired' ? 'executed' : marker.kind === 'trigger_skipped' ? 'missed' : 'pending';
}
export type TimelineActionSubmitResult =
  | { readonly ok: true; readonly interaction: Interaction }
  | { readonly ok: false; readonly message: string };

/**
 * Commit exactly one dialog draft against the current document revision.
 *
 * Keeping this boundary synchronous is intentional: the document publishes the
 * new revision (and therefore the route overlay) before this function returns;
 * autosave remains debounced in the background.
 */
export function submitTimelineAction(
  document: EditorDocument,
  draft: TimelineActionDraft,
  resolveTurn?: (actorId: string, turn: 'Straight' | 'Left' | 'Right') => readonly string[] | null,
): TimelineActionSubmitResult {
  try {
    const template = document.data;
    const role = template.roles.find((item) => item.id === draft.actorId);
    if (!role) return { ok: false, message: 'This actor no longer exists. Close the dialog and select another actor.' };
    const definition = actionsForActor(role.actor.class, role.actor.catalogId).find((item) => item.id === draft.definitionId);
    if (!definition) return { ok: false, message: 'That action is not available for this actor type.' };
    if (!Number.isFinite(draft.time) || draft.time < 0 || draft.time > template.choreography.clipSeconds) {
      return { ok: false, message: `Start must be between 0 and ${template.choreography.clipSeconds} seconds.` };
    }
    if (!Number.isFinite(draft.duration) || draft.duration < .1 || draft.duration > 20) {
      return { ok: false, message: 'Duration must be between 0.1 and 20 seconds.' };
    }
    if (draft.time + draft.duration > template.choreography.clipSeconds + 1e-9) {
      return { ok: false, message: `This action ends after the ${template.choreography.clipSeconds}-second scenario. Shorten it or move it earlier.` };
    }
    if (definition.id.includes('target_speed') && (!Number.isFinite(draft.targetSpeed) || draft.targetSpeed < 0 || draft.targetSpeed > 200)) {
      return { ok: false, message: 'Speed must be between 0 and 200 km/h.' };
    }
    let customized: ActionDefinition = definition.id.includes('target_speed')
      ? { ...definition, target: { mode: 'absolute', valueKph: draft.targetSpeed } }
      : definition;
    const requestedTurn = definition.id.endsWith('turn_left') ? 'Left' : definition.id.endsWith('turn_right') ? 'Right' : definition.id.endsWith('keep_lane') ? 'Straight' : null;
    if (requestedTurn && resolveTurn) {
      const lanes = resolveTurn(draft.actorId, requestedTurn);
      if (!lanes?.length) return { ok: false, message: `No legal ${requestedTurn.toLowerCase()} movement is reachable from this actor's lane.` };
      customized = { ...customized, target: { mode: 'lanePath', lanes } };
    }
    let ordinal = template.choreography.interactions.length + 1;
    let interaction = interactionForAction({ ...customized, durationS: draft.duration }, draft.actorId, draft.time, ordinal);
    const usedIds = new Set(template.choreography.interactions.map((item) => item.id));
    while (!draft.editingId && usedIds.has(interaction.id)) {
      interaction = interactionForAction({ ...customized, durationS: draft.duration }, draft.actorId, draft.time, ++ordinal);
    }
    if (draft.editingId) interaction = { ...interaction, id: draft.editingId } as Interaction;
    const currentGroup = buildTimelineGroups(template).find((item) => item.actorId === draft.actorId);
    if (!currentGroup) return { ok: false, message: 'The timeline could not find this actor.' };
    const candidate: TimelineItem = {
      interaction,
      actorId: draft.actorId,
      track: 'actions',
      resource: customized.resource,
      anchorTime: draft.time,
      endTime: Math.min(template.choreography.clipSeconds, draft.time + draft.duration),
      unresolved: false,
    };
    const conflict = conflictingAction(candidate, currentGroup.tracks.actions, draft.editingId ?? undefined);
    if (conflict) {
      return { ok: false, message: `${customized.group} action overlaps “${conflict.interaction.label ?? conflict.interaction.id}”. Move one of them so this actor has only one ${customized.resource} action at a time.` };
    }
    if (draft.editingId) document.replaceInteraction(draft.editingId, interaction);
    else document.addInteraction(interaction);
    return { ok: true, interaction };
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : String(reason);
    return { ok: false, message: `Could not add this action: ${detail}` };
  }
}

export function TimelineDock({ controller, editorState, session, outcomes = [], rightInset = 16, drawerMode = false, onActorInspect, onActorDelete, dashCameras = [], selectedDashCameraId = null, onDashCameraChange, onCameraPlay, onPlayPause }: TimelineDockProps): JSX.Element {
  const [expanded, setExpanded] = useState(true); const [selectedInteraction, setSelectedInteraction] = useState<string | null>(null); const [editor, setEditor] = useState<ActionEditorState | null>(null); const [notice, setNotice] = useState<string | null>(null); const [inspectedActor, setInspectedActor] = useState<string | null>(null);
  const template = controller?.doc.data ?? null; const duration = template?.choreography.clipSeconds ?? session.state.duration; const groups = useMemo(() => template ? buildTimelineGroups(template) : [], [template]); const readonly = session.state.mode !== 'authoring';
  useEffect(() => { if (readonly) { setEditor(null); setNotice(null); } }, [readonly]);
  const groupFor = (actorId: string) => groups.find((group) => group.actorId === actorId);
  const openNew = (actorId: string, time = session.state.time): void => { const group = groupFor(actorId); if (!group || readonly) return; const choices = actionsForActor(group.actorClass, group.catalogId); if (!choices.length) return; setEditor({ actorId, definitionId: choices[0]!.id, time: clamp(time, 0, duration), duration: choices[0]!.durationS, targetSpeed: Number(choices[0]!.target.valueKph ?? 30), editingId: null }); setSelectedInteraction(null); setNotice(null); };
  const selectItem = (item: TimelineItem): void => { const group = groupFor(item.actorId); if (!group) return; const choices = actionsForActor(group.actorClass, group.catalogId); const definition = definitionForInteraction(item.interaction, group.actorClass, group.catalogId) ?? choices.find((choice) => choice.verb === item.interaction.verb && choice.resource === item.resource) ?? choices[0]; if (!definition) return; setSelectedInteraction(item.interaction.id); setEditor({ actorId: item.actorId, definitionId: definition.id, time: item.anchorTime, duration: Math.max(.1, item.endTime - item.anchorTime), targetSpeed: item.interaction.verb === 'speed' && item.interaction.target.mode === 'absolute' && typeof item.interaction.target.valueKph === 'number' ? item.interaction.target.valueKph : Number(definition.target.valueKph ?? 30), editingId: item.interaction.id }); controller?.setSelection([item.actorId]); };
  const saveEditor = (): void => {
    if (!editor) { setNotice('The action dialog lost its draft. Close it and try again.'); return; }
    if (!controller) { setNotice('The editor is still loading. Try again in a moment.'); return; }
    if (readonly) { setNotice('Actions can only be changed while authoring.'); return; }
    const result = submitTimelineAction(controller.doc, editor, (actorId, turn) => controller.planTimelineTurn(actorId, turn));
    if (!result.ok) { setNotice(result.message); return; }
    setSelectedInteraction(result.interaction.id);
    setEditor(null);
    setNotice(null);
  };
  const moveItem = (item: TimelineItem, time: number): void => { if (!controller) return; const group = groupFor(item.actorId); if (!group) return; const candidate = { ...item, anchorTime: time, endTime: time + (item.endTime - item.anchorTime) }; const conflict = conflictingAction(candidate, group.tracks.actions, item.interaction.id); if (conflict) { setNotice(`That move would overlap another ${item.resource} action.`); return; } controller.doc.replaceInteraction(item.interaction.id, moveInteraction(item.interaction, time)); setNotice(null); };
  const deleteActor = (actorId: string): void => { if (!controller || readonly) return; controller.setSelection((editorState?.selection ?? []).filter((id) => id !== actorId)); controller.doc.remove([actorId]); if (inspectedActor === actorId) setInspectedActor(null); setSelectedInteraction(null); setEditor(null); onActorDelete?.(actorId); };
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (readonly || isField(event.target)) return; if ((event.key === 'Delete' || event.key === 'Backspace') && selectedInteraction) { event.preventDefault(); controller?.doc.removeInteraction(selectedInteraction); setSelectedInteraction(null); setEditor(null); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? controller?.redo() : controller?.undo(); } }; window.addEventListener('keydown', key, { capture: true }); return () => window.removeEventListener('keydown', key, { capture: true }); });
  return <section style={{ ...styles.dock, width: drawerMode && !expanded ? 124 : '100%', height: drawerMode && !expanded ? 44 : '100%' }} data-testid="timeline-dock" data-layout={drawerMode ? 'drawer' : 'sidebar'}>
    {(template?.choreography.warmupSeconds ?? 0) > 0 ? <div style={styles.notice} title="Actors move during an unrecorded prologue before timeline time zero" data-testid="timeline-warmup">This scenario has a {template!.choreography.warmupSeconds}s unrecorded warmup</div> : null}
    <div style={styles.transport}><strong style={styles.timelineTitle}>Timeline</strong><button type="button" aria-label={session.state.mode === 'playing' ? 'Pause simulation' : 'Play simulation'} style={styles.transportButton} onClick={onPlayPause ?? session.playPause} disabled={!controller || session.state.mode === 'preparing'} data-testid="session-play-pause">{session.state.mode === 'playing' ? '❚❚' : '▶'}</button><button type="button" aria-label={session.state.mode === 'playing' ? 'Pause camera playback' : 'Play from dash camera'} style={{ ...styles.transportButton, ...styles.cameraPlayButton }} onClick={session.state.mode === 'playing' ? session.playPause : onCameraPlay} disabled={!controller || !dashCameras.length || !onCameraPlay} data-testid="session-camera-play">{session.state.mode === 'playing' ? '❚❚' : '▣▶'}</button>{dashCameras.length > 1 ? <select aria-label="Dash camera for Camera Play" value={selectedDashCameraId ?? dashCameras[0]?.id ?? ''} onChange={(event) => onDashCameraChange?.(event.target.value)} style={styles.cameraSelect}>{dashCameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select> : null}{dashCameras.length === 0 ? <span style={styles.noCamera}>No dash camera</span> : null}<span style={styles.time}>{session.state.time.toFixed(2)} / {duration.toFixed(2)} s</span><input type="range" min={0} max={duration} step={.01} value={session.state.time} disabled={session.state.mode === 'authoring' || session.state.mode === 'preparing' || session.state.mode === 'error'} onChange={(event) => session.seek(Number(event.target.value))} style={styles.scrubber} aria-label="Scenario time" data-testid="session-scrubber" />{drawerMode ? <button type="button" style={styles.collapse} aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'} onClick={() => setExpanded((value) => !value)}>{expanded ? '‹' : '›'}</button> : null}</div>
    {notice ? <div style={styles.notice} role="alert">{notice}</div> : null}{session.state.error ? <div style={styles.error} role="alert">{session.state.error}</div> : null}
    {expanded ? <div style={styles.timelineBody}><div style={styles.labels}><div style={styles.rulerLabel}>Actors</div>{groups.flatMap((group) => { const icon = timelineActorIcon(group.actorClass, group.catalogId); return [<div key={`${group.actorId}:actor`} style={{ ...styles.actorHeader, ...(inspectedActor === group.actorId || editorState?.selection.includes(group.actorId) ? styles.actorSelected : null) }} data-testid={`timeline-actor-row-${group.actorId}`}><button type="button" style={styles.actorLabel} onClick={() => { setInspectedActor(group.actorId); onActorInspect?.(group.actorId); }} aria-label={`Select and frame ${group.label}`} data-testid={`timeline-actor-${group.actorId}`}><span role="img" aria-label={`${icon.label} icon`} data-icon-kind={icon.kind}>{icon.glyph}</span><span style={styles.actorName}>{group.label}</span></button>{!readonly ? <button type="button" style={styles.actorDelete} aria-label={`Delete ${group.label}`} data-testid={`timeline-delete-actor-${group.actorId}`} onClick={() => deleteActor(group.actorId)}>🗑</button> : null}</div>, ...(group.compact ? [] : group.lanes.map((lane) => <div key={`${group.actorId}:label:${lane.index}`} style={styles.trackLabel}><span>{lane.index === 0 ? 'Actions' : `Parallel ${lane.index + 1}`}</span>{lane.index === 0 ? <button type="button" style={styles.rowAdd} disabled={readonly} onClick={() => openNew(group.actorId)} aria-label={`Add action for ${group.label}`} data-testid={`timeline-add-${group.actorId}-actions`}>＋</button> : null}</div>))]; })}</div>
      <div style={styles.canvas}><Ruler duration={duration} />{groups.flatMap((group) => [<div key={`${group.actorId}:spacer`} style={styles.actorSpacer} data-testid={group.compact ? `timeline-object-${group.actorId}` : undefined} />, ...(group.compact ? [] : group.lanes.map((lane) => <div key={`${group.actorId}:lane:${lane.index}`} style={styles.track} onDoubleClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); openNew(group.actorId, ((event.clientX - bounds.left) / bounds.width) * duration); }} data-testid={lane.index === 0 ? `timeline-${group.actorId}-actions` : `timeline-${group.actorId}-actions-${lane.index + 1}`}>{lane.items.map((item) => <TimelineClip key={item.interaction.id} item={item} duration={duration} readonly={readonly} selected={selectedInteraction === item.interaction.id} outcome={timelineActionOutcome(outcomes, item.interaction.id)} onSelect={() => selectItem(item)} onMove={(time) => moveItem(item, time)} onDelete={() => controller?.doc.removeInteraction(item.interaction.id)} />)}{outcomes.filter((marker) => marker.actorId === group.actorId).map((marker, index) => <span key={`${marker.kind}:${index}`} style={{ ...styles.outcome, left: `${marker.time / duration * 100}%` }} />)}</div>))])}<div style={{ ...styles.playhead, left: `${session.state.time / duration * 100}%` }} /></div></div> : null}
    {editor ? <ActionEditor state={editor} group={groupFor(editor.actorId)!} readOnly={readonly} rightInset={rightInset} onChange={setEditor} onSave={saveEditor} onDelete={editor.editingId ? () => { controller?.doc.removeInteraction(editor.editingId!); setEditor(null); setSelectedInteraction(null); } : undefined} onClose={() => setEditor(null)} /> : null}
  </section>;
}

function ActionEditor({ state, group, readOnly, rightInset, onChange, onSave, onDelete, onClose }: { state: ActionEditorState; group: TimelineActorGroup; readOnly: boolean; rightInset: number; onChange: (state: ActionEditorState) => void; onSave: () => void; onDelete?: () => void; onClose: () => void }): JSX.Element { const choices = actionsForActor(group.actorClass, group.catalogId); const selected = choices.find((item) => item.id === state.definitionId) ?? choices[0]!; const grouped = [...new Set(choices.map((item) => item.group))]; return <aside role="dialog" aria-label={state.editingId ? 'Edit action' : 'Add action'} style={{ ...styles.editor, right: Math.max(16, rightInset) }} data-testid="interaction-editor"><div style={styles.editorHeader}><div><strong>Action</strong><div style={styles.editorContext}>{group.label}</div></div><button type="button" onClick={onClose} style={styles.close} aria-label="Close">×</button></div><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><label style={styles.field}><span>Action</span><select value={selected.id} onChange={(event) => { const next = choices.find((item) => item.id === event.target.value)!; onChange({ ...state, definitionId: next.id, duration: next.durationS, targetSpeed: Number(next.target.valueKph ?? state.targetSpeed) }); }} disabled={readOnly} data-testid="action-preset">{grouped.map((name) => <optgroup key={name} label={name}>{choices.filter((item) => item.group === name).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>{selected.id.includes('target_speed') ? <label style={styles.field}><span>Speed</span><span><input type="number" min={0} max={200} value={state.targetSpeed} onChange={(event) => onChange({ ...state, targetSpeed: Number(event.target.value) })} data-testid="speed-value" /> km/h</span></label> : null}<label style={styles.field}><span>Start</span><input type="number" min={0} step={.1} value={state.time} onChange={(event) => onChange({ ...state, time: Number(event.target.value) })} data-testid="interaction-time" /></label><label style={styles.field}><span>Duration</span><input type="number" min={.1} max={20} step={.1} value={state.duration} onChange={(event) => onChange({ ...state, duration: Number(event.target.value) })} /></label><div style={styles.resourceHint}>Only one {selected.resource} action can run at once; different resources run in parallel.</div><div style={styles.editorActions}><button type="submit" disabled={readOnly} style={styles.save} data-testid="save-interaction">{state.editingId ? 'Update' : 'Add to timeline'}</button>{onDelete ? <button type="button" onClick={onDelete} style={styles.delete}>Delete</button> : null}</div></form></aside>; }
function TimelineClip({ item, duration, readonly, selected, outcome, onSelect, onMove, onDelete }: { item: TimelineItem; duration: number; readonly: boolean; selected: boolean; outcome: TimelineActionOutcome; onSelect: () => void; onMove: (time: number) => void; onDelete: () => void }): JSX.Element { const drag = (event: ReactMouseEvent<HTMLButtonElement>): void => { onSelect(); if (readonly || event.button !== 0) return; const track = event.currentTarget.parentElement; if (!track) return; window.addEventListener('mouseup', (pointer) => { const bounds = track.getBoundingClientRect(); onMove(clamp((pointer.clientX - bounds.left) / bounds.width * duration, 0, duration)); }, { once: true }); }; return <button type="button" onMouseDown={drag} onDoubleClick={(event) => { event.stopPropagation(); if (!readonly) onDelete(); }} title={`${item.interaction.label ?? item.interaction.verb} · ${triggerLabel(item.interaction.trigger)} · ${outcome}`} data-outcome={outcome} data-testid={`timeline-item-${item.interaction.id}`} style={{ ...styles.clip, ...(outcome === 'executed' ? styles.clipExecuted : outcome === 'missed' ? styles.clipMissed : null), left: `${item.anchorTime / duration * 100}%`, width: `${Math.max(3, (item.endTime - item.anchorTime) / duration * 100)}%`, ...(selected ? styles.clipSelected : null) }}>{item.interaction.label ?? item.interaction.verb}</button>; }
function Ruler({ duration }: { duration: number }): JSX.Element { return <div style={styles.ruler}>{Array.from({ length: Math.floor(duration / 5) + 1 }, (_, index) => index * 5).map((tick) => <span key={tick} style={{ ...styles.tick, left: `${tick / duration * 100}%` }}>{tick}s</span>)}</div>; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); } function isField(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement; }
const styles: Record<string, CSSProperties> = { dock: { position: 'relative', zIndex: 18, overflow: 'hidden', background: 'rgba(23,25,29,.99)', borderRight: '1px solid #3a3e46', color: '#e8ebf0' }, transport: { minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid #343841' }, timelineTitle: { fontSize: 11 }, transportButton: { width: 32, height: 28, borderRadius: 5, border: '1px solid #c66b2c', background: '#8d451b', color: '#fff' }, cameraPlayButton: { borderColor: '#4388c7', background: '#245b89' }, cameraSelect: { maxWidth: 130, background: '#272c33', color: '#eee' }, noCamera: { color: '#788391', fontSize: 9 }, time: { fontSize: 10, whiteSpace: 'nowrap' }, scrubber: { minWidth: 55, flex: 1 }, collapse: { background: '#292d34', color: '#eee', border: 0 }, notice: { padding: 8, background: '#4c371b', color: '#ffd89a', fontSize: 10 }, error: { padding: 6, background: '#471d24', color: '#ff9b9b' }, worldTrack: { minHeight: 28, display: 'grid', gridTemplateColumns: '48px 1fr auto', padding: '5px 8px', fontSize: 9 }, timelineBody: { height: 'calc(100% - 72px)', minHeight: 180, display: 'grid', gridTemplateColumns: '142px minmax(248px, 1fr)', overflow: 'auto' }, labels: { position: 'sticky', left: 0, zIndex: 3, background: '#202329' }, rulerLabel: { height: 24, padding: '5px 8px', color: '#798290', fontSize: 10 }, actorHeader: { height: 30, background: '#292d34', borderTop: '1px solid #3a3e46', display: 'flex', alignItems: 'center' }, actorLabel: { flex: 1, minWidth: 0, padding: 7, border: 0, background: 'transparent', color: 'inherit', display: 'flex', gap: 5 }, actorName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, actorDelete: { width: 26, background: 'transparent', border: 0 }, actorSelected: { background: '#354b69' }, trackLabel: { height: 44, boxSizing: 'border-box', padding: '6px 6px 6px 14px', borderBottom: '1px solid #2c3037', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#aeb7c4', fontSize: 10 }, rowAdd: { width: 25, height: 25, background: '#273748', color: '#83baf0', border: '1px solid #46596e', borderRadius: 5 }, canvas: { position: 'relative', minWidth: 248 }, ruler: { height: 24, background: '#1c1f24', borderBottom: '1px solid #424751' }, tick: { position: 'absolute', top: 4, fontSize: 9, color: '#87909d' }, actorSpacer: { height: 30, background: 'rgba(255,255,255,.035)', borderTop: '1px solid #3a3e46' }, track: { position: 'relative', height: 44, borderBottom: '1px solid #2c3037' }, clip: { position: 'absolute', top: 10, height: 24, minWidth: 16, maxWidth: 150, overflow: 'hidden', border: '1px solid #68a8ed', borderRadius: 4, background: '#3276c8', color: '#fff', fontSize: 9, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, clipExecuted: { background: '#287a4c', borderColor: '#67d99a' }, clipMissed: { background: '#71313a', borderColor: '#ff788c' }, clipSelected: { outline: '2px solid #fff' }, outcome: { position: 'absolute', top: 4, width: 3, height: 36, background: '#ff5e7a' }, playhead: { position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ff8551' }, editor: { position: 'fixed', zIndex: 32, bottom: 104, width: 340, padding: 14, borderRadius: 8, background: '#22262d', border: '1px solid #555c68', fontSize: 10 }, editorHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }, editorContext: { color: '#9ba4b2', fontSize: 10 }, close: { border: 0, background: 'transparent', color: '#eee', fontSize: 18 }, field: { display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginBottom: 8, color: '#aab3c1' }, resourceHint: { padding: 7, borderRadius: 4, background: '#29333f', color: '#9eb8d3' }, editorActions: { display: 'flex', gap: 6, marginTop: 10 }, save: { flex: 1, padding: 8, background: '#286aa8', color: '#fff', border: 0, borderRadius: 5 }, delete: { padding: 8, background: '#52252c', color: '#ffabb8', border: 0, borderRadius: 5 } };
