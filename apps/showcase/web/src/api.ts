import { normalizeGallery, normalizeJob } from './model';
import type { Artifact, GalleryCard, JobIndex, RawJobIndex, StageEvent, SubmitPayload } from './types';

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
