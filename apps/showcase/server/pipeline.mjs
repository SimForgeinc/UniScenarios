import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { availableParallelism, loadavg } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  classifyRenderFailure,
  collisionPolicyForContract,
  evaluateTraceValidity,
  mergeDefectCodes,
  retryForDefectCodes,
} from '../../../scripts/trace-validity-lib.mjs';
import { operationalFailure } from './failures.mjs';
import {
  acceptanceCache,
  acceptanceFields,
  blocksSemantic,
  contractIdentity,
  evaluateReview,
  GATE_DEFECT_CODE,
  judgeAcceptanceSummary,
  normalizeJudgeDocument,
  retryRecommendation,
  retryRequiresAuthor,
  reviewCodeDigest,
  rowReview,
  sha256Text,
  withDefectCodes,
} from './review-contract.mjs';

const execFileAsync = promisify(execFile);

export const MAPS = [
  'yale-street',
  'belmont-research-center',
  'el-camino-road',
  'easterbrook-discovery-school',
  'richmond-field-station',
];

const COMPILER_TERMS = /\b(brak|lead|vehicle|car|truck|bus|pedestrian|child|cycl|scooter|junction|intersection|cross|cut.?in|lane chang|swerve|oncoming|u.?turn|parking|pull.?out|work.?zone|road.?work|closure)/i;

export async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  await rename(temp, path);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Deterministic product eligibility for one simulated cell.
 *
 * This runs after the frozen training-grade gate and before any render or
 * review: an unreadable trace, a contract-violating collision, an actor frozen
 * by an engine-recorded failure, a permanent lane-corridor stall or a failed
 * authored interaction all reject the cell here, where rejection costs nothing.
 */
async function cellTraceValidity(traceFile, collisionPolicy) {
  let trace = null;
  try {
    trace = JSON.parse(gunzipSync(await readFile(traceFile)).toString('utf8'));
  } catch {
    // An unreadable trace carries no physical fact at all, which is exactly what the validator
    // reports for a trace that recorded no ticks: one code path, failing closed.
  }
  const { schema: _schema, semanticAccepted, ...validity } = evaluateTraceValidity(trace, { collisionPolicy });
  // `eligible` is deliberately not the contract's `semanticAccepted`: under the shared contract a
  // `simulation.*` defect blocks the presentation, not the scenario. This is the cheap gate that
  // keeps a broken draw out of the renderer, and `evaluateReview` still owns both verdicts.
  return { eligible: semanticAccepted, ...validity, retry: retryForDefectCodes(validity.defectCodes) };
}

/**
 * Product eligibility for every simulated cell of a job.
 *
 * The frozen training-grade gate decides admission and is never re-litigated
 * here; a cell it rejected is simply reported as not admitted. For the cells it
 * admitted, this is the deterministic decision about whether the recorded
 * physics is presentable, and it is the gate that every expensive stage filters
 * on.
 */
export async function evaluateCellEligibility(cells, { passing, gateCells = [], collisionPolicy }) {
  const rows = await Promise.all(cells.map(async (cell) => {
    if (!passing.has(cell.cellId)) {
      return {
        cellId: cell.cellId,
        admitted: false,
        eligible: false,
        defectCodes: [],
        unsupportedReason: null,
        retry: 'none',
        reason: `frozen gate rejected this cell (${gateCells.find((row) => row.cellId === cell.cellId)?.firstFailure ?? 'no verdict'})`,
      };
    }
    return {
      cellId: cell.cellId,
      admitted: true,
      ...await cellTraceValidity(cell.traceFile, collisionPolicy),
    };
  }));
  return {
    status: 'complete',
    implementation: 'scripts/trace-validity-lib.mjs:evaluateTraceValidity',
    collisionPolicy,
    admittedCells: rows.filter((row) => row.admitted).length,
    eligibleCells: rows.filter((row) => row.admitted && row.eligible).length,
    defectCodes: mergeDefectCodes(...rows.map((row) => row.defectCodes)),
    cells: rows,
  };
}

function lastJsonLine(text) {
  let value;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    try {
      value = JSON.parse(line);
    } catch {
      // Logs may start with a brace; only complete JSON lines are protocol output.
    }
  }
  return value;
}

async function command(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args.map(String), {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? 3_600_000,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const result = {
      code: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error.message ?? error),
    };
    if (!options.allowFailure) {
      throw new Error(`${file} ${args.join(' ')} failed (${result.code}): ${String(result.stderr).slice(-2000)}`);
    }
    return result;
  }
}

function artifactPath(jobDir, path) {
  return relative(jobDir, path).split('\\').join('/');
}

export async function stage(context, name, artifacts, action, { cacheKey } = {}) {
  const present = await Promise.all(artifacts.map((path) => exists(path)));
  const single = artifacts.length === 1 && artifacts[0].endsWith('.json') ? artifacts[0] : null;
  if (present.every(Boolean)) {
    const cached = single ? await readJson(single) : undefined;
    if (!cacheKey || cached?.cache?.key === cacheKey) {
      context.emit({ stage: name, status: 'complete', artifacts: artifacts.map((p) => artifactPath(context.jobDir, p)) });
      return cached;
    }
    // A verdict cached under a different contract, prompt, or review implementation is evidence
    // about a contract that no longer exists. Retire it instead of letting it read as current.
    const retired = join(dirname(single), '.stale', `${basename(single)}.${String(cached?.cache?.key ?? 'unkeyed').slice(0, 12)}`);
    await mkdir(dirname(retired), { recursive: true });
    await rename(single, retired);
    context.staleArtifacts[name] = {
      previousKey: cached?.cache?.key ?? null,
      artifact: artifactPath(context.jobDir, retired),
      retiredAt: new Date().toISOString(),
    };
  }
  context.emit({ stage: name, status: 'running', artifacts: [] });
  const started = Date.now();
  const result = await action();
  context.timings[name] = Number(((Date.now() - started) / 1000).toFixed(3));
  context.emit({ stage: name, status: result?.status ?? 'complete', artifacts: artifacts.map((p) => artifactPath(context.jobDir, p)) });
  return result?.value ?? result;
}

