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
      `${catalog.slots.length} deterministic authored designs: ${catalog.contract.slotsPerMap} × ${catalog.contract.supportedMaps.length} maps`,
      `progress: authored=${catalog.progress.authored}, generated=${catalog.progress.generated}, simulated=${catalog.progress.simulated}, rendered=${catalog.progress.rendered}, visually-accepted=${catalog.progress.visuallyAccepted}`,
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
      `incident breadth: ${Object.entries(report.incidentTypesByMap).map(([map, count]) => `${map}=${count}`).join(', ') || '—'}`,
      `domain breadth: ${Object.entries(report.domainsByMap).map(([map, count]) => `${map}=${count}`).join(', ') || '—'}`,
      `progress: authored=${report.progress.authored}, generated=${report.progress.generated}, simulated=${report.progress.simulated}, rendered=${report.progress.rendered}, visually-accepted=${report.progress.visuallyAccepted}`,
      `evidence checked: ${report.evidenceChecked ? 'yes' : 'no (authored designs have no claimed runtime evidence)'}`,
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
    taxonomy: {
      incidentTypes: catalog.taxonomy.length,
      domains: new Set(catalog.taxonomy.map((entry) => entry.domain)).size,
      incidentTypesByMap: Object.fromEntries(catalog.contract.supportedMaps.map((mapId) => [
        mapId,
        new Set(catalog.slots.filter((slot) => slot.mapId === mapId).map((slot) => slot.scenario.incidentId)).size,
      ])),
    },
    progress: catalog.progress,
    status: { authored: catalog.slots.length },
    manifest,
  };
}
