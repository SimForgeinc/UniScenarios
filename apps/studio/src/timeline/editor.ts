import {
  InteractionSchema,
  type Interaction,
  type Trigger,
  type Verb,
} from '@uniscenarios/scenario-model';

export type TriggerKind = Trigger['kind'];

export interface InteractionDraft {
  id: string;
  actor: string;
  label: string;
  verb: Verb;
  triggerKind: TriggerKind;
  time: number;
  afterId: string;
  afterEvent: 'start' | 'end';
  delayS: number;
  byLatest: number;
  ifNever: 'skip' | 'fire';
  conditionJson: string;
  arrivalOf: string;
  arrivalAtJson: string;
  syncWith: string;
  arrivalMode: 'ttc' | 'deltaT';
  arrivalValue: number;
  speedMode: 'absolute' | 'delta' | 'factor' | 'match' | 'stop' | 'resume';
  speedValue: number;
  dynamicsShape: 'step' | 'linear' | 'sinusoidal' | 'cubic';
  dynamicsConstraint: 'rate' | 'time' | 'distance';
  dynamicsValue: number;
  targetJson: string;
}

export type DraftResult = { ok: true; interaction: Interaction } | { ok: false; error: string };

export function createInteractionDraft(actor: string, time: number, ordinal: number): InteractionDraft {
  return {
    id: uniqueInteractionId('speed', actor, ordinal), actor, label: 'Set speed', verb: 'speed',
    triggerKind: 'at', time, afterId: '', afterEvent: 'start', delayS: 0,
    byLatest: Math.max(time, 10), ifNever: 'skip',
    conditionJson: JSON.stringify({ kind: 'speed', of: actor, op: '<=', valueKph: 10 }),
    arrivalOf: actor, arrivalAtJson: JSON.stringify({ role: actor }), syncWith: actor,
    arrivalMode: 'ttc', arrivalValue: 1.5,
    speedMode: 'absolute', speedValue: 30,
    dynamicsShape: 'linear', dynamicsConstraint: 'time', dynamicsValue: 1,
    targetJson: JSON.stringify({ mode: 'absolute', valueKph: 30 }),
  };
}

export function draftFromInteraction(interaction: Interaction): InteractionDraft {
  const draft = createInteractionDraft(interaction.actor, numericAt(interaction.trigger), 1);
  draft.id = interaction.id;
  draft.label = interaction.label ?? '';
  draft.verb = interaction.verb;
  draft.triggerKind = interaction.trigger.kind;
  if (interaction.trigger.kind === 'after') {
    draft.afterId = interaction.trigger.of;
    draft.afterEvent = interaction.trigger.event;
    draft.delayS = numberOr(interaction.trigger.delayS, 0);
  } else if (interaction.trigger.kind === 'when') {
    draft.byLatest = numberOr(interaction.trigger.byLatest, 10);
    draft.ifNever = interaction.trigger.ifNever;
    draft.conditionJson = JSON.stringify(interaction.trigger.condition, null, 2);
  } else if (interaction.trigger.kind === 'arrival') {
    draft.arrivalOf = interaction.trigger.of;
    draft.arrivalAtJson = JSON.stringify(interaction.trigger.at, null, 2);
    draft.syncWith = interaction.trigger.syncWith;
    if (interaction.trigger.ttc !== undefined) {
      draft.arrivalMode = 'ttc';
      draft.arrivalValue = numberOr(interaction.trigger.ttc, 1.5);
    } else {
      draft.arrivalMode = 'deltaT';
      draft.arrivalValue = numberOr(interaction.trigger.deltaT, 0);
    }
  }
  draft.targetJson = JSON.stringify(interaction.target, null, 2);
  if (interaction.verb === 'speed') {
    draft.speedMode = interaction.target.mode;
    if (interaction.target.mode === 'absolute') draft.speedValue = numberOr(interaction.target.valueKph, 30);
    else if (interaction.target.mode === 'delta') draft.speedValue = numberOr(interaction.target.deltaKph, 0);
    else if (interaction.target.mode === 'factor') draft.speedValue = numberOr(interaction.target.factor, 1);
  }
  if ('dynamics' in interaction && interaction.dynamics) {
    draft.dynamicsShape = interaction.dynamics.shape;
    draft.dynamicsConstraint = interaction.dynamics.constraint;
    draft.dynamicsValue = numberOr(interaction.dynamics.value, 1);
  }
  return draft;
}

export function interactionFromDraft(draft: InteractionDraft): DraftResult {
  try {
    const trigger = triggerFromDraft(draft);
    const target = draft.verb === 'speed' ? speedTarget(draft) : parseObject(draft.targetJson, 'Target');
    const candidate: Record<string, unknown> = {
      id: draft.id.trim(), actor: draft.actor, trigger, verb: draft.verb, target,
      ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
    };
    if (draft.verb === 'speed' || draft.verb === 'gap' || draft.verb === 'changeLane' || draft.verb === 'laneOffset') {
      candidate['dynamics'] = {
        shape: draft.dynamicsShape,
        constraint: draft.dynamicsConstraint,
        value: draft.dynamicsValue,
      };
    }
    const parsed = InteractionSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(' · ') };
    }
    return { ok: true, interaction: parsed.data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function defaultTargetJson(verb: Verb, actor: string): string {
  const target: Record<Verb, unknown> = {
    speed: { mode: 'absolute', valueKph: 30 },
    gap: { role: actor, value: 1.5, unit: 'time' },
    changeLane: { mode: 'relative', dk: 1 },
    laneOffset: { tFrac: 0.2, reference: 'lane_center' },
    route: { mode: 'acquire', pose: { laneOffset: 0, s: 0, tFrac: 0, headingOffsetRad: 0 } },
    exist: { state: 'present' },
    set: { key: 'lights.indicator', value: 'left' },
  };
  return JSON.stringify(target[verb], null, 2);
}

function triggerFromDraft(draft: InteractionDraft): Trigger {
  if (draft.triggerKind === 'at') return { kind: 'at', t: draft.time };
  if (draft.triggerKind === 'after') {
    return { kind: 'after', of: draft.afterId, event: draft.afterEvent, delayS: draft.delayS };
  }
  if (draft.triggerKind === 'when') {
    return { kind: 'when', condition: parseObject(draft.conditionJson, 'Condition') as never, byLatest: draft.byLatest, ifNever: draft.ifNever };
  }
  const at = parseObject(draft.arrivalAtJson, 'Arrival point') as never;
  return {
    kind: 'arrival', of: draft.arrivalOf, at, syncWith: draft.syncWith,
    ...(draft.arrivalMode === 'ttc' ? { ttc: draft.arrivalValue } : { deltaT: draft.arrivalValue }),
  };
}

function speedTarget(draft: InteractionDraft): unknown {
  if (draft.speedMode === 'absolute') return { mode: 'absolute', valueKph: draft.speedValue };
  if (draft.speedMode === 'delta') return { mode: 'delta', deltaKph: draft.speedValue };
  if (draft.speedMode === 'factor') return { mode: 'factor', factor: draft.speedValue };
  if (draft.speedMode === 'match') return parseObject(draft.targetJson, 'Speed target');
  return { mode: draft.speedMode };
}

function parseObject(text: string, label: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function numericAt(trigger: Trigger): number {
  return trigger.kind === 'at' ? numberOr(trigger.t, 0) : 0;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function uniqueInteractionId(verb: string, actor: string, ordinal: number): string {
  return `${verb}_${actor}_${ordinal}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}
