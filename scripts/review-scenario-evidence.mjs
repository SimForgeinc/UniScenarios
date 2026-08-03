#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import {
  SCENARIO_REVIEW_PROVENANCE_FILES,
  createScenarioReviewTemplate,
  upsertScenarioReview,
} from './scenario-review-ledger-lib.mjs';

function argsOf(argv) {
  const out = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith('--') || !value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    out.set(key.slice(2), value);
    index += 1;
  }
  return out;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJsonAtomic(file, value) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, absolute);
}

async function verifyArtifact(root, artifact, label) {
  if (typeof artifact?.file !== 'string' || typeof artifact?.sha256 !== 'string') {
    throw new Error(`${label} is missing file or sha256`);
  }
  const file = path.resolve(root, artifact.file);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the evidence directory`);
  }
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  if (digest !== artifact.sha256) throw new Error(`${label} digest mismatch`);
}

async function verifyManifestArtifacts(manifestFile, manifest) {
  const root = path.dirname(path.resolve(manifestFile));
  await Promise.all([
    ...(manifest.frames ?? []).map((frame) => verifyArtifact(root, frame.artifact, `frame ${frame.phase}`)),
    verifyArtifact(root, manifest.video, 'video'),
    ...Object.entries(manifest.artifacts ?? {}).map(([name, artifact]) => verifyArtifact(root, artifact, `source ${name}`)),
  ]);
}

function parseMaybeGzipJson(bytes, label) {
  const plain = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  try {
    return JSON.parse(plain.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function buildReviewContext(repositoryRoot, manifestFile, manifest) {
  const renderRoot = path.dirname(path.resolve(manifestFile));
  const instanceFile = path.resolve(renderRoot, manifest?.artifacts?.instance?.file ?? '');
  const traceFile = path.resolve(renderRoot, manifest?.artifacts?.traceFile?.file ?? '');
  const resultFile = manifest?.artifacts?.result?.file
    ? path.resolve(renderRoot, manifest.artifacts.result.file)
    : null;
  const [instanceBytes, traceBytes, resultBytes, rendererSources] = await Promise.all([
    readFile(instanceFile),
    readFile(traceFile),
    resultFile ? readFile(resultFile) : Promise.resolve(null),
    Promise.all(SCENARIO_REVIEW_PROVENANCE_FILES.map(async (file) => ({
      file,
      sha256: createHash('sha256').update(await readFile(path.resolve(repositoryRoot, file))).digest('hex'),
    }))),
  ]);
  return {
    instanceDoc: parseMaybeGzipJson(instanceBytes, 'instance artifact'),
    trace: parseMaybeGzipJson(traceBytes, 'trace artifact'),
    instanceSha256: createHash('sha256').update(instanceBytes).digest('hex'),
    traceFileSha256: createHash('sha256').update(traceBytes).digest('hex'),
    resultSha256: resultBytes ? createHash('sha256').update(resultBytes).digest('hex') : null,
    rendererSources,
  };
}

const args = argsOf(process.argv);
const manifestFile = args.get('manifest');
if (!manifestFile) throw new Error('--manifest is required');
const manifest = await readJson(manifestFile);
await verifyManifestArtifacts(manifestFile, manifest);
const repositoryRoot = path.resolve(args.get('root') ?? '.');
const reviewContext = await buildReviewContext(repositoryRoot, manifestFile, manifest);

if (args.has('template')) {
  const output = args.get('template');
  const review = createScenarioReviewTemplate(
    manifest,
    path.relative(path.dirname(path.resolve(output)), path.resolve(manifestFile)),
    reviewContext,
  );
  await writeJsonAtomic(output, review);
  console.log(JSON.stringify({ template: output, classification: review.classification }, null, 2));
} else {
  const reviewFile = args.get('review');
  const ledgerFile = args.get('ledger');
  if (!reviewFile || !ledgerFile) throw new Error('use --template <file> or --review <file> --ledger <file>');
  const review = await readJson(reviewFile);
  let ledger = null;
  try {
    ledger = await readJson(ledgerFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const updated = upsertScenarioReview(ledger, manifest, review, reviewContext);
  await writeJsonAtomic(ledgerFile, updated);
  console.log(JSON.stringify({ ledger: ledgerFile, summary: updated.summary }, null, 2));
}
