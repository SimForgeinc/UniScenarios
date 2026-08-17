import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createShowcaseServer } from './index.mjs';
import { atomicJson, rankCandidates, retryKind } from './pipeline.mjs';

const TOKEN = 'test-showcase-token';

class StubEngine {
  constructor() {
    this.jobs = [];
  }

  async run(job, context) {
    this.jobs.push(job);
    const write = async (stage, path, value) => {
      await atomicJson(join(context.jobDir, path), value);
      context.emit({ stage, status: 'complete', artifacts: [path] });
      await new Promise((resolve) => setTimeout(resolve, 4));
    };
    await write('10-route', '10-route.json', { requested: job.engine, engine: 'compiler', why: 'stub' });
    await write('15-precheck', '15-precheck.json', { feasible: true, requires: ['plain_corridor'] });
    await mkdir(join(context.jobDir, '20-author'), { recursive: true });
    await atomicJson(join(context.jobDir, '20-author', 'template.json'), { stub: true });
    await atomicJson(join(context.jobDir, '20-author', 'transcript.json'), { stub: true });
    context.emit({ stage: '20-author', status: 'complete', artifacts: ['20-author/template.json', '20-author/transcript.json'] });
    await write('30-sites', '30-sites.json', { totalSites: 1, maps: [] });
    await mkdir(join(context.jobDir, '40-cells', 'stub-cell'), { recursive: true });
    await writeFile(join(context.jobDir, '40-cells', 'stub-cell', 'trace.json.gz'), 'stub');
    await write('40-cells', '40-cells/index.json', { cells: [{ cellId: 'stub-cell' }] });
    await write('50-gate', '50-gate.json', { cells: [{ cellId: 'stub-cell', pass: true }] });
    await mkdir(join(context.jobDir, '60-render2d', 'stub-cell'), { recursive: true });
    await writeFile(join(context.jobDir, '60-render2d', 'stub-cell', 'rollout.mp4'), 'fake mp4');
    await write('60-render2d', '60-render2d/index.json', { cells: [{ cellId: 'stub-cell', status: 'complete' }] });
    await write('65-render3d', '65-render3d/index.json', { status: 'skipped', cells: [] });
    await write('70-judge', '70-judge.json', { status: 'skipped', cells: [] });
    await write('90-gallery', '90-gallery.json', {
      id: job.jobId,
      jobId: job.jobId,
      brief: job.brief,
      engine: 'compiler',
      headline: `/artifacts/jobs/${job.jobId}/60-render2d/stub-cell/rollout.mp4`,
      createdAt: job.createdAt,
    });
  }
}

test('candidate ranking prefers judged quality while preserving site diversity', () => {
  const cells = [
    { cellId: 'a-0', mapId: 'map-a', siteId: 'site-a' },
    { cellId: 'a-1', mapId: 'map-a', siteId: 'site-a' },
    { cellId: 'b-0', mapId: 'map-b', siteId: 'site-b' },
  ];
  const quality = [
    { cellId: 'a-0', plausible: true, realism: 8, dynamism: 7, defects: [] },
    { cellId: 'a-1', plausible: true, realism: 7, dynamism: 7, defects: [] },
    { cellId: 'b-0', plausible: true, realism: 6, dynamism: 5, defects: [] },
  ];
  assert.deepEqual(rankCandidates(cells, quality).map((cell) => cell.cellId), ['a-0', 'b-0', 'a-1']);
});


test('production retry policy escalates compiler failures to the visual author', () => {
  const production = { render3d: true, judge: true, fallbackToVisual: true };
  assert.equal(retryKind({ engine: 'compiler' }, production, { acceptedCells: 0 }), 'visual-fallback');
  assert.equal(retryKind({ engine: 'vista2' }, production, { acceptedCells: 0 }), 'visual-repair');
  assert.equal(retryKind({ engine: 'compiler' }, { ...production, _fallbackDepth: 1 }, { acceptedCells: 0 }), null);
  assert.equal(retryKind({ engine: 'compiler' }, production, { acceptedCells: 1 }), null);
});
async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'showcase-server-test-'));
  const webDir = join(dataDir, 'web');
  await mkdir(webDir, { recursive: true });
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>showcase test</title>');
  const engine = new StubEngine();
  const app = await createShowcaseServer({ token: TOKEN, dataDir, webDir, engine });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { ...app, base };
}

async function collectEvents(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const frame = pending.slice(0, boundary);
      pending = pending.slice(boundary + 2);
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
    if (done) break;
  }
  return events;
}

