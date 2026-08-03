export type CampaignBinding = 'exact-matched-site' | 'pinned-behavioral-surrogate' | 'unverified';

export interface CampaignAssets {
  templateUrl?: string;
  instanceUrl?: string;
  traceUrl?: string;
  rubricUrl?: string;
  evidenceUrl?: string;
  provenanceUrl?: string;
  ambientUrl?: string;
  variationsUrl?: string;
}

export interface GeneratedCampaignEntry {
  ordinal: number;
  stableId: string;
  slug: string;
  title: string;
  owner: string;
  status: string;
  mapId?: string;
  binding: CampaignBinding;
  transfer: string;
  matchCount?: number;
  baseline: string;
  identity: 'exact-envelope' | 'raw-digest-match-runtime-validation' | 'stale-input-trace-mismatch' | 'static-pose-trace-mismatch' | 'trace-header-missing' | 'missing';
  ambient: string;
  rubric: string;
  provenance: string;
  diagnostics: string[];
  assets: CampaignAssets;
}

export interface CampaignImportRecord {
  ordinal: number;
  stableId: string;
  slug: string;
  savedName: string;
  mapId: string;
  title: string;
  importedAt: string;
}
