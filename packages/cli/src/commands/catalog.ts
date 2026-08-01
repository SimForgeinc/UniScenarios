import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createScenarioCatalog,
  validateScenarioCatalog,
  type ScenarioCatalogManifest,
} from '../catalog.js';
import { CliError, EXIT } from '../errors.js';
import { emit, emitLines } from '../output.js';
import { writeJsonFile } from '../template-io.js';

export interface CatalogCreateOptions {
  readonly out: string;
  readonly namespace?: string | undefined;
  readonly evidenceRoot?: string | undefined;
  readonly pretty: boolean;
}

export async function catalogCreate(options: CatalogCreateOptions): Promise<number> {
  const catalog = await createScenarioCatalog({
    namespace: options.namespace,
    evidenceRoot: options.evidenceRoot,
  });
  await writeJsonFile(options.out, catalog);
  const payload = catalogSummary(catalog, path.resolve(options.out));
  if (options.pretty) {
    emitLines([
      `UniScenarios catalog ${catalog.catalogDigest}`,
      `${catalog.slots.length} deterministic slots: ${catalog.contract.slotsPerMap} × ${catalog.contract.supportedMaps.length} maps`,
      `statuses: reserved=${catalog.slots.length}`,
      `manifest: ${path.resolve(options.out)}`,
    ]);
  } else {
    emit(payload, options);
  }
  return EXIT.ok;
}

export interface CatalogVerifyOptions {
  readonly file: string;
  readonly evidenceRoot?: string | undefined;
  readonly requireEvidence: boolean;
  readonly pretty: boolean;
}

export async function catalogVerify(options: CatalogVerifyOptions): Promise<number> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(options.file, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError('file_not_found', `cannot read ${options.file}`, { path: options.file });
    }
    throw new CliError('invalid_json', error instanceof Error ? error.message : String(error), {
      path: options.file,
    });
  }
  const report = validateScenarioCatalog(value, {
    manifestFile: options.file,
    evidenceRootOverride: options.evidenceRoot,
    requireEvidence: options.requireEvidence,
  });
  const payload = { manifest: path.resolve(options.file), ...report };
  if (options.pretty) {
    const lines = [
      `${report.ok ? 'OK' : 'INVALID'} — ${report.slots} catalog slots`,
      `digest: ${report.catalogDigest ?? '—'}`,
      `maps: ${Object.entries(report.maps).map(([map, count]) => `${map}=${count}`).join(', ') || '—'}`,
      `statuses: ${Object.entries(report.statuses).map(([status, count]) => `${status}=${count}`).join(', ') || '—'}`,
      `evidence checked: ${report.evidenceChecked ? 'yes' : 'no (reserved slots only)'}`,
    ];
    if (report.issues.length > 0) {
      lines.push('', ...report.issues.map((entry) => `${entry.code} at ${entry.path}: ${entry.reason}`));
    }
    emitLines(lines);
  } else {
    emit(payload, options);
  }
  return report.ok ? EXIT.ok : EXIT.validationFindings;
}

function catalogSummary(catalog: ScenarioCatalogManifest, manifest: string): Record<string, unknown> {
  const perMap = Object.fromEntries(catalog.contract.supportedMaps.map((mapId) => [
    mapId,
    catalog.slots.filter((slot) => slot.mapId === mapId).length,
  ]));
  return {
    kind: catalog.kind,
    version: catalog.version,
    catalogDigest: catalog.catalogDigest,
    namespace: catalog.provenance.namespace,
    slotsPerMap: catalog.contract.slotsPerMap,
    totalSlots: catalog.contract.totalSlots,
    maps: perMap,
    templates: catalog.templates,
    status: { reserved: catalog.slots.length },
    manifest,
  };
}
