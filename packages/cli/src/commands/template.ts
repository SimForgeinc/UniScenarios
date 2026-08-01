/**
 * `scen template validate <file>` — schema + tier-1.
 *
 * With `--map` the map-dependent half of tier 1 runs too, against a **real**
 * `MapContext` built from the best matched site (or `--site`). Without a site
 * there is no anchor frame, and therefore no honest way to answer "is there a
 * lane at (k, s)" — so those checks are skipped and `mapChecked` says so rather
 * than reporting a pass nobody earned.
 */

import {
  ScenarioTemplateV2Schema,
  parseAndValidateTemplate,
  toScenarioIssues,
  type ClauseResult,
} from '@scenario-studio/scenario-model';

import { adaptTemplate } from '../adapt.js';
import { EXIT } from '../errors.js';
import { createMapContext } from '../map-context.js';
import { emit, emitLines, pad } from '../output.js';
import { matchOnMap } from '../sites.js';
import { readFile } from 'node:fs/promises';

export interface TemplateValidateOptions {
  readonly file: string;
  readonly mapId?: string | undefined;
  readonly siteId?: string | undefined;
  readonly pretty: boolean;
}

export async function templateValidate(options: TemplateValidateOptions): Promise<number> {
  const json = JSON.parse(await readFile(options.file, 'utf8')) as unknown;

  // Parse once here so map binding can use the parsed document, and reuse
  // `parseAndValidateTemplate`'s uniform issue shape when parsing fails.
  const parsed = ScenarioTemplateV2Schema.safeParse(json);
  if (!parsed.success) {
    const issues = toScenarioIssues(parsed.error.issues).map((i) => ({
      path: i.path,
      severity: 'error' as const,
      code: 'schema_invalid',
      message: i.message,
    }));
    emit(
      { file: options.file, ok: false, mapChecked: false, counts: { error: issues.length, warning: 0, info: 0 }, issues },
      options,
    );
    return EXIT.validationFindings;
  }
  const template = parsed.data;

  let mapChecked = false;
  let siteId: string | null = null;
  let context: ReturnType<typeof createMapContext> | undefined;
  // Not an `issue`: the validator's codes are a closed vocabulary shared with
  // the matcher, and "I could not run the map checks" is a property of *this
  // invocation*, not a defect in the document.
  let mapCheckSkipped: string | null = null;

  if (options.mapId) {
    const match = await matchOnMap(template, options.mapId);
    const site = options.siteId
      ? match.report.sites.find((s) => s.siteId === options.siteId)
      : match.report.sites[0];
    if (site) {
      context = createMapContext(match.bundle.index, site);
      siteId = site.siteId;
      mapChecked = true;
    } else {
      mapCheckSkipped = `the anchor matched no site on ${options.mapId}: ${match.report.failureSummary}`;
    }
  }

  const { report } = parseAndValidateTemplate(json, context);
  const adapted = adaptTemplate(template);
  const issues: ClauseResult[] = [...report.issues];
  const counts = {
    error: issues.filter((i) => i.severity === 'error').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  const payload = {
    file: options.file,
    ok: counts.error === 0,
    mapChecked,
    mapCheckSkipped,
    mapId: options.mapId ?? null,
    siteId,
    counts,
    issues,
    adapterNotes: adapted.notes,
  };

  if (!options.pretty) {
    emit(payload, options);
  } else {
    const lines = [
      `${options.file}: ${counts.error} error(s), ${counts.warning} warning(s)${
        mapChecked ? ` — map checks against ${options.mapId} site ${siteId}` : ' — document-only checks'
      }`,
      '',
    ];
    if (mapCheckSkipped) lines.push(`map checks skipped: ${mapCheckSkipped}`, '');
    for (const i of issues) {
      lines.push(`${pad(i.severity, 9)}${pad(i.code, 26)}${pad(i.path, 44)}${i.message}`);
    }
    for (const n of adapted.notes) lines.push(`${pad('adapter', 9)}${pad('note', 26)}${pad(n.path, 44)}${n.reason}`);
    emitLines(lines);
  }
  return counts.error > 0 ? EXIT.validationFindings : EXIT.ok;
}
