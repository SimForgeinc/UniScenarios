import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function revision(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function collectFiles(root, ignoredNames, relative = '', result = new Map()) {
  const directory = path.join(root, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return result;
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (ignoredNames.has(entry.name)) continue;
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await collectFiles(root, ignoredNames, child, result);
    } else if (entry.isFile()) {
      const bytes = await readFile(path.join(root, child));
      result.set(child, digest(bytes));
    }
  }
  return result;
}

function compareFiles(uniscenarios, simcloud) {
  const paths = [...new Set([...uniscenarios.keys(), ...simcloud.keys()])].sort();
  return paths.map((file) => {
    const uniscenariosSha256 = uniscenarios.get(file);
    const simcloudSha256 = simcloud.get(file);
    if (!uniscenariosSha256) return { path: file, status: 'simcloud-only', simcloudSha256 };
    if (!simcloudSha256) return { path: file, status: 'uniscenarios-only', uniscenariosSha256 };
    if (uniscenariosSha256 === simcloudSha256) {
      return { path: file, status: 'identical', uniscenariosSha256, simcloudSha256 };
    }
    return { path: file, status: 'changed', uniscenariosSha256, simcloudSha256 };
  });
}

function counts(files) {
  const result = { identical: 0, changed: 0, uniscenariosOnly: 0, simcloudOnly: 0 };
  for (const file of files) {
    if (file.status === 'identical') result.identical += 1;
    if (file.status === 'changed') result.changed += 1;
    if (file.status === 'uniscenarios-only') result.uniscenariosOnly += 1;
    if (file.status === 'simcloud-only') result.simcloudOnly += 1;
  }
  return result;
}

export async function auditDivergence({ uniscenariosRoot, simcloudRoot, includeGitRevisions = true }) {
  const config = await readJson(path.join(uniscenariosRoot, 'config/simcloud-integration.json'));
  if (config.schema !== 'uniscenarios.simcloud-integration/v1') {
    throw new Error(`Unsupported integration config schema: ${String(config.schema)}`);
  }
  if (!(await stat(simcloudRoot)).isDirectory()) throw new Error('simcloudRoot must be a directory');

  const ignoredNames = new Set(config.ignoredNames);
  const surfaces = [];
  for (const surface of config.surfaces) {
    const uniscenarios = await collectFiles(path.join(uniscenariosRoot, surface.uniscenariosPath), ignoredNames);
    const simcloud = await collectFiles(path.join(simcloudRoot, surface.simcloudPath), ignoredNames);
    const files = compareFiles(uniscenarios, simcloud);
    surfaces.push({
      id: surface.id,
      owner: surface.owner,
      policy: surface.policy,
      paths: {
        uniscenarios: surface.uniscenariosPath,
        simcloud: surface.simcloudPath,
      },
      counts: counts(files),
      files,
    });
  }

  return {
    schema: 'uniscenarios.simcloud-divergence/v1',
    repositories: {
      uniscenarios: {
        repository: 'https://github.com/SimForgeinc/UniScenarios',
        ...(includeGitRevisions ? { revision: revision(uniscenariosRoot) } : {}),
      },
      simcloud: {
        repository: config.platformRepository,
        ...(includeGitRevisions ? { revision: revision(simcloudRoot) } : {}),
      },
    },
    surfaces,
    totals: counts(surfaces.flatMap((surface) => surface.files)),
  };
}
