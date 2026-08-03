import type { Interaction, MapSignalPlan, MapSignalPlanClip, ScenarioTemplateV2, Trigger } from '@uniscenarios/scenario-model';
import { actionResource, isActionCompatible, type ActionResource } from './actions';

export type TimelineTrackKind = 'actions';
export const MIN_TIMELINE_CLIP_SECONDS = 0.2;
export const TIMELINE_LAYOUT_EXTENSION_KEY = 'studio.presentation.timeline.v1';
export interface TimelineItem { readonly interaction: Interaction; readonly actorId: string; readonly track: TimelineTrackKind; readonly resource: ActionResource; readonly anchorTime: number; readonly endTime: number; readonly unresolved: boolean; }
export interface TimelineActionLane { readonly index: number; readonly items: readonly TimelineItem[]; }
export interface TimelineActorGroup { readonly actorId: string; readonly label: string; readonly actorClass: ScenarioTemplateV2['roles'][number]['actor']['class']; readonly catalogId?: string; readonly compact: boolean; readonly tracks: Readonly<Record<TimelineTrackKind, readonly TimelineItem[]>>; readonly lanes: readonly TimelineActionLane[]; }
export interface TimelineMapSignalClip {
  readonly planId: string;
  readonly junctionId: string;
  readonly clip: MapSignalPlanClip;
  readonly anchorTime: number;
  readonly endTime: number;
}
export interface TimelineMapSignalGroup {
  readonly plan: MapSignalPlan;
  readonly planId: string;
  readonly junctionId: string;
  readonly label: string;
  readonly clips: readonly TimelineMapSignalClip[];
}
export interface TraceOutcomeMarker { readonly interactionId?: string; readonly actorId?: string; readonly time: number; readonly kind: string; readonly label?: string; }

export interface TimelineOutcomeEvent {
  readonly t: number;
  readonly kind: string;
  readonly interactionId?: string;
  readonly actorId?: string;
}

export interface TimelineInitialInteractionOutcome {
  readonly interactionId: string;
  readonly actorId: string;
  readonly verb: string;
  readonly timeS: number;
  readonly outcome: 'executed';
  readonly basis: 'folded_initial_state';
}

export interface TimelineMaterializationNote {
  readonly path: string;
  readonly reason: string;
}

/**
 * Trigger evidence indexed once per concrete trace revision.
 *
 * Simulation traces also contain collisions, lane changes, signal events, and
 * ambient-traffic evidence. None of those can decide an authored clip's UI
 * outcome. Restricting the index to document interaction ids both keeps the
 * playback hot path small and prevents a native/SUMO ambient provider from
 * accidentally changing authored action badges.
 */
export function buildTimelineOutcomeIndex(
  events: readonly TimelineOutcomeEvent[],
  interactions: readonly Pick<Interaction, 'id' | 'actor'>[],
  initialOutcomes: readonly TimelineInitialInteractionOutcome[] = [],
): readonly TraceOutcomeMarker[] {
  const actorsByInteraction = new Map(interactions.map((interaction) => [interaction.id, interaction.actor]));
  const runtime = events.flatMap((event): TraceOutcomeMarker[] => {
    if ((event.kind !== 'trigger_fired' && event.kind !== 'trigger_skipped') || !event.interactionId) return [];
    const actorId = actorsByInteraction.get(event.interactionId);
    if (!actorId || !Number.isFinite(event.t)) return [];
    return [{
      interactionId: event.interactionId,
      actorId,
      time: event.t,
      kind: event.kind,
    }];
  });
  const initial = initialOutcomes.flatMap((outcome): TraceOutcomeMarker[] => {
    const actorId = actorsByInteraction.get(outcome.interactionId);
    if (!actorId || outcome.outcome !== 'executed' || !Number.isFinite(outcome.timeS)) return [];
    return [{ interactionId: outcome.interactionId, actorId, time: outcome.timeS, kind: 'trigger_fired' }];
  });
  return [...initial, ...runtime].sort((left, right) => left.time - right.time
    || String(left.interactionId).localeCompare(String(right.interactionId)));
}

/**
 * Read canonical materializer outcomes, with a compatibility bridge for
 * manifest-v1 evidence written before the structured field existed.
 */
