import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import type { Interaction, MapSignalPlan, MapSignalPlanClip } from '@uniscenarios/scenario-model';
import type { MapSignalCatalog } from '@uniscenarios/scenario-materializer';
import type { EditorController, EditorState } from '../editor/controller';
import type { EditorDocument } from '../editor/document';
import type { StudioSessionApi } from '../session/useStudioSession';
import { createMapSignalPlan, physicalSignalChoiceIndex, physicalSignalChoices } from '../signals/authoring';
import { actionsForActor, definitionForInteraction, interactionForAction, type ActionDefinition } from './actions';
import { buildMapSignalTimelineGroups, buildTimelineGroups, conflictingAction, editMapSignalPlanClip, moveInteraction, moveMapSignalPlanClip, resizeMapSignalPlanClip, triggerLabel, type TimelineActorGroup, type TimelineItem, type TimelineMapSignalClip, type TraceOutcomeMarker } from './model';

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

export interface TimelineDockProps { controller: EditorController | null; editorState: EditorState | null; session: StudioSessionApi; outcomes?: readonly TraceOutcomeMarker[]; achievedSpeeds?: Readonly<Record<string, TimelineSpeedSeries>>; rightInset?: number; drawerMode?: boolean; onActorInspect?: (actorId: string) => void; onActorDelete?: (actorId: string) => void; dashCameras?: readonly { id: string; label: string }[]; selectedDashCameraId?: string | null; onDashCameraChange?: (id: string) => void; onCameraPlay?: () => void; onPlayPause?: () => void; signalCatalog?: MapSignalCatalog | null; signalControlDigest?: string | null; selectedSignalHeadId?: string | null; selectedSignalJunctionId?: string | null; selectedSignalControllerId?: string | null; selectedSignalResolved?: boolean; }
interface ActionEditorState { actorId: string; definitionId: string; time: number; duration: number; maneuverDuration: number; maneuverStyle: 'cautious' | 'normal' | 'assertive'; targetSpeed: number; editingId: string | null; }
export interface TimelineSignalDraft { planId: string; clipId: string; startS: number; endS: number; reference: MapSignalPlanClip['reference']; indication: MapSignalPlanClip['indication']; }
export type TimelineActionDraft = Omit<ActionEditorState, 'maneuverDuration' | 'maneuverStyle'> & {
  maneuverDuration?: number;
  maneuverStyle?: 'cautious' | 'normal' | 'assertive';
};
export type TimelineActionOutcome = 'pending' | 'executed' | 'missed';
export function timelineActionOutcome(markers: readonly TraceOutcomeMarker[], interactionId: string): TimelineActionOutcome {
  const marker = [...markers].reverse().find((item) => item.interactionId === interactionId);
  if (!marker) return 'pending';
  return marker.kind === 'trigger_fired' ? 'executed' : marker.kind === 'trigger_skipped' ? 'missed' : 'pending';
}
export type TimelineActionSubmitResult =
  | { readonly ok: true; readonly interaction: Interaction }
  | { readonly ok: false; readonly message: string };

export type TimelineSignalSubmitResult =
  | { readonly ok: true; readonly plan: MapSignalPlan; readonly clip: MapSignalPlanClip }
  | { readonly ok: false; readonly message: string };

