import { contentHash } from '@uniscenarios/sim-engine';

export interface MapRuntimeIdentity {
  readonly mapId: string;
  readonly assetDigest: string;
  readonly graphDigest: string;
  readonly controlDigest: string;
  readonly colliderDigest: string;
}

export interface CompileIdentity {
  readonly revision: string;
  readonly documentDigest: string;
  readonly ambientDigest: string;
}

/**
 * Stable identity for the files from which a worker-side map runtime is built.
 * Map assets use content-addressed URLs in production; tests and development
 * can supply an explicit revision by changing any URL.
 */
export function mapAssetDigest(map: {
  readonly id: string;
  readonly manifest: string;
  readonly topology: string;
  readonly derivedTopology: string;
  readonly locations: string;
  readonly xodr: string;
  readonly signals: string;
}): string {
  return contentHash(map);
}

export function runtimeDigest(identity: MapRuntimeIdentity): string {
  return contentHash(identity);
}

export function compileDigest(runtime: MapRuntimeIdentity, compile: CompileIdentity): string {
  return contentHash({ runtime: runtimeDigest(runtime), compile });
}

/** Only these jobs may create complete traces or interchange/evidence output. */
export type RuntimeJobKind = 'compile' | 'play' | 'validate' | 'export' | 'robustness';

export function jobProducesCompleteTrace(kind: RuntimeJobKind): boolean {
  return kind === 'validate' || kind === 'export' || kind === 'robustness';
}

export function jobProducesArtifacts(kind: RuntimeJobKind): boolean {
  return kind === 'export';
}

/** Main-thread revision gate. A superseded worker response is never installable. */
export class RevisionGate {
  private current = '';

  begin(revision: string): void {
    this.current = revision;
  }

  accepts(revision: string): boolean {
    return revision === this.current;
  }

  invalidate(): void {
    this.current = '';
  }
}