export function initialTimelineOutcomesFromManifest(
  interactions: readonly Pick<Interaction, 'id' | 'actor' | 'verb'>[],
  structured: unknown,
  notes: unknown,
): readonly TimelineInitialInteractionOutcome[] {
  const routeIds = new Set(interactions.filter((item) => item.verb === 'route').map((item) => item.id));
  const accepted = new Map<string, TimelineInitialInteractionOutcome>();
  const structuredOutcomes = Array.isArray(structured)
    ? structured.filter(isInitialInteractionOutcome)
    : [];
  for (const outcome of structuredOutcomes) {
    if (!routeIds.has(outcome.interactionId) || outcome.verb !== 'route') continue;
    accepted.set(outcome.interactionId, outcome);
  }
  const materializationNotes = Array.isArray(notes) ? notes.filter(isMaterializationNote) : [];
  for (const note of materializationNotes) {
    const match = /^choreography\.interactions\.([A-Za-z0-9_-]+)$/.exec(note.path);
    const interactionId = match?.[1];
    if (!interactionId || !routeIds.has(interactionId) || !/route\([^)]*\).*folded into .*spawn route/i.test(note.reason)) continue;
    const interaction = interactions.find((item) => item.id === interactionId)!;
    const time = /\bat t=(-?\d+(?:\.\d+)?)/i.exec(note.reason)?.[1];
    accepted.set(interactionId, {
      interactionId,
      actorId: interaction.actor,
      verb: 'route',
      timeS: time === undefined ? 0 : Number(time),
      outcome: 'executed',
      basis: 'folded_initial_state',
    });
  }
  return [...accepted.values()];
}

function isInitialInteractionOutcome(value: unknown): value is TimelineInitialInteractionOutcome {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item['interactionId'] === 'string'
    && typeof item['actorId'] === 'string'
    && typeof item['verb'] === 'string'
    && typeof item['timeS'] === 'number'
    && item['outcome'] === 'executed'
    && item['basis'] === 'folded_initial_state';
}

function isMaterializationNote(value: unknown): value is TimelineMaterializationNote {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item['path'] === 'string' && typeof item['reason'] === 'string';
}

/** Project immutable canonical evidence at one playhead position. */
export function timelineOutcomesAt(
  index: readonly TraceOutcomeMarker[],
  time: number,
): readonly TraceOutcomeMarker[] {
  const inclusiveTime = Number.isFinite(time) ? Math.max(0, time) + 1e-9 : 0;
  const visible: TraceOutcomeMarker[] = [];
  // The index is time-sorted, so ordinary playback only walks its short prefix.
  // Seeking backwards is deterministic because no outcome state is retained.
  for (const marker of index) {
    if (marker.time > inclusiveTime) break;
    visible.push(marker);
  }
  return visible;
}

export function timelineTrack(_interaction: Interaction): TimelineTrackKind { return 'actions'; }
export function triggerAnchor(trigger: Trigger, interactions: readonly Interaction[], clipSeconds: number, seen = new Set<string>()): { time: number; unresolved: boolean } {
  if (trigger.kind === 'at') return numeric(trigger.t) === null ? { time: 0, unresolved: true } : { time: clamp(numeric(trigger.t)!, 0, clipSeconds), unresolved: false };
  if (trigger.kind === 'when') return { time: clamp(numeric(trigger.byLatest) ?? clipSeconds * .5, 0, clipSeconds), unresolved: true };
  if (trigger.kind === 'arrival') return { time: clipSeconds * .5, unresolved: true };
  if (seen.has(trigger.of)) return { time: 0, unresolved: true };
  const dependency = interactions.find((item) => item.id === trigger.of);
  if (!dependency) return { time: 0, unresolved: true };
  seen.add(trigger.of);
  const base = triggerAnchor(dependency.trigger, interactions, clipSeconds, seen);
  return { time: clamp(base.time + (numeric(trigger.delayS) ?? 0), 0, clipSeconds), unresolved: base.unresolved };
}

export interface TimelineLanePreferences { readonly [interactionId: string]: number; }
export interface TimelineClipRange { readonly start: number; readonly end: number; }
export type TimelineClipEditMode = 'move' | 'resize-start' | 'resize-end';

export function timelineLanePreferences(extensions: ScenarioTemplateV2['extensions']): TimelineLanePreferences {
  const value = extensions?.[TIMELINE_LAYOUT_EXTENSION_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const lanes = (value as Record<string, unknown>)['lanes'];
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) return {};
  return Object.fromEntries(Object.entries(lanes as Record<string, unknown>).flatMap(([id, lane]) =>
    typeof lane === 'number' && Number.isInteger(lane) && lane >= 0 ? [[id, lane]] : []));
}

export function timelineLayoutExtension(lanes: TimelineLanePreferences): { readonly version: 1; readonly lanes: TimelineLanePreferences } {
  return { version: 1, lanes: Object.fromEntries(Object.entries(lanes).filter(([, lane]) => Number.isInteger(lane) && lane >= 0)) };
}

