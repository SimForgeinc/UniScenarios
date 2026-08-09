import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { auditDivergence } from './divergence-audit-lib.mjs';

async function write(root, file, content) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test('classifies every shared, changed, and repository-only file', async () => {
  const uniscenariosRoot = await mkdtemp(path.join(tmpdir(), 'uniscenarios-audit-'));
  const simcloudRoot = await mkdtemp(path.join(tmpdir(), 'simcloud-audit-'));
  await write(uniscenariosRoot, 'config/simcloud-integration.json', JSON.stringify({
    schema: 'uniscenarios.simcloud-integration/v1',
    platformRepository: 'https://example.test/simcloud',
    ignoredNames: ['node_modules'],
    surfaces: [{
      id: 'engine', owner: 'uniscenarios', policy: 'must-converge',
      uniscenariosPath: 'engine', simcloudPath: 'engine-copy',
    }],
  }));
  await write(uniscenariosRoot, 'engine/shared.ts', 'same');
  await write(uniscenariosRoot, 'engine/changed.ts', 'upstream');
  await write(uniscenariosRoot, 'engine/upstream.ts', 'only here');
  await write(uniscenariosRoot, 'engine/node_modules/ignored.ts', 'ignored');
  await write(simcloudRoot, 'engine-copy/shared.ts', 'same');
  await write(simcloudRoot, 'engine-copy/changed.ts', 'product');
  await write(simcloudRoot, 'engine-copy/product.ts', 'only there');

  const report = await auditDivergence({ uniscenariosRoot, simcloudRoot, includeGitRevisions: false });
  assert.deepEqual(report.totals, {
    identical: 1,
    changed: 1,
    uniscenariosOnly: 1,
    simcloudOnly: 1,
  });
  assert.deepEqual(
    report.surfaces[0].files.map(({ path: file, status }) => [file, status]),
    [
      ['changed.ts', 'changed'],
      ['product.ts', 'simcloud-only'],
      ['shared.ts', 'identical'],
      ['upstream.ts', 'uniscenarios-only'],
    ],
  );
});
