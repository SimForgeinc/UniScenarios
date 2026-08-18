#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism, freemem, hostname, loadavg, totalmem } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const ROOT = resolve(import.meta.dirname, '../../..');
const execFileAsync = promisify(execFile);
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const value = process.argv[index + 1];
  args.set(key.slice(2), value?.startsWith('--') ? true : value ?? true);
  if (value && !value.startsWith('--')) index += 1;
}
const configPath = resolve(String(args.get('config') ?? join(ROOT, 'apps/showcase/campaigns/edge-cases.json')));
const dataRoot = resolve(String(args.get('data') ?? join(ROOT, 'showcase-data')));
const server = String(args.get('server') ?? process.env.SHOWCASE_SERVER ?? 'http://127.0.0.1:4174');
const token = String(args.get('token') ?? process.env.SHOWCASE_TOKEN ?? 'demo-local');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const runtimeConfig = config.runtime ?? {};
function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}
const hardware = {
  logicalCpus: availableParallelism(),
  memoryGiB: Number((totalmem() / (1024 ** 3)).toFixed(1)),
  gpuSlots: boundedInteger(process.env.SHOWCASE_CAMPAIGN_GPU_SLOTS, 2, 1, 8, 'SHOWCASE_CAMPAIGN_GPU_SLOTS'),
};
const requestedConcurrency = boundedInteger(
  args.get('concurrency') ?? process.env.SHOWCASE_CAMPAIGN_CONCURRENCY ?? runtimeConfig.maxActiveJobs,
  4, 1, 8, 'campaign concurrency',
);
const maxActive = Math.min(requestedConcurrency, hardware.logicalCpus);
const batchConcurrency = boundedInteger(runtimeConfig.batchConcurrency, 3, 1, 16, 'batch concurrency');
const intervalMs = boundedInteger(
  args.get('interval-ms') ?? process.env.SHOWCASE_CAMPAIGN_INTERVAL_MS ?? runtimeConfig.intervalMs,
  30_000, 5_000, 3_600_000, 'campaign interval-ms',
);
const submissionRecoveryMs = boundedInteger(
  args.get('submission-recovery-ms') ?? process.env.SHOWCASE_CAMPAIGN_SUBMISSION_RECOVERY_MS ?? runtimeConfig.submissionRecoveryMs,
  300_000, 30_000, 3_600_000, 'campaign submission-recovery-ms',
);
const submissionRampPerHeartbeat = boundedInteger(
  args.get('submission-ramp') ?? process.env.SHOWCASE_CAMPAIGN_SUBMISSION_RAMP ?? runtimeConfig.submissionRampPerHeartbeat,
  1, 1, 4, 'campaign submission-ramp',
);
const loadPausePerCpu = Number(process.env.SHOWCASE_CAMPAIGN_LOAD_PAUSE_PER_CPU ?? runtimeConfig.loadPausePerCpu ?? 1.25);
if (!Number.isFinite(loadPausePerCpu) || loadPausePerCpu < 0.5 || loadPausePerCpu > 4) {
  throw new Error('campaign loadPausePerCpu must be between 0.5 and 4');
}
const initializeOnly = args.has('once') || args.has('dry-run');
if (typeof config.id !== 'string' || !config.id || !Array.isArray(config.cases) || config.cases.length === 0) {
  throw new Error('campaign config requires a non-empty id and cases array');
}
if (!Number.isInteger(config.targetValidVideos) || config.targetValidVideos < 1) {
  throw new Error('campaign targetValidVideos must be a positive integer');
}
const caseIds = config.cases.map((item) => item.id);
if (caseIds.some((id) => typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(caseIds).size !== caseIds.length) {
  throw new Error('campaign case ids must be unique lowercase slugs');
}
const campaignDir = join(dataRoot, 'campaigns', config.id);
const statePath = join(campaignDir, 'state.json');
const reportPath = join(campaignDir, 'report.json');
const htmlPath = join(campaignDir, 'index.html');
const jobsDir = join(dataRoot, 'jobs');
const lockPath = join(campaignDir, 'runner.lock');

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const exists = async (path) => stat(path).then(() => true, () => false);
const nonemptyFile = async (path) => stat(path).then((value) => value.isFile() && value.size > 0, () => false);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const isActive = (attempt) => ['submitting', 'queued', 'running'].includes(attempt.status);
const dateMs = (value, fallback = Date.now()) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
async function fileSha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, value);
  await rename(temporary, path);
}
async function atomicJson(path, value) {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function emptyUsage() {
  return { calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, modelWallS: 0 };
}
async function acquireLock() {
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o644);
      await handle.writeFile(`${JSON.stringify({ host: hostname(), pid: process.pid, startedAt: now() })}\n`);
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let owner;
      try { owner = await readJson(lockPath); } catch { owner = null; }
      let live = owner != null && owner.host !== hostname();
      if (owner?.host === hostname() && Number.isInteger(owner.pid)) {
        try { process.kill(owner.pid, 0); live = true; } catch { live = false; }
      }
      if (live) throw new Error(`campaign runner is already active on ${owner.host ?? 'unknown host'} as pid ${owner.pid ?? 'unknown'}`);
      await unlink(lockPath).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw unlinkError;
      });
    }
  }
  throw new Error('could not acquire campaign runner lock');
}