export function buildTimelineGroups(template: ScenarioTemplateV2, lanePreferences = timelineLanePreferences(template.extensions)): TimelineActorGroup[] {
  return template.roles.map((role) => {
    const items = template.choreography.interactions.flatMap((interaction): TimelineItem[] => {
      if (interaction.actor !== role.id || !isActionCompatible(interaction, role.actor.class, role.actor.catalogId)) return [];
      const resource = actionResource(interaction); if (!resource) return [];
      const anchor = triggerAnchor(interaction.trigger, template.choreography.interactions, template.choreography.clipSeconds);
      const end = interaction.until ? triggerAnchor(interaction.until, template.choreography.interactions, template.choreography.clipSeconds).time : Math.min(template.choreography.clipSeconds, anchor.time + interactionDuration(interaction));
      return [{ interaction, actorId: role.id, track: 'actions', resource, anchorTime: anchor.time, endTime: Math.max(anchor.time + .1, end), unresolved: anchor.unresolved }];
    }).sort((a, b) => a.anchorTime - b.anchorTime);
    return { actorId: role.id, label: role.label ?? role.actor.catalogId ?? role.id, actorClass: role.actor.class, ...(role.actor.catalogId ? { catalogId: role.actor.catalogId } : {}), compact: role.actor.class === 'static_object', tracks: { actions: items }, lanes: packActionLanes(items, lanePreferences) };
  });
}

/** Project map-bound controller programs without turning physical lamp heads into actors. */
export function buildMapSignalTimelineGroups(template: ScenarioTemplateV2): TimelineMapSignalGroup[] {
  return (template.mapSignalPlans ?? []).map((plan) => ({
    plan,
    planId: plan.id,
    junctionId: plan.binding.junctionId,
    label: `Intersection ${plan.binding.junctionId}`,
    clips: [...plan.clips]
      .sort((left, right) => left.startS - right.startS || left.endS - right.endS || left.id.localeCompare(right.id))
      .map((clip) => ({ planId: plan.id, junctionId: plan.binding.junctionId, clip, anchorTime: clip.startS, endTime: clip.endS })),
  }));
}

export type MapSignalClipEditResult =
  | { readonly ok: true; readonly plan: MapSignalPlan }
  | { readonly ok: false; readonly message: string };

/**
 * Replace one half-open controller clip and keep the plan in canonical time order.
 * Adjacent clips are legal; positive overlap is not, because one controller must
 * own one atomic phase at every instant.
 */
export function editMapSignalPlanClip(
  plan: MapSignalPlan,
  clip: MapSignalPlanClip,
  durationS: number,
): MapSignalClipEditResult {
  if (!Number.isFinite(clip.startS) || !Number.isFinite(clip.endS)
    || clip.startS < 0 || clip.endS > durationS || clip.endS - clip.startS < .1) {
    return { ok: false, message: `Signal clips must be at least 0.1 seconds and stay inside 0–${durationS} seconds.` };
  }
  const conflict = plan.clips.find((item) => item.id !== clip.id
    && clip.startS < item.endS && item.startS < clip.endS);
  if (conflict) {
    return { ok: false, message: `This signal clip overlaps “${conflict.id}”. A controller can have only one authored phase at a time.` };
  }
  const clips = [...plan.clips.filter((item) => item.id !== clip.id), clip]
    .sort((left, right) => left.startS - right.startS || left.id.localeCompare(right.id));
  return { ok: true, plan: { ...plan, clips } };
}

export function moveMapSignalPlanClip(
  plan: MapSignalPlan,
  clipId: string,
  startS: number,
  durationS: number,
): MapSignalClipEditResult {
  const clip = plan.clips.find((item) => item.id === clipId);
  if (!clip) return { ok: false, message: `Signal clip “${clipId}” no longer exists.` };
  const width = clip.endS - clip.startS;
  const start = clamp(Number(startS.toFixed(3)), 0, Math.max(0, durationS - width));
  return editMapSignalPlanClip(plan, { ...clip, startS: start, endS: Number((start + width).toFixed(3)) }, durationS);
}

export function resizeMapSignalPlanClip(
  plan: MapSignalPlan,
  clipId: string,
  edge: 'start' | 'end',
  timeS: number,
  durationS: number,
): MapSignalClipEditResult {
  const clip = plan.clips.find((item) => item.id === clipId);
  if (!clip) return { ok: false, message: `Signal clip “${clipId}” no longer exists.` };
  const time = Number(clamp(timeS, 0, durationS).toFixed(3));
  return editMapSignalPlanClip(plan, edge === 'start'
    ? { ...clip, startS: Math.min(time, clip.endS - .1) }
    : { ...clip, endS: Math.max(time, clip.startS + .1) }, durationS);
}

/** Preferred lanes are honored when possible; overlap spills into an unbounded
 * parallel lane and empty placeholders are compacted away afterwards. */
