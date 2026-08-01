/**
 * Site matching: `template × map → ranked MatchedSite[]`.
 *
 * Thin on purpose — the matcher is a pure function and the only thing the CLI
 * adds is the vocabulary translation in `adapt.ts` and a memo, because
 * `scen batch` matches the same template against the same map once per run and
 * would otherwise redo a few thousand frame evaluations per cell.
 */

import { matchAnchorReport, type MatchReport, type MatchedSite } from '@uniscenarios/anchor-matcher';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';

import { adaptTemplate, type AdaptNote } from './adapt.js';
import { CliError } from './errors.js';
import { loadMap, type MapBundle } from './maps.js';

export interface SiteMatch {
  readonly mapId: string;
  readonly bundle: MapBundle;
  readonly report: MatchReport;
  readonly notes: AdaptNote[];
}

const cache = new Map<string, SiteMatch>();

function cacheKey(template: ScenarioTemplateV2, mapId: string): string {
  const anchor = template.anchor.id ?? template.meta.name;
  return `${anchor}|${mapId}|${JSON.stringify(template.anchor)}|${JSON.stringify(template.roles)}`;
}

/** Match one template against one map. */
export async function matchOnMap(
  template: ScenarioTemplateV2,
  mapId: string,
  options: { minScore?: number | undefined; maxSites?: number | undefined } = {},
): Promise<SiteMatch> {
  const key = `${cacheKey(template, mapId)}|${options.minScore ?? ''}|${options.maxSites ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const bundle = await loadMap(mapId);
  const { anchor, roles, notes } = adaptTemplate(template);
  const policy = { ...(anchor.policy ?? {}) };
  if (options.minScore !== undefined) policy.minScore = options.minScore;
  if (options.maxSites !== undefined) policy.maxSitesPerMap = options.maxSites;

  const report = matchAnchorReport({ ...anchor, policy }, bundle.index, { roles });
  const result: SiteMatch = { mapId, bundle, report, notes };
  cache.set(key, result);
  return result;
}

/** Match across several maps, in the given order. */
export async function matchOnMaps(
  template: ScenarioTemplateV2,
  mapIds: readonly string[],
  options: { minScore?: number | undefined; maxSites?: number | undefined } = {},
): Promise<SiteMatch[]> {
  const out: SiteMatch[] = [];
  for (const mapId of mapIds) out.push(await matchOnMap(template, mapId, options));
  return out;
}

/** Find one site by id across a set of maps. */
export async function findSite(
  template: ScenarioTemplateV2,
  mapId: string,
  siteId: string,
): Promise<{ bundle: MapBundle; site: MatchedSite }> {
  const match = await matchOnMap(template, mapId);
  const site =
    match.report.sites.find((s) => s.siteId === siteId) ??
    match.report.rejected.find((s) => s.siteId === siteId);
  if (!site) {
    throw new CliError('unknown_site', `site "${siteId}" was not produced on ${mapId}`, {
      path: '--site',
      detail: {
        available: match.report.sites.slice(0, 10).map((s) => s.siteId),
        failureSummary: match.report.failureSummary,
      },
    });
  }
  return { bundle: match.bundle, site };
}

/** The compact site view the CLI prints. */
export function siteSummary(site: MatchedSite): Record<string, unknown> {
  return {
    siteId: site.siteId,
    mapId: site.mapId,
    score: round3(site.score),
    verdict: site.degradation.verdict,
    intentPreserved: site.degradation.intentPreserved,
    origin: site.frame.origin.mapFeatureId,
    entryLaneRsl: site.frame.entryLaneRsl,
    egoTurn: site.frame.egoTurn ?? null,
    runwayUpstreamM: round3(site.frame.runwayUpstreamM),
    runwayDownstreamM: round3(site.frame.runwayDownstreamM),
    mirrored: site.frame.mirrored,
    alternateFrames: site.alternateFrames,
    degradation: {
      summary: site.degradation.summary,
      repairs: site.degradation.repairs.map((r) => ({
        kind: r.kind,
        touchesRequired: r.touchesRequired,
        note: r.note,
      })),
      failedRequiredClauses: site.degradation.failedRequiredClauses,
    },
    bindings: site.bindings.map((b) => ({
      role: b.role,
      kind: b.kind,
      status: b.status,
      laneRsl: b.laneRsl ?? null,
      routeLanes: b.routeLaneChain?.length ?? 0,
      conflict: b.conflict
        ? {
            gateId: b.conflict.gateId,
            crossingAngleDeg: round3(b.conflict.crossingAngleDeg),
            relation: b.conflict.relation,
            sOnEgo: round3(b.conflict.sOnEgo),
            sOnActor: round3(b.conflict.sOnActor),
          }
        : null,
      notes: b.notes,
    })),
    clauses: site.clauses.map((c) => ({
      path: c.path,
      essentiality: c.essentiality,
      score: round3(c.score),
      slack: round3(c.slack),
      supported: c.supported,
      required: c.required,
      actual: c.actual,
      reason: c.reason,
    })),
    matchedReasons: site.matchedReasons,
  };
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