async function releaseLock(handle) {
  await handle.close().catch(() => {});
  await unlink(lockPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
function addUsage(total, usage, wallS = 0) {
  if (!usage || typeof usage !== 'object') return;
  total.calls += Number(usage.calls ?? (usage.in != null || usage.input_tokens != null ? 1 : 0)) || 0;
  total.inputTokens += Number(usage.inputTokens ?? usage.input_tokens ?? usage.in ?? 0) || 0;
  total.outputTokens += Number(usage.outputTokens ?? usage.output_tokens ?? usage.out ?? 0) || 0;
  total.reasoningTokens += Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoning ?? 0) || 0;
  total.modelWallS += Number(usage.modelWallS ?? usage.wallS ?? usage.llmWallS ?? wallS ?? 0) || 0;
}
async function walk(dir) {
  if (!(await exists(dir))) return [];
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else paths.push(path);
  }
  return paths;
}
function authorUsage(document, usage) {
  const attempts = Array.isArray(document.attempts) ? document.attempts : [];
  const attemptUsages = attempts.map((attempt) => attempt?.row?.usage).filter(Boolean);
  if (attemptUsages.length) {
    for (const item of attemptUsages) addUsage(usage, item);
    return;
  }
  const source = document.usage ?? document.result?.usage ?? document.episode?.usage ?? document.cost?.tokens;
  addUsage(usage, source, document.wallS ?? document.cost?.wallS);
}
function judgeUsage(document, usage) {
  for (const row of document.cells ?? []) {
    addUsage(usage, row?._meta?.tokens, row?._meta?.latencyS);
    addUsage(usage, row?.threeDReview?.tokens, row?.threeDReview?.latencyS);
  }
}
async function jobMetrics(jobDir, submittedAt, finishedAt) {
  const usage = emptyUsage();
  const files = await walk(jobDir);
  const seenAuthor = new Set();
  const contractAttemptPaths = files.filter((value) => basename(value) === 'contract-attempts.json');
  const contractAttemptDirs = new Set(contractAttemptPaths.map((value) => dirname(value)));
  const authorPaths = [
    ...contractAttemptPaths,
    ...files.filter((value) => basename(value) === 'transcript.json'
      && !contractAttemptDirs.has(dirname(value))),
  ];
  for (const path of authorPaths) {
    const bytes = await readFile(path);
    const hash = sha256(bytes);
    if (seenAuthor.has(hash)) continue;
    seenAuthor.add(hash);
    try { authorUsage(JSON.parse(bytes), usage); } catch { /* preserved malformed evidence is not billable twice */ }
  }
  const seenJudge = new Set();
  for (const path of files.filter((value) => basename(value) === '70-judge.json')) {
    const bytes = await readFile(path);
    const hash = sha256(bytes);
    if (seenJudge.has(hash)) continue;
    seenJudge.add(hash);
    try { judgeUsage(JSON.parse(bytes), usage); } catch { /* terminal report records missing coverage */ }
  }
  const stageSeconds = {};
  let timingLedgers = 0;
  for (const path of files.filter((value) => basename(value) === '90-gallery.json')) {
    let gallery;
    try { gallery = await readJson(path); } catch { continue; }
    const copiedRepairSummary = gallery.repairedFromRejectedAttempt === true
      && typeof gallery.repairEvidence === 'string';
    if (copiedRepairSummary) continue;
    timingLedgers += 1;
    for (const [stage, seconds] of Object.entries(gallery.timings ?? {})) {
      const numeric = Number(seconds);
      if (!Number.isFinite(numeric) || numeric < 0) continue;
      stageSeconds[stage] = Number((Number(stageSeconds[stage] ?? 0) + numeric).toFixed(3));
    }
  }
  const startedMs = dateMs(submittedAt);
  const finishedMs = dateMs(finishedAt, startedMs);
  return {
    wallS: Number((Math.max(0, finishedMs - startedMs) / 1000).toFixed(3)),
    stageSeconds,
    tokens: usage,
    tokenAccounting: {
      version: 2,
      authorTranscripts: seenAuthor.size,
      judgeLedgers: seenJudge.size,
      timingLedgers,
      dollarCost: null,
      note: 'Provider-recorded tokens are deduplicated by evidence hash. Copied repair summaries are excluded from stage timing totals.',
    },
  };
}

