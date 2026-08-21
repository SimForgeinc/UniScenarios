import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildEsminiRunnableBundle,
  createServerMapDependencyResolver,
  type EsminiRunnableBundle,
} from '../../../packages/openscenario/src/node/esmini-bundle.ts';
import { loadMap } from '../../../packages/cli/src/maps.ts';
import {
  EsminiRunner,
  EsminiRunnerService,
  ingestRunnableBundle,
  parseEsminiCsv,
  createVerifiedMacOsLocalExecutor,
  ESMINI_OBSERVABLE_EVENT_KINDS,
  type ArtifactStore,
  type ContentStore,
  type ExternalRunSnapshot,
  type WritableContentStore,
} from '../../../packages/esmini-runner/src/index.ts';
import { decodeTraceGz, traceDigest, type SimTrace } from '../../../packages/sim-engine/src/index.ts';
import {
  buildDualTracePlaybackData,
  compareNormalizedTraces,
  normalizeCanonicalTrace,
  normalizeExternalTrace,
  toComparisonUiModel,
} from '../../../packages/trace-comparator/src/index.ts';

const REPO = path.resolve(import.meta.dirname, '../../..');
const XSD = path.join(REPO, '.tools/openscenario/1.3.1/OpenSCENARIO.xsd');
const ESMINI = path.join(REPO, '.tools/esmini/3.6.0/payload/esmini/bin/esmini');
const API = '/api/local-openscenario';

interface SnapshotBody {
  readonly snapshot: {
    readonly source: { readonly name: string };
    readonly concrete: { readonly input: Parameters<typeof buildEsminiRunnableBundle>[0]['input']; readonly inputHash: string; readonly instanceId: string; readonly traceHash: string; readonly traceGzipBase64: string };
    readonly map: { readonly id: string; readonly xodrDigest: string; readonly laneGraphDigest: string };
    readonly artifact: { readonly filename: string };
  };
  readonly mode: 'deterministic-trajectory' | 'supported-actions';
}

class BytesStore implements WritableContentStore, ContentStore {
  readonly values = new Map<string, Uint8Array>();
  async put(bytes: Uint8Array, expected?: string): Promise<string> {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (expected && expected !== digest) throw new Error('immutable content digest mismatch');
    const id = `content-${digest}`;
    this.values.set(id, bytes.slice());
    return id;
  }
  async read(id: string): Promise<Uint8Array> {
    const value = this.values.get(id);
    if (!value) throw new Error('unknown immutable content handle');
    return value.slice();
  }
}

class LocalArtifactStore implements ArtifactStore {
  readonly values = new Map<string, { name: string; bytes: Uint8Array }>();
  async put(name: string, bytes: Uint8Array): Promise<string> {
    const id = `artifact-${randomUUID()}`;
    this.values.set(id, { name, bytes: bytes.slice() });
    return id;
  }
}

interface BundleRecord { readonly bundle: EsminiRunnableBundle; readonly filename: string; readonly mode: SnapshotBody['mode'] }
interface RunEvidence {
  snapshot: ExternalRunSnapshot;
  comparison?: ReturnType<typeof compareNormalizedTraces>;
  comparisonUi?: ReturnType<typeof toComparisonUiModel>;
  dualTrace?: ReturnType<typeof buildDualTracePlaybackData>;
  sampleCount?: number;
  unsupportedSemantics: string[];
}

