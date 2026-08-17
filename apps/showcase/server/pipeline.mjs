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
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

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

async function stage(context, name, artifacts, action) {
  const present = await Promise.all(artifacts.map((path) => exists(path)));
  if (present.every(Boolean)) {
    context.emit({ stage: name, status: 'complete', artifacts: artifacts.map((p) => artifactPath(context.jobDir, p)) });
    return artifacts.length === 1 && artifacts[0].endsWith('.json') ? readJson(artifacts[0]) : undefined;
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

async function renderCell(context, cell, outDir, { redact = false, tier = '2d' } = {}) {
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

export class ShowcasePipeline {
  constructor({ root, python, cli } = {}) {
    this.root = root ?? resolve(import.meta.dirname, '../../..');
    this.python = python ?? join(this.root, '.venv', 'bin', 'python');
    this.cli = cli ?? join(this.root, 'packages', 'cli', 'bin', 'uniscenarios.js');
    this.bridge = join(this.root, 'tools', 'research', 'showcase', 'stages.py');
  }

  async run(job, externalContext) {
    const context = { ...externalContext, root: this.root, python: this.python, cli: this.cli, timings: {} };
    const briefPath = join(context.jobDir, '00-brief.json');
    const routePath = join(context.jobDir, '10-route.json');
    const precheckPath = join(context.jobDir, '15-precheck.json');
    const authorDir = join(context.jobDir, '20-author');
    const templatePath = join(authorDir, 'template.json');
    const transcriptPath = join(authorDir, 'transcript.json');
    const sitesPath = join(context.jobDir, '30-sites.json');
    const cellsDir = join(context.jobDir, '40-cells');
    const cellsIndex = join(cellsDir, 'index.json');
    const gatePath = join(context.jobDir, '50-gate.json');
    const render2dDir = join(context.jobDir, '60-render2d');
    const render2dIndex = join(render2dDir, 'index.json');
    const render3dDir = join(context.jobDir, '65-render3d');
    const render3dIndex = join(render3dDir, 'index.json');
    const judgePath = join(context.jobDir, '70-judge.json');
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
      };
      await atomicJson(routePath, value);
      return value;
    });
    await stage(context, '15-precheck', [precheckPath], async () => {
      await atomicJson(precheckPath, precheckResult);
      return precheckResult;
    });

    await stage(context, '20-author', [templatePath, transcriptPath], async () => {
      await mkdir(authorDir, { recursive: true });
      const subcommand = route.engine === 'vista2' ? 'vista-author' : 'author';
      const args = [this.bridge, subcommand, '--brief', briefPath, '--out', authorDir, '--model', 'gpt-5.6-sol', '--effort', 'medium'];
      if (subcommand === 'author') {
        args.push('--draws', '1', '--probe-draws', '1', '--max-sites', String(Math.min(job.maxSitesPerMap, 3)), '--concurrency', '2');
      }
      await command(this.python, args, {
        cwd: this.root,
        timeout: route.engine === 'vista2' ? 2_700_000 : 900_000,
        env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:4141/v1', OPENAI_API_KEY: 'x' },
      });
      // `batch` intentionally derives each draw seed from the template identity,
      // site and draw index. Give its existing seeding path a stable identity
      // derived from the user knob instead of the per-request UUID emitted by
      // the author adapter.
      const template = await readJson(templatePath);
      const seedIdentity = createHash('sha256').update(`${job.brief}\0${String(job.seed)}`).digest('hex').slice(0, 16);
      template.anchor.id = `showcase-${seedIdentity}`;
      await atomicJson(templatePath, template);
    });

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
      const args = [this.cli, 'batch', templatePath, '--out', batchDir, '--draws', String(job.nScenarios), '--max-sites', String(job.maxSitesPerMap), '--concurrency', '2'];
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
        brief: job.brief,
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

    let render2d = await stage(context, '60-render2d', [render2dIndex], async () => {
      await mkdir(render2dDir, { recursive: true });
      const rendered = [];
      for (const cell of cells.filter((candidate) => candidate.traceFile && candidate.instanceFile)) {
        const out = join(render2dDir, cell.cellId);
        try {
          await renderCell(context, cell, out, { tier: '2d' });
          let redacted = null;
          if (job.judge) {
            redacted = join(out, 'redacted');
            await renderCell(context, cell, redacted, { tier: '2d', redact: true });
          }
          rendered.push({ cellId: cell.cellId, status: 'complete', video: `${cell.cellId}/rollout.mp4`, redacted: redacted ? `${cell.cellId}/redacted` : null });
        } catch (error) {
          rendered.push({ cellId: cell.cellId, status: 'error', error: String(error.message ?? error).slice(-1000) });
        }
      }
      await atomicJson(render2dIndex, { cells: rendered });
      return { value: rendered, status: rendered.some((row) => row.status === 'complete') ? 'complete' : 'error' };
    });
    if (!Array.isArray(render2d)) render2d = render2d.cells ?? [];

    const passing = new Set((gate.cells ?? []).filter((cell) => cell.pass).map((cell) => cell.cellId));
    await stage(context, '65-render3d', [render3dIndex], async () => {
      await mkdir(render3dDir, { recursive: true });
      if (!job.render3d) {
        const value = { status: 'skipped', reason: 'render3d disabled', cells: [] };
        await atomicJson(render3dIndex, value);
        return { value, status: 'skipped' };
      }
      const rows = [];
      for (const cell of cells.filter((candidate) => passing.has(candidate.cellId)).slice(0, job.topK)) {
        try {
          await renderCell(context, cell, join(render3dDir, cell.cellId), { tier: '3d' });
          rows.push({ cellId: cell.cellId, status: 'complete' });
        } catch (error) {
          rows.push({ cellId: cell.cellId, status: 'error', error: String(error.message ?? error).slice(-1000) });
        }
      }
      const value = { status: rows.some((row) => row.status === 'complete') ? 'complete' : 'unavailable', cells: rows };
      await atomicJson(render3dIndex, value);
      return { value, status: value.status === 'complete' ? 'complete' : 'skipped' };
    });

    const judge = await stage(context, '70-judge', [judgePath], async () => {
      if (!job.judge) {
        const value = { status: 'skipped', reason: 'judge disabled', cells: [] };
        await atomicJson(judgePath, value);
        return { value, status: 'skipped' };
      }
      if (!(await gatewayAvailable())) {
        const value = { status: 'skipped', reason: 'OpenAI gateway unavailable at 127.0.0.1:4141', cells: [] };
        await atomicJson(judgePath, value);
        return { value, status: 'skipped' };
      }
      const rows = [];
      for (const item of render2d.filter((row) => row.status === 'complete' && row.redacted)) {
        const cell = cells.find((candidate) => candidate.cellId === item.cellId);
        const result = await command(this.python, [this.bridge, 'judge', '--cell', cell.cellDir, '--render', join(render2dDir, item.redacted), '--model', 'gpt-5.6-sol', '--effort', 'medium', '--strategy', 'spread8'], {
          cwd: this.root,
          timeout: 600_000,
          env: { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:4141/v1', OPENAI_API_KEY: 'x' },
          allowFailure: true,
        });
        const verdict = lastJsonLine(result.stdout);
        rows.push(verdict ? { status: 'complete', ...verdict } : { cellId: item.cellId, status: 'error', error: result.stderr.slice(-1000) });
      }
      const value = { status: 'complete', model: 'gpt-5.6-sol', effort: 'medium', strategy: 'spread8', cells: rows };
      await atomicJson(judgePath, value);
      return value;
    });

    await stage(context, '90-gallery', [galleryPath], async () => {
      const headline = render2d.find((row) => row.status === 'complete' && passing.has(row.cellId))
        ?? render2d.find((row) => row.status === 'complete');
      const judgeRows = judge.cells?.filter((row) => row.status === 'complete') ?? [];
      const average = (key) => judgeRows.length
        ? Number((judgeRows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / judgeRows.length).toFixed(2))
        : null;
      const value = {
        id: job.jobId,
        jobId: job.jobId,
        brief: job.brief,
        engine: route.engine,
        maps: [...new Set(cells.map((cell) => cell.mapId))],
        ambient: job.ambient,
        admitted: passing.size > 0,
        gate: { passed: passing.size, cells: gate.cells?.length ?? 0 },
        scores: { realism: average('realism'), dynamism: average('dynamism') },
        headline: headline ? `/artifacts/jobs/${job.jobId}/60-render2d/${headline.video}` : null,
        render3d: job.render3d,
        timings: context.timings,
        createdAt: job.createdAt,
      };
      await atomicJson(galleryPath, value);
      return value;
    });
  }
}
