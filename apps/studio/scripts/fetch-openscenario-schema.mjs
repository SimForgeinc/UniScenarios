#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const destination = join(root, '.tools', 'openscenario', '1.3.1');
const xsd = join(destination, 'OpenSCENARIO.xsd');
const expectedArchive = '25044a2ffdab426c894ea441aee4dfc5eff45ab86cbb64835e6861d6f65f7cb6';
const expectedXsd = '1c86539c61264c691c1031ec78e3a93dcde63876f7f769428c330d4fd86c26a4';
const source = 'https://publications.pages.asam.net/standards/ASAM_OpenSCENARIO/ASAM_OpenSCENARIO_XML/v1.3.1/_attachments/generated/ASAM_OpenSCENARIO_v1.3.1_Schema.zip';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  await access(xsd, constants.R_OK);
  if (digest(await readFile(xsd)) === expectedXsd) process.exit(0);
} catch { /* install below */ }

await mkdir(destination, { recursive: true });
const response = await fetch(source, { redirect: 'follow' });
if (!response.ok) throw new Error(`OpenSCENARIO schema download failed: HTTP ${response.status}`);
const bytes = new Uint8Array(await response.arrayBuffer());
if (digest(bytes) !== expectedArchive) throw new Error('OpenSCENARIO schema archive digest mismatch');
const archive = join(destination, 'schema.zip.partial');
const extracted = join(destination, 'OpenSCENARIO.xsd.partial');
await writeFile(archive, bytes, { mode: 0o600 });
const unzip = spawnSync('unzip', ['-p', archive, 'OpenSCENARIO.xsd'], { encoding: null, maxBuffer: 2_000_000 });
if (unzip.status !== 0 || !unzip.stdout) throw new Error('Could not extract OpenSCENARIO.xsd from pinned archive');
await writeFile(extracted, unzip.stdout, { mode: 0o600 });
if (digest(await readFile(extracted)) !== expectedXsd) throw new Error('OpenSCENARIO.xsd digest mismatch');
await rename(extracted, xsd);
await rm(archive, { force: true });
console.log(`Verified ASAM OpenSCENARIO 1.3.1 schema at ${xsd}`);
