import {
  type Interaction,
  type ScenarioTemplateV2,
  type Trigger,
} from '@uniscenarios/scenario-model';

/** The authoring timeline deliberately has only two primary rows per actor. */
export type TimelineTrackKind = 'speed' | 'actions';

export interface TimelineItem {
  readonly interaction: Interaction;
  readonly actorId: string;
  readonly track: TimelineTrackKind;
  readonly anchorTime: number;
  readonly endTime: number;
  readonly unresolved: boolean;
}

export interface TimelineActorGroup {
  readonly actorId: string;
  readonly label: string;
  readonly actorClass: ScenarioTemplateV2['roles'][number]['actor']['class'];
  readonly catalogId?: string;
  /** Objects are listed so they remain discoverable/deletable, but have no motion tracks. */
  readonly compact: boolean;
  readonly tracks: Readonly<Record<TimelineTrackKind, readonly TimelineItem[]>>;
}

export interface TraceOutcomeMarker {
  readonly interactionId?: string;
  readonly actorId?: string;
  readonly time: number;
  readonly kind: string;
  readonly label?: string;
}

const TRACKS: readonly TimelineTrackKind[] = ['speed', 'actions'];

export function timelineTrack(interaction: Interaction): TimelineTrackKind {
  return interaction.verb === 'speed' || interaction.verb === 'gap' ? 'speed' : 'actions';
}

export function triggerAnchor(
  trigger: Trigger,
  interactions: readonly Interaction[],
  clipSeconds: number,
  seen = new Set<string>(),
): { time: number; unresolved: boolean } {
  if (trigger.kind === 'at') return numeric(trigger.t) === null
    ? { time: 0, unresolved: true }
    : { time: clamp(numeric(trigger.t) as number, 0, clipSeconds), unresolved: false };
  if (trigger.kind === 'when') {
    const deadline = numeric(trigger.byLatest);
    return { time: clamp(deadline ?? clipSeconds * 0.5, 0, clipSeconds), unresolved: true };
  }
  if (trigger.kind === 'arrival') return { time: clipSeconds * 0.5, unresolved: true };
  if (seen.has(trigger.of)) return { time: 0, unresolved: true };
  const dependency = interactions.find((item) => item.id === trigger.of);
  if (!dependency) return { time: 0, unresolved: true };
  seen.add(trigger.of);
  const base = triggerAnchor(dependency.trigger, interactions, clipSeconds, seen);
  const delay = numeric(trigger.delayS) ?? 0;
  return { time: clamp(base.time + delay, 0, clipSeconds), unresolved: base.unresolved };
}

export function buildTimelineGroups(template: ScenarioTemplateV2): TimelineActorGroup[] {
  const empty = (): Record<TimelineTrackKind, TimelineItem[]> => ({
    speed: [], actions: [],
  });
  const groups = new Map<string, TimelineActorGroup & { tracks: Record<TimelineTrackKind, TimelineItem[]> }>();
  for (const role of template.roles) {
    groups.set(role.id, {
      actorId: role.id,
      label: role.label ?? role.actor.catalogId ?? role.id,
      actorClass: role.actor.class,
      ...(role.actor.catalogId ? { catalogId: role.actor.catalogId } : {}),
      compact: role.actor.class === 'static_object',
      tracks: empty(),
    });
  }
  for (const interaction of template.choreography.interactions) {
    const anchor = triggerAnchor(interaction.trigger, template.choreography.interactions, template.choreography.clipSeconds);
    const until = interaction.until
      ? triggerAnchor(interaction.until, template.choreography.interactions, template.choreography.clipSeconds).time
      : Math.min(template.choreography.clipSeconds, anchor.time + interactionDuration(interaction));
    const group = groups.get(interaction.actor);
    if (!group) continue;
    const track = timelineTrack(interaction);
    group.tracks[track].push({
      interaction,
      actorId: interaction.actor,
      track,
      anchorTime: anchor.time,
      endTime: Math.max(anchor.time + 0.1, until),
      unresolved: anchor.unresolved,
    });
  }
  for (const group of groups.values()) {
    for (const track of TRACKS) group.tracks[track].sort((a, b) => a.anchorTime - b.anchorTime);
  }
  return [...groups.values()];
}

export function moveInteraction(interaction: Interaction, time: number): Interaction {
  return { ...interaction, trigger: { kind: 'at', t: Math.max(0, Number(time.toFixed(3))) } } as Interaction;
}

export function newSpeedInteraction(actorId: string, time: number, ordinal: number): Interaction {
  return {
    id: `speed_${actorId}_${ordinal}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64),
    actor: actorId,
    trigger: { kind: 'at', t: Math.max(0, Number(time.toFixed(3))) },
    verb: 'speed',
    target: { mode: 'absolute', valueKph: 30 },
    dynamics: { shape: 'linear', constraint: 'time', value: 1 },
  };
}

export function triggerLabel(trigger: Trigger): string {
  if (trigger.kind === 'at') return `at ${formatNumeric(trigger.t)}s`;
  if (trigger.kind === 'after') return `after ${trigger.of}`;
  if (trigger.kind === 'when') return `when ${trigger.condition.kind}`;
  return `arrival ${trigger.of} ↔ ${trigger.syncWith}`;
}

function interactionDuration(interaction: Interaction): number {
  if ('dynamics' in interaction && interaction.dynamics?.constraint === 'time') {
    return Math.max(0.2, numeric(interaction.dynamics.value) ?? 1);
  }
  return 0.35;
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatNumeric(value: unknown): string {
  return numeric(value)?.toFixed(1) ?? 'expr';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
