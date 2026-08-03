import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { buildLaneGraph, parseSimScenarioInput, type LaneGraph, type TopologyIndex } from '@uniscenarios/sim-engine';
import { AsamExportError, exportOpenScenarioXml14, validateOpenScenarioXml14 } from '../asam/index.js';
import { DEV_ASSETS } from '../maps.js';

export type AuditVerdict = 'xsd-validated' | 'unsupported-fail-closed' | 'asset-blocked' | 'unexpected-failure';

export interface AuditResult {
  readonly id: string;
  readonly mapId?: string;
  readonly verdict: AuditVerdict;
  readonly [key: string]: unknown;
}

export interface AuditCounts {
  readonly total: number;
  readonly xsdValidated: number;
  readonly unsupportedFailClosed: number;
  readonly assetBlocked: number;
  readonly unexpectedFailures: number;
}

export class AuditAssetError extends Error {
  override readonly name = 'AuditAssetError';
  constructor(readonly code: 'asset-missing' | 'asset-invalid' | 'asset-stale' | 'instance-topology-stale', message: string) {
    super(message);
  }
}

interface InstanceFile {
  readonly input: unknown;
  readonly manifest?: {
    readonly instanceId?: string;
    readonly replayKey?: { readonly mapId?: string; readonly engineGraphDigest?: string };
  };
}

export interface ProductionAuditMap {
  readonly mapId: string;
  readonly graph: LaneGraph;
  readonly xodrSha256: string;
  readonly xodrPath: string;
  readonly topologyPath: string;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Load the exact checked production XODR/topology pair; never synthesize a graph. */
export async function loadProductionAuditMap(mapId: string, assetRoot = DEV_ASSETS): Promise<ProductionAuditMap> {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(mapId)) throw new AuditAssetError('asset-invalid', `unsafe map id ${mapId}`);
  const mapRoot = path.resolve(assetRoot, mapId);
  const boundary = `${path.resolve(assetRoot)}${path.sep}`;
  if (!mapRoot.startsWith(boundary)) throw new AuditAssetError('asset-invalid', `map ${mapId} escaped the asset root`);
  const xodrPath = path.join(mapRoot, 'map.xodr');
  const topologyPath = path.join(mapRoot, 'topology-index.json.gz');
  let xodrBytes: Uint8Array, topologyBytes: Uint8Array;
  try {
    [xodrBytes, topologyBytes] = await Promise.all([readFile(xodrPath), readFile(topologyPath)]);
  } catch (error) {
    throw new AuditAssetError('asset-missing', `production map assets unavailable for ${mapId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const xodrSha256 = sha256(xodrBytes);
  let topology: TopologyIndex;
  try {
    const plain = topologyBytes[0] === 0x1f && topologyBytes[1] === 0x8b ? gunzipSync(topologyBytes) : topologyBytes;
    topology = JSON.parse(Buffer.from(plain).toString('utf8')) as TopologyIndex;
  } catch (error) {
    throw new AuditAssetError('asset-invalid', `invalid production topology for ${mapId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (topology.source?.xodrSha256 !== xodrSha256) throw new AuditAssetError(
    'asset-stale',
    `production topology/XODR digest mismatch for ${mapId}: topology ${topology.source?.xodrSha256 ?? 'none'}, XODR ${xodrSha256}`,
  );
  return { mapId, graph: buildLaneGraph(topology), xodrSha256, xodrPath, topologyPath };
}

export async function auditXml14Instance(
  file: string,
  xsdPath: string,
  loadMap: (mapId: string) => Promise<ProductionAuditMap> = (mapId) => loadProductionAuditMap(mapId),
): Promise<AuditResult> {
  let parsed: InstanceFile;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8')) as InstanceFile;
  } catch (error) {
    return { id: path.basename(path.dirname(file)), verdict: 'unexpected-failure', stage: 'instance-read', message: error instanceof Error ? error.message : String(error) };
  }
  const id = parsed.manifest?.instanceId ?? path.basename(path.dirname(file));
  let mapId: string | undefined;
  let productionMap: ProductionAuditMap | undefined;
  try {
    const input = parseSimScenarioInput(parsed.input);
    mapId = input.mapId;
    productionMap = await loadMap(input.mapId);
    const replayKey = parsed.manifest?.replayKey;
    if (replayKey?.mapId && replayKey.mapId !== input.mapId) throw new AuditAssetError(
      'instance-topology-stale', `instance replay map ${replayKey.mapId} does not match input map ${input.mapId}`,
    );
    if (replayKey?.engineGraphDigest && replayKey.engineGraphDigest !== productionMap.graph.topologyDigest) throw new AuditAssetError(
      'instance-topology-stale',
      `instance graph ${replayKey.engineGraphDigest} does not match production graph ${productionMap.graph.topologyDigest}`,
    );
    const exported = exportOpenScenarioXml14(input, {
      graph: productionMap.graph,
      executionMode: 'trajectory-replay',
      roadFile: `${input.mapId}.xodr`,
      headerDate: '1970-01-01T00:00:00.000Z',
    });
    const validation = await validateOpenScenarioXml14(exported.content, xsdPath);
    return validation.valid
      ? { id, mapId: input.mapId, verdict: 'xsd-validated', warnings: exported.warnings.length, xodrSha256: productionMap.xodrSha256 }
      : { id, mapId: input.mapId, verdict: 'unexpected-failure', stage: 'official-xsd', diagnostics: validation.diagnostics };
  } catch (error) {
    if (error instanceof AuditAssetError) return { id, ...(mapId ? { mapId } : {}), verdict: 'asset-blocked', assetCode: error.code, message: error.message };
    if (error instanceof AsamExportError && error.issues.length > 0) return {
      id,
      ...(mapId ? { mapId } : {}),
      verdict: 'unsupported-fail-closed',
      ...(productionMap ? { xodrSha256: productionMap.xodrSha256 } : {}),
      issueCodes: [...new Set(error.issues.map((issue) => issue.code))].sort(),
      issueReasons: [...new Set(error.issues.map((issue) => issue.reason))].sort(),
      issueCount: error.issues.length,
    };
    return { id, ...(mapId ? { mapId } : {}), verdict: 'unexpected-failure', stage: 'export', message: error instanceof Error ? error.message : String(error) };
  }
}

export function summarizeAuditResults(results: readonly AuditResult[]): AuditCounts {
  return {
    total: results.length,
    xsdValidated: results.filter((item) => item.verdict === 'xsd-validated').length,
    unsupportedFailClosed: results.filter((item) => item.verdict === 'unsupported-fail-closed').length,
    assetBlocked: results.filter((item) => item.verdict === 'asset-blocked').length,
    unexpectedFailures: results.filter((item) => item.verdict === 'unexpected-failure').length,
  };
}

export function auditGatePassed(counts: AuditCounts): boolean {
  return counts.total > 0 && counts.xsdValidated > 0 && counts.assetBlocked === 0 && counts.unexpectedFailures === 0;
}
