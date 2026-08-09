import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildStackManifest, serializeStackManifest } from './stack-manifest-lib.mjs';

const SHA = 'a'.repeat(40);

async function fixture(overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'uniscenarios-stack-'));
  const config = {
    schema: 'uniscenarios.stack-config/v1',
    stackVersion: '1.2.3',
    repository: 'https://example.test/uniscenarios',
    contracts: { scenarioTemplate: '2', simulationStepSeconds: 0.02 },
    packages: [
      { path: 'packages/model', role: 'scenario-contract' },
      { path: 'packages/engine', role: 'simulation-kernel' },
    ],
  };
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'packages/model'), { recursive: true });
  await mkdir(path.join(root, 'packages/engine'), { recursive: true });
  await writeFile(path.join(root, 'config/uniscenarios-stack.json'), JSON.stringify(config));
  await writeFile(path.join(root, 'packages/model/package.json'), JSON.stringify({
    name: '@uniscenarios/model', version: '1.2.3', license: 'Apache-2.0',
    publishConfig: { access: 'public', provenance: true },
    repository: { directory: 'packages/model' }, ...overrides.model,
  }));
  await writeFile(path.join(root, 'packages/engine/package.json'), JSON.stringify({
    name: '@uniscenarios/engine', version: '1.2.3', license: 'Apache-2.0',
    publishConfig: { access: 'public', provenance: true },
    repository: { directory: 'packages/engine' },
    dependencies: { '@uniscenarios/model': 'workspace:*' }, ...overrides.engine,
  }));
  return root;
}

test('builds a deterministic exact stack manifest', async () => {
  const repoRoot = await fixture();
  const manifest = await buildStackManifest({ repoRoot, sourceRevision: SHA });
  assert.equal(manifest.source.revision, SHA);
  assert.deepEqual(manifest.packages, [
    { name: '@uniscenarios/model', version: '1.2.3', role: 'scenario-contract' },
    { name: '@uniscenarios/engine', version: '1.2.3', role: 'simulation-kernel' },
  ]);
  assert.equal(serializeStackManifest(manifest), `${JSON.stringify(manifest, null, 2)}\n`);
});

test('rejects private packages and version-skewed internal dependencies', async () => {
  const privateRoot = await fixture({ model: { private: true } });
  await assert.rejects(
    buildStackManifest({ repoRoot: privateRoot, sourceRevision: SHA }),
    /private and cannot be part of the public stack/u,
  );

  const skewedRoot = await fixture({ engine: { dependencies: { '@uniscenarios/model': '^1.2.3' } } });
  await assert.rejects(
    buildStackManifest({ repoRoot: skewedRoot, sourceRevision: SHA }),
    /must pin @uniscenarios\/model to the stack version 1.2.3/u,
  );
});

test('requires a full immutable source revision', async () => {
  const repoRoot = await fixture();
  await assert.rejects(
    buildStackManifest({ repoRoot, sourceRevision: 'main' }),
    /full lowercase git SHA/u,
  );
});