function normalizeAttempt(attempt) {
  return {
    ...attempt,
    number: Number(attempt.number),
    status: isActive(attempt) || ['complete', 'failed'].includes(attempt.status) ? attempt.status : 'failed',
  };
}
function normalizeAttempts(attempts) {
  const unique = new Map();
  for (const raw of attempts) {
    const attempt = normalizeAttempt(raw);
    if (!Number.isInteger(attempt.number) || attempt.number < 1) continue;
    const key = attempt.jobId ? `job:${attempt.jobId}` : `number:${attempt.number}`;
    if (unique.has(key)) Object.assign(unique.get(key), attempt);
    else unique.set(key, attempt);
  }
  return [...unique.values()];
}
async function loadState() {
  let saved;
  try { saved = await readJson(statePath); } catch { saved = null; }
  if (saved?.campaignId !== config.id) saved = null;
  const byId = new Map((saved?.cases ?? []).map((item) => [item.id, item]));
  const cases = config.cases.map((item, index) => ({
    id: item.id,
    title: item.title,
    index,
    attempts: normalizeAttempts(byId.get(item.id)?.attempts ?? []),
    validVideos: (byId.get(item.id)?.validVideos ?? []).slice(0, config.targetValidVideos),
  }));
  return {
    version: 2,
    campaignId: config.id,
    targetValidVideos: config.targetValidVideos,
    methodology: config.methodology,
    startedAt: saved?.startedAt ?? now(),
    updatedAt: now(),
    heartbeatAt: saved?.heartbeatAt ?? null,
    heartbeatSequence: Number.isInteger(saved?.heartbeatSequence) ? saved.heartbeatSequence : 0,
    nextCaseIndex: Number.isInteger(saved?.nextCaseIndex) ? saved.nextCaseIndex % cases.length : 0,
    lastSubmissionAt: saved?.lastSubmissionAt ?? null,
    cases,
  };
}
let state = await loadState();
let capacity = null;

async function capacitySnapshot() {
  const load1 = loadavg()[0];
  const memoryInfo = await readFile('/proc/meminfo', 'utf8').catch(() => '');
  const availableKiB = Number(memoryInfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m)?.[1]);
  const memoryAvailableGiB = Number(((Number.isFinite(availableKiB) ? availableKiB * 1024 : freemem()) / (1024 ** 3)).toFixed(2));
  let gpuFreeGiB = null;
  try {
    const result = await execFileAsync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { timeout: 5_000 });
    const values = result.stdout.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (values.length) gpuFreeGiB = Number((Math.min(...values) / 1024).toFixed(2));
  } catch { /* CPU and memory gates remain available without nvidia-smi */ }
  let effectiveMaxActiveJobs = maxActive;
  let throttleReason = null;
  if (memoryAvailableGiB < 8) {
    effectiveMaxActiveJobs = 0;
    throttleReason = `available memory ${memoryAvailableGiB} GiB is below 8 GiB`;
  } else if (gpuFreeGiB != null && gpuFreeGiB < 1.5) {
    effectiveMaxActiveJobs = 0;
    throttleReason = `GPU memory ${gpuFreeGiB} GiB is below 1.5 GiB`;
  } else if (load1 > hardware.logicalCpus * loadPausePerCpu) {
    effectiveMaxActiveJobs = Math.min(1, maxActive);
    throttleReason = `load1 ${load1.toFixed(2)} exceeds ${(hardware.logicalCpus * loadPausePerCpu).toFixed(2)}`;
  }
  return {
    observedAt: now(),
    load1: Number(load1.toFixed(2)),
    loadPauseThreshold: Number((hardware.logicalCpus * loadPausePerCpu).toFixed(2)),
    memoryAvailableGiB,
    gpuFreeGiB,
    effectiveMaxActiveJobs,
    throttleReason,
  };
}

