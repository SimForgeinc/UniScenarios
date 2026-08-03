/** Versioned selection boundary for expensive episode metrics. Collision detection remains global. */
export const MONITORED_PAIR_POLICY_VERSION = 'episode-metric-pairs.v1';

export interface MonitoredPairPolicy {
  version: typeof MONITORED_PAIR_POLICY_VERSION;
  metricSubject: string | null;
  explicitPairs: ReadonlySet<string>;
}

export interface MetricPairSelection {
  monitored: boolean;
  scored: boolean;
  reason: 'metric-subject' | 'all-pairs' | 'explicit-monitor' | 'articulated-static' | 'not-selected';
}

/** Exactly preserves v1 metrics semantics; future ambient pruning must prove equivalence here. */
export function selectMetricPair(policy: MonitoredPairPolicy, a: string, b: string, hasArticulatedStaticShape = false): MetricPairSelection {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const monitored = policy.explicitPairs.has(key);
  const subjectScored = policy.metricSubject === null || a === policy.metricSubject || b === policy.metricSubject;
  if (monitored) return { monitored: true, scored: subjectScored, reason: 'explicit-monitor' };
  if (hasArticulatedStaticShape) return { monitored: false, scored: true, reason: 'articulated-static' };
  if (policy.metricSubject === null) return { monitored: false, scored: true, reason: 'all-pairs' };
  if (subjectScored) return { monitored: false, scored: true, reason: 'metric-subject' };
  return { monitored: false, scored: false, reason: 'not-selected' };
}
