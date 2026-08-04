import { z } from 'zod';

export const DirectPlacementSlotSchema = z.strictObject({
  id: z.string().min(1).max(160),
  actorKinds: z.array(z.enum(['vehicle', 'pedestrian', 'prop'])).min(1).max(3),
  catalogIds: z.array(z.string().min(1).max(200)).max(64).optional(),
  pose: z.strictObject({ x: z.number(), y: z.number(), z: z.number(), headingRad: z.number().min(-Math.PI * 2).max(Math.PI * 2) }),
  laneRef: z.strictObject({
    roadId: z.string().min(1), section: z.number().int().min(0), laneId: z.number().int(),
    s: z.number().min(0), t: z.number(), headingOffsetRad: z.number(),
  }).optional(),
  routeLaneRsls: z.array(z.string().min(1)).min(1).max(128).optional(),
  recommendedSpeedKph: z.number().min(0).max(160).optional(),
  labels: z.array(z.string().min(1).max(160)).max(32).default([]),
});

export const DirectMapContextSchema = z.strictObject({
  mapId: z.string().min(1).max(200),
  mapName: z.string().min(1).max(240),
  xodrSha256: z.string().nullable(),
  laneCount: z.number().int().min(0),
  junctionLaneCount: z.number().int().min(0),
  bounds: z.strictObject({ minX: z.number(), minZ: z.number(), maxX: z.number(), maxZ: z.number() }),
  placementSlots: z.array(DirectPlacementSlotSchema).min(1).max(128),
});

export const DirectActionDraftSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  actorId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  kind: z.enum(['speed', 'changeLane', 'laneOffset']),
  startS: z.number().min(0).max(120),
  durationS: z.number().min(0.1).max(120),
  value: z.number(),
  label: z.string().max(200),
});

export const DirectActorDraftSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  label: z.string().min(1).max(200),
  catalogId: z.string().min(1).max(200),
  slotId: z.string().min(1).max(160),
  initialSpeedKph: z.number().min(0).max(160),
});

export const DirectNativeDraftSchema = z.strictObject({
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  actors: z.array(DirectActorDraftSchema).min(1).max(32),
  actions: z.array(DirectActionDraftSchema).max(128),
  reasoningSummary: z.string().max(2000),
});

export const DirectGenerationRequestSchema = z.strictObject({
  prompt: z.string().min(3).max(12_000),
  mapContext: DirectMapContextSchema,
  providerId: z.literal('direct-llm'),
  currentScenario: z.unknown().optional(),
  maxCandidates: z.number().int().min(1).max(5).default(1),
  model: z.string().min(1).max(200).optional(),
  evaluationMode: z.literal('deterministic').optional(),
});

export type DirectPlacementSlot = z.infer<typeof DirectPlacementSlotSchema>;
export type DirectMapContext = z.infer<typeof DirectMapContextSchema>;
export type DirectNativeDraft = z.infer<typeof DirectNativeDraftSchema>;
export type DirectGenerationRequest = z.infer<typeof DirectGenerationRequestSchema>;

export interface DirectUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly estimatedCostUsd?: number;
}

export interface DirectProviderDiagnostics {
  readonly requestedModel: string;
  readonly actualModel: string;
  readonly modelSubstituted: boolean;
  readonly repairAttempts: number;
  readonly latencyMs: number;
  readonly requestId?: string;
  readonly warnings: readonly string[];
}