export function packActionLanes(items: readonly TimelineItem[], preferences: TimelineLanePreferences = {}): TimelineActionLane[] {
  const lanes: TimelineItem[][] = [];
  const sorted = [...items].sort((a, b) => {
    const aPreferred = preferences[a.interaction.id]; const bPreferred = preferences[b.interaction.id];
    if (aPreferred !== undefined || bPreferred !== undefined) return (aPreferred ?? Number.MAX_SAFE_INTEGER) - (bPreferred ?? Number.MAX_SAFE_INTEGER) || a.anchorTime - b.anchorTime;
    return a.anchorTime - b.anchorTime || a.endTime - b.endTime;
  });
  for (const item of sorted) {
    const preferred = preferences[item.interaction.id];
    let index = preferred === undefined
      ? lanes.findIndex((candidate) => candidate.every((other) => !overlaps(item, other)))
      : Math.min(preferred, lanes.length);
    if (index < 0) index = lanes.length;
    while (true) {
      while (lanes.length <= index) lanes.push([]);
      const lane = lanes[index]!;
      if (lane.every((other) => !overlaps(item, other))) { lane.push(item); break; }
      index++;
    }
  }
  const compact = lanes.filter((lane) => lane.length > 0);
  return (compact.length ? compact : [[]]).map((lane, index) => ({ index, items: lane.sort((a, b) => a.anchorTime - b.anchorTime) }));
}

export function conflictingAction(candidate: TimelineItem, items: readonly TimelineItem[], ignoreId?: string): TimelineItem | undefined {
  return items.find((item) => item.interaction.id !== ignoreId && item.resource === candidate.resource && overlaps(candidate, item));
}
export function moveInteraction(interaction: Interaction, time: number): Interaction {
  const start = Math.max(0, Number(time.toFixed(3)));
  const oldStart = interaction.trigger.kind === 'at' ? numeric(interaction.trigger.t) : null;
  const oldEnd = interaction.until?.kind === 'at' ? numeric(interaction.until.t) : null;
  const until = oldStart !== null && oldEnd !== null
    ? { kind: 'at' as const, t: Number((start + Math.max(.1, oldEnd - oldStart)).toFixed(3)) }
    : interaction.until;
  return { ...interaction, trigger: { kind: 'at', t: start }, ...(until ? { until } : {}) } as Interaction;
}
export function editTimelineClipRange(origin: TimelineClipRange, mode: TimelineClipEditMode, deltaSeconds: number, duration: number, minimum = MIN_TIMELINE_CLIP_SECONDS): TimelineClipRange {
  const clipDuration = Math.max(minimum, origin.end - origin.start);
  if (mode === 'move') {
    const start = clamp(origin.start + deltaSeconds, 0, Math.max(0, duration - clipDuration));
    return roundedRange(start, start + clipDuration);
  }
  if (mode === 'resize-start') return roundedRange(clamp(origin.start + deltaSeconds, 0, origin.end - minimum), origin.end);
  return roundedRange(origin.start, clamp(origin.end + deltaSeconds, origin.start + minimum, duration));
}
export function interactionWithTimelineRange(interaction: Interaction, range: TimelineClipRange): Interaction {
  const start = Number(range.start.toFixed(3)); const end = Number(range.end.toFixed(3));
  return { ...interaction, trigger: { kind: 'at' as const, t: start }, until: { kind: 'at' as const, t: end } } as Interaction;
}
/** Only an already absolute eligibility window can be rewritten by timeline gestures. */
export function isTimelineRangeEditable(interaction: Interaction): boolean {
  return interaction.trigger.kind === 'at' && (!interaction.until || interaction.until.kind === 'at');
}
/** Compatibility helper for non-UI session tests; speed commands now render as actions. */
export function newSpeedInteraction(actorId: string, time: number, ordinal: number): Interaction { return { id: `speed_${actorId}_${ordinal}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64), actor: actorId, trigger: { kind: 'at', t: Math.max(0, Number(time.toFixed(3))) }, verb: 'speed', target: { mode: 'absolute', valueKph: 30 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 } }; }
export function triggerLabel(trigger: Trigger): string { if (trigger.kind === 'at') return `at ${formatNumeric(trigger.t)}s`; if (trigger.kind === 'after') return `after ${trigger.of}`; if (trigger.kind === 'when') return `when ${trigger.condition.kind}`; return `arrival ${trigger.of} ↔ ${trigger.syncWith}`; }
function overlaps(a: Pick<TimelineItem, 'anchorTime' | 'endTime'>, b: Pick<TimelineItem, 'anchorTime' | 'endTime'>): boolean { return a.anchorTime < b.endTime && b.anchorTime < a.endTime; }
function interactionDuration(interaction: Interaction): number { return 'dynamics' in interaction && interaction.dynamics?.constraint === 'time' ? Math.max(.2, numeric(interaction.dynamics.value) ?? 1) : .35; }
function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function formatNumeric(value: unknown): string { return numeric(value)?.toFixed(1) ?? 'expr'; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function roundedRange(start: number, end: number): TimelineClipRange { return { start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) }; }
