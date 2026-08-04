/** UniScenarios-owned examples. Only compact facts are retrieved; no third-party prompts or data. */
const EXAMPLES = [
  { id: 'EC-04', terms: ['child', 'pedestrian', 'occlusion', 'bus', 'crossing'], fact: 'A hidden pedestrian can begin moving after an authored time trigger while an ego vehicle follows a lane route.' },
  { id: 'EC-05', terms: ['cyclist', 'bicycle', 'occlusion', 'conflict'], fact: 'A bicycle challenger can be represented as a native role with a speed action and a lane-bound route.' },
  { id: 'EC-07', terms: ['red', 'signal', 'intersection', 'left'], fact: 'Signal-sensitive interactions need a map-resolved signal reference; do not invent a signal id.' },
  { id: 'EC-08', terms: ['merge', 'lane', 'closure', 'vehicle'], fact: 'Lane-changing scenarios must keep placement and downstream route binding deterministic.' },
  { id: 'EC-09', terms: ['stalled', 'stopped', 'sight', 'vehicle'], fact: 'A stopped context vehicle is a static occluder rather than an authored destruction event.' },
] as const;

export interface RetrievedCopilotExample { readonly id: string; readonly fact: string; readonly score: number }

export function retrieveOwnedExamples(prompt: string, limit = 3): RetrievedCopilotExample[] {
  const words = new Set(prompt.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return EXAMPLES.map((example) => ({
    id: example.id,
    fact: example.fact,
    score: example.terms.reduce((score, term) => score + Number(words.has(term)), 0),
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