export function createLocalOpenScenarioHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  const content = new BytesStore();
  const artifacts = new LocalArtifactStore();
  const bundles = new Map<string, BundleRecord>();
  const evidence = new Map<string, RunEvidence>();
  let servicePromise: Promise<EsminiRunnerService> | undefined;
  const service = (): Promise<EsminiRunnerService> => servicePromise ??= (async () => {
    assertInstalledTools();
    if (process.platform !== 'darwin') throw new Error('This local runner currently requires the pinned macOS esmini binary. Use the pinned container executor on other platforms.');
    const executor = await createVerifiedMacOsLocalExecutor(ESMINI);
    return new EsminiRunnerService(new EsminiRunner({ executor, contentStore: content, artifactStore: artifacts }));
  })();

  return (req, res) => void route(req, res, { content, artifacts, bundles, evidence, service }).catch((error) => {
    respondJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  });
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  state: {
    content: BytesStore;
    artifacts: LocalArtifactStore;
    bundles: Map<string, BundleRecord>;
    evidence: Map<string, RunEvidence>;
    service(): Promise<EsminiRunnerService>;
  },
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const routedPath = url.pathname.startsWith(API) ? url.pathname.slice(API.length) : url.pathname;
  const parts = routedPath.split('/').filter(Boolean);
  if (req.method === 'POST' && parts.length === 1 && parts[0] === 'bundles') {
    assertInstalledTools();
    const body = await readJson<SnapshotBody>(req);
    if (!body.snapshot || !['deterministic-trajectory', 'supported-actions'].includes(body.mode)) throw new Error('invalid local bundle request');
    const { snapshot } = body;
    if (snapshot.concrete.input.mapId !== snapshot.map.id) throw new Error('snapshot map identity mismatch');
    if (snapshot.map.xodrDigest !== snapshot.map.laneGraphDigest) throw new Error('snapshot map digests disagree');
    const map = await loadMap(snapshot.map.id);
    if (!snapshot.concrete.traceGzipBase64 || snapshot.concrete.traceGzipBase64.length > 64 * 1024 * 1024) throw new Error('missing or oversized canonical trace evidence');
    const canonicalTrace = await decodeTraceGz(new Uint8Array(Buffer.from(snapshot.concrete.traceGzipBase64, 'base64')));
    if (canonicalTrace.header.inputHash !== snapshot.concrete.inputHash || traceDigest(canonicalTrace) !== snapshot.concrete.traceHash) throw new Error('attached canonical trace does not match the immutable Studio snapshot');
    const bundle = await buildEsminiRunnableBundle({
      instanceId: snapshot.concrete.instanceId,
      input: snapshot.concrete.input,
      inputHash: snapshot.concrete.inputHash,
      graph: map.graph,
      canonicalTrace,
      expectedXodrSha256: snapshot.map.xodrDigest,
      mapResolver: createServerMapDependencyResolver(path.join(REPO, 'dev-assets')),
      xsdPath: XSD,
      mode: body.mode,
      author: 'UniScenarios Studio',
      description: snapshot.source.name,
    });
    const id = `bundle-${randomUUID()}`;
    const stem = snapshot.artifact.filename.replace(/\.xosc$/u, '');
    const filename = `${stem}.esmini-1.3.bundle.zip`;
    state.bundles.set(id, { bundle, filename, mode: body.mode });
    const xml = new TextDecoder().decode(bundle.files.get(bundle.manifest.scenarioEntry)!);
    respondJson(res, 201, {
      bundleId: id,
      profile: body.mode === 'deterministic-trajectory' ? 'esmini-1.3-trajectory' : 'esmini-1.3-actions',
      standard: 'ASAM OpenSCENARIO XML 1.3.1 · esmini compatibility',
      behaviorParityScope: bundle.manifest.behaviorParityScope,
      filename: snapshot.artifact.filename,
      xml,
      manifest: bundle.manifest,
      capability: bundle.capability,
      xsd: { valid: true, digest: bundle.manifest.files.find((f) => f.path === 'reports/capability.json')?.sha256 ?? '' },
      downloadUrl: `${API}/bundles/${id}/download`,
    });
    return;
  }
  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'bundles' && parts[2] === 'download') {
    const record = state.bundles.get(parts[1]!);
    if (!record) return respondJson(res, 404, { error: 'unknown local bundle' });
    const zip = zipStored(record.bundle.files);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${record.filename}"`);
    res.setHeader('content-length', zip.byteLength);
    res.end(zip);
    return;
  }
  if (req.method === 'POST' && parts.length === 1 && parts[0] === 'runs') {
    const { bundleId } = await readJson<{ bundleId: string }>(req);
    const record = state.bundles.get(bundleId);
    if (!record) return respondJson(res, 404, { error: 'unknown local bundle' });
    const jobId = `esmini-${randomUUID()}`;
    // esmini 3.6.0's macOS OSI writer segfaults on several production XODR
    // object records before the first step. CSV/DAT/log remain authoritative
    // local parity evidence; OSI can be requested by the pinned container lane.
    const job = await ingestRunnableBundle(record.bundle, state.content, {
      jobId,
      options: { durationS: 20, record: ['csv', 'dat', 'log'], evidenceProfile: 'local-trace-no-osi' },
    });
    const initial: ExternalRunSnapshot = { jobId, status: 'queued', stage: 'security-validation', submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.evidence.set(jobId, {
      snapshot: initial,
      unsupportedSemantics: [
        ...compatibilityNotes(record.bundle),
        'localEvidence.osi: Omitted because the pinned macOS esmini 3.6.0 OSI writer crashes on production OpenDRIVE object records; CSV, DAT, and log evidence are retained. Container validation keeps the full OSI contract.',
      ],
    });
    const runner = await state.service();
    void runner.submit(job).then((snapshot) => void completeEvidence(jobId, snapshot, record, state));
    respondJson(res, 202, initial);
    return;
  }
  if (parts.length === 2 && parts[0] === 'runs') {
    const jobId = parts[1]!;
    const run = state.evidence.get(jobId);
    if (!run) return respondJson(res, 404, { error: 'unknown local run' });
    const runner = await state.service();
    if (req.method === 'DELETE') {
      const accepted = runner.cancel(jobId);
      respondJson(res, accepted ? 202 : 409, { accepted });
      return;
    }
    const current = runner.status(jobId);
    if (current) run.snapshot = current;
    respondJson(res, 200, presentEvidence(run));
    return;
  }
  if (req.method === 'GET' && parts.length === 3 && parts[0] === 'artifacts') {
    const value = state.artifacts.values.get(parts[1]!);
    if (!value || parts[2] !== 'download') return respondJson(res, 404, { error: 'unknown local artifact' });
    res.statusCode = 200;
    res.setHeader('content-type', mediaType(value.name));
    res.setHeader('content-disposition', `attachment; filename="${value.name.replaceAll('"', '')}"`);
    res.setHeader('content-length', value.bytes.byteLength);
    res.end(value.bytes);
    return;
  }
  respondJson(res, 404, { error: 'unknown local OpenSCENARIO endpoint' });
}

