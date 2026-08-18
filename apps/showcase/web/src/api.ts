import { normalizeGallery, normalizeJob } from './model';
import type {
  Artifact, CampaignCase, CampaignCaseProgress, CampaignReport, CampaignTotals, CampaignVideo,
  GalleryCard, JobIndex, RawJobIndex, StageEvent, SubmitPayload,
} from './types';

const token = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('token');

export function withToken(path: string): string {
  if (!token) return path;
  const url = new URL(path, location.origin);
  url.searchParams.set('token', token);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withToken(path), init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export async function getGallery(): Promise<GalleryCard[]> {
  const result = await json<GalleryCard[] | { cards?: GalleryCard[]; gallery?: GalleryCard[] }>('/api/gallery');
  return normalizeGallery(Array.isArray(result) ? result : result.cards ?? result.gallery ?? []);
}

export const getJob = async (id: string) => normalizeJob(await json<JobIndex | RawJobIndex>(`/api/jobs/${encodeURIComponent(id)}/full`));

export async function submitJob(payload: SubmitPayload): Promise<string> {
  const result = await json<{ jobId: string }>('/api/jobs', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!result.jobId) throw new Error('Server response did not include jobId');
  return result.jobId;
}

export function subscribe(id: string, onStage: (event: StageEvent) => void, onConnection: (live: boolean) => void): () => void {
  const source = new EventSource(withToken(`/api/jobs/${encodeURIComponent(id)}`));
  source.onopen = () => onConnection(true);
  source.onmessage = (message) => {
    try { onStage(JSON.parse(message.data) as StageEvent); } catch { /* ignore keepalive text */ }
  };
  source.addEventListener('stage', (message) => {
    try { onStage(JSON.parse((message as MessageEvent).data) as StageEvent); } catch { /* malformed event */ }
  });
  source.onerror = () => onConnection(false);
  return () => source.close();
}

export function artifactUrl(artifact: Artifact | string): string {
  const raw = typeof artifact === 'string' ? artifact : artifact.url ?? artifact.path ?? '';
  if (/^(data:|blob:|https?:\/\/)/.test(raw)) return raw;
  if (raw.startsWith('/artifacts/')) return withToken(raw);
  return withToken(`/artifacts/${raw.replace(/^\/+/, '')}`);
}

export const CAMPAIGN_ID = 'edge-cases-67x5';

const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
/** Strict campaign validity: only unique, hashed, published 3D videos may ever be presented as a result. */
function acceptedVideos(raw: CampaignVideo[] | undefined): CampaignVideo[] {
  const seen = new Set<string>();
  return (raw ?? []).filter((video) => {
    if (!video?.url || !video.sha256 || seen.has(video.sha256)) return false;
    seen.add(video.sha256);
    return true;
  });
}

export function normalizeCampaign(raw: Partial<CampaignReport>): CampaignReport {
  const target = count(raw.targetValidVideos ?? raw.validityContract?.minimumPerCase);
  const cases: CampaignCase[] = (raw.cases ?? []).map((item, index) => ({
    ...item,
    id: item.id ?? `case-${index + 1}`,
    title: item.title ?? item.id ?? `Case ${index + 1}`,
    index: Number.isFinite(item.index) ? item.index : index,
    attempts: item.attempts ?? [],
    validVideos: acceptedVideos(item.validVideos),
  }));
  const validVideos = cases.reduce((sum, item) => sum + item.validVideos.length, 0);
  const totals: CampaignTotals = {
    ...raw.totals,
    cases: raw.totals?.cases ?? cases.length,
    completeCases: cases.filter((item) => target > 0 && item.validVideos.length >= target).length,
    targetVideos: count(raw.totals?.targetVideos) || cases.length * target,
    validVideos,
    jobs: count(raw.totals?.jobs), activeJobs: count(raw.totals?.activeJobs), failedJobs: count(raw.totals?.failedJobs),
    wallS: count(raw.totals?.wallS), stageSeconds: raw.totals?.stageSeconds ?? {},
    tokens: {
      calls: count(raw.totals?.tokens?.calls), inputTokens: count(raw.totals?.tokens?.inputTokens),
      outputTokens: count(raw.totals?.tokens?.outputTokens), reasoningTokens: count(raw.totals?.tokens?.reasoningTokens),
      modelWallS: count(raw.totals?.tokens?.modelWallS),
    },
    elapsedHours: count(raw.totals?.elapsedHours), validVideosPerHour: count(raw.totals?.validVideosPerHour),
    jobsPerHour: count(raw.totals?.jobsPerHour),
    meanTokensPerValidVideo: raw.totals?.meanTokensPerValidVideo ?? null,
  };
  return {
    ...raw,
    campaignId: raw.campaignId ?? CAMPAIGN_ID,
    targetValidVideos: target,
    updatedAt: raw.updatedAt ?? '',
    cases, totals,
    validityContract: raw.validityContract ?? {},
  };
}

export function campaignCaseProgress(item: CampaignCase, target: number): CampaignCaseProgress {
  const accepted = item.validVideos.length;
  const active = item.attempts.filter((attempt) => attempt.status === 'queued' || attempt.status === 'running').length;
  const failed = item.attempts.filter((attempt) => attempt.status === 'failed').length;
  const latest = item.attempts.at(-1);
  const state = accepted >= target && target > 0 ? 'complete'
    : active > 0 ? 'running'
      : latest?.status === 'failed' ? 'blocked' : 'idle';
  return { state, accepted, target, attempts: item.attempts.length, active, failed, latest };
}

export async function getCampaign(id: string): Promise<CampaignReport> {
  const response = await fetch(withToken(`/api/campaigns/${encodeURIComponent(id)}`));
  if (response.status === 404) throw new Error(`No published report for campaign "${id}" yet. The runner writes report.json on its first publish cycle.`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return normalizeCampaign(await response.json() as Partial<CampaignReport>);
}
