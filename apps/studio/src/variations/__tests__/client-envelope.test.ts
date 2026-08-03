import { describe, expect, it } from 'vitest';
import { AUTHORED_ACTOR_LIMIT_CODE, MAX_AUTHORED_ACTORS } from '@uniscenarios/scenario-model';
import { VariationSearchClient } from '../client';

describe('variation API authored actor envelope', () => {
  it('rejects 33 authored roles before starting workers or loading map assets', async () => {
    const template = { roles: Array.from({ length: MAX_AUTHORED_ACTORS + 1 }, (_, index) => ({ id: `actor-${index}` })) } as any;
    await expect(new VariationSearchClient().analyze(template, { id: 'map' } as any)).rejects.toMatchObject({ code: AUTHORED_ACTOR_LIMIT_CODE, actual: 33, maximum: 32 });
  });
});
