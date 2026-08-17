export interface Render3dOptions {
  readonly instance: string;
  readonly trace: string;
  readonly out: string;
  readonly format: 'stills' | 'video' | 'both';
  readonly camera: 'follow-ego' | 'overview';
  readonly fps: number;
  readonly redact: boolean;
  readonly devAssets?: string | undefined;
}

export interface Render3dResult {
  readonly status: 'unavailable';
  readonly reason: string;
}

/** Dispatch seam owned by showcase packet P2. */
export async function render3d(_options: Render3dOptions): Promise<Render3dResult> {
  return {
    status: 'unavailable',
    reason: 'The 3D renderer is not installed in this build; the P2 dispatch seam is available.',
  };
}