function safeCellId(result) {
  return `${result.mapId}-${result.siteId}-${result.drawIndex}`.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function copyCells(summary, cellsDir, job) {
  await mkdir(cellsDir, { recursive: true });
  const cells = [];
  for (const result of summary.results ?? []) {
    const cellId = safeCellId(result);
    const cellDir = join(cellsDir, cellId);
    await mkdir(cellDir, { recursive: true });
    const traceFile = result.traceFile && (await exists(result.traceFile)) ? join(cellDir, 'trace.json.gz') : null;
    const instanceFile = result.instanceFile && (await exists(result.instanceFile)) ? join(cellDir, 'instance.json') : null;
    if (traceFile) await copyFile(result.traceFile, traceFile);
    if (instanceFile) await copyFile(result.instanceFile, instanceFile);
    const meta = {
      cellId,
      briefId: job.briefId,
      stream: 'showcase',
      templateSha256: summary.templateDigest ?? null,
      map: result.mapId,
      site: result.siteId,
      draw: result.drawIndex,
      seed: result.paramSeed ?? job.seed ?? null,
      gate: null,
      notes: 'showcase job cell; gate populated in 50-gate.json',
      batch: {
        status: result.status,
        verdict: result.verdict,
        band: result.band,
        siteScore: result.siteScore,
        error: result.error ?? null,
      },
    };
    await atomicJson(join(cellDir, 'meta.json'), meta);
    cells.push({
      cellId,
      cellDir,
      traceFile,
      instanceFile,
      mapId: result.mapId,
      siteId: result.siteId,
      drawIndex: result.drawIndex,
      verdict: result.verdict,
      band: result.band,
      siteScore: result.siteScore,
    });
  }
  await atomicJson(join(cellsDir, 'index.json'), {
    cells: cells.map(({ cellDir: _cellDir, ...cell }) => ({
      ...cell,
      traceFile: cell.traceFile ? artifactPath(cellsDir, cell.traceFile) : null,
      instanceFile: cell.instanceFile ? artifactPath(cellsDir, cell.instanceFile) : null,
    })),
    batch: { cells: summary.cells, elapsedMs: summary.elapsedMs, criticality: summary.criticality },
  });
  return cells;
}

export function rankCandidates(cells, qualityRows) {
  const quality = new Map(qualityRows.map((row) => [row.cellId, row]));
  const score = (cell) => {
    const row = quality.get(cell.cellId) ?? {};
    return (row.plausible === true ? 100 : 0)
      + Number(row.realism ?? 0) * 10
      + Number(row.dynamism ?? 0) * 2
      - (row.defects ?? []).length * 25;
  };
  const sorted = [...cells].sort((a, b) => score(b) - score(a)
    || String(a.cellId).localeCompare(String(b.cellId)));
  const diverse = [];
  const deferred = [];
  const sites = new Set();
  const maps = new Set();
  for (const cell of sorted) {
    const site = `${cell.mapId}:${cell.siteId}`;
    if (!sites.has(site) || !maps.has(cell.mapId)) {
      diverse.push(cell);
      sites.add(site);
      maps.add(cell.mapId);
    } else {
      deferred.push(cell);
    }
  }
  return [...diverse, ...deferred];
}

/**
 * Decide both canonical verdicts for every row of one attempt, in place.
 *
 * `evaluateReview` is the only acceptance predicate. This function's whole job is to hand it the
 * evidence the reviewer could not see -- the frozen gate verdict, the deterministic trace validity
 * codes, and a hard render failure -- and to ration the deliverable presentation quota to `topK`.
 */
export function applyProductDecision(rows, { job, passing, gateRows, validityByCell, renderByCell }) {
  const evaluated = rows.map((row) => {
    const evidence = rowReview(row);
    const validity = validityByCell?.get(row.cellId);
    const render = renderByCell?.get(row.cellId);
    const renderCodes = render?.defectCodes ?? [];
    const injected = [];
    if (!passing.has(row.cellId)) {
      injected.push({
        code: GATE_DEFECT_CODE,
        text: `frozen gate first failure ${gateRows?.get(row.cellId)?.firstFailure ?? 'NOGATE'}`,
      });
    }
    if (row.renderError) {
      // The exporter classified this failure itself, so its message is evidence text and not a
      // defect to re-attribute: taxonomy rules written for reviewer prose would only guess at it.
      evidence.explanation = [evidence.explanation, row.renderError].filter(Boolean).join('\n');
      if (renderCodes.length === 0) injected.push({ text: row.renderError });
    }
    if (injected.length) {
      evidence.defects = [...(Array.isArray(evidence.defects) ? evidence.defects : []), ...injected];
    }
    // The deterministic stages name their own defects exactly; only free text has to be attributed
    // by the taxonomy rules, so their codes are folded in rather than reclassified.
    return { row, result: withDefectCodes(evaluateReview(evidence), validity?.defectCodes, renderCodes) };
  });
  // Presentation acceptance is the deliverable quota, so topK caps it; semantic truth about the
  // scenario is never rationed and stays attributable on every row.
  const overflow = new Set(evaluated
    .filter(({ result }) => result.presentationAccepted)
    .sort((left, right) => Number(right.result.axes.realism ?? 0) - Number(left.result.axes.realism ?? 0)
      || Number(right.result.axes.confidence ?? 0) - Number(left.result.axes.confidence ?? 0)
      || String(left.row.cellId).localeCompare(String(right.row.cellId)))
    .slice(Math.max(0, Number(job.topK ?? 0)))
    .map(({ row }) => row.cellId));
  for (const { row, result } of evaluated) {
    const cappedByTopK = overflow.has(row.cellId);
    Object.assign(row, acceptanceFields(result));
    if (cappedByTopK) row.presentationAccepted = false;
    row.acceptance = {
      tier: result.tier,
      axes: result.axes,
      defects: result.defects,
      contract: contractIdentity(),
      gatePassed: passing.has(row.cellId),
      cappedByTopK,
    };
  }
  return rows;
}

/**
 * The single stage-local control a rejected job authorises.
 *
 * The contract's own `retryRecommendation` names the namespace that has to be repaired, so the cost
 * order is the contract's and not this function's: a presentation blocker can never reach the
 * author. What lives here is the mapping from that namespace to the control this pipeline can
 * actually run, plus the one escalation the deterministic draws force -- re-running an identical
 * simulation repairs nothing, so a simulation blocker is a defect of the template.
 */
export function planRetry(route, job, judge) {
  const document = normalizeJudgeDocument(judge);
  const rows = document?.cells ?? [];
  const none = (reason) => ({
    retry: 'none', kind: 'none', defectCodes: [], cellIds: [], reason, recommendation: null,
  });
  if (!job.render3d || !job.judge) return none('3D render or product review is disabled');
  if (document?.status !== 'complete') return none(`product review was skipped: ${document?.reason ?? 'unknown reason'}`);
  const summary = judgeAcceptanceSummary(document);
  if (summary.presentationAcceptedCells > 0) return none('the job accepted a cell');

  // Cells a presentation control could still rescue: the ones no scenario defect condemns. A cell
  // whose render produced no footage belongs here -- its semantics are unproven, not rejected, and
  // reading a missing verdict as a rejection would turn a camera fault into an authoring fault.
  const repairable = rows.filter((row) => !blocksSemantic(row.defectCodes));
  const observed = mergeDefectCodes(...(repairable.length > 0 ? repairable : rows).map((row) => row.defectCodes));
  const authorised = (codes) => retryRecommendation(codes, repairable.length > 0 ? {} : { reviewed: summary.reviewed });
  let defectCodes = observed;
  let recommendation = authorised(defectCodes);
  // No control short of authoring can change this outcome: either the only namespace left is the
  // simulator and the recorded draws are deterministic, or nothing reviewable survived at all.
  // Naming that as an attributable scenario code lets the contract's own order make the call.
  const escalation = recommendation?.action === 'resimulate'
    ? 'scenario.contract_violation'
    : (recommendation === null || (repairable.length === 0 && !blocksSemantic(observed))
      ? 'scenario.no_eligible_simulation'
      : null);
  if (escalation) {
    defectCodes = mergeDefectCodes([escalation], observed);
    recommendation = authorised(defectCodes);
  }
  const cellIds = repairable.map((row) => row.cellId);
  const plan = (retry, kind, reason) => ({
    retry, kind, defectCodes, cellIds: retry === 'reauthor' ? [] : cellIds, reason, recommendation,
  });
  if (retryRequiresAuthor(recommendation)) {
    if (route.engine === 'compiler' && job.fallbackToVisual === true && Number(job._fallbackDepth ?? 0) < 1) {
      return plan('reauthor', 'compiler-to-visual-fallback',
        'compiler output produced no presentable scenario; visual authoring is the declared fallback');
    }
    if (Number(job._reauthorDepth ?? 0) < 1) {
      return plan('reauthor', 'scenario-defect-reauthor',
        'scenario defects can only be repaired by authoring a new template');
    }
    return plan('manual-review', 'exhausted', 'the single authorised reauthor is already spent');
  }
  if (recommendation.action === 'recompose' || recommendation.action === 'recapture') {
    // Bounded by the retry stage's own cached artifact, not by a depth counter: the attempt runs
    // once, and a resumed job reads what it already rendered.
    return plan(recommendation.action, 'presentation-retry',
      `every rejected cell is repairable where it failed: ${recommendation.reason}`);
  }
  // `rereview` is what the contract returns when only `judge.` codes are left. Running the same
  // model over the same footage is not a repair, so the job stops for a person.
  return plan('manual-review', recommendation.action, 'no automatic control repairs this rejection');
}

async function loadCells(cellsDir) {
  const index = await readJson(join(cellsDir, 'index.json'));
  return index.cells.map((cell) => ({
    ...cell,
    cellDir: join(cellsDir, cell.cellId),
    traceFile: cell.traceFile ? join(cellsDir, cell.traceFile) : null,
    instanceFile: cell.instanceFile ? join(cellsDir, cell.instanceFile) : null,
  }));
}

async function normalizeRender(outDir, redact) {
  const names = await readdir(outDir);
  const video = names.find((name) => name === 'rollout.mp4') ?? names.find((name) => name.endsWith('.mp4'));
  if (!video) throw new Error(`renderer wrote no mp4 in ${outDir}`);
  if (video !== 'rollout.mp4') await copyFile(join(outDir, video), join(outDir, 'rollout.mp4'));
  const manifestName = names.includes('render-manifest.json')
    ? 'render-manifest.json'
    : names.includes('manifest.json')
      ? 'manifest.json'
      : null;
  if (!manifestName) throw new Error(`renderer wrote no manifest in ${outDir}`);
  if (manifestName === 'manifest.json') {
    const source = await readJson(join(outDir, manifestName));
    const times = (source.frames ?? []).map((frame) => frame.t);
    await atomicJson(join(outDir, 'render-manifest.json'), {
      ...source,
      frames: (source.frames ?? []).map((frame) => ({ t: frame.t, png: frame.png })),
      footage: { redacted: redact, framePlan: { burstTimes: times.slice(0, 6) } },
    });
  }
}

async function renderCell(context, cell, outDir, { redact = false, tier = '2d', composition = 'incident' } = {}) {
  await mkdir(outDir, { recursive: true });
  const cliArgs = [
    context.cli,
    'render',
    cell.traceFile,
    '--instance',
    cell.instanceFile,
    '--out',
    outDir,
    '--tier',
    tier,
    '--format',
    'both',
    '--camera',
    'follow-ego',
    '--fps',
    '12',
    '--full-clip',
    '--composition',
    composition,
  ];
  if (redact) cliArgs.push('--redact');
  const builtIn = await command('node', cliArgs, { cwd: context.root, allowFailure: true, timeout: tier === '3d' ? 900_000 : 180_000 });
  if (builtIn.code !== 0 && tier === '2d') {
    const fallback = [
      join(context.root, 'scripts', 'render-trace.mjs'),
      '--instance',
      cell.instanceFile,
      '--trace',
      cell.traceFile,
      '--out',
      outDir,
      '--camera',
      'follow-ego',
      '--fps',
      '12',
    ];
    if (redact) fallback.push('--redact');
    await command('node', fallback, { cwd: context.root, timeout: 180_000 });
  } else if (builtIn.code !== 0) {
    throw new Error(String(builtIn.stderr).slice(-2000));
  }
  await normalizeRender(outDir, redact);
}

function gatewayAvailable(host = '127.0.0.1', port = 4141) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function concurrencySetting(value, fallback, name, max) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > max) {
    throw new RangeError(`${name} must be an integer from 1 to ${max}`);
  }
  return resolved;
}

