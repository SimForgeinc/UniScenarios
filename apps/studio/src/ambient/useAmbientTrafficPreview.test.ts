import { describe, expect, it } from 'vitest';
import { authoringPreviewActors } from './useAmbientTrafficPreview';

describe('authoring t=0 population', () => {
  it('keeps portable and ambient actors while excluding editor-rendered duplicates', () => {
    const actors = [
      { id: 'ego' },
      { id: 'ambulance' },
      { id: 'ambient:0' },
    ];
    expect(authoringPreviewActors(actors, ['ego']).map((actor) => actor.id)).toEqual([
      'ambulance',
      'ambient:0',
    ]);
  });
});