export function submitTimelineSignalClip(
  document: EditorDocument,
  draft: TimelineSignalDraft,
): TimelineSignalSubmitResult {
  const plan = document.data.mapSignalPlans.find((item) => item.id === draft.planId);
  if (!plan) return { ok: false, message: 'This traffic-signal controller no longer exists.' };
  const existing = plan.clips.find((item) => item.id === draft.clipId);
  const clip: MapSignalPlanClip = { id: draft.clipId, startS: draft.startS, endS: draft.endS, reference: existing?.reference ?? draft.reference, indication: draft.indication };
  const result = editMapSignalPlanClip(plan, clip, document.data.choreography.clipSeconds);
  if (!result.ok) return result;
  document.replaceMapSignalPlan(plan.id, result.plan);
  return { ok: true, plan: result.plan, clip };
}

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
    const maneuver = customized.verb === 'changeLane' || customized.verb === 'laneOffset'
      ? { durationS: draft.maneuverDuration ?? draft.duration, style: draft.maneuverStyle ?? 'normal' }
      : undefined;
    if (maneuver && (!Number.isFinite(maneuver.durationS) || maneuver.durationS < .1 || maneuver.durationS > 30)) {
      return { ok: false, message: 'Maneuver duration must be between 0.1 and 30 seconds.' };
    }
    let interaction = interactionForAction({ ...customized, durationS: draft.duration }, draft.actorId, draft.time, ordinal, maneuver);
    const usedIds = new Set(template.choreography.interactions.map((item) => item.id));
    while (!draft.editingId && usedIds.has(interaction.id)) {
      interaction = interactionForAction({ ...customized, durationS: draft.duration }, draft.actorId, draft.time, ++ordinal, maneuver);
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

export function TimelineDock({ controller, editorState, session, outcomes = [], rightInset = 16, drawerMode = false, onActorInspect, onActorDelete, dashCameras = [], selectedDashCameraId = null, onDashCameraChange, onCameraPlay, onPlayPause, signalCatalog = null, signalControlDigest = null, selectedSignalHeadId = null, selectedSignalJunctionId = null, selectedSignalControllerId = null, selectedSignalResolved = true }: TimelineDockProps): JSX.Element {
  const [expanded, setExpanded] = useState(true); const [selectedInteraction, setSelectedInteraction] = useState<string | null>(null); const [selectedSignalClip, setSelectedSignalClip] = useState<string | null>(null); const [editor, setEditor] = useState<ActionEditorState | null>(null); const [signalEditor, setSignalEditor] = useState<TimelineSignalDraft | null>(null); const [notice, setNotice] = useState<string | null>(null); const [inspectedActor, setInspectedActor] = useState<string | null>(null); const [selectedSignalChoice, setSelectedSignalChoice] = useState(0);
  const template = controller?.doc.data ?? null; const duration = template?.choreography.clipSeconds ?? session.state.duration; const groups = useMemo(() => template ? buildTimelineGroups(template) : [], [template]); const signalGroups = useMemo(() => template ? buildMapSignalTimelineGroups(template) : [], [template]); const signalChoices = useMemo(() => signalCatalog && selectedSignalHeadId ? physicalSignalChoices(signalCatalog, selectedSignalHeadId) : [], [signalCatalog, selectedSignalHeadId]); const readonly = session.state.mode !== 'authoring';
  useEffect(() => {
    setSelectedSignalChoice(physicalSignalChoiceIndex(
      signalChoices, selectedSignalJunctionId, selectedSignalControllerId,
    ));
  }, [selectedSignalControllerId, selectedSignalHeadId, selectedSignalJunctionId, signalChoices]);
  useEffect(() => { if (readonly) { setEditor(null); setSignalEditor(null); setNotice(null); } }, [readonly]);
  const groupFor = (actorId: string) => groups.find((group) => group.actorId === actorId);
  const openNew = (actorId: string, time = session.state.time): void => { const group = groupFor(actorId); if (!group || readonly) return; const choices = actionsForActor(group.actorClass, group.catalogId); if (!choices.length) return; setEditor({ actorId, definitionId: choices[0]!.id, time: clamp(time, 0, duration), duration: choices[0]!.durationS, maneuverDuration: choices[0]!.durationS, maneuverStyle: 'normal', targetSpeed: Number(choices[0]!.target.valueKph ?? 30), editingId: null }); setSelectedInteraction(null); setNotice(null); };
  const selectItem = (item: TimelineItem): void => { const group = groupFor(item.actorId); if (!group) return; const choices = actionsForActor(group.actorClass, group.catalogId); const definition = definitionForInteraction(item.interaction, group.actorClass, group.catalogId) ?? choices.find((choice) => choice.verb === item.interaction.verb && choice.resource === item.resource) ?? choices[0]; if (!definition) return; const lateral = item.interaction.verb === 'changeLane' || item.interaction.verb === 'laneOffset' ? item.interaction : null; const legacyDuration = lateral?.dynamics?.constraint === 'time' && typeof lateral.dynamics.value === 'number' ? lateral.dynamics.value : definition.durationS; setSelectedInteraction(item.interaction.id); setEditor({ actorId: item.actorId, definitionId: definition.id, time: item.anchorTime, duration: Math.max(.1, item.endTime - item.anchorTime), maneuverDuration: lateral && typeof lateral.maneuverDurationS === 'number' ? lateral.maneuverDurationS : legacyDuration, maneuverStyle: lateral?.maneuverStyle ?? 'normal', targetSpeed: item.interaction.verb === 'speed' && item.interaction.target.mode === 'absolute' && typeof item.interaction.target.valueKph === 'number' ? item.interaction.target.valueKph : Number(definition.target.valueKph ?? 30), editingId: item.interaction.id }); controller?.setSelection([item.actorId]); };
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
  const openSignalEditor = (plan: MapSignalPlan, clip?: MapSignalPlanClip, reference?: MapSignalPlanClip['reference']): void => {
    if (readonly) return;
    const resolvedReference = clip?.reference ?? reference ?? plan.clips[0]?.reference;
    if (!resolvedReference) { setNotice('Select a physical signal orb before adding the first phase clip.'); return; }
    const slot = clip ? { startS: clip.startS, endS: clip.endS } : firstSignalGap(plan.clips, duration, session.state.time);
    if (!slot) { setNotice('This controller track has no free space for another phase clip.'); return; }
    const clipId = clip?.id ?? uniqueSignalClipId(plan);
    setSignalEditor({ planId: plan.id, clipId, ...slot, reference: resolvedReference, indication: clip?.indication ?? 'green' });
    setSelectedSignalClip(clipId); setSelectedInteraction(null); setEditor(null); setNotice(null);
  };
  const addSelectedSignalController = (): void => {
    if (!controller || readonly || !signalControlDigest) return;
    const choice = signalChoices[selectedSignalChoice];
    if (!choice) { setNotice('This physical signal is not bound to a junction controller.'); return; }
    const existing = controller.doc.data.mapSignalPlans.find((plan) => plan.binding.junctionId === choice.junctionId);
    if (existing) { openSignalEditor(existing, undefined, { controllerId: choice.controllerId, headId: choice.headId }); return; }
    const plan = createMapSignalPlan(controller.doc.map.id, signalControlDigest, choice, new Set(controller.doc.data.mapSignalPlans.map((item) => item.id)));
    controller.doc.addMapSignalPlan(plan);
    openSignalEditor(plan, undefined, { controllerId: choice.controllerId, headId: choice.headId });
  };
  const saveSignalEditor = (): void => {
    if (!controller || !signalEditor || readonly) return;
    const result = submitTimelineSignalClip(controller.doc, signalEditor);
    if (!result.ok) { setNotice(result.message); return; }
    setSelectedSignalClip(result.clip.id); setSignalEditor(null); setNotice(null);
  };
  const applySignalEdit = (result: ReturnType<typeof moveMapSignalPlanClip> | ReturnType<typeof resizeMapSignalPlanClip>): void => {
    if (!controller) return;
    if (!result.ok) { setNotice(result.message); return; }
    controller.doc.replaceMapSignalPlan(result.plan.id, result.plan); setNotice(null);
  };
  const deleteSignalClip = (plan: MapSignalPlan, clipId: string): void => {
    if (!controller || readonly) return;
    controller.doc.replaceMapSignalPlan(plan.id, { ...plan, clips: plan.clips.filter((clip) => clip.id !== clipId) });
    setSelectedSignalClip(null); setSignalEditor(null);
  };
  const deleteActor = (actorId: string): void => { if (!controller || readonly) return; controller.setSelection((editorState?.selection ?? []).filter((id) => id !== actorId)); controller.doc.remove([actorId]); if (inspectedActor === actorId) setInspectedActor(null); setSelectedInteraction(null); setEditor(null); onActorDelete?.(actorId); };
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (readonly || isField(event.target)) return; if ((event.key === 'Delete' || event.key === 'Backspace') && selectedInteraction) { event.preventDefault(); controller?.doc.removeInteraction(selectedInteraction); setSelectedInteraction(null); setEditor(null); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? controller?.redo() : controller?.undo(); } }; window.addEventListener('keydown', key, { capture: true }); return () => window.removeEventListener('keydown', key, { capture: true }); });
  return <section style={{ ...styles.dock, width: drawerMode && !expanded ? 124 : '100%', height: drawerMode && !expanded ? 44 : '100%' }} data-testid="timeline-dock" data-layout={drawerMode ? 'drawer' : 'sidebar'}>
    {(template?.choreography.warmupSeconds ?? 0) > 0 ? <div style={styles.notice} title="Actors move during an unrecorded prologue before timeline time zero" data-testid="timeline-warmup">This scenario has a {template!.choreography.warmupSeconds}s unrecorded warmup</div> : null}
    <div style={styles.transport}><strong style={styles.timelineTitle}>Timeline</strong><button type="button" aria-label={session.state.mode === 'playing' ? 'Pause simulation' : 'Play simulation'} style={styles.transportButton} onClick={onPlayPause ?? session.playPause} disabled={!controller || session.state.mode === 'preparing'} data-testid="session-play-pause">{session.state.mode === 'playing' ? '❚❚' : '▶'}</button><button type="button" aria-label={session.state.mode === 'playing' ? 'Pause camera playback' : 'Play from dash camera'} style={{ ...styles.transportButton, ...styles.cameraPlayButton }} onClick={session.state.mode === 'playing' ? session.playPause : onCameraPlay} disabled={!controller || !dashCameras.length || !onCameraPlay} data-testid="session-camera-play">{session.state.mode === 'playing' ? '❚❚' : '▣▶'}</button>{dashCameras.length > 1 ? <select aria-label="Dash camera for Camera Play" value={selectedDashCameraId ?? dashCameras[0]?.id ?? ''} onChange={(event) => onDashCameraChange?.(event.target.value)} style={styles.cameraSelect}>{dashCameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.label}</option>)}</select> : null}{dashCameras.length === 0 ? <span style={styles.noCamera}>No dash camera</span> : null}<span style={styles.time}>{session.state.time.toFixed(2)} / {duration.toFixed(2)} s</span><input type="range" min={0} max={duration} step={.01} value={session.state.time} disabled={session.state.mode === 'authoring' || session.state.mode === 'preparing' || session.state.mode === 'error'} onChange={(event) => session.seek(Number(event.target.value))} style={styles.scrubber} aria-label="Scenario time" data-testid="session-scrubber" />{drawerMode ? <button type="button" style={styles.collapse} aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'} onClick={() => setExpanded((value) => !value)}>{expanded ? '‹' : '›'}</button> : null}</div>
    {notice ? <div style={styles.notice} role="alert">{notice}</div> : null}{session.state.error ? <div style={styles.error} role="alert">{session.state.error}</div> : null}
    {selectedSignalHeadId ? <div style={styles.signalSelection} data-testid="selected-signal-head"><span>🚦 {selectedSignalHeadId}</span>{!selectedSignalResolved ? <span role="alert">Unbound signal — exact controller ownership is unavailable</span> : signalChoices.length > 1 ? <select aria-label="Signal controller" value={selectedSignalChoice} onChange={(event) => setSelectedSignalChoice(Number(event.target.value))}>{signalChoices.map((choice, index) => <option key={`${choice.junctionId}:${choice.controllerId}`} value={index}>Intersection {choice.junctionId} · controller {choice.controllerId}</option>)}</select> : signalChoices[0] ? <span>Intersection {signalChoices[0].junctionId}</span> : <span>Unbound signal</span>}<button type="button" disabled={readonly || !selectedSignalResolved || !signalControlDigest || signalChoices.length === 0} onClick={addSelectedSignalController} data-testid="timeline-add-signal-controller">Add phase clip</button></div> : null}
    {expanded ? <div style={styles.timelineBody}><div style={styles.labels}><div style={styles.rulerLabel}>Signals &amp; actors</div>{signalGroups.flatMap((group) => [<div key={`${group.planId}:signal`} style={styles.signalHeader} data-testid={`timeline-signal-row-${group.planId}`}><span>🚦 {group.label}</span>{!readonly ? <button type="button" style={styles.actorDelete} aria-label={`Delete ${group.label} signal plan`} onClick={() => controller?.doc.removeMapSignalPlan(group.planId)}>🗑</button> : null}</div>, <div key={`${group.planId}:label`} style={styles.trackLabel}><span>Reference light</span><button type="button" style={styles.rowAdd} disabled={readonly} onClick={() => openSignalEditor(group.plan)} aria-label={`Add phase for ${group.label}`} data-testid={`timeline-add-signal-${group.planId}`}>＋</button></div>])}{groups.flatMap((group) => { const icon = timelineActorIcon(group.actorClass, group.catalogId); return [<div key={`${group.actorId}:actor`} style={{ ...styles.actorHeader, ...(inspectedActor === group.actorId || editorState?.selection.includes(group.actorId) ? styles.actorSelected : null) }} data-testid={`timeline-actor-row-${group.actorId}`}><button type="button" style={styles.actorLabel} onClick={() => { setInspectedActor(group.actorId); onActorInspect?.(group.actorId); }} aria-label={`Select and frame ${group.label}`} data-testid={`timeline-actor-${group.actorId}`}><span role="img" aria-label={`${icon.label} icon`} data-icon-kind={icon.kind}>{icon.glyph}</span><span style={styles.actorName}>{group.label}</span></button>{!readonly ? <button type="button" style={styles.actorDelete} aria-label={`Delete ${group.label}`} data-testid={`timeline-delete-actor-${group.actorId}`} onClick={() => deleteActor(group.actorId)}>🗑</button> : null}</div>, ...(group.compact ? [] : group.lanes.map((lane) => <div key={`${group.actorId}:label:${lane.index}`} style={styles.trackLabel}><span>{lane.index === 0 ? 'Actions' : `Parallel ${lane.index + 1}`}</span>{lane.index === 0 ? <button type="button" style={styles.rowAdd} disabled={readonly} onClick={() => openNew(group.actorId)} aria-label={`Add action for ${group.label}`} data-testid={`timeline-add-${group.actorId}-actions`}>＋</button> : null}</div>))]; })}</div>
      <div style={styles.canvas}><Ruler duration={duration} />{signalGroups.flatMap((group) => [<div key={`${group.planId}:spacer`} style={styles.signalSpacer} />, <div key={`${group.planId}:track`} style={styles.track} onDoubleClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); openSignalEditor(group.plan, undefined, group.plan.clips[0]?.reference); if (group.plan.clips.length === 0) setNotice('Select a physical signal orb before adding the first phase clip.'); }} data-testid={`timeline-signal-${group.planId}`}>{group.clips.map((item) => <SignalTimelineClip key={item.clip.id} item={item} duration={duration} readonly={readonly} selected={selectedSignalClip === item.clip.id} onSelect={() => openSignalEditor(group.plan, item.clip)} onMove={(time) => applySignalEdit(moveMapSignalPlanClip(group.plan, item.clip.id, time, duration))} onResize={(edge, time) => applySignalEdit(resizeMapSignalPlanClip(group.plan, item.clip.id, edge, time, duration))} />)}</div>])}{groups.flatMap((group) => [<div key={`${group.actorId}:spacer`} style={styles.actorSpacer} data-testid={group.compact ? `timeline-object-${group.actorId}` : undefined} />, ...(group.compact ? [] : group.lanes.map((lane) => <div key={`${group.actorId}:lane:${lane.index}`} style={styles.track} onDoubleClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); openNew(group.actorId, ((event.clientX - bounds.left) / bounds.width) * duration); }} data-testid={lane.index === 0 ? `timeline-${group.actorId}-actions` : `timeline-${group.actorId}-actions-${lane.index + 1}`}>{lane.items.map((item) => <TimelineClip key={item.interaction.id} item={item} duration={duration} readonly={readonly} selected={selectedInteraction === item.interaction.id} outcome={timelineActionOutcome(outcomes, item.interaction.id)} onSelect={() => selectItem(item)} onMove={(time) => moveItem(item, time)} onDelete={() => controller?.doc.removeInteraction(item.interaction.id)} />)}{outcomes.filter((marker) => marker.actorId === group.actorId).map((marker, index) => <span key={`${marker.kind}:${index}`} style={{ ...styles.outcome, left: `${marker.time / duration * 100}%` }} />)}</div>))])}<div style={{ ...styles.playhead, left: `${session.state.time / duration * 100}%` }} /></div></div> : null}
    {editor ? <ActionEditor state={editor} group={groupFor(editor.actorId)!} readOnly={readonly} rightInset={rightInset} onChange={setEditor} onSave={saveEditor} onDelete={editor.editingId ? () => { controller?.doc.removeInteraction(editor.editingId!); setEditor(null); setSelectedInteraction(null); } : undefined} onClose={() => setEditor(null)} /> : null}
    {signalEditor ? <SignalClipEditor state={signalEditor} readOnly={readonly} rightInset={rightInset} onChange={setSignalEditor} onSave={saveSignalEditor} onDelete={() => { const plan = template?.mapSignalPlans.find((item) => item.id === signalEditor.planId); if (plan?.clips.some((clip) => clip.id === signalEditor.clipId)) deleteSignalClip(plan, signalEditor.clipId); else { setSignalEditor(null); setSelectedSignalClip(null); } }} onClose={() => setSignalEditor(null)} /> : null}
  </section>;
}