test('frozen REST + SSE contract exposes each stage and gallery artifacts', async (t) => {
  const { base } = await fixture(t);
  const submitted = await fetch(`${base}/api/jobs?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      methodology: 'custom',
      brief: 'A lead vehicle brakes hard in front of the ego.',
      engine: 'compiler',
      nScenarios: 1,
      maps: ['yale-street'],
      maxSitesPerMap: 1,
      ambient: 'light',
      seed: 7,
      render3d: false,
      topK: 1,
      judge: false,
    }),
  });
  assert.equal(submitted.status, 202);
  const payload = await submitted.json();
  assert.deepEqual(Object.keys(payload), ['jobId']);
  assert.match(payload.jobId, /^[0-9a-f-]{36}$/);

  const events = await collectEvents(await fetch(`${base}/api/jobs/${payload.jobId}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }));
  const completed = new Set(events.filter((event) => event.status === 'complete').map((event) => event.stage));
  for (const stage of ['00-brief', '10-route', '15-precheck', '20-author', '30-sites', '40-cells', '50-gate', '60-render2d', '65-render3d', '70-judge', '90-gallery']) {
    assert.ok(completed.has(stage), `${stage} appeared in SSE`);
  }
  for (const event of events) assert.deepEqual(Object.keys(event), ['stage', 'status', 'artifacts']);

  const full = await fetch(`${base}/api/jobs/${payload.jobId}/full?token=${TOKEN}`).then((response) => response.json());
  assert.equal(full.jobId, payload.jobId);
  assert.ok(full.files.some((file) => file.path === '00-brief.json' && file.json.brief.includes('lead vehicle')));
  assert.ok(full.files.some((file) => file.path === '90-gallery.json'));

  const cards = await fetch(`${base}/api/gallery?token=${TOKEN}`).then((response) => response.json());
  assert.equal(cards.length, 1);
  assert.equal(cards[0].jobId, payload.jobId);
  const artifact = await fetch(`${base}${cards[0].headline}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(artifact.status, 200);
  assert.equal(await artifact.text(), 'fake mp4');
});

test('production methodology freezes the research-proven recipe', async (t) => {
  const { base, runner } = await fixture(t);
  const response = await fetch(`${base}/api/jobs?token=${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      methodology: 'production',
      brief: 'A cyclist emerges late from behind a stopped bus.',
      engine: 'compiler',
      nScenarios: 1,
      maps: ['yale-street'],
      maxSitesPerMap: 1,
      ambient: 'off',
      render3d: false,
      judge: false,
    }),
  });
  assert.equal(response.status, 202);
  const { jobId } = await response.json();
  await collectEvents(await fetch(`${base}/api/jobs/${jobId}?token=${TOKEN}`));
  const job = runner.engine.jobs.find((candidate) => candidate.jobId === jobId);
  assert.deepEqual({
    methodology: job.methodology,
    engine: job.engine,
    maps: job.maps,
    nScenarios: job.nScenarios,
    maxSitesPerMap: job.maxSitesPerMap,
    ambient: job.ambient,
    render3d: job.render3d,
    topK: job.topK,
    judge: job.judge,
    author: `${job.authorModel}/${job.authorEffort}`,
    judgeConfig: `${job.judgeModel}/${job.judgeEffort}/${job.judgeStrategy}`,
    fallbackToVisual: job.fallbackToVisual,
  }, {
    methodology: 'production',
    engine: 'auto',
    maps: [
      'yale-street',
      'belmont-research-center',
      'el-camino-road',
      'easterbrook-discovery-school',
      'richmond-field-station',
    ],
    nScenarios: 3,
    maxSitesPerMap: 3,
    ambient: 'light',
    render3d: true,
    topK: 3,
    judge: true,
    author: 'gpt-5.6-sol/low',
    judgeConfig: 'gpt-5.6-sol/medium/spread8',
    fallbackToVisual: true,
  });
});

test('all endpoints reject missing/wrong auth and accept query or bearer auth', async (t) => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/api/gallery`)).status, 401);
  assert.equal((await fetch(`${base}/api/gallery?token=wrong`)).status, 401);
  assert.equal((await fetch(`${base}/api/gallery?token=${TOKEN}`)).status, 200);
  assert.equal((await fetch(`${base}/api/gallery`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
  const page = await fetch(`${base}/?token=${TOKEN}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /showcase test/);
  assert.match(page.headers.get('set-cookie'), /^showcase_token=/);
  assert.equal((await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brief: 'A valid but unauthorized brief.' }),
  })).status, 401);
});

test('gallery discovers committed per-card gallery seeds on first load', async (t) => {
  const { base, runner } = await fixture(t);
  const seed = join(runner.dataDir, 'gallery-seed', '001');
  await mkdir(join(seed, '60-render2d', 'cell-1'), { recursive: true });
  await writeFile(join(seed, '60-render2d', 'cell-1', 'rollout.mp4'), 'seed mp4');
  await atomicJson(join(seed, '90-gallery.json'), {
    id: 'seed-001',
    brief: 'A seeded scenario.',
    media: '/artifacts/gallery-seed/001/60-render2d/cell-1/rollout.mp4',
  });

  const cards = await fetch(`${base}/api/gallery?token=${TOKEN}`).then((response) => response.json());
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'seed-001');
  const artifact = await fetch(`${base}${cards[0].media}?token=${TOKEN}`);
  assert.equal(artifact.status, 200);
  assert.equal(await artifact.text(), 'seed mp4');
});
