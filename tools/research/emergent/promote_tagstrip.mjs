#!/usr/bin/env node
/**
 * Arm (ii) tag-strip promotion (supersedes prior worldgen M4 recast-as-primary).
 *
 * For each selected ego-involved mined event: take the cell's instance input,
 * remove 'ambient' from the counterpart actor's tags (nothing else changes),
 * re-simulate, evaluate, and write a promoted artifact set the frozen gate can
 * read. The counterpart's emerged trajectory was produced by the ambient engine,
 * not authored; promotion merely makes it metric-visible. The promoted run is a
 * NEW deterministic world: the pair becomes mutually visible to conflict logic
 * (engine.ts crossing-priority skips authored->ambient), so the conflict may
 * dissolve — that dissolution is measured, not hidden, and yield is counted on
 * the promoted cell's own gate verdict.
 *
 *   node promote_tagstrip.mjs --out <harvest-dir> [--max 60] [--tier T1|any]
 *
 * Reads <out>/mining/events.jsonl; writes <out>/cells/<cellId>/promoted-<actor>/
 *   {instance.json, trace.json.gz, result.json}
 * plus <out>/mining/promotions.jsonl.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const CLI = await import(path.join(ROOT, 'packages/cli/dist/index.js'));
const SE = await import(path.join(ROOT, 'packages/sim-engine/dist/index.js'));

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const out = arg('out');
const maxN = Number(arg('max', 60));
const tierWant = arg('tier', 'any');

const events = readFileSync(path.join(out, 'mining/events.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Selection: ego-involved, non-collision, tier filter; most severe first
// (T1 first, then lowest TTC, then lowest clearance); one promotion per cell.
const candidates = events
  .filter((e) => e.egoInvolved && !e.collision)
  .filter((e) => tierWant === 'any' || e.tier === tierWant)
  .sort((a, b) =>
    (a.tier === 'T1' ? 0 : 1) - (b.tier === 'T1' ? 0 : 1)
    || (a.ttcRrS ?? 99) - (b.ttcRrS ?? 99)
    || a.minClearanceM - b.minClearanceM);
const perCell = new Map();
for (const e of candidates) {
  const key = e.cell.out;
  if (!perCell.has(key)) perCell.set(key, e);
}
const selected = [...perCell.values()].slice(0, maxN);
console.log(JSON.stringify({ events: events.length, egoInvolved: candidates.length, selected: selected.length }));

const promoLog = path.join(out, 'mining/promotions.jsonl');
writeFileSync(promoLog, '');
const bundles = new Map();

for (const e of selected) {
  const cellDir = e.cell.out;
  const counterpart = e.pair.find((id) => id !== 'ego');
  const pdir = path.join(cellDir, `promoted-${counterpart.replace(/[^a-zA-Z0-9_.-]/g, '_')}`);
  const rec = {
    cellId: path.basename(cellDir), counterpart, tier: e.tier,
    ttcRrS: e.ttcRrS, minClearanceM: e.minClearanceM, category: e.category,
    signature: e.signature, window: e.window,
  };
  try {
    const inst = JSON.parse(readFileSync(path.join(cellDir, 'instance.json'), 'utf8'));
    const actor = inst.input.actors.find((a) => a.id === counterpart);
    if (!actor) throw new Error(`counterpart ${counterpart} not in instance`);
    actor.tags = (actor.tags ?? []).filter((t) => t !== 'ambient');
    const mapId = inst.manifest.replayKey?.mapId ?? inst.input.mapId;
    if (!bundles.has(mapId)) bundles.set(mapId, await CLI.loadMap(mapId));
    const bundle = bundles.get(mapId);
    const t0 = Date.now();
    const run = SE.runSimulation(inst.input, { graph: bundle.graph, guards: 'collect' });
    const wallMs = Date.now() - t0;
    const evaluation = SE.evaluateTrace(run.trace, CLI.filtersFor('critical', {}));
    const verdict = evaluation.verdict;
    const band = CLI.criticalityBand(verdict, evaluation.findings);
    const evidenceOk = SE.contentHash(SE.normalizeSimScenarioInput(inst.input))
      === run.trace.header.inputHash;
    mkdirSync(pdir, { recursive: true });
    const promotedManifest = {
      ...inst.manifest,
      inputHash: run.trace.header.inputHash,
      promotion: {
        kind: 'tag-strip', counterpart, sourceEvent: rec,
        note: 'ambient tag removed from counterpart; all other input bytes unchanged',
      },
    };
    writeFileSync(path.join(pdir, 'instance.json'),
      JSON.stringify({ kind: 'scenario-instance', version: 1, manifest: promotedManifest, input: inst.input }));
    await CLI.writeTraceFile(path.join(pdir, 'trace.json.gz'), run.trace);
    const result = {
      status: 'ok', promoted: true, counterpart,
      verdict, band, evidenceOk,
      findings: evaluation.findings.map((f) => ({ code: f.code, reason: f.reason })),
      metrics: CLI.metricsSummary ? CLI.metricsSummary(run.trace) : null,
      traceDigest: SE.traceDigest(run.trace), wallMs,
      ambientActorIds: run.trace.header.ambientActorIds?.length ?? 0,
    };
    writeFileSync(path.join(pdir, 'result.json'), JSON.stringify(result, null, 1));
    Object.assign(rec, {
      status: 'ok', verdict, band, evidenceOk, wallMs, dir: pdir,
      counterpartStillPresent: Boolean(run.trace.ticks.actors[counterpart]),
    });
  } catch (err) {
    Object.assign(rec, { status: 'error', error: String(err?.message ?? err) });
  }
  appendFileSync(promoLog, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ cellId: rec.cellId, counterpart, status: rec.status, verdict: rec.verdict ?? null, band: rec.band ?? null }));
}
console.log(JSON.stringify({ promoted: selected.length, log: promoLog }));