async function completeEvidence(
  jobId: string,
  snapshot: ExternalRunSnapshot,
  record: BundleRecord,
  state: { artifacts: LocalArtifactStore; evidence: Map<string, RunEvidence> },
): Promise<void> {
  const result = state.evidence.get(jobId);
  if (!result) return;
  result.snapshot = snapshot;
  if (snapshot.status !== 'succeeded' || !snapshot.result) return;
  const csv = snapshot.result.artifacts.find((item) => item.kind === 'csv');
  const csvBytes = csv ? state.artifacts.values.get(csv.artifactId)?.bytes : undefined;
  const traceBytes = record.bundle.files.get(record.bundle.manifest.canonicalTraceEntry);
  if (!csvBytes || !traceBytes) return;
  try {
    const canonical = JSON.parse(new TextDecoder().decode(traceBytes)) as SimTrace;
    const warmup = canonical.header.warmupSeconds;
    const entityIdMap = Object.fromEntries(canonical.header.actorIds.map((actorId) => [openScenarioActorName(actorId), actorId]));
    const parsed = parseEsminiCsv(new TextDecoder().decode(csvBytes), {
      durationS: 20,
      timeOffsetS: -warmup,
      expectedVersion: '3.6.0',
      entityIdMap,
    });
    const raw = { ...parsed, durationS: 20 };
    const normalizedCanonical = normalizeCanonicalTrace(canonical);
    const normalizedExternal = normalizeExternalTrace(raw, canonical.header.actorIds);
    const comparison = compareNormalizedTraces(normalizedCanonical, normalizedExternal.trace, normalizedExternal.mapping, {
      profile: record.mode === 'deterministic-trajectory' ? 'strict-trajectory-v1' : 'supported-actions-v1',
      observableEventKinds: ESMINI_OBSERVABLE_EVENT_KINDS,
    });
    result.comparison = comparison;
    result.comparisonUi = toComparisonUiModel(comparison);
    result.dualTrace = buildDualTracePlaybackData(normalizedCanonical, normalizedExternal.trace);
    result.sampleCount = result.dualTrace.frames.length;
  } catch (error) {
    result.unsupportedSemantics.push(`External CSV comparison could not be attached: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function openScenarioActorName(actorId: string): string {
  const keywords = new Set(['action', 'actor', 'and', 'as', 'bool', 'call', 'cover', 'default', 'def', 'do', 'else', 'emit', 'enum', 'event', 'extend', 'false', 'float', 'hard', 'if', 'import', 'in', 'inherits', 'int', 'is', 'it', 'keep', 'list', 'modifier', 'not', 'of', 'on', 'one_of', 'or', 'parallel', 'range', 'record', 'remove_default', 'scenario', 'serial', 'string', 'struct', 'true', 'uint', 'until', 'var', 'wait', 'with']);
  let stem = actorId.replace(/[^A-Za-z0-9_]/gu, '_').replace(/_+/gu, '_').replace(/^_+|_+$/gu, '');
  if (!stem || /^[0-9]/u.test(stem) || keywords.has(stem)) stem = `id_${stem || 'unnamed'}`;
  return `actor_${stem}`;
}

function presentEvidence(value: RunEvidence): object {
  const external = value.snapshot.result?.artifacts ?? [];
  return {
    snapshot: value.snapshot,
    ...(value.comparison ? { comparison: value.comparison, comparisonUi: value.comparisonUi, dualTrace: value.dualTrace, sampleCount: value.sampleCount } : {}),
    unsupportedSemantics: value.unsupportedSemantics,
    artifacts: external.map((artifact) => ({ ...artifact, downloadUrl: `${API}/artifacts/${artifact.artifactId}/download` })),
  };
}

function compatibilityNotes(bundle: EsminiRunnableBundle): string[] {
  return bundle.capability.entries.filter((entry) => entry.disposition !== 'semantic-portable')
    .map((entry) => `${entry.path}: ${entry.reason}`);
}

function assertInstalledTools(): void {
  if (!existsSync(XSD)) throw new Error('Pinned OpenSCENARIO 1.3.1 schema is not installed. Run: node apps/studio/scripts/fetch-openscenario-schema.mjs');
  if (!existsSync(ESMINI)) throw new Error('Pinned esmini 3.6.0 is not installed. Run: node packages/esmini-runner/scripts/fetch-pinned-esmini.mjs');
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > 128 * 1024 * 1024) throw new Error('local request exceeds 128 MiB');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function respondJson(res: ServerResponse, status: number, body: object): void {
  if (res.headersSent) return;
  const bytes = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', bytes.byteLength);
  res.end(bytes);
}

function mediaType(name: string): string {
  if (name.endsWith('.csv')) return 'text/csv';
  if (name.endsWith('.log')) return 'text/plain';
  return 'application/octet-stream';
}

/** Minimal deterministic ZIP (stored entries, no shell/archive path handling). */
function zipStored(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, bytes] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = Buffer.from(name, 'utf8'), data = Buffer.from(bytes), crc = crc32(data);
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(file.length, 26);
    local.push(head, file, data);
    const dir = Buffer.alloc(46); dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(file.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, file); offset += head.length + file.length + data.length;
  }
  const centralBytes = Buffer.concat(central), tail = Buffer.alloc(22); tail.writeUInt32LE(0x06054b50, 0); tail.writeUInt16LE(files.size, 8); tail.writeUInt16LE(files.size, 10); tail.writeUInt32LE(centralBytes.length, 12); tail.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, tail]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
