/**
 * Planned sites must run; re-matching in the worker must not refuse them.
 *
 * Defect (RETHINK-PLAN §3D item 2, ~30% of W7 engine time): `batch` plans its
 * cell matrix from `matchOnMaps(template, maps, { minScore, maxSites })`, but
 * `runCell` re-resolved the site with `findSite(template, map, siteId, {})` —
 * NO options. With a diversity policy, a different `maxSitesPerMap` changes
 * WHICH sites are selected, not merely how many, so the worker's re-match can
 * lack sites the plan named. Every such cell died `unknown_site` after paying
 * for a full anchor re-match: 50/180 cells (27.8%) on this very template
 * (`--all-maps --draws 10 --max-sites 5`, measured 2026-08-16).
 *
 * Contract: a cell carries the site the plan resolved; nothing between plan
 * and simulation re-derives it.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCell } from '../batch-cell.js';
import { DEV_ASSETS, REPO_ROOT } from '../maps.js';
import { matchOnMap } from '../sites.js';
import { readTemplate } from '../template-io.js';

const MAP = 'yale-street';
const haveArtifacts = existsSync(path.join(DEV_ASSETS, MAP, 'derived', 'topology-derived.json.gz'));
const TEMPLATE_FILE = path.join(
  REPO_ROOT,
  'research/edge-case-corpus/vista-corpus/templates/c3-allway-stop.template.json',
);

describe.skipIf(!haveArtifacts || !existsSync(TEMPLATE_FILE))('batch cells run the site the plan resolved', () => {
  it('every plan-matched site materializes and simulates; none refuses unknown_site', async () => {
    const template = await readTemplate(TEMPLATE_FILE);
    const match = await matchOnMap(template, MAP, { maxSites: 5 });
    expect(match.report.sites.length).toBeGreaterThan(0);

    let okCells = 0;
    for (const site of match.report.sites) {
      const result = await runCell(template, {
        mapId: MAP,
        siteId: site.siteId,
        drawIndex: 0,
        outDir: `/tmp/tgr-engine-test-planned-site/${site.siteId}`,
        writeTrace: false,
        filter: 'critical',
        site,
      });
      // The defect signature: status 'error' with error.code 'unknown_site'.
      // Other refusals (e.g. arrival_unconverged) are legitimate solver
      // verdicts about the site, not re-resolution failures.
      expect(
        result.error?.code,
        `plan-matched site ${site.siteId} must not refuse after spawn`,
      ).not.toBe('unknown_site');
      if (result.status === 'ok') okCells += 1;
    }
    expect(okCells, 'at least one planned site must simulate end-to-end').toBeGreaterThan(0);
  }, 180_000);
});
