export type CityAssetVariantPreference = 'auto' | 'original' | 'ktx2' | 'geometry-only' | 'roads-only';
export type CityAssetVariantId = Exclude<CityAssetVariantPreference, 'auto' | 'original'>;

export interface CityAssetVariantFile {
  file: string;
  /** Previous known-good derivative; never a textured source asset. */
  fallbackFile?: string;
  sourceSha256: string;
  outputSha256: string;
  bytes: number;
}

export interface CityAssetVariant {
  id: CityAssetVariantId;
  generatedAt: string;
  generator: { name: string; version: string; command: string };
  files: Record<string, CityAssetVariantFile>;
  runtime?: { ktx2TranscoderPath?: string; assets?: Array<{ file: string; sha256: string }> };
  /** Optional replacement for a monolithic static layer, only emitted after continuity validation. */
  staticLayers?: Array<{ id: string; files: string[]; bounds: { min: number[]; max: number[] }[] }>;
}

export interface CityAssetVariantManifest {
  schemaVersion: 1;
  sourceManifestSha256: string;
  variants: Partial<Record<CityAssetVariantId, CityAssetVariant>>;
}

export function allowsSourceAssetFallback(selected: CityAssetVariantId | 'original', ultraLow: boolean): boolean {
  return selected !== 'original' && !ultraLow;
}

export function isCityAssetVariantManifest(value: unknown): value is CityAssetVariantManifest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CityAssetVariantManifest>;
  return candidate.schemaVersion === 1
    && typeof candidate.sourceManifestSha256 === 'string'
    && Boolean(candidate.variants && typeof candidate.variants === 'object');
}

export function selectAssetVariant(
  manifest: CityAssetVariantManifest | null,
  sourceFile: string,
  preference: CityAssetVariantPreference,
  options: { ultraLow: boolean; roadsOnly?: boolean; ktx2Ready: boolean },
): { variant: CityAssetVariantId | 'original'; file: string; fallbackFile?: string } {
  if (!manifest || preference === 'original') return { variant: 'original', file: sourceFile };
  const requested: CityAssetVariantId | null = preference === 'auto'
    ? (options.roadsOnly ? 'roads-only' : options.ultraLow ? 'geometry-only' : options.ktx2Ready ? 'ktx2' : null)
    : preference;
  if (!requested || (requested === 'ktx2' && !options.ktx2Ready)) {
    return { variant: 'original', file: sourceFile };
  }
  const candidate = manifest.variants[requested]?.files[sourceFile];
  const unsafePath = (file: string): boolean => /^(?:[a-z]+:|\/)/i.test(file) || /(?:^|\/)\.\.(?:\/|$)/.test(file);
  const unsafe = candidate && unsafePath(candidate.file);
  const fallbackFile = candidate?.fallbackFile && !unsafePath(candidate.fallbackFile) ? candidate.fallbackFile : undefined;
  return candidate && !unsafe ? { variant: requested, file: candidate.file, fallbackFile } : { variant: 'original', file: sourceFile };
}
