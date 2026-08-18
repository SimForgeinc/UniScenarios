export type Engine = 'auto' | 'compiler' | 'vista2';
export type Status = 'pending' | 'running' | 'complete' | 'failed' | string;

export interface Artifact { path?: string; url?: string; name?: string; type?: string }
export interface StageEvent { stage: string; status: Status; artifacts?: Artifact[]; elapsedMs?: number; [key: string]: unknown }
export interface ReviewDefect { code: string; text?: string; confidence?: number | null; source?: string }
export interface CellAcceptance {
  tier?: '2d' | '3d' | null; axes?: Record<string, string | number | boolean>;
  defects?: ReviewDefect[]; gatePassed?: boolean; cappedByTopK?: boolean;
  contract?: { version?: string | null; sha256?: string | null; reviewVersion?: string | null } | null;
  normalizedFrom?: string | null;
}
export interface CellJudge {
  realism?: number; dynamism?: number; plausible?: boolean;
  semanticAccepted?: boolean; presentationAccepted?: boolean;
  defectCodes?: string[]; unsupportedReason?: string | null; acceptance?: CellAcceptance;
  threeDReview?: {
    mechanismFidelity?: string; visualGrounding?: string; actorFidelity?: string;
    eventSequence?: string; realism?: number; confidence?: number; explanation?: string;
  };
}
export interface CellVerdict {
  cellId?: string; id?: string; map?: string;
  gate?: { pass?: boolean; admitted?: boolean; firstFailure?: string } | boolean;
  judge?: CellJudge;
  artifacts?: Artifact[]; [key: string]: unknown;
}
export interface JobIndex {
  jobId?: string; id?: string; brief?: string; status?: Status; engine?: Engine;
  options?: Record<string, unknown>; stages?: StageEvent[] | Record<string, unknown>;
  cells?: CellVerdict[] | Record<string, CellVerdict>; artifacts?: Artifact[];
  [key: string]: unknown;
}
export interface IndexedFile { path: string; size?: number; json?: unknown; jsonError?: boolean }
export interface RawJobIndex { jobId: string; files: IndexedFile[] }
export interface GalleryCard {
  jobId?: string; id?: string; brief?: string; headline?: string; engine?: Engine;
  maps?: string[]; admitted?: number; total?: number; admittedCells?: number; totalCells?: number;
  realism?: number; dynamism?: number; media?: string; headlineArtifact?: string;
  artifacts?: Artifact[]; [key: string]: unknown;
}
export interface SubmitPayload {
  brief: string; methodology: 'production' | 'custom'; engine: Engine; nScenarios: number;
  maps: string[]; maxSitesPerMap: number;
  ambient: 'off' | 'light' | 'moderate' | 'city' | 'heavy'; seed: number;
  render3d: boolean; topK: number; judge: boolean;
}

export type CampaignAttemptStatus = 'queued' | 'running' | 'complete' | 'failed' | string;
export type CampaignCaseState = 'complete' | 'running' | 'blocked' | 'idle';
export interface CampaignUsage { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; modelWallS: number }
export interface CampaignAttemptMetrics {
  wallS?: number; stageSeconds?: Record<string, number>; tokens?: CampaignUsage;
  tokenAccounting?: { authorTranscripts?: number; judgeLedgers?: number; dollarCost?: number | null; note?: string };
}
export interface CampaignAttempt {
  number: number; jobId: string; seed?: number; status: CampaignAttemptStatus;
  submittedAt?: string; finishedAt?: string; acceptedVideos?: number; error?: string; metrics?: CampaignAttemptMetrics;
}
export interface CampaignVideo {
  sha256: string; jobId?: string; cellId?: string; source?: string; url: string;
  mapId?: string | null; realism?: number | null; dynamism?: number | null; acceptedAt?: string;
  semanticAccepted?: boolean; presentationAccepted?: boolean;
  reviewContractVersion?: string; reviewContractSha256?: string; reviewVersion?: string;
}
export interface CampaignCase { id: string; title: string; index: number; attempts: CampaignAttempt[]; validVideos: CampaignVideo[] }
export interface CampaignTotals {
  cases: number; completeCases: number; targetVideos: number; validVideos: number;
  jobs: number; activeJobs: number; failedJobs: number; wallS: number;
  stageSeconds: Record<string, number>; tokens: CampaignUsage;
  elapsedHours: number; validVideosPerHour: number; jobsPerHour: number; meanTokensPerValidVideo: number | null;
}
export interface CampaignValidityContract {
  semanticAcceptedRequired?: boolean; presentationAcceptedRequired?: boolean;
  frozenGateRequired?: boolean; briefAware3dReviewRequired?: boolean;
  uniqueVideoSha256Required?: boolean; durableCampaignCopyRequired?: boolean;
  currentReviewContractRequired?: boolean; reviewContractVersion?: string;
  reviewContractSha256?: string; reviewVersion?: string; minimumPerCase?: number;
}
export interface CampaignReport {
  campaignId: string; targetValidVideos: number; methodology?: string; version?: number;
  startedAt?: string; updatedAt: string; cases: CampaignCase[]; totals: CampaignTotals;
  validityContract: CampaignValidityContract;
}
export interface CampaignCaseProgress {
  state: CampaignCaseState; accepted: number; target: number;
  attempts: number; active: number; failed: number; latest?: CampaignAttempt;
}
