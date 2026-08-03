import { describe, expect, it, vi } from 'vitest';

import { selectPlayableSite } from '../site-selection';

function site(siteId: string, intentPreserved = true) {
  return { siteId, degradation: { intentPreserved } };
}

describe('playable site selection', () => {
  it('keeps matcher order but skips candidates that cannot materialize', () => {
    const attempt = vi.fn((candidate: ReturnType<typeof site>) => {
      if (candidate.siteId === 'junction-447') throw new Error('signal_unbindable: left movement');
      return `instance:${candidate.siteId}`;
    });

    const selected = selectPlayableSite(
      [site('junction-447'), site('presentation-only', false), site('junction-345')],
      attempt,
    );

    expect(selected.site.siteId).toBe('junction-345');
    expect(selected.product).toBe('instance:junction-345');
    expect(selected.rejected).toEqual([
      { siteId: 'junction-447', reason: 'signal_unbindable: left movement' },
    ]);
    expect(attempt.mock.calls.map(([candidate]) => candidate.siteId)).toEqual([
      'junction-447',
      'junction-345',
    ]);
  });

  it('reports every concrete rejection when no candidate can execute', () => {
    expect(() => selectPlayableSite(
      [site('junction-447'), site('junction-303')],
      (candidate) => { throw new Error(`${candidate.siteId} has no physical signal binding`); },
    )).toThrow(
      'No intent-preserving site can execute this scenario. junction-447: junction-447 has no physical signal binding · junction-303: junction-303 has no physical signal binding',
    );
  });
});
