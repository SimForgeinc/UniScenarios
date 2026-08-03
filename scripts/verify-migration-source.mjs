#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const EXPECTED_SCHEMA = 'uniscenarios.repository-extraction.v2';
const EXPECTED_CLASSIFICATION = 'verification-only-non-reconstructible';
const EXPECTED_CHECKS = [
  'gitHead',
  'gitBranch',
  'gitStatusPorcelainV1',
  'materialPathSet',
  'fileKind',
  'posixMode',
  'sha256',
];

function runGit(sourceRoot, args) {
  const result = spawnSync('git', args, {
    cwd: sourceRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`could not run git: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function parseArgs(argv) {
  let source;
  let manifest = resolve(fileURLToPath(new URL('../MIGRATION-SOURCE.json', import.meta.url)));

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--source' || argument === '--manifest') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === '--source') source = value;
      else manifest = value;
      index += 1;
    } else if (argument === '--help') {
      return { help: true };
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  if (!source) throw new Error('--source is required; no source location is inferred');
  return { source, manifest };
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validateManifest(manifest) {
  assertObject(manifest, 'manifest');
  if (manifest.schema !== EXPECTED_SCHEMA) {
    throw new Error(`manifest.schema must be ${EXPECTED_SCHEMA}`);
  }
  if (typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    throw new Error('manifest.capturedAt must be an ISO-compatible timestamp');
  }

  assertObject(manifest.source, 'manifest.source');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(manifest.source.head ?? '')) {
    throw new Error('manifest.source.head must be a lowercase Git object ID');
  }
  if (typeof manifest.source.branch !== 'string' || manifest.source.branch.length === 0) {
    throw new Error('manifest.source.branch must be a non-empty string');
  }
  if (typeof manifest.source.dirty !== 'boolean') {
    throw new Error('manifest.source.dirty must be a boolean');
  }
  if (!Array.isArray(manifest.source.status) || !manifest.source.status.every((line) =>
    typeof line === 'string' && line.length >= 3)) {
    throw new Error('manifest.source.status must be an array of porcelain status lines');
  }
  if (new Set(manifest.source.status).size !== manifest.source.status.length) {
    throw new Error('manifest.source.status must not contain duplicate lines');
  }
  if (manifest.source.dirty !== (manifest.source.status.length > 0)) {
    throw new Error('manifest.source.dirty contradicts manifest.source.status');
  }
  if (typeof manifest.source.repositoryName !== 'string' || manifest.source.repositoryName.length === 0) {
    throw new Error('manifest.source.repositoryName must identify the historical source repository');
  }

  if (manifest.packageScope !== '@uniscenarios') {
    throw new Error('manifest.packageScope must be @uniscenarios');
  }
  assertObject(manifest.cli, 'manifest.cli');
  if (manifest.cli.primary !== 'uniscenarios' || manifest.cli.compatibilityAlias !== 'scen') {
    throw new Error('manifest.cli must record uniscenarios as primary and scen as compatibility alias');
  }

  assertObject(manifest.provenance, 'manifest.provenance');
  assertObject(manifest.provenance.reproducibility, 'manifest.provenance.reproducibility');
  if (manifest.provenance.reproducibility.classification !== EXPECTED_CLASSIFICATION ||
      manifest.provenance.reproducibility.exactDirtySnapshotReconstructibleFromManifest !== false) {
    throw new Error('manifest must classify the dirty snapshot as verification-only and non-reconstructible');
  }
  assertObject(manifest.provenance.sourceLocator, 'manifest.provenance.sourceLocator');
  if (manifest.provenance.sourceLocator.kind !== 'not-recorded' ||
      manifest.provenance.sourceLocator.value !== null) {
    throw new Error('manifest source locator must be explicitly not recorded');
  }
  if (typeof manifest.provenance.sourceLocator.policy !== 'string' ||
      manifest.provenance.sourceLocator.policy.length === 0) {
    throw new Error('manifest source locator policy must be explicit');
  }
  assertObject(manifest.provenance.verification, 'manifest.provenance.verification');
  if (!Array.isArray(manifest.provenance.verification.checks) ||
      manifest.provenance.verification.checks.length !== EXPECTED_CHECKS.length ||
      EXPECTED_CHECKS.some((check, index) => manifest.provenance.verification.checks[index] !== check)) {
    throw new Error('manifest provenance must list exactly the supported verifier checks in canonical order');
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('manifest.files must be a non-empty array');
  }
  const paths = new Set();
  for (const [index, file] of manifest.files.entries()) {
    const label = `manifest.files[${index}]`;
    assertObject(file, label);
    if (typeof file.path !== 'string' || file.path.length === 0 || isAbsolute(file.path) ||
        file.path.includes('\0') || posix.normalize(file.path) !== file.path ||
        file.path === '..' || file.path.startsWith('../')) {
      throw new Error(`${label}.path must be a normalized relative path within the source checkout`);
    }
    if (paths.has(file.path)) throw new Error(`duplicate manifest file path: ${file.path}`);
    paths.add(file.path);
    if (file.kind !== 'file' && file.kind !== 'symlink') {
      throw new Error(`${label}.kind must be file or symlink`);
    }
    if (!/^0[0-7]{3}$/.test(file.mode ?? '')) {
      throw new Error(`${label}.mode must be a four-digit POSIX mode`);
    }
    if (!/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) {
      throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
    }
  }
  return manifest;
}

function digestMaterialPath(absolutePath, kind) {
  const input = kind === 'symlink' ? readlinkSync(absolutePath) : readFileSync(absolutePath);
  return createHash('sha256').update(input).digest('hex');
}

function listDifference(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((entry) => !actualSet.has(entry));
}

function summarize(entries) {
  const visible = entries.slice(0, 10).map((entry) => JSON.stringify(entry)).join(', ');
  return entries.length > 10 ? `${visible}, … (${entries.length - 10} more)` : visible;
}

export function verifyMigrationSource({ source, manifestPath }) {
  const sourceRoot = realpathSync(source);
  const gitRoot = realpathSync(runGit(sourceRoot, ['rev-parse', '--show-toplevel']).trim());
  if (gitRoot !== sourceRoot) {
    throw new Error(`--source must name the checkout root (Git root is ${gitRoot})`);
  }

  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const errors = [];
  const actualHead = runGit(sourceRoot, ['rev-parse', 'HEAD']).trim();
  if (actualHead !== manifest.source.head) {
    errors.push(`Git HEAD differs (expected ${manifest.source.head}, found ${actualHead})`);
  }

  const actualBranch = runGit(sourceRoot, ['branch', '--show-current']).trim();
  if (actualBranch !== manifest.source.branch) {
    errors.push(`Git branch differs (expected ${JSON.stringify(manifest.source.branch)}, found ${JSON.stringify(actualBranch)})`);
  }

  const actualStatus = runGit(sourceRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]).split('\n').filter(Boolean);
  const missingStatus = listDifference(manifest.source.status, actualStatus);
  const unexpectedStatus = listDifference(actualStatus, manifest.source.status);
  if (missingStatus.length || unexpectedStatus.length) {
    errors.push(`Git status differs (missing: [${summarize(missingStatus)}]; unexpected: [${summarize(unexpectedStatus)}])`);
  }

  const actualPaths = runGit(sourceRoot, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
  ]).split('\0').filter(Boolean).sort();
  const expectedPaths = manifest.files.map((file) => file.path).sort();
  const missingPaths = listDifference(expectedPaths, actualPaths);
  const unexpectedPaths = listDifference(actualPaths, expectedPaths);
  if (missingPaths.length || unexpectedPaths.length) {
    errors.push(`material path set differs (missing: [${summarize(missingPaths)}]; unexpected: [${summarize(unexpectedPaths)}])`);
  }

  const actualPathSet = new Set(actualPaths);
  for (const expected of manifest.files) {
    if (!actualPathSet.has(expected.path)) continue;
    const absolutePath = resolve(sourceRoot, expected.path);
    if (absolutePath !== sourceRoot && !absolutePath.startsWith(`${sourceRoot}${sep}`)) {
      errors.push(`${expected.path}: resolved outside source checkout`);
      continue;
    }
    let stat;
    try {
      stat = lstatSync(absolutePath);
    } catch (error) {
      errors.push(`${expected.path}: cannot inspect path (${error.message})`);
      continue;
    }
    const actualKind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'unsupported';
    if (actualKind !== expected.kind) {
      errors.push(`${expected.path}: kind differs (expected ${expected.kind}, found ${actualKind})`);
      continue;
    }
    const actualMode = `0${(stat.mode & 0o777).toString(8).padStart(3, '0')}`;
    if (actualMode !== expected.mode) {
      errors.push(`${expected.path}: mode differs (expected ${expected.mode}, found ${actualMode})`);
    }
    try {
      const actualDigest = digestMaterialPath(absolutePath, actualKind);
      if (actualDigest !== expected.sha256) {
        errors.push(`${expected.path}: SHA-256 differs (expected ${expected.sha256}, found ${actualDigest})`);
      }
    } catch (error) {
      errors.push(`${expected.path}: cannot hash material (${error.message})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`candidate checkout does not match the migration source:\n- ${errors.join('\n- ')}`);
  }
  return {
    head: actualHead,
    branch: actualBranch,
    dirty: actualStatus.length > 0,
    fileCount: manifest.files.length,
  };
}

function printHelp() {
  process.stdout.write([
    'Usage: node scripts/verify-migration-source.mjs --source PATH [options]',
    '',
    '  --source PATH    Candidate source checkout root (required)',
    '  --manifest PATH  Manifest to verify (default: MIGRATION-SOURCE.json)',
    '  --help           Show this help',
    '',
    'The verifier never locates or downloads a source checkout.',
    '',
  ].join('\n'));
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    const result = verifyMigrationSource({
      source: options.source,
      manifestPath: resolve(options.manifest),
    });
    process.stdout.write(
      `Verified migration source: ${result.fileCount} files at ${result.head} (${result.branch}, ${result.dirty ? 'dirty' : 'clean'})\n`,
    );
  } catch (error) {
    process.stderr.write(`Migration source verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
