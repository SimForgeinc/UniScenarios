import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { atomicJson, exists, MAPS, ShowcasePipeline } from './pipeline.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const MIME = {
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request, url, token) {
  const query = url.searchParams.get('token');
  const header = request.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return (query !== null && safeEqual(query, token)) || (bearer !== null && safeEqual(bearer, token));
}

async function requestJson(request, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('request body exceeds 1 MB'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('request body must be valid JSON'), { status: 400 });
  }
}

function optionalInteger(value, fallback, name, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw Object.assign(new Error(`${name} must be an integer from ${min} to ${max}`), { status: 400 });
  }
  return value;
}

function normalizeJob(input, jobId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('JSON body must be an object'), { status: 400 });
  }
  if (typeof input.brief !== 'string' || input.brief.trim().length < 3 || input.brief.length > 10_000) {
    throw Object.assign(new Error('brief must be a string from 3 to 10000 characters'), { status: 400 });
  }
  const engine = input.engine ?? 'auto';
  if (!['auto', 'compiler', 'vista2'].includes(engine)) {
    throw Object.assign(new Error('engine must be auto, compiler, or vista2'), { status: 400 });
  }
  const maps = input.maps === undefined ? [...MAPS] : input.maps;
  if (!Array.isArray(maps) || maps.length < 1 || maps.some((map) => !MAPS.includes(map)) || new Set(maps).size !== maps.length) {
    throw Object.assign(new Error(`maps must contain unique values from: ${MAPS.join(', ')}`), { status: 400 });
  }
  const ambient = input.ambient ?? 'off';
  if (!['off', 'light', 'moderate', 'city', 'heavy'].includes(ambient)) {
    throw Object.assign(new Error('ambient must be off, light, moderate, city, or heavy'), { status: 400 });
  }
  const nScenarios = optionalInteger(input.nScenarios, 1, 'nScenarios', 1, 10);
  const maxSitesPerMap = optionalInteger(input.maxSitesPerMap, 1, 'maxSitesPerMap', 1, 10);
  if (nScenarios * maxSitesPerMap * maps.length > 48) {
    throw Object.assign(new Error('job exceeds the 48-cell disk cap (nScenarios × maxSitesPerMap × maps)'), { status: 400 });
  }
  const topK = optionalInteger(input.topK, 3, 'topK', 1, 10);
  if (input.render3d !== undefined && typeof input.render3d !== 'boolean') {
    throw Object.assign(new Error('render3d must be boolean'), { status: 400 });
  }
  if (input.judge !== undefined && typeof input.judge !== 'boolean') {
    throw Object.assign(new Error('judge must be boolean'), { status: 400 });
  }
  if (input.seed !== undefined && !['string', 'number'].includes(typeof input.seed)) {
    throw Object.assign(new Error('seed must be a string or number'), { status: 400 });
  }
  return {
    jobId,
    briefId: `showcase-${jobId}`,
    category: 'showcase.custom',
    brief: input.brief.trim(),
    engine,
    nScenarios,
    maps,
    maxSitesPerMap,
    ambient,
    seed: input.seed ?? jobId,
    render3d: input.render3d ?? false,
    topK,
    judge: input.judge ?? true,
    createdAt: new Date().toISOString(),
  };
}

export class JobRunner {
  constructor({ dataDir, engine, concurrency = 2 }) {
    this.dataDir = dataDir;
    this.jobsDir = join(dataDir, 'jobs');
    this.engine = engine;
    this.concurrency = concurrency;
    this.queue = [];
    this.active = 0;
    this.states = new Map();
  }

  async initialize() {
    await mkdir(this.jobsDir, { recursive: true });
    for (const entry of await readdir(this.jobsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const jobDir = join(this.jobsDir, entry.name);
      const briefPath = join(jobDir, '00-brief.json');
      if (!(await exists(briefPath))) continue;
      const job = JSON.parse(await readFile(briefPath, 'utf8'));
      const state = this.ensureState(entry.name);
      if (await exists(join(jobDir, '90-gallery.json'))) {
        state.done = true;
      } else {
        this.queue.push({ job, jobDir });
      }
    }
    this.drain();
  }

  ensureState(jobId) {
    let state = this.states.get(jobId);
    if (!state) {
      state = { events: [], listeners: new Set(), done: false };
      this.states.set(jobId, state);
    }
    return state;
  }

  emit(jobId, event) {
    const value = { stage: String(event.stage), status: String(event.status), artifacts: Array.isArray(event.artifacts) ? event.artifacts : [] };
    const state = this.ensureState(jobId);
    state.events.push(value);
    for (const listener of state.listeners) listener(value);
    if (event.stage === '90-gallery' && event.status === 'complete') state.done = true;
  }

  async submit(input) {
    const jobId = randomUUID();
    const job = normalizeJob(input, jobId);
    const jobDir = join(this.jobsDir, jobId);
    await mkdir(jobDir, { recursive: false });
    await atomicJson(join(jobDir, '00-brief.json'), job);
    this.emit(jobId, { stage: '00-brief', status: 'complete', artifacts: ['00-brief.json'] });
    this.emit(jobId, { stage: 'job', status: 'queued', artifacts: [] });
    this.queue.push({ job, jobDir });
    this.drain();
    return jobId;
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      this.active += 1;
      void this.execute(item).finally(() => {
        this.active -= 1;
        this.drain();
      });
    }
  }

