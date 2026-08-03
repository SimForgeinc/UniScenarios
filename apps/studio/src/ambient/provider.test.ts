import { describe, expect, it } from 'vitest';
import {
  AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY,
  ambientTrafficProviderFromExtensions,
} from './provider';

describe('ambient traffic provider preference', () => {
  it('keeps native as the fail-safe default', () => {
    expect(ambientTrafficProviderFromExtensions(undefined)).toBe('native');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'broken' })).toBe('native');
  });

  it('restores an explicit SUMO choice', () => {
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'sumo' })).toBe('sumo');
  });
});
