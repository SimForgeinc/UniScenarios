export interface IntentPreservingSite {
  readonly siteId: string;
  readonly degradation: { readonly intentPreserved: boolean };
}

export interface PlayableSiteSelection<TSite extends IntentPreservingSite, TProduct> {
  readonly site: TSite;
  readonly product: TProduct;
  readonly rejected: readonly { siteId: string; reason: string }[];
}

/**
 * Matcher score orders structurally suitable sites, but executable semantics
 * such as physical signal-head ownership are only known during
 * materialization. Keep matcher order deterministic while trying every
 * intent-preserving candidate, and retain the concrete rejection reasons when
 * none can execute.
 */
export function selectPlayableSite<TSite extends IntentPreservingSite, TProduct>(
  sites: readonly TSite[],
  attempt: (site: TSite) => TProduct,
): PlayableSiteSelection<TSite, TProduct> {
  const rejected: Array<{ siteId: string; reason: string }> = [];
  for (const site of sites) {
    if (!site.degradation.intentPreserved) continue;
    try {
      return { site, product: attempt(site), rejected };
    } catch (error) {
      rejected.push({
        siteId: site.siteId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (rejected.length === 0) {
    throw new Error('No intent-preserving site matches this scenario');
  }
  throw new Error(
    `No intent-preserving site can execute this scenario. ${rejected
      .map(({ siteId, reason }) => `${siteId}: ${reason}`)
      .join(' · ')}`,
  );
}
