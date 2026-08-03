import { describe, expect, it } from 'vitest';
import {
  AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY,
  ambientTrafficProviderFromExtensions,
} from './provider';

describe('ambient traffic provider preference', () => {
  it('migrates missing and unknown preferences to SUMO', () => {
    expect(ambientTrafficProviderFromExtensions(undefined)).toBe('sumo');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'broken' })).toBe('sumo');
  });

  it('restores explicit provider choices', () => {
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'sumo' })).toBe('sumo');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'native' })).toBe('native');
  });
});