  async execute({ job, jobDir }) {
    this.emit(job.jobId, { stage: 'job', status: 'running', artifacts: [] });
    try {
      await this.engine.run(job, { jobDir, emit: (event) => this.emit(job.jobId, event) });
      this.ensureState(job.jobId).done = true;
    } catch (error) {
      this.emit(job.jobId, { stage: 'job', status: 'error', artifacts: [] });
      this.ensureState(job.jobId).done = true;
      await atomicJson(join(jobDir, 'job-error.json'), {
        error: String(error.message ?? error),
        stack: String(error.stack ?? '').split('\n').slice(0, 12),
        failedAt: new Date().toISOString(),
      });
    }
  }

  subscribe(jobId, listener) {
    const state = this.ensureState(jobId);
    for (const event of state.events) listener(event);
    if (!state.done) state.listeners.add(listener);
    return { done: state.done, unsubscribe: () => state.listeners.delete(listener) };
  }
}

async function directoryIndex(root, current = root) {
  const files = [];
  for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await directoryIndex(root, path));
    else if (entry.isFile()) {
      const info = await stat(path);
      const item = { path: relative(root, path).split(sep).join('/'), size: info.size };
      if (entry.name.endsWith('.json') && info.size <= 2_000_000) {
        try {
          item.json = JSON.parse(await readFile(path, 'utf8'));
        } catch {
          item.jsonError = true;
        }
      }
      files.push(item);
    }
  }
  return files;
}

async function gallery(jobsDir) {
  const cards = [];
  for (const entry of await readdir(jobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(jobsDir, entry.name, '90-gallery.json');
    if (!(await exists(path))) continue;
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      if (Array.isArray(value)) cards.push(...value);
      else cards.push(value);
    } catch {
      // An incomplete atomic temp file is hidden; a corrupt committed card is omitted.
    }
  }
  return cards.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
}

async function serveArtifact(request, response, dataDir, encodedPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(encodedPath);
  } catch {
    return sendJson(response, 400, { error: 'invalid artifact path encoding' });
  }
  const root = resolve(dataDir);
  const path = resolve(root, decoded);
  if (path !== root && !path.startsWith(`${root}${sep}`)) return sendJson(response, 403, { error: 'artifact path escapes data root' });
  let info;
  try {
    info = await stat(path);
  } catch {
    return sendJson(response, 404, { error: 'artifact not found' });
  }
  if (!info.isFile()) return sendJson(response, 404, { error: 'artifact not found' });
  const headers = { 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream', 'accept-ranges': 'bytes' };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= info.size) {
      response.writeHead(416, { 'content-range': `bytes */${info.size}` });
      return response.end();
    }
    response.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${info.size}` });
    return createReadStream(path, { start, end }).pipe(response);
  }
  response.writeHead(200, { ...headers, 'content-length': info.size });
  createReadStream(path).pipe(response);
}

export async function createShowcaseServer({
  token,
  dataDir = join(REPO_ROOT, 'showcase-data'),
  engine = new ShowcasePipeline({ root: REPO_ROOT }),
  concurrency = 2,
} = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('SHOWCASE_TOKEN is required');
  const runner = new JobRunner({ dataDir: resolve(dataDir), engine, concurrency });
  await runner.initialize();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://showcase.local');
    if (!authorized(request, url, token)) return sendJson(response, 401, { error: 'unauthorized' });
    try {
      if (request.method === 'POST' && url.pathname === '/api/jobs') {
        const jobId = await runner.submit(await requestJson(request));
        return sendJson(response, 202, { jobId });
      }
      if (request.method === 'GET' && url.pathname === '/api/gallery') {
        return sendJson(response, 200, await gallery(runner.jobsDir));
      }
      const full = /^\/api\/jobs\/([0-9a-f-]+)\/full$/.exec(url.pathname);
      if (request.method === 'GET' && full) {
        const jobDir = join(runner.jobsDir, full[1]);
        if (!(await exists(join(jobDir, '00-brief.json')))) return sendJson(response, 404, { error: 'job not found' });
        return sendJson(response, 200, { jobId: full[1], files: await directoryIndex(jobDir) });
      }
      const events = /^\/api\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
      if (request.method === 'GET' && events) {
        const jobDir = join(runner.jobsDir, events[1]);
        if (!(await exists(join(jobDir, '00-brief.json')))) return sendJson(response, 404, { error: 'job not found' });
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.flushHeaders?.();
        const subscription = runner.subscribe(events[1], (event) => {
          response.write(`data: ${JSON.stringify(event)}\n\n`);
          if ((event.stage === '90-gallery' && event.status === 'complete') || (event.stage === 'job' && event.status === 'error')) {
            queueMicrotask(() => response.end());
          }
        });
        if (subscription.done) return response.end();
        const keepalive = setInterval(() => response.write(': keepalive\n\n'), 15_000);
        request.once('close', () => {
          clearInterval(keepalive);
          subscription.unsubscribe();
        });
        return;
      }
      if (request.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
        return serveArtifact(request, response, runner.dataDir, url.pathname.slice('/artifacts/'.length));
      }
      return sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      return sendJson(response, error.status ?? 500, { error: String(error.message ?? error) });
    }
  });
  return { server, runner };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const host = process.env.SHOWCASE_HOST ?? '0.0.0.0';
  const port = Number(process.env.SHOWCASE_PORT ?? 4174);
  const { server } = await createShowcaseServer({
    token: process.env.SHOWCASE_TOKEN,
    dataDir: process.env.SHOWCASE_DATA_DIR ?? join(REPO_ROOT, 'showcase-data'),
  });
  server.listen(port, host, () => process.stdout.write(`showcase server listening on http://${host}:${port}\n`));
}
