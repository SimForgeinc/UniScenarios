import type { Artifact, CellVerdict, GalleryCard, JobIndex, StageEvent } from './types';

export const STAGES = [
  ['00', 'Brief'], ['10', 'Route'], ['15', 'Precheck'], ['20', 'Author'], ['30', 'Sites'],
  ['40', 'Simulate'], ['50', 'Gate'], ['60', 'Render 2D'], ['65', 'Render 3D'], ['70', 'Judge'], ['90', 'Gallery'],
] as const;

export function stageNumber(value: string): string {
  return (value.match(/\d{2}/)?.[0] ?? value).padStart(2, '0');
}

export function stageList(job: JobIndex | null, live: Record<string, StageEvent>): StageEvent[] {
  const source = job?.stages;
  const indexed: Record<string, StageEvent> = {};
  if (Array.isArray(source)) source.forEach((item) => { indexed[stageNumber(item.stage)] = item; });
  else if (source && typeof source === 'object') Object.entries(source).forEach(([key, value]) => {
    indexed[stageNumber(key)] = typeof value === 'object' && value ? { stage: key, ...(value as object) } as StageEvent : { stage: key, status: String(value) };
  });
  Object.values(live).forEach((item) => { indexed[stageNumber(item.stage)] = { ...indexed[stageNumber(item.stage)], ...item }; });
  return STAGES.map(([stage]) => indexed[stage] ?? { stage, status: 'pending' });
}

export function cells(job: JobIndex | null): CellVerdict[] {
  if (!job?.cells) return [];
  return Array.isArray(job.cells) ? job.cells : Object.entries(job.cells).map(([id, cell]) => ({ cellId: id, ...cell }));
}

export function artifactKind(artifact: Artifact | string): 'image' | 'video' | 'download' {
  const value = typeof artifact === 'string' ? artifact : `${artifact.type ?? ''} ${artifact.path ?? artifact.url ?? ''}`;
  if (/\.(png|jpe?g|webp|gif)(\?|$)|\bimage\b/i.test(value)) return 'image';
  if (/\.(mp4|webm|mov)(\?|$)|\bvideo\b/i.test(value)) return 'video';
  return 'download';
}

export function artifacts(value: unknown): Artifact[] {
  if (!value || typeof value !== 'object') return [];
  const direct = (value as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(direct)) return [];
  return direct.map((item) => typeof item === 'string' ? { path: item } : item as Artifact);
}

export function cardId(card: GalleryCard): string { return card.jobId ?? card.id ?? ''; }
export function cardMedia(card: GalleryCard): string | undefined {
  return card.media ?? card.headlineArtifact ?? card.artifacts?.find((item) => artifactKind(item) !== 'download')?.url ?? card.artifacts?.find((item) => artifactKind(item) !== 'download')?.path;
}
