export type Engine = 'auto' | 'compiler' | 'vista2';
export type Status = 'pending' | 'running' | 'complete' | 'failed' | string;

export interface Artifact { path?: string; url?: string; name?: string; type?: string }
export interface StageEvent { stage: string; status: Status; artifacts?: Artifact[]; elapsedMs?: number; [key: string]: unknown }
export interface CellVerdict {
  cellId?: string; id?: string; map?: string;
  gate?: { pass?: boolean; admitted?: boolean; firstFailure?: string } | boolean;
  judge?: { realism?: number; dynamism?: number; plausible?: boolean };
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
  brief: string; engine: Engine; nScenarios: number; maps: string[]; maxSitesPerMap: number;
  ambient: 'off' | 'light' | 'moderate' | 'city' | 'heavy'; seed: number;
  render3d: boolean; topK: number; judge: boolean;
}
