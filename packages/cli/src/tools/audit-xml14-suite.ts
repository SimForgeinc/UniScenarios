import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildLaneGraph, parseSimScenarioInput, type TopologyIndex } from '@uniscenarios/sim-engine';
import {
  AsamExportError,
  exportOpenScenarioXml14,
  validateOpenScenarioXml14,
} from '../asam/index.js';

interface InstanceFile {
  readonly input: unknown;
  readonly manifest?: { readonly instanceId?: string };
}

const xsdPath = process.argv[2] ?? process.env['ASAM_OPENSCENARIO_14_XSD'];
if (!xsdPath) throw new Error('Usage: tsx audit-xml14-suite.ts /path/to/official/OpenSCENARIO.xsd');

const suiteRoot = path.resolve('examples/edge-cases');
const entries = (await readdir(suiteRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{2}-/u.test(entry.name))
  .map((entry) => path.join(suiteRoot, entry.name, 'scenario.instance.json'))
  .sort();
if (entries.length === 0) throw new Error(`No curated edge-case instances found in ${suiteRoot}`);

const graph = buildLaneGraph({
  schemaVersion: 1,
  mapName: 'suite-export-audit',
  source: { xodrSha256: 'suite-export-audit' },
  lanes: {}, gates: [], junctions: {},
} satisfies TopologyIndex);

const results: Array<Record<string, unknown>> = [];
for (const file of entries) {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as InstanceFile;
  const id = parsed.manifest?.instanceId ?? path.basename(path.dirname(file));
  try {
    const input = parseSimScenarioInput(parsed.input);
    const exported = exportOpenScenarioXml14(input, {
      graph,
      executionMode: 'trajectory-replay',
      roadFile: `${input.mapId}.xodr`,
      headerDate: '1970-01-01T00:00:00.000Z',
    });
    const validation = await validateOpenScenarioXml14(exported.content, xsdPath);
    results.push(validation.valid
      ? { id, verdict: 'xsd-validated', warnings: exported.warnings.length }
      : { id, verdict: 'unexpected-failure', stage: 'official-xsd', diagnostics: validation.diagnostics });
  } catch (error) {
    if (error instanceof AsamExportError && error.issues.length > 0) {
      results.push({
        id,
        verdict: 'unsupported-fail-closed',
        issueCodes: [...new Set(error.issues.map((issue) => issue.code))].sort(),
        issueReasons: [...new Set(error.issues.map((issue) => issue.reason))].sort(),
        issueCount: error.issues.length,
      });
    } else {
      results.push({ id, verdict: 'unexpected-failure', stage: 'export', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

const counts = {
  total: results.length,
  xsdValidated: results.filter((item) => item['verdict'] === 'xsd-validated').length,
  unsupportedFailClosed: results.filter((item) => item['verdict'] === 'unsupported-fail-closed').length,
  unexpectedFailures: results.filter((item) => item['verdict'] === 'unexpected-failure').length,
};
const report = {
  schema: 'uniscenarios.openscenario-1.4-suite-audit/v1',
  suite: 'examples/edge-cases/*/scenario.instance.json',
  officialXsd: path.resolve(xsdPath),
  counts,
  gatePassed: counts.total > 0 && counts.xsdValidated > 0 && counts.unexpectedFailures === 0,
  results,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.gatePassed) process.exitCode = 1;
