#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_NAME = 'uniscenarios';
const PACKAGE_SCOPE = '@uniscenarios/';
const HISTORICAL_DOCUMENTS = new Set([
  'docs/repository-transition.md',
  'docs/uniscenarios-repository-extraction.md',
]);
const LEGACY_PUBLIC_NAME = /@scenario-studio(?:\/|\b)|\bscenario-studio\b|\bScenario Studio\b|\bSCENARIO_STUDIO\b/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function workspaceManifestPaths(root) {
  const paths = [];
  for (const parent of ['apps', 'packages']) {
    const directory = join(root, parent);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(directory, entry.name, 'package.json');
      if (existsSync(manifest)) paths.push(manifest);
    }
  }
  return paths.sort();
}

function markdownPathsBelow(root, relativeDirectory) {
  const paths = [];
  const directory = join(root, relativeDirectory);
  if (!existsSync(directory)) return paths;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...markdownPathsBelow(root, path));
    else if (entry.isFile() && entry.name.endsWith('.md')) paths.push(path);
  }
  return paths;
}

function publicDocumentationPaths(root) {
  const paths = [];
  for (const path of ['README.md']) {
    if (existsSync(join(root, path))) paths.push(path);
  }
  for (const parent of ['apps', 'catalog', 'docs', 'examples', 'packages']) {
    paths.push(...markdownPathsBelow(root, parent));
  }
  return paths.filter((path) => !HISTORICAL_DOCUMENTS.has(path)).sort();
}

export function verifyRepositoryNaming(root) {
  const errors = [];
  const rootManifest = readJson(join(root, 'package.json'));
  if (rootManifest.name !== ROOT_NAME) {
    errors.push(`package.json name must be ${ROOT_NAME}, found ${JSON.stringify(rootManifest.name)}`);
  }
  if (rootManifest.private !== true) errors.push('package.json must keep the workspace root private');

  const seenNames = new Set();
  for (const path of workspaceManifestPaths(root)) {
    const manifest = readJson(path);
    const displayPath = relative(root, path);
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith(PACKAGE_SCOPE)) {
      errors.push(`${displayPath} name must use the ${PACKAGE_SCOPE} scope`);
      continue;
    }
    if (seenNames.has(manifest.name)) errors.push(`duplicate workspace package name: ${manifest.name}`);
    seenNames.add(manifest.name);
  }

  const cliPath = join(root, 'packages/cli/package.json');
  if (existsSync(cliPath)) {
    const cli = readJson(cliPath);
    if (cli.bin?.uniscenarios !== './bin/uniscenarios.js') {
      errors.push('CLI primary executable must be uniscenarios -> ./bin/uniscenarios.js');
    }
    if (cli.bin?.scen !== './bin/scen.js') {
      errors.push('CLI compatibility executable must remain scen -> ./bin/scen.js');
    }
    const unexpectedBins = Object.keys(cli.bin ?? {}).filter((name) => name !== 'uniscenarios' && name !== 'scen');
    if (unexpectedBins.length) errors.push(`CLI exposes unexpected executable names: ${unexpectedBins.join(', ')}`);
  }

  for (const path of publicDocumentationPaths(root)) {
    const lines = readFileSync(join(root, path), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (LEGACY_PUBLIC_NAME.test(line)) {
        errors.push(`${path}:${index + 1} contains a legacy public product name`);
      }
    }
  }

  if (errors.length) throw new Error(`repository naming verification failed:\n- ${errors.join('\n- ')}`);
  return {
    rootName: ROOT_NAME,
    packageScope: PACKAGE_SCOPE.slice(0, -1),
    workspacePackageCount: seenNames.size,
    documentationFileCount: publicDocumentationPaths(root).length,
  };
}

function main() {
  try {
    const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
    const result = verifyRepositoryNaming(root);
    process.stdout.write(
      `Verified UniScenarios naming: ${result.workspacePackageCount} workspace packages and ${result.documentationFileCount} public documents\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
