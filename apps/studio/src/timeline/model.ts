import type { Interaction, ScenarioTemplateV2, Trigger } from '@uniscenarios/scenario-model';
import { actionResource, isActionCompatible, type ActionResource } from './actions';

export type TimelineTrackKind = 'actions';
export interface TimelineItem { readonly interaction: Interaction; readonly actorId: string; readonly track: TimelineTrackKind; readonly resource: ActionResource; readonly anchorTime: number; readonly endTime: number; readonly unresolved: boolean; }
export interface TimelineActionLane { readonly index: number; readonly items: readonly TimelineItem[]; }
export interface TimelineActorGroup { readonly actorId: string; readonly label: string; readonly actorClass: ScenarioTemplateV2['roles'][number]['actor']['class']; readonly catalogId?: string; readonly compact: boolean; readonly tracks: Readonly<Record<TimelineTrackKind, readonly TimelineItem[]>>; readonly lanes: readonly TimelineActionLane[]; }
export interface TraceOutcomeMarker { readonly interactionId?: string; readonly actorId?: string; readonly time: number; readonly kind: string; readonly label?: string; }

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

export function buildTimelineGroups(template: ScenarioTemplateV2): TimelineActorGroup[] {
  return template.roles.map((role) => {
    const items = template.choreography.interactions.flatMap((interaction): TimelineItem[] => {
      if (interaction.actor !== role.id || !isActionCompatible(interaction, role.actor.class, role.actor.catalogId)) return [];
      const resource = actionResource(interaction); if (!resource) return [];
      const anchor = triggerAnchor(interaction.trigger, template.choreography.interactions, template.choreography.clipSeconds);
      const end = interaction.until ? triggerAnchor(interaction.until, template.choreography.interactions, template.choreography.clipSeconds).time : Math.min(template.choreography.clipSeconds, anchor.time + interactionDuration(interaction));
      return [{ interaction, actorId: role.id, track: 'actions', resource, anchorTime: anchor.time, endTime: Math.max(anchor.time + .1, end), unresolved: anchor.unresolved }];
    }).sort((a, b) => a.anchorTime - b.anchorTime);
    return { actorId: role.id, label: role.label ?? role.actor.catalogId ?? role.id, actorClass: role.actor.class, ...(role.actor.catalogId ? { catalogId: role.actor.catalogId } : {}), compact: role.actor.class === 'static_object', tracks: { actions: items }, lanes: packActionLanes(items) };
  });
}

/** Greedy interval packing creates only the parallel rows the actor actually needs. */
export function packActionLanes(items: readonly TimelineItem[]): TimelineActionLane[] {
  const lanes: TimelineItem[][] = [];
  for (const item of [...items].sort((a, b) => a.anchorTime - b.anchorTime || a.endTime - b.endTime)) {
    let lane = lanes.find((candidate) => candidate.every((other) => !overlaps(item, other)));
    if (!lane) { lane = []; lanes.push(lane); }
    lane.push(item);
  }
  return (lanes.length ? lanes : [[]]).map((lane, index) => ({ index, items: lane }));
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
/** Compatibility helper for non-UI session tests; speed commands now render as actions. */
export function newSpeedInteraction(actorId: string, time: number, ordinal: number): Interaction { return { id: `speed_${actorId}_${ordinal}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64), actor: actorId, trigger: { kind: 'at', t: Math.max(0, Number(time.toFixed(3))) }, verb: 'speed', target: { mode: 'absolute', valueKph: 30 }, dynamics: { shape: 'linear', constraint: 'time', value: 1 } }; }
export function triggerLabel(trigger: Trigger): string { if (trigger.kind === 'at') return `at ${formatNumeric(trigger.t)}s`; if (trigger.kind === 'after') return `after ${trigger.of}`; if (trigger.kind === 'when') return `when ${trigger.condition.kind}`; return `arrival ${trigger.of} ↔ ${trigger.syncWith}`; }
function overlaps(a: Pick<TimelineItem, 'anchorTime' | 'endTime'>, b: Pick<TimelineItem, 'anchorTime' | 'endTime'>): boolean { return a.anchorTime < b.endTime && b.anchorTime < a.endTime; }
function interactionDuration(interaction: Interaction): number { return 'dynamics' in interaction && interaction.dynamics?.constraint === 'time' ? Math.max(.2, numeric(interaction.dynamics.value) ?? 1) : .35; }
function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function formatNumeric(value: unknown): string { return numeric(value)?.toFixed(1) ?? 'expr'; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