function batchConcurrencyForHost(configured) {
  const load1 = loadavg()[0];
  return {
    concurrency: load1 > availableParallelism() * 1.25 ? 1 : configured,
    load1: Number(load1.toFixed(2)),
  };
}

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiters = [];
  }

  async run(action) {
    if (this.active < this.limit) {
      this.active += 1;
    } else {
      await new Promise((resolvePromise) => this.waiters.push(resolvePromise));
    }
    try {
      return await action();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

async function mapConcurrent(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class ShowcasePipeline {
  constructor({
    root,
    python,
    cli,
    jobConcurrency = 4,
    batchConcurrency = 3,
    render2dConcurrency = 4,
    render3dConcurrency = 2,
    judgeConcurrency = 4,
  } = {}) {
    this.root = root ?? resolve(import.meta.dirname, '../../..');
    this.python = python ?? join(this.root, '.venv', 'bin', 'python');
    this.cli = cli ?? join(this.root, 'packages', 'cli', 'bin', 'uniscenarios.js');
    this.bridge = join(this.root, 'tools', 'research', 'showcase', 'stages.py');
    this.schedulerSettings = Object.freeze({
      jobConcurrency: concurrencySetting(jobConcurrency, 4, 'jobConcurrency', 8),
      batchConcurrency: concurrencySetting(batchConcurrency, 3, 'batchConcurrency', 12),
      render2dConcurrency: concurrencySetting(render2dConcurrency, 4, 'render2dConcurrency', 8),
      render3dConcurrency: concurrencySetting(render3dConcurrency, 2, 'render3dConcurrency', 4),
      judgeConcurrency: concurrencySetting(judgeConcurrency, 4, 'judgeConcurrency', 8),
    });
    this.batchConcurrency = this.schedulerSettings.batchConcurrency;
    this.render2d = new Semaphore(this.schedulerSettings.render2dConcurrency);
    this.render3d = new Semaphore(this.schedulerSettings.render3dConcurrency);
    this.judge = new Semaphore(this.schedulerSettings.judgeConcurrency);
  }

  async run(job, externalContext) {
    const initialBatch = batchConcurrencyForHost(this.batchConcurrency);
    const effectiveBatchConcurrency = initialBatch.concurrency;
    const context = {
      ...externalContext,
      root: this.root,
      python: this.python,
      cli: this.cli,
      timings: {},
      staleArtifacts: {},
      scheduler: {
        ...(job.scheduler ?? this.schedulerSettings),
        effectiveBatchConcurrency,
        load1AtStart: initialBatch.load1,
      },
    };
    const briefPath = join(context.jobDir, '00-brief.json');
    const routePath = join(context.jobDir, '10-route.json');
    const precheckPath = join(context.jobDir, '15-precheck.json');
    const contractPath = join(context.jobDir, '15-contract.json');
    const authorDir = join(context.jobDir, '20-author');
    const templatePath = join(authorDir, 'template.json');
    const transcriptPath = join(authorDir, 'transcript.json');
    const sitesPath = join(context.jobDir, '30-sites.json');
    const cellsDir = join(context.jobDir, '40-cells');
    const cellsIndex = join(cellsDir, 'index.json');
    const gatePath = join(context.jobDir, '50-gate.json');
    const eligibilityPath = join(context.jobDir, '55-eligibility.json');
    const render2dDir = join(context.jobDir, '60-render2d');
    const render2dQualityPath = join(render2dDir, 'quality.json');
    const render2dIndex = join(render2dDir, 'index.json');
    const render3dDir = join(context.jobDir, '65-render3d');
    const render3dIndex = join(render3dDir, 'index.json');
    const judgePath = join(context.jobDir, '70-judge.json');
    const productPath = join(context.jobDir, '75-product.json');
    const authorContractPath = join(authorDir, 'contract-verdict.json');
    const galleryPath = join(context.jobDir, '90-gallery.json');

    context.emit({ stage: '00-brief', status: 'complete', artifacts: ['00-brief.json'] });

    let precheckResult;
    if (await exists(precheckPath)) {
      precheckResult = await readJson(precheckPath);
    } else {
      const result = await command(this.python, [this.bridge, 'precheck', '--brief', briefPath], { cwd: this.root });
      precheckResult = lastJsonLine(result.stdout);
      if (!precheckResult) throw new Error(`precheck returned no JSON: ${result.stdout.slice(-1000)}`);
    }
    let semanticContract;
    if (job.semanticContract) {
      semanticContract = structuredClone(job.semanticContract);
    } else if (await exists(contractPath)) {
      semanticContract = await readJson(contractPath);
    } else {
      const result = await command(this.python, [this.bridge, 'contract', '--brief', briefPath], { cwd: this.root });
      semanticContract = lastJsonLine(result.stdout);
      if (!semanticContract) throw new Error(`semantic contract returned no JSON: ${result.stdout.slice(-1000)}`);
    }
    const requested = job.engine ?? 'auto';
    const autoEngine = precheckResult.feasible && COMPILER_TERMS.test(job.brief) ? 'compiler' : 'vista2';
    const engine = requested === 'auto' ? autoEngine : requested;
    const route = await stage(context, '10-route', [routePath], async () => {
      const value = {
        requested,
        engine,
        why: requested === 'auto'
          ? `${precheckResult.feasible ? 'feasible' : 'infeasible'} structural precheck; ${autoEngine === 'compiler' ? 'brief matches a compiler family' : 'visual authoring required'}`
          : `explicit engine override: ${requested}`,
        precheck: { feasible: precheckResult.feasible, requires: precheckResult.requires, missing: precheckResult.missing },
        methodology: {
          profile: job.methodology ?? 'custom',
          author: { model: job.authorModel, effort: job.authorEffort },
          judge: { model: job.judgeModel, effort: job.judgeEffort, strategy: job.judgeStrategy },
          fallbackToVisual: job.fallbackToVisual === true,
        },
        semanticContract,
        scheduler: context.scheduler,
      };
      await atomicJson(routePath, value);
      return value;
    });
    await stage(context, '15-precheck', [precheckPath, contractPath], async () => {
      await atomicJson(precheckPath, precheckResult);
      await atomicJson(contractPath, semanticContract);
      return { precheck: precheckResult, contract: semanticContract };
    });

    await stage(context, '20-author', [templatePath, transcriptPath, authorContractPath], async () => {
      await mkdir(authorDir, { recursive: true });
      const authorOnce = async (subcommand) => {
        const args = [
          this.bridge, subcommand, '--brief', briefPath, '--out', authorDir,
          '--model', job.authorModel ?? 'gpt-5.6-sol',
          '--effort', job.authorEffort ?? 'medium',
        ];
        if (subcommand === 'vista-author') args.push('--contract', contractPath, '--retries', '2');
        if (subcommand === 'author') {
          args.push('--draws', '1', '--probe-draws', '1', '--max-sites', String(Math.min(job.maxSitesPerMap, 3)), '--concurrency', String(context.scheduler.effectiveBatchConcurrency));
        }
        await command(this.python, args, {
          cwd: this.root,
          timeout: subcommand === 'vista-author' ? 2_700_000 : 900_000,
          env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:4141/v1', OPENAI_API_KEY: 'x' },
        });
        const result = await command(this.python, [
          this.bridge, 'validate-contract', '--template', templatePath, '--contract', contractPath,
        ], { cwd: this.root });
        return lastJsonLine(result.stdout);
      };
      const initialEngine = route.engine;
      let contractVerdict = await authorOnce(initialEngine === 'vista2' ? 'vista-author' : 'author');
      const compilerContractVerdict = contractVerdict;
      if (!contractVerdict?.valid && initialEngine === 'compiler' && job.fallbackToVisual === true) {
        const rejectedDir = join(authorDir, 'compiler-rejected');
        await mkdir(rejectedDir, { recursive: true });
        await rename(templatePath, join(rejectedDir, 'template.json'));
        await rename(transcriptPath, join(rejectedDir, 'transcript.json'));
        contractVerdict = await authorOnce('vista-author');
        route.initialEngine = 'compiler';
        route.engine = 'vista2';
        route.authorFallback = {
          reason: 'compiler output violated the executable semantic contract',
          failures: compilerContractVerdict?.failures ?? [],
          artifacts: ['20-author/compiler-rejected/template.json', '20-author/compiler-rejected/transcript.json'],
        };
        await atomicJson(routePath, route);
      }
      if (!contractVerdict?.valid) {
        throw new Error(`authored template violated semantic contract: ${JSON.stringify(contractVerdict?.failures ?? [])}`);
      }
      await atomicJson(authorContractPath, contractVerdict);
      // `batch` derives draw seeds from template identity, site, and draw index.
      // Give that path a stable identity derived from the user-controlled seed.
      const template = await readJson(templatePath);
      const seedIdentity = createHash('sha256').update(`${job.brief}\0${String(job.seed)}`).digest('hex').slice(0, 16);
      template.anchor.id = `showcase-${seedIdentity}`;
      await atomicJson(templatePath, template);
    });
    const authoredTemplate = await readJson(templatePath);
    context.renderComposition = (authoredTemplate.props ?? [])
      .some((prop) => prop.essentiality === 'required') ? 'all-authored' : 'incident';
    route.methodology.renderComposition = context.renderComposition;
    await atomicJson(routePath, route);

    const sites = await stage(context, '30-sites', [sitesPath], async () => {
      const args = [this.cli, 'sites', 'match', templatePath];
      if (job.maps.length === MAPS.length) args.push('--all-maps');
      else args.push('--maps', job.maps.join(','));
      args.push('--max-sites', String(job.maxSitesPerMap), '--rejected');
      const result = await command('node', args, { cwd: this.root, allowFailure: true, timeout: 600_000 });
      const value = lastJsonLine(result.stdout);
      if (!value) throw new Error(`site matcher returned no JSON (${result.code}): ${result.stderr.slice(-1000)}`);
      await atomicJson(sitesPath, value);
      return value;
    });
    if ((sites?.totalSites ?? 0) === 0) throw new Error('no matching sites for authored template');

    let cells = await stage(context, '40-cells', [cellsIndex], async () => {
      const batchDir = join(context.jobDir, '.batch');
      await rm(batchDir, { recursive: true, force: true });
      const simulationBatch = batchConcurrencyForHost(this.batchConcurrency);
      context.scheduler.effectiveBatchConcurrency = simulationBatch.concurrency;
      context.scheduler.load1AtSimulation = simulationBatch.load1;
      route.scheduler = context.scheduler;
      await atomicJson(routePath, route);
      const args = [this.cli, 'batch', templatePath, '--out', batchDir, '--draws', String(job.nScenarios), '--max-sites', String(job.maxSitesPerMap), '--concurrency', String(simulationBatch.concurrency)];
      if (job.maps.length === MAPS.length) args.push('--all-maps');
      else args.push('--maps', job.maps.join(','));
      if (job.ambient !== 'off') args.push('--ambient', job.ambient, '--ambient-seed', String(job.seed));
      const result = await command('node', args, { cwd: this.root, allowFailure: true, timeout: 1_800_000 });
      const summaryPath = join(batchDir, 'batch-summary.json');
      if (!(await exists(summaryPath))) throw new Error(`batch wrote no summary (${result.code}): ${result.stderr.slice(-1500)}`);
      const summary = await readJson(summaryPath);
      const copied = await copyCells(summary, cellsDir, job);
      await rm(batchDir, { recursive: true, force: true });
      return copied;
    });
    if (!Array.isArray(cells)) cells = await loadCells(cellsDir);

    const gate = await stage(context, '50-gate', [gatePath], async () => {
      const requestPath = join(context.jobDir, '.gate-request.json');
      await atomicJson(requestPath, {
        brief: job.requestedBrief ?? job.brief,
        cells: cells.map((cell) => ({
          cellId: cell.cellId,
          traceFile: cell.traceFile,
          verdict: cell.verdict,
          band: cell.band,
          mapId: cell.mapId,
          siteId: cell.siteId,
          drawIndex: cell.drawIndex,
        })),
      });
      const result = await command(this.python, [this.bridge, 'gate', '--request', requestPath], { cwd: this.root, timeout: 600_000 });
      await rm(requestPath, { force: true });
      const value = lastJsonLine(result.stdout);
      if (!value) throw new Error(`gate returned no JSON: ${result.stdout.slice(-1000)}`);
      await atomicJson(gatePath, value);
      return value;
    });
    const passing = new Set((gate.cells ?? []).filter((cell) => cell.pass).map((cell) => cell.cellId));

    // Deterministic product eligibility, downstream of the frozen gate and
    // upstream of every expensive stage. The frozen contract decides admission;
    // this decides whether the admitted physics is presentable at all.
    const collisionPolicy = collisionPolicyForContract(semanticContract);
    const eligibility = await stage(context, '55-eligibility', [eligibilityPath], async () => {
      const value = await evaluateCellEligibility(cells, {
        passing,
        gateCells: gate.cells ?? [],
        collisionPolicy,
      });
      await atomicJson(eligibilityPath, value);
      return value;
    });
    const eligibilityByCell = new Map((eligibility.cells ?? []).map((row) => [row.cellId, row]));
    const eligible = new Set((eligibility.cells ?? [])
      .filter((row) => row.admitted && row.eligible)
      .map((row) => row.cellId));

    let render2d = await stage(context, '60-render2d', [render2dIndex], async () => {
      await mkdir(render2dDir, { recursive: true });
      const candidates = cells.filter((candidate) =>
        eligible.has(candidate.cellId) && candidate.traceFile && candidate.instanceFile);
      const rendered = await mapConcurrent(
        candidates,
        this.schedulerSettings.render2dConcurrency,
        async (cell) => {
          const out = join(render2dDir, cell.cellId);
          try {
            await this.render2d.run(() => renderCell(context, cell, out, {
              tier: '2d', composition: context.renderComposition,
            }));
            let redacted = null;
            if (job.judge) {
              redacted = join(out, 'redacted');
              await this.render2d.run(() => renderCell(context, cell, redacted, {
                tier: '2d', redact: true, composition: context.renderComposition,
              }));
            }
            return { cellId: cell.cellId, status: 'complete', video: `${cell.cellId}/rollout.mp4`, redacted: redacted ? `${cell.cellId}/redacted` : null };
          } catch (error) {
            const message = String(error.message ?? error);
            return {
              cellId: cell.cellId,
              status: 'error',
              error: message.slice(-1000),
              defectCodes: [classifyRenderFailure(message)],
            };
          }
        },
      );
      await atomicJson(render2dIndex, { cells: rendered });
      return { value: rendered, status: rendered.some((row) => row.status === 'complete') ? 'complete' : 'error' };
    });
    if (!Array.isArray(render2d)) render2d = render2d.cells ?? [];

    let qualityRows = [];
    if (job.judge && await gatewayAvailable()) {
      if (await exists(render2dQualityPath)) {
        qualityRows = (await readJson(render2dQualityPath)).cells ?? [];
      } else {
        qualityRows = await mapConcurrent(
          render2d.filter((row) => row.status === 'complete' && row.redacted),
          this.schedulerSettings.judgeConcurrency,
          async (item) => this.judge.run(async () => {
            const cell = cells.find((candidate) => candidate.cellId === item.cellId);
            const result = await command(this.python, [
              this.bridge, 'judge', '--cell', cell.cellDir,
              '--render', join(render2dDir, item.redacted),
              '--model', job.judgeModel ?? 'gpt-5.6-sol',
              '--effort', job.judgeEffort ?? 'medium',
              '--strategy', job.judgeStrategy ?? 'spread8',
            ], {
              cwd: this.root,
              timeout: 600_000,
              env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:4141/v1', OPENAI_API_KEY: 'x' },
              allowFailure: true,
            });
            const verdict = lastJsonLine(result.stdout);
            return verdict
              ? { status: 'complete', ...verdict }
              : { cellId: item.cellId, status: 'error', error: result.stderr.slice(-1000) };
          }),
        );
        await atomicJson(render2dQualityPath, { status: 'complete', cells: qualityRows });
      }
    }
    const qualityAccessFailure = qualityRows.find(operationalFailure);
    if (qualityAccessFailure) {
      throw new Error(`model access unavailable during 2D review: ${JSON.stringify(qualityAccessFailure).slice(-1000)}`);
    }
    let render3d = await stage(context, '65-render3d', [render3dIndex], async () => {
      await mkdir(render3dDir, { recursive: true });
      if (!job.render3d) {
        const value = { status: 'skipped', reason: 'render3d disabled', cells: [] };
        await atomicJson(render3dIndex, value);
        return { value, status: 'skipped' };
      }
      const candidates = rankCandidates(
        cells.filter((candidate) => eligible.has(candidate.cellId)),
        qualityRows,
      ).slice(0, job.topK * 3);
      const rows = await mapConcurrent(
        candidates,
        this.schedulerSettings.render3dConcurrency,
        async (cell) => this.render3dCell(context, cell, join(render3dDir, cell.cellId)),
      );
      const value = { status: rows.some((row) => row.status === 'complete') ? 'complete' : 'unavailable', cells: rows };
      await atomicJson(render3dIndex, value);
      return { value, status: value.status === 'complete' ? 'complete' : 'skipped' };
    });
    if (Array.isArray(render3d)) render3d = { status: 'complete', cells: render3d };

    const judgeModel = job.judgeModel ?? 'gpt-5.6-sol';
    const judgeEffort = job.judgeEffort ?? 'medium';
    const judgeCache = acceptanceCache({
      codeSha256: await reviewCodeDigest(this.root),
      requestSha256: sha256Text(String(job.requestedBrief ?? job.brief ?? '')),
      model: judgeModel,
      effort: judgeEffort,
      flags: {
        judge: job.judge === true,
        render3d: job.render3d === true,
        topK: Number(job.topK ?? 0),
      },
    });
    const gateRows = new Map((gate.cells ?? []).map((row) => [row.cellId, row]));
    const judge = await stage(context, '70-judge', [judgePath], async () => {
      if (!job.judge) {
        const value = { status: 'skipped', reason: 'judge disabled', cells: [], contract: contractIdentity(), cache: judgeCache };
        await atomicJson(judgePath, value);
        return { value, status: 'skipped' };
      }
      if (!(await gatewayAvailable())) {
        const value = { status: 'skipped', reason: 'OpenAI gateway unavailable at 127.0.0.1:4141', cells: [], contract: contractIdentity(), cache: judgeCache };
        await atomicJson(judgePath, value);
        return { value, status: 'skipped' };
      }
      const rows = qualityRows.map((row) => ({ ...row }));
      const reviews = await this.review3dRenders(context, job, briefPath, render3dDir,
        (render3d?.cells ?? []).filter((row) => row.status === 'complete'));
      const reviewAccessFailure = reviews.find(operationalFailure);
      if (reviewAccessFailure) {
        throw new Error(`model access unavailable during 3D review: ${JSON.stringify(reviewAccessFailure).slice(-1000)}`);
      }
      for (const item of reviews) {
        const existing = rows.find((row) => row.cellId === item.cellId);
        const row = existing ?? { cellId: item.cellId, status: 'complete' };
        if (!existing) rows.push(row);
        row.threeDReview = item.review;
      }
      for (const item of render3d?.cells ?? []) {
        if (item.status !== 'error') continue;
        const existing = rows.find((row) => row.cellId === item.cellId);
        const row = existing ?? { cellId: item.cellId, status: 'unavailable' };
        if (!existing) rows.push(row);
        row.renderError = String(item.error ?? 'render failed');
      }
      // One shared predicate decides both verdicts. The pipeline only contributes the evidence the
      // reviewer cannot see: the frozen gate verdict, the deterministic trace validity codes, and
      // the classified render failures.
      applyProductDecision(rows, {
        job,
        passing,
        gateRows,
        validityByCell: eligibilityByCell,
        renderByCell: new Map((job.render3d ? render3d?.cells ?? [] : render2d).map((row) => [row.cellId, row])),
      });
      const value = {
        status: 'complete',
        model: judgeModel,
        effort: judgeEffort,
        strategy: job.judgeStrategy ?? 'spread8',
        contract: contractIdentity(),
        cache: { ...judgeCache, retired: context.staleArtifacts['70-judge'] ?? null },
        ...judgeAcceptanceSummary({ contract: contractIdentity(), cells: rows }),
        cells: rows,
      };
      await atomicJson(judgePath, value);
      return value;
    }, { cacheKey: judgeCache.key });

    // One deterministic control per rejected job, chosen from the defect codes
    // the stages recorded. Presentation faults are repaired where they happened;
    // only a scenario defect is allowed to spend an authoring pass.
    const plan = planRetry(route, job, judge);
    // `renderDir` is where this cell's own 3D render was written. A 2D-only job
    // has none, and its accepted headline resolves from the 2D index instead.
    let productRows = (judge.cells ?? []).map((row) => ({
      ...row,
      renderDir: job.render3d ? `65-render3d/${row.cellId}` : null,
    }));
    let acceptedAttempt = null;

    if (plan.retry === 'recompose' || plan.retry === 'recapture') {
      const attemptName = '80-presentation-retry';
      const retryDir = join(context.jobDir, attemptName);
      const retryIndex = join(retryDir, 'index.json');
      // A cached stage, exactly like the ones upstream: a job resumed after a
      // crash reads the attempt it already made instead of rendering it twice.
      // That is what bounds this to one presentation retry per attempt.
      const attempt = await stage(context, attemptName, [retryIndex], async () => {
        const targets = cells.filter((cell) => plan.cellIds.includes(cell.cellId));
        // A fresh output directory: the rejected render and its manifest stay
        // exactly as they were captured.
        const renderRows = await mapConcurrent(
          targets,
          this.schedulerSettings.render3dConcurrency,
          async (cell) => this.render3dCell(context, cell, join(retryDir, '65-render3d', cell.cellId)),
        );
        const reviews = await this.review3dRenders(context, job, briefPath,
          join(retryDir, '65-render3d'), renderRows.filter((row) => row.status === 'complete'));
        const retryRows = renderRows.map((render) => {
          const source = productRows.find((row) => row.cellId === render.cellId)
            ?? { cellId: render.cellId, status: 'complete' };
          const row = { ...source, renderDir: `${attemptName}/65-render3d/${render.cellId}` };
          if (render.status === 'error') row.renderError = String(render.error ?? 'render failed');
          else delete row.renderError;
          // This attempt is judged on its own footage: the rejected attempt's verdict stays in its
          // own artifact and is never carried forward as evidence for a render it does not describe.
          row.threeDReview = reviews.find((item) => item.cellId === render.cellId)?.review ?? null;
          return row;
        });
        applyProductDecision(retryRows, {
          job,
          passing,
          gateRows,
          validityByCell: eligibilityByCell,
          renderByCell: new Map(renderRows.map((row) => [row.cellId, row])),
        });
        const value = {
          kind: plan.retry,
          reason: plan.reason,
          authorisedBy: plan.defectCodes,
          cells: renderRows,
          review: retryRows,
          acceptedCells: retryRows.filter((row) => row.presentationAccepted === true).length,
        };
        await atomicJson(retryIndex, value);
        return { value, status: value.acceptedCells > 0 ? 'complete' : 'failed' };
      });
      if ((attempt?.acceptedCells ?? 0) > 0) {
        acceptedAttempt = attemptName;
        const retried = attempt.review ?? [];
        productRows = [
          ...productRows.filter((row) => !retried.some((item) => item.cellId === row.cellId)),
          ...retried,
        ];
      }
    } else if (plan.retry === 'reauthor') {
      const attemptName = plan.kind === 'compiler-to-visual-fallback' ? '80-visual-fallback' : '80-reauthor-01';
      const repairDir = join(context.jobDir, attemptName);
      const eligibilityDefects = (eligibility.cells ?? [])
        .filter((row) => row.admitted && (row.defectCodes ?? []).length > 0)
        .map((row) => `${row.cellId}: ${row.defectCodes.join(', ')}`);
      // Repair feedback is attributable: every line names the defect code it has to fix, and the
      // deterministic rejections come first because they name defects no reviewer ever saw.
      const repairFeedback = [
        ...eligibilityDefects,
        ...(judge.cells ?? []).flatMap((row) => [
          ...(row.acceptance?.defects ?? []).map((defect) => `${defect.code}: ${defect.text}`),
          ...(row.unsupportedReason ? [`${row.acceptance?.tier ?? 'unknown'} review unsupported: ${row.unsupportedReason}`] : []),
          ...(row.threeDReview?.explanation ? [row.threeDReview.explanation] : []),
        ]),
      ].filter(Boolean).slice(0, 24);
      const repairJob = {
        ...job,
        briefId: `${job.briefId}-${plan.kind === 'compiler-to-visual-fallback' ? 'visual-fallback' : 'reauthor-01'}`,
        requestedBrief: job.requestedBrief ?? job.brief,
        brief: `${job.brief}\n\nPOST-RENDER REPAIR FEEDBACK FROM REJECTED ATTEMPT:\n${repairFeedback.map((item) => `- ${item}`).join('\n')}\nReauthor the executable scenario; do not merely explain these defects.`,
        engine: 'vista2',
        fallbackToVisual: false,
        _fallbackDepth: plan.kind === 'compiler-to-visual-fallback' ? 1 : Number(job._fallbackDepth ?? 0),
        _reauthorDepth: plan.kind === 'compiler-to-visual-fallback' ? Number(job._reauthorDepth ?? 0) : 1,
        semanticContract,
      };
      await mkdir(repairDir, { recursive: true });
      await atomicJson(join(repairDir, '00-brief.json'), repairJob);
      await atomicJson(join(repairDir, 'repair-request.json'), {
        kind: plan.kind,
        retry: plan.retry,
        reason: plan.reason,
        authorisedBy: plan.defectCodes,
        sourceJobId: job.jobId,
        feedback: repairFeedback,
        semanticContract,
      });
      context.emit({ stage: '80-reauthor', status: 'running', artifacts: [`${attemptName}/repair-request.json`] });
      try {
        await this.run(repairJob, {
          ...externalContext,
          jobDir: repairDir,
          emit: () => {},
        });
        const repairedGallery = await readJson(join(repairDir, '90-gallery.json'));
        await atomicJson(join(repairDir, 'repair-result.json'), {
          accepted: repairedGallery.accepted === true,
          gallery: repairedGallery,
        });
        context.emit({
          stage: '80-reauthor',
          status: repairedGallery.accepted === true ? 'complete' : 'failed',
          artifacts: [`${attemptName}/repair-request.json`, `${attemptName}/repair-result.json`],
        });
        if (repairedGallery.accepted === true) {
          // The attempt keeps its own cells, gate verdict, renders and review.
          // Nothing under the rejected attempt is replaced, so both attempts
          // stay auditable and every recorded hash keeps its meaning.
          acceptedAttempt = attemptName;
          const repairedProduct = await readJson(join(repairDir, '75-product.json'));
          productRows = (repairedProduct.cells ?? []).map((row) => ({
            ...row,
            renderDir: row.renderDir ? `${attemptName}/${row.renderDir}` : null,
          }));
        }
      } catch (error) {
        await atomicJson(join(repairDir, 'repair-result.json'), {
          accepted: false,
          error: String(error.message ?? error),
        });
        context.emit({
          stage: '80-reauthor',
          status: 'failed',
          artifacts: [`${attemptName}/repair-request.json`, `${attemptName}/repair-result.json`],
        });
      }
    }

    // The authoritative cross-attempt product decision. Stage artifacts stay
    // immutable, so this is the one file that says which cell won, where its
    // video actually lives, and every defect code the job recorded -- including
    // the ones that rejected a cell before it could ever be reviewed.
    const productSummary = judgeAcceptanceSummary({ contract: contractIdentity(), cells: productRows });
    const product = {
      schema: 'uniscenarios.showcase-product-decision.v1',
      status: 'complete',
      contract: contractIdentity(),
      collisionPolicy,
      retry: {
        kind: plan.retry,
        detail: plan.kind,
        reason: plan.reason,
        authorisedBy: plan.defectCodes,
        cellIds: plan.cellIds,
        recommendation: plan.recommendation,
      },
      acceptedAttempt,
      acceptedCells: productRows.filter((row) => row.presentationAccepted === true).length,
      semanticAcceptedCells: productSummary.semanticAcceptedCells,
      unsupportedCells: productSummary.unsupportedCells,
      reviewed: productSummary.reviewed,
      defectCodeCounts: productSummary.defectCodeCounts,
      defectCodes: mergeDefectCodes(
        eligibility.defectCodes,
        plan.defectCodes,
        ...productRows.map((row) => row.defectCodes),
      ),
      cells: productRows,
    };
    // A resumed job reads the decision it already recorded, so the gallery never describes a
    // different attempt than the artifact does.
    const decision = await stage(context, '75-product', [productPath], async () => {
      await atomicJson(productPath, product);
      return product;
    }) ?? product;

    await stage(context, '90-gallery', [galleryPath], async () => {
      const judgeRows = decision.cells ?? [];
      const summary = judgeAcceptanceSummary(decision);
      const acceptedRows = judgeRows.filter((row) => row.presentationAccepted === true);
      const accepted = new Set(acceptedRows.map((row) => row.cellId));
      const accepted2d = render2d.find((row) => row.status === 'complete' && accepted.has(row.cellId));
      const fallback2d = render2d.find((row) => row.status === 'complete' && eligible.has(row.cellId))
        ?? render2d.find((row) => row.status === 'complete');
      const average = (key) => acceptedRows.length
        ? Number((acceptedRows.reduce((sum, row) => sum + Number(row.acceptance?.axes?.[key] ?? row[key] ?? 0), 0) / acceptedRows.length).toFixed(2))
        : null;
      // An accepted cell names the directory its own render was written to, so a
      // promoted attempt is addressed where it lives instead of overwriting the
      // rejected attempt's artifacts.
      const headline = acceptedRows[0]?.renderDir
        ? `/artifacts/jobs/${job.jobId}/${acceptedRows[0].renderDir}/rollout.mp4`
        : accepted2d
          ? `/artifacts/jobs/${job.jobId}/60-render2d/${accepted2d.video}`
          : fallback2d
            ? `/artifacts/jobs/${job.jobId}/60-render2d/${fallback2d.video}`
            : null;
      const value = {
        id: job.jobId,
        jobId: job.jobId,
        brief: job.brief,
        engine: route.engine,
        methodology: job.methodology ?? 'custom',
        maps: [...new Set(cells.map((cell) => cell.mapId))],
        ambient: job.ambient,
        admitted: passing.size > 0,
        eligible: eligible.size,
        accepted: accepted.size > 0,
        semanticAccepted: judgeRows.some((row) => row.semanticAccepted === true),
        presentationAccepted: judgeRows.some((row) => row.presentationAccepted === true),
        defectCodes: decision.defectCodes,
        unsupportedReason: judgeRows.find((row) => row.unsupportedReason)?.unsupportedReason ?? null,
        retry: decision.retry,
        acceptedAttempt: decision.acceptedAttempt ?? null,
        gate: { passed: passing.size, cells: gate.cells?.length ?? 0 },
        quality: { accepted: accepted.size, reviewed: judgeRows.length },
        acceptance: {
          contract: contractIdentity(),
          semanticCells: summary.semanticAcceptedCells,
          presentationCells: summary.presentationAcceptedCells,
          unsupportedCells: summary.unsupportedCells,
          reviewed: summary.reviewed,
          defectCodes: summary.defectCodeCounts,
          retry: summary.retry,
        },
        scores: { realism: average('realism'), dynamism: average('dynamism') },
        headline,
        render3d: job.render3d,
        timings: context.timings,
        createdAt: job.createdAt,
      };
      await atomicJson(galleryPath, value);
      return value;
    });
  }

  /**
   * Render one cell in 3D with a bounded transient retry, classifying any
   * failure into the presentation namespace that owns it.
   */
  async render3dCell(context, cell, outDir) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.render3d.run(() => renderCell(context, cell, outDir, {
          tier: '3d', composition: context.renderComposition,
        }));
        return { cellId: cell.cellId, status: 'complete', attempts: attempt };
      } catch (error) {
        lastError = error;
        const message = String(error?.message ?? error);
        const transient = /Execution context was destroyed|navigation|Target closed|ECONNRESET|fetch failed|renderer captured an empty scene/i.test(message);
        if (!transient || attempt === 2) break;
      }
    }
    const message = String(lastError?.message ?? lastError);
    return {
      cellId: cell.cellId,
      status: 'error',
      error: message.slice(-1000),
      defectCodes: [classifyRenderFailure(message)],
    };
  }

  /** Brief-aware 3D product review of already rendered cells. */
  async review3dRenders(context, job, briefPath, renderDir, items) {
    return mapConcurrent(items, this.schedulerSettings.judgeConcurrency, async (item) => this.judge.run(async () => {
      const result = await command(this.python, [
        this.bridge, 'review3d', '--brief', briefPath,
        '--render', join(renderDir, item.cellId), '--cell-id', item.cellId,
        '--request-text', job.requestedBrief ?? job.brief,
        '--model', job.judgeModel ?? 'gpt-5.6-sol',
        '--effort', job.judgeEffort ?? 'medium',
      ], {
        cwd: this.root,
        timeout: 600_000,
        env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:4141/v1', OPENAI_API_KEY: 'x' },
        allowFailure: true,
      });
      return {
        cellId: item.cellId,
        review: lastJsonLine(result.stdout) ?? { tier: '3d', error: result.stderr.slice(-1000) },
      };
    }));
  }
}
