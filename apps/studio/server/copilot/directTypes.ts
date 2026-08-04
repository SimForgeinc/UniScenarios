import { z } from 'zod';
import { COPILOT_MAX_RUNWAY_M } from '../../src/copilot/types.js';

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
  availableDownstreamM: z.number().finite().min(0).max(COPILOT_MAX_RUNWAY_M).optional(),
  recommendedSpeedKph: z.number().min(0).max(160).optional(),
  labels: z.array(z.string().min(1).max(160)).max(32).default([]),
});

export const CopilotMapContextSchema = z.strictObject({
  mapId: z.string().min(1).max(200),
  mapName: z.string().min(1).max(240),
  xodrSha256: z.string().nullable(),
  laneCount: z.number().int().min(0),
  junctionLaneCount: z.number().int().min(0),
  bounds: z.strictObject({ minX: z.number(), minZ: z.number(), maxX: z.number(), maxZ: z.number() }),
  placementSlots: z.array(DirectPlacementSlotSchema).min(2).max(64),
});

/** Backwards-compatible name for the direct provider's shared map boundary. */
export const DirectMapContextSchema = CopilotMapContextSchema;

export const DirectActionDraftSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  actorId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  kind: z.enum(['speed', 'changeLane', 'laneOffset', 'route', 'nearMiss']),
  startS: z.number().min(0).max(120),
  durationS: z.number().min(0.1).max(120),
  value: z.number(),
  label: z.string().max(200),
  targetActorId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).nullable().default(null),
  clearanceM: z.number().min(0.1).max(10).nullable().default(null),
  triggerMode: z.enum(['at', 'distance', 'ttc']).default('at'),
  triggerActorId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).nullable().default(null),
  triggerThreshold: z.number().min(0.05).max(500).nullable().default(null),
  triggerDeadlineS: z.number().min(0).max(20).nullable().default(null),
});

export const DirectActorDraftSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  label: z.string().min(1).max(200),
  catalogId: z.string().min(1).max(200),
  slotId: z.string().min(1).max(160),
  initialSpeedKph: z.number().min(0).max(160),
  static: z.boolean().default(false),
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
  providerId: z.enum(['direct-llm', 'simulation-agent', 'simulation-agent-vision']),
  currentScenario: z.unknown().optional(),
  maxCandidates: z.number().int().min(1).max(5).default(1),
  model: z.string().min(1).max(200).optional(),
  maxAgentIterations: z.number().int().min(1).max(4).optional(),
  agentReasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
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