function ActionEditor({ state, group, readOnly, rightInset, onChange, onSave, onDelete, onClose }: { state: ActionEditorState; group: TimelineActorGroup; readOnly: boolean; rightInset: number; onChange: (state: ActionEditorState) => void; onSave: () => void; onDelete?: () => void; onClose: () => void }): JSX.Element {
  const choices = actionsForActor(group.actorClass, group.catalogId);
  const selected = choices.find((item) => item.id === state.definitionId) ?? choices[0]!;
  const grouped = [...new Set(choices.map((item) => item.group))];
  const lateral = selected.verb === 'changeLane' || selected.verb === 'laneOffset';
  return <aside role="dialog" aria-label={state.editingId ? 'Edit action' : 'Add action'} style={{ ...styles.editor, right: Math.max(16, rightInset) }} data-testid="interaction-editor">
    <div style={styles.editorHeader}><div><strong>Action</strong><div style={styles.editorContext}>{group.label}</div></div><button type="button" onClick={onClose} style={styles.close} aria-label="Close">×</button></div>
    <form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <label style={styles.field}><span>Action</span><select value={selected.id} onChange={(event) => { const next = choices.find((item) => item.id === event.target.value)!; onChange({ ...state, definitionId: next.id, duration: next.durationS, maneuverDuration: next.durationS, targetSpeed: Number(next.target.valueKph ?? state.targetSpeed) }); }} disabled={readOnly} data-testid="action-preset">{grouped.map((name) => <optgroup key={name} label={name}>{choices.filter((item) => item.group === name).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      {selected.id.includes('target_speed') ? <label style={styles.field}><span>Speed</span><span><input type="number" min={0} max={200} value={state.targetSpeed} onChange={(event) => onChange({ ...state, targetSpeed: Number(event.target.value) })} data-testid="speed-value" /> km/h</span></label> : null}
      <label style={styles.field}><span>Start</span><input type="number" min={0} step={.1} value={state.time} onChange={(event) => onChange({ ...state, time: Number(event.target.value) })} data-testid="interaction-time" /></label>
      <label style={styles.field}><span>Window</span><input type="number" min={.1} max={20} step={.1} value={state.duration} onChange={(event) => onChange({ ...state, duration: Number(event.target.value) })} data-testid="interaction-window-duration" /></label>
      {lateral ? <><label style={styles.field}><span>Maneuver</span><span><input type="number" min={.1} max={30} step={.1} value={state.maneuverDuration} onChange={(event) => onChange({ ...state, maneuverDuration: Number(event.target.value) })} data-testid="maneuver-duration" /> s</span></label><label style={styles.field}><span>Style</span><select value={state.maneuverStyle} onChange={(event) => onChange({ ...state, maneuverStyle: event.target.value as ActionEditorState['maneuverStyle'] })} data-testid="maneuver-style"><option value="cautious">Cautious</option><option value="normal">Normal</option><option value="assertive">Assertive</option></select></label></> : null}
      <div style={styles.resourceHint}>{lateral ? 'The window controls when this action may start. Maneuver duration controls the gradual physical motion.' : `Only one ${selected.resource} action can run at once; different resources run in parallel.`}</div>
      <div style={styles.editorActions}><button type="submit" disabled={readOnly} style={styles.save} data-testid="save-interaction">{state.editingId ? 'Update' : 'Add to timeline'}</button>{onDelete ? <button type="button" onClick={onDelete} style={styles.delete}>Delete</button> : null}</div>
    </form>
  </aside>;
}
function TimelineClip({ item, duration, readonly, selected, outcome, onSelect, onMove, onDelete }: { item: TimelineItem; duration: number; readonly: boolean; selected: boolean; outcome: TimelineActionOutcome; onSelect: () => void; onMove: (time: number) => void; onDelete: () => void }): JSX.Element { const drag = (event: ReactMouseEvent<HTMLButtonElement>): void => { onSelect(); if (readonly || event.button !== 0) return; const track = event.currentTarget.parentElement; if (!track) return; window.addEventListener('mouseup', (pointer) => { const bounds = track.getBoundingClientRect(); onMove(clamp((pointer.clientX - bounds.left) / bounds.width * duration, 0, duration)); }, { once: true }); }; return <button type="button" onMouseDown={drag} onDoubleClick={(event) => { event.stopPropagation(); if (!readonly) onDelete(); }} title={`${item.interaction.label ?? item.interaction.verb} · ${triggerLabel(item.interaction.trigger)} · ${outcome}`} data-outcome={outcome} data-testid={`timeline-item-${item.interaction.id}`} style={{ ...styles.clip, ...(outcome === 'executed' ? styles.clipExecuted : outcome === 'missed' ? styles.clipMissed : null), left: `${item.anchorTime / duration * 100}%`, width: `${Math.max(3, (item.endTime - item.anchorTime) / duration * 100)}%`, ...(selected ? styles.clipSelected : null) }}>{item.interaction.label ?? item.interaction.verb}</button>; }
function SignalClipEditor({ state, readOnly, rightInset, onChange, onSave, onDelete, onClose }: { state: TimelineSignalDraft; readOnly: boolean; rightInset: number; onChange: (state: TimelineSignalDraft) => void; onSave: () => void; onDelete: () => void; onClose: () => void }): JSX.Element { return <aside role="dialog" aria-label="Edit traffic signal phase" style={{ ...styles.editor, right: Math.max(16, rightInset) }} data-testid="signal-clip-editor"><div style={styles.editorHeader}><div><strong>Reference light</strong><div style={styles.editorContext}>Controller {state.reference.controllerId} · head {state.reference.headId}</div></div><button type="button" onClick={onClose} style={styles.close} aria-label="Close">×</button></div><form onSubmit={(event) => { event.preventDefault(); onSave(); }}><label style={styles.field}><span>Phase</span><select value={state.indication} onChange={(event) => onChange({ ...state, indication: event.target.value as MapSignalPlanClip['indication'] })} disabled={readOnly} data-testid="signal-indication"><option value="green">Green</option><option value="yellow">Yellow</option><option value="red">Red</option><option value="flashing_yellow">Flashing yellow</option><option value="flashing_red">Flashing red (fail-safe)</option><option value="off">Off</option></select></label><label style={styles.field}><span>Start</span><input type="number" min={0} step={.1} value={state.startS} onChange={(event) => onChange({ ...state, startS: Number(event.target.value) })} data-testid="signal-start" /></label><label style={styles.field}><span>End</span><input type="number" min={.1} step={.1} value={state.endS} onChange={(event) => onChange({ ...state, endS: Number(event.target.value) })} data-testid="signal-end" /></label><div style={styles.resourceHint}>The interval is [start, end). Related heads are derived together from this reference light.</div><div style={styles.editorActions}><button type="submit" disabled={readOnly} style={styles.save} data-testid="save-signal-clip">Save phase</button><button type="button" onClick={onDelete} disabled={readOnly} style={styles.delete}>Delete</button></div></form></aside>; }
function SignalTimelineClip({ item, duration, readonly, selected, onSelect, onMove, onResize }: { item: TimelineMapSignalClip; duration: number; readonly: boolean; selected: boolean; onSelect: () => void; onMove: (time: number) => void; onResize: (edge: 'start' | 'end', time: number) => void }): JSX.Element {
  const beginMove = (event: ReactMouseEvent<HTMLButtonElement>): void => { onSelect(); if (readonly || event.button !== 0) return; event.stopPropagation(); const clipNode = event.currentTarget.parentElement; const track = clipNode?.parentElement; if (!clipNode || !track) return; const grabOffset = event.clientX - clipNode.getBoundingClientRect().left; window.addEventListener('mouseup', (pointer) => { const bounds = track.getBoundingClientRect(); onMove(clamp((pointer.clientX - bounds.left - grabOffset) / bounds.width * duration, 0, duration)); }, { once: true }); };
  const beginResize = (edge: 'start' | 'end', event: ReactMouseEvent<HTMLButtonElement>): void => { onSelect(); if (readonly || event.button !== 0) return; event.stopPropagation(); const track = event.currentTarget.parentElement?.parentElement; if (!track) return; window.addEventListener('mouseup', (pointer) => { const bounds = track.getBoundingClientRect(); onResize(edge, clamp((pointer.clientX - bounds.left) / bounds.width * duration, 0, duration)); }, { once: true }); };
  const label = signalIndicationLabel(item.clip.indication);
  return <div data-testid={`timeline-signal-clip-${item.clip.id}`} data-indication={item.clip.indication} style={{ ...styles.signalClip, ...signalIndicationStyle(item.clip.indication), left: `${item.anchorTime / duration * 100}%`, width: `${Math.max(3, (item.endTime - item.anchorTime) / duration * 100)}%`, ...(selected ? styles.clipSelected : null) }}><button type="button" onMouseDown={beginMove} style={styles.signalClipBody} title={`${label} · ${item.anchorTime.toFixed(1)}–${item.endTime.toFixed(1)}s`}>{label}</button><button type="button" aria-label="Resize signal phase start" onMouseDown={(event) => beginResize('start', event)} style={{ ...styles.resizeHandle, left: 0 }} /><button type="button" aria-label="Resize signal phase end" onMouseDown={(event) => beginResize('end', event)} style={{ ...styles.resizeHandle, right: 0 }} /></div>;
}
function signalIndicationLabel(indication: MapSignalPlanClip['indication']): string { return indication === 'flashing_red' ? 'flashing red · fail-safe' : indication.replaceAll('_', ' '); }
function signalIndicationStyle(indication: MapSignalPlanClip['indication']): CSSProperties { if (indication === 'green') return { background: '#217a43', borderColor: '#59d98a' }; if (indication === 'yellow' || indication === 'flashing_yellow') return { background: '#8a6b16', borderColor: '#f3cb4d', color: '#fff6c9' }; if (indication === 'red' || indication === 'flashing_red') return { background: '#7f2832', borderColor: '#ef6878' }; return { background: '#363b43', borderColor: '#89929f' }; }
function uniqueSignalClipId(plan: MapSignalPlan): string { const used = new Set(plan.clips.map((clip) => clip.id)); let ordinal = plan.clips.length + 1; let id = `phase_${ordinal}`; while (used.has(id)) id = `phase_${++ordinal}`; return id; }
function firstSignalGap(clips: readonly MapSignalPlanClip[], duration: number, preferred: number): { startS: number; endS: number } | null { const width = Math.min(3, duration); if (width < .1) return null; const ordered = [...clips].sort((left, right) => left.startS - right.startS); const candidates = [clamp(preferred, 0, duration - width), 0, ...ordered.map((clip) => clip.endS)]; for (const start of candidates) { const end = start + width; if (end <= duration + 1e-9 && ordered.every((clip) => end <= clip.startS || start >= clip.endS)) return { startS: Number(start.toFixed(3)), endS: Number(end.toFixed(3)) }; } return null; }
function Ruler({ duration }: { duration: number }): JSX.Element { return <div style={styles.ruler}>{Array.from({ length: Math.floor(duration / 5) + 1 }, (_, index) => index * 5).map((tick) => <span key={tick} style={{ ...styles.tick, left: `${tick / duration * 100}%` }}>{tick}s</span>)}</div>; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); } function isField(target: EventTarget | null): boolean { return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement; }
const styles: Record<string, CSSProperties> = { dock: { position: 'relative', zIndex: 18, overflow: 'hidden', background: 'rgba(23,25,29,.99)', borderRight: '1px solid #3a3e46', color: '#e8ebf0' }, transport: { minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid #343841' }, timelineTitle: { fontSize: 11 }, transportButton: { width: 32, height: 28, borderRadius: 5, borderWidth: 1, borderStyle: 'solid', borderColor: '#c66b2c', background: '#8d451b', color: '#fff' }, cameraPlayButton: { borderColor: '#4388c7', background: '#245b89' }, cameraSelect: { maxWidth: 130, background: '#272c33', color: '#eee' }, noCamera: { color: '#788391', fontSize: 9 }, time: { fontSize: 10, whiteSpace: 'nowrap' }, scrubber: { minWidth: 55, flex: 1 }, collapse: { background: '#292d34', color: '#eee', border: 0 }, notice: { padding: 8, background: '#4c371b', color: '#ffd89a', fontSize: 10 }, error: { padding: 6, background: '#471d24', color: '#ff9b9b' }, worldTrack: { minHeight: 28, display: 'grid', gridTemplateColumns: '48px 1fr auto', padding: '5px 8px', fontSize: 9 }, signalSelection: { minHeight: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderBottom: '1px solid #343841', color: '#d8c995', fontSize: 9 }, timelineBody: { height: 'calc(100% - 72px)', minHeight: 180, display: 'grid', gridTemplateColumns: '142px minmax(248px, 1fr)', overflow: 'auto' }, labels: { position: 'sticky', left: 0, zIndex: 3, background: '#202329' }, rulerLabel: { height: 24, padding: '5px 8px', color: '#798290', fontSize: 10 }, actorHeader: { height: 30, background: '#292d34', borderTop: '1px solid #3a3e46', display: 'flex', alignItems: 'center' }, signalHeader: { height: 30, boxSizing: 'border-box', padding: '6px 7px', background: '#343123', borderTop: '1px solid #565039', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#eadc9d', fontSize: 10 }, actorLabel: { flex: 1, minWidth: 0, padding: 7, border: 0, background: 'transparent', color: 'inherit', display: 'flex', gap: 5 }, actorName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, actorDelete: { width: 26, background: 'transparent', border: 0 }, actorSelected: { background: '#354b69' }, trackLabel: { height: 44, boxSizing: 'border-box', padding: '6px 6px 6px 14px', borderBottom: '1px solid #2c3037', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#aeb7c4', fontSize: 10 }, rowAdd: { width: 25, height: 25, background: '#273748', color: '#83baf0', border: '1px solid #46596e', borderRadius: 5 }, canvas: { position: 'relative', minWidth: 248 }, ruler: { height: 24, background: '#1c1f24', borderBottom: '1px solid #424751' }, tick: { position: 'absolute', top: 4, fontSize: 9, color: '#87909d' }, actorSpacer: { height: 30, background: 'rgba(255,255,255,.035)', borderTop: '1px solid #3a3e46' }, signalSpacer: { height: 30, background: 'rgba(174,145,49,.08)', borderTop: '1px solid #565039' }, track: { position: 'relative', height: 44, borderBottom: '1px solid #2c3037' }, clip: { position: 'absolute', top: 10, height: 24, minWidth: 16, maxWidth: 150, overflow: 'hidden', borderWidth: 1, borderStyle: 'solid', borderColor: '#68a8ed', borderRadius: 4, background: '#3276c8', color: '#fff', fontSize: 9, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, signalClip: { position: 'absolute', top: 8, height: 28, minWidth: 18, boxSizing: 'border-box', borderWidth: 1, borderStyle: 'solid', borderRadius: 4, color: '#fff' }, signalClipBody: { position: 'absolute', inset: '0 6px', overflow: 'hidden', border: 0, background: 'transparent', color: 'inherit', fontSize: 9, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }, resizeHandle: { position: 'absolute', top: 0, bottom: 0, width: 7, border: 0, borderRadius: 3, background: 'rgba(255,255,255,.3)', cursor: 'ew-resize' }, clipExecuted: { background: '#287a4c', borderColor: '#67d99a' }, clipMissed: { background: '#71313a', borderColor: '#ff788c' }, clipSelected: { outline: '2px solid #fff' }, outcome: { position: 'absolute', top: 4, width: 3, height: 36, background: '#ff5e7a' }, playhead: { position: 'absolute', top: 0, bottom: 0, width: 1, background: '#ff8551' }, editor: { position: 'fixed', zIndex: 32, bottom: 104, width: 340, padding: 14, borderRadius: 8, background: '#22262d', border: '1px solid #555c68', fontSize: 10 }, editorHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontSize: 13 }, editorContext: { color: '#9ba4b2', fontSize: 10 }, close: { border: 0, background: 'transparent', color: '#eee', fontSize: 18 }, field: { display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, alignItems: 'center', marginBottom: 8, color: '#aab3c1' }, resourceHint: { padding: 7, borderRadius: 4, background: '#29333f', color: '#9eb8d3' }, editorActions: { display: 'flex', gap: 6, marginTop: 10 }, save: { flex: 1, padding: 8, background: '#286aa8', color: '#fff', border: 0, borderRadius: 5 }, delete: { padding: 8, background: '#52252c', color: '#ffabb8', border: 0, borderRadius: 5 } };