function runnerStatus() {
  return {
    host: hostname(),
    pid: process.pid,
    mode: initializeOnly ? 'initialize-only' : 'running',
    maxActiveJobs: maxActive,
    requestedMaxActiveJobs: requestedConcurrency,
    batchConcurrency,
    intervalMs,
    submissionRecoveryMs,
    submissionRampPerHeartbeat,
    hardware,
    capacity,
  };
}

async function checkpoint(heartbeat = false) {
  state.updatedAt = now();
  if (heartbeat) {
    state.heartbeatAt = state.updatedAt;
    state.heartbeatSequence += 1;
  }
  await atomicJson(statePath, state);
}

async function recoverCampaignJobs() {
  if (!(await exists(jobsDir))) return;
  const caseById = new Map(state.cases.map((item) => [item.id, item]));
  for (const entry of await readdir(jobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jobId = entry.name;
    let brief;
    try { brief = await readJson(join(jobsDir, jobId, '00-brief.json')); } catch { continue; }
    if (brief.campaignId !== config.id) continue;
    const item = caseById.get(brief.campaignCaseId);
    const number = Number(brief.campaignAttempt);
    if (!item || !Number.isInteger(number) || number < 1) continue;
    let attempt = item.attempts.find((value) => value.jobId === jobId);
    if (!attempt) attempt = item.attempts.find((value) => value.number === number && !value.jobId);
    if (!attempt) {
      attempt = { number, seed: brief.seed, status: 'queued', submittedAt: brief.createdAt ?? now() };
      item.attempts.push(attempt);
    }
    attempt.jobId = jobId;
    attempt.seed = brief.seed ?? attempt.seed;
    attempt.submittedAt = brief.createdAt ?? attempt.submittedAt ?? now();
    if (attempt.status === 'submitting') attempt.status = 'queued';
  }
  for (const item of state.cases) {
    item.attempts.sort((left, right) => left.number - right.number || String(left.jobId ?? '').localeCompare(String(right.jobId ?? '')));
  }
}

function aggregate() {
  const totals = {
    cases: state.cases.length,
    completeCases: 0,
    targetVideos: state.cases.length * state.targetValidVideos,
    validVideos: 0,
    jobs: 0,
    activeJobs: 0,
    failedJobs: 0,
    wallS: 0,
    stageSeconds: {},
    tokens: emptyUsage(),
  };
  for (const item of state.cases) {
    totals.validVideos += item.validVideos.length;
    if (item.validVideos.length === state.targetValidVideos) totals.completeCases += 1;
    for (const attempt of item.attempts) {
      totals.jobs += 1;
      if (isActive(attempt)) totals.activeJobs += 1;
      if (attempt.status === 'failed') totals.failedJobs += 1;
      if (!attempt.metrics) continue;
      totals.wallS += Number(attempt.metrics.wallS ?? 0) || 0;
      addUsage(totals.tokens, attempt.metrics.tokens);
      for (const [stage, seconds] of Object.entries(attempt.metrics.stageSeconds ?? {})) {
        totals.stageSeconds[stage] = Number((Number(totals.stageSeconds[stage] ?? 0) + (Number(seconds) || 0)).toFixed(3));
      }
    }
  }
  totals.wallS = Number(totals.wallS.toFixed(3));
  const elapsedHours = Math.max(1 / 3600, (Date.now() - dateMs(state.startedAt)) / 3_600_000);
  totals.elapsedHours = Number(elapsedHours.toFixed(3));
  totals.validVideosPerHour = Number((totals.validVideos / elapsedHours).toFixed(3));
  totals.jobsPerHour = Number((totals.jobs / elapsedHours).toFixed(3));
  totals.meanTokensPerValidVideo = totals.validVideos
    ? Math.round((totals.tokens.inputTokens + totals.tokens.outputTokens) / totals.validVideos)
    : null;
  return totals;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
async function publish() {
  capacity = await capacitySnapshot();
  await checkpoint(true);
  const totals = aggregate();
  const report = {
    ...state,
    runner: runnerStatus(),
    totals,
    validityContract: {
      productAccepted: true,
      frozenGateRequired: true,
      briefAware3dReviewRequired: true,
      uniqueVideoSha256Required: true,
      durableCampaignCopyRequired: true,
      minimumPerCase: state.targetValidVideos,
    },
  };
  await atomicJson(reportPath, report);
  const rows = state.cases.map((item) => {
    const attempts = item.attempts.map((attempt) => `#${attempt.number} ${attempt.status}`).join(', ') || 'pending';
    const videos = item.validVideos.map((video, index) => `<figure><video controls preload="none" src="${escapeHtml(video.url)}"></video><figcaption>${index + 1}. ${escapeHtml(video.cellId)} · ${escapeHtml(video.sha256.slice(0, 12))}</figcaption></figure>`).join('');
    return `<tr><td>${item.index + 1}</td><td><b>${escapeHtml(item.title)}</b><div class="muted">${escapeHtml(attempts)}</div>${videos ? `<details><summary>${item.validVideos.length} accepted videos</summary><div class="videos">${videos}</div></details>` : ''}</td><td>${item.validVideos.length}/${state.targetValidVideos}</td></tr>`;
  }).join('\n');
  const throttle = capacity.throttleReason ? ` Throttled: ${escapeHtml(capacity.throttleReason)}.` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(config.id)}</title><style>body{font:14px system-ui;background:#0b0e14;color:#e8edf5;margin:32px}h1{margin-bottom:4px}.muted,figcaption{color:#95a0b2}.metrics{display:flex;gap:12px;flex-wrap:wrap}.metric{padding:12px 16px;background:#151b25;border-radius:10px}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{text-align:left;vertical-align:top;padding:9px;border-bottom:1px solid #29303c}.videos{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px}video{width:100%;background:#000}figure{margin:0}a{color:#8de8c0}summary{cursor:pointer;margin-top:7px}</style></head><body><h1>${escapeHtml(config.id)}</h1><p class="muted">Strict frozen gate + brief-aware 3D product acceptance + per-case SHA-256 uniqueness. Heartbeat ${escapeHtml(state.heartbeatAt)}.${throttle}</p><div class="metrics"><div class="metric"><b>${totals.validVideos}/${totals.targetVideos}</b><br>valid videos</div><div class="metric"><b>${totals.completeCases}/${totals.cases}</b><br>complete cases</div><div class="metric"><b>${totals.activeJobs}/${capacity.effectiveMaxActiveJobs}</b><br>active/effective jobs</div><div class="metric"><b>${capacity.load1}</b><br>load1</div><div class="metric"><b>${totals.validVideosPerHour}</b><br>videos/hour</div><div class="metric"><b>${totals.tokens.inputTokens + totals.tokens.outputTokens}</b><br>tokens</div></div><p><a href="report.json">Live report JSON</a></p><table><thead><tr><th>#</th><th>Case and attempt status</th><th>Accepted</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  await atomicWrite(htmlPath, html);
  console.log(JSON.stringify({ at: state.updatedAt, heartbeatSequence: state.heartbeatSequence, capacity, ...totals }));
}

function safeCellId(value) {
  return typeof value === 'string' && value.length > 0 && basename(value) === value && !value.includes(sep) ? value : null;
}

function videoTarget(item, digest) {
  return join(campaignDir, 'videos', item.id, `${digest}.mp4`);
}

async function durableCopy(source, target, expectedHash) {
  if (await nonemptyFile(target)) {
    if (await fileSha256(target) === expectedHash) return;
  }
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await copyFile(source, temporary);
  if (await fileSha256(temporary) !== expectedHash) throw new Error(`copied video hash mismatch for ${source}`);
  await rename(temporary, target);
}

async function collectAccepted(item, attempt, jobDir, gallery) {
  const judgePath = join(jobDir, '70-judge.json');
  if (!(await exists(judgePath)) || item.validVideos.length >= state.targetValidVideos) return;
  let judge;
  try { judge = await readJson(judgePath); } catch { return; }
  let indexedCells = [];
  try { indexedCells = (await readJson(join(jobDir, '40-cells', 'index.json'))).cells ?? []; } catch { /* map id remains unknown */ }
  const known = new Set(item.validVideos.map((video) => video.sha256));
  for (const row of judge.cells ?? []) {
    if (row.productAccepted !== true || item.validVideos.length >= state.targetValidVideos) continue;
    const cellId = safeCellId(row.cellId);
    if (!cellId) continue;
    const candidates = [
      join(jobDir, '65-render3d', cellId, 'rollout.mp4'),
      join(jobDir, '65-render3d', cellId, 'video.mp4'),
    ];
    let videoPath = null;
    for (const candidate of candidates) {
      if (await nonemptyFile(candidate)) { videoPath = candidate; break; }
    }
    if (!videoPath) continue;
    const digest = await fileSha256(videoPath);
    if (known.has(digest)) continue;
    const relativeVideo = join('videos', item.id, `${digest}.mp4`);
    await durableCopy(videoPath, join(campaignDir, relativeVideo), digest);
    const indexedCell = indexedCells.find((cell) => cell.cellId === cellId);
    item.validVideos.push({
      sha256: digest,
      jobId: attempt.jobId,
      cellId,
      source: relative(jobDir, videoPath).split('\\').join('/'),
      url: `/artifacts/campaigns/${config.id}/${relativeVideo.split('\\').join('/')}`,
      mapId: indexedCell?.mapId ?? ((gallery.maps ?? []).length === 1 ? gallery.maps[0] : null),
      realism: row.threeDReview?.realism ?? row.realism ?? null,
      dynamism: row.dynamism ?? null,
      acceptedAt: now(),
    });
    known.add(digest);
  }
}

async function validateSavedVideos() {
  for (const item of state.cases) {
    const valid = [];
    const known = new Set();
    const removedJobs = new Set();
    for (const video of item.validVideos) {
      let accepted = true;
      if (valid.length >= state.targetValidVideos || !/^[a-f0-9]{64}$/.test(video.sha256) || known.has(video.sha256)) accepted = false;
      const attempt = accepted ? item.attempts.find((value) => value.jobId === video.jobId) : null;
      if (accepted && (!attempt?.jobId || !safeCellId(video.cellId))) accepted = false;
      let judge;
      if (accepted) {
        try { judge = await readJson(join(jobsDir, attempt.jobId, '70-judge.json')); } catch { accepted = false; }
      }
      if (accepted && !(judge.cells ?? []).some((row) => row.cellId === video.cellId && row.productAccepted === true)) accepted = false;
      const target = accepted ? videoTarget(item, video.sha256) : null;
      if (accepted && (!(await nonemptyFile(target)) || await fileSha256(target) !== video.sha256)) accepted = false;
      if (!accepted) {
        if (video.jobId) removedJobs.add(video.jobId);
        continue;
      }
      valid.push(video);
      known.add(video.sha256);
    }
    item.validVideos = valid;
    if (removedJobs.size) {
      for (const attempt of item.attempts) delete attempt.acceptanceCollectedAt;
    }
  }
}

async function refreshAttempts() {
  const refreshedJobs = new Set();
  for (const item of state.cases) {
    for (const attempt of item.attempts) {
      if (!attempt.jobId) {
        if (attempt.status === 'submitting' && Date.now() - dateMs(attempt.submissionStartedAt) >= submissionRecoveryMs) {
          attempt.status = 'failed';
          attempt.finishedAt = now();
          attempt.error = 'submission outcome was not recoverable before the recovery deadline';
        }
        continue;
      }
      if (refreshedJobs.has(attempt.jobId)) continue;
      refreshedJobs.add(attempt.jobId);
      const jobDir = join(jobsDir, attempt.jobId);
      const galleryPath = join(jobDir, '90-gallery.json');
      const errorPath = join(jobDir, 'job-error.json');
      if (await exists(galleryPath)) {
        let gallery;
        try { gallery = await readJson(galleryPath); } catch { continue; }
        attempt.status = 'complete';
        attempt.finishedAt = gallery.finishedAt ?? attempt.finishedAt ?? now();
        attempt.reportedAcceptedVideos = Number(gallery.quality?.accepted ?? 0);
        if (!attempt.acceptanceCollectedAt) {
          await collectAccepted(item, attempt, jobDir, gallery);
          attempt.acceptanceCollectedAt = now();
        }
        attempt.acceptedVideos = item.validVideos.filter((video) => video.jobId === attempt.jobId).length;
        if (attempt.metrics?.tokenAccounting?.version !== 2) attempt.metrics = await jobMetrics(jobDir, attempt.submittedAt, attempt.finishedAt);
      } else if (await exists(errorPath)) {
        let error;
        try { error = await readJson(errorPath); } catch { continue; }
        attempt.status = 'failed';
        attempt.finishedAt = error.failedAt ?? attempt.finishedAt ?? now();
        attempt.error = error.error ?? 'job failed';
        if (attempt.metrics?.tokenAccounting?.version !== 2) attempt.metrics = await jobMetrics(jobDir, attempt.submittedAt, attempt.finishedAt);
      } else if (await exists(jobDir)) {
        attempt.status = 'running';
      }
    }
  }
}

function activeCount() {
  return state.cases.flatMap((item) => item.attempts).filter(isActive).length;
}
function nextCase() {
  for (let offset = 0; offset < state.cases.length; offset += 1) {
    const index = (state.nextCaseIndex + offset) % state.cases.length;
    const item = state.cases[index];
    if (item.validVideos.length >= state.targetValidVideos || item.attempts.some(isActive)) continue;
    state.nextCaseIndex = (index + 1) % state.cases.length;
    return item;
  }
  return null;
}
function attemptSeed(item, number) {
  return Number.parseInt(sha256(`${item.id}:${number}`).slice(0, 8), 16) & 0x7fffffff;
}
async function submit(item) {
  const number = Math.max(0, ...item.attempts.map((attempt) => Number(attempt.number) || 0)) + 1;
  const seed = attemptSeed(item, number);
  const remaining = Math.max(1, state.targetValidVideos - item.validVideos.length);
  const topK = Math.max(1, Math.min(3, Math.ceil((remaining + 1) / 3)));
  const attempt = { number, seed, status: 'submitting', submissionStartedAt: now(), submittedAt: null };
  item.attempts.push(attempt);
  await checkpoint();
  const brief = `${item.title}. Generate a physically grounded, collision-free edge-case scenario in which the exact requested behavior is visibly central. The full-duration 3D sequence must unambiguously establish the road context, causal actors, event progression, and realistic reactions needed for strict product review. Produce a distinct realization for campaign attempt ${number}.`;
  try {
    const response = await fetch(`${server}/api/jobs?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        methodology: 'production',
        brief,
        seed,
        campaignId: config.id,
        campaignCaseId: item.id,
        campaignAttempt: number,
        topK,
      }),
    });
    if (!response.ok) throw new Error(`submit ${item.id} failed ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    if (typeof payload.jobId !== 'string' || !payload.jobId) throw new Error(`submit ${item.id} returned no jobId`);
    attempt.jobId = payload.jobId;
    attempt.status = 'queued';
    attempt.submittedAt = now();
    state.lastSubmissionAt = attempt.submittedAt;
    await checkpoint();
    console.log(JSON.stringify({ submitted: item.id, number, jobId: attempt.jobId }));
  } catch (error) {
    attempt.status = 'failed';
    attempt.finishedAt = now();
    attempt.error = String(error?.message ?? error);
    await checkpoint();
    throw error;
  }
}

await mkdir(campaignDir, { recursive: true });
const runnerLock = await acquireLock();
try {
await recoverCampaignJobs();
await validateSavedVideos();
await refreshAttempts();
await publish();

if (!initializeOnly) {
  while (aggregate().completeCases < state.cases.length) {
    let submissionFailed = false;
    let submittedThisHeartbeat = 0;
    while (
      activeCount() < capacity.effectiveMaxActiveJobs
      && submittedThisHeartbeat < submissionRampPerHeartbeat
    ) {
      const item = nextCase();
      if (!item) break;
      try {
        await submit(item);
        submittedThisHeartbeat += 1;
      } catch (error) {
        console.error(String(error?.stack ?? error));
        submissionFailed = true;
        break;
      }
    }
    await publish();
    await sleep(submissionFailed ? Math.max(intervalMs, 60_000) : intervalMs);
    await recoverCampaignJobs();
    await refreshAttempts();
  }
  await publish();
}
} finally {
  await releaseLock(runnerLock);
}
