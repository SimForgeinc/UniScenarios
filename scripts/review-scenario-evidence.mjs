#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
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

const args = argsOf(process.argv);
const manifestFile = args.get('manifest');
if (!manifestFile) throw new Error('--manifest is required');
const manifest = await readJson(manifestFile);

if (args.has('template')) {
  const output = args.get('template');
  const review = createScenarioReviewTemplate(manifest, path.relative(path.dirname(output), manifestFile));
  await writeFile(output, `${JSON.stringify(review, null, 2)}\n`);
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
  const updated = upsertScenarioReview(ledger, manifest, review);
  await writeFile(ledgerFile, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(JSON.stringify({ ledger: ledgerFile, summary: updated.summary }, null, 2));
}
