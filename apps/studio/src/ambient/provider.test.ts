import { describe, expect, it } from 'vitest';
import {
  AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY,
  LEGACY_AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY,
  ambientTrafficProviderFromExtensions,
  sumoOwnsPhysicalSignalStates,
} from './provider';

describe('ambient traffic provider preference', () => {
  it('migrates missing and unknown preferences to SUMO', () => {
    expect(ambientTrafficProviderFromExtensions(undefined)).toBe('sumo');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'broken' })).toBe('sumo');
  });

  it('restores explicit provider choices', () => {
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'off' })).toBe('off');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'sumo' })).toBe('sumo');
    expect(ambientTrafficProviderFromExtensions({ [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'native' })).toBe('native');
  });

  it('reads the legacy presentation choice without changing the missing-field default', () => {
    expect(ambientTrafficProviderFromExtensions({ [LEGACY_AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'native' })).toBe('native');
    expect(ambientTrafficProviderFromExtensions({
      [LEGACY_AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'native',
      [AMBIENT_TRAFFIC_PROVIDER_EXTENSION_KEY]: 'off',
    })).toBe('off');
  });

  it('hands physical signal colors to canonical playback when a map plan is authored', () => {
    expect(sumoOwnsPhysicalSignalStates('sumo', false, false, false)).toBe(true);
    expect(sumoOwnsPhysicalSignalStates('sumo', false, true, false)).toBe(false);
    expect(sumoOwnsPhysicalSignalStates('sumo', true, false, false)).toBe(false);
    expect(sumoOwnsPhysicalSignalStates('native', false, false, false)).toBe(false);
    expect(sumoOwnsPhysicalSignalStates('off', false, false, false)).toBe(false);
  });

  it('hands physical signal colors to imported playback even without an editor-authored plan', () => {
    expect(sumoOwnsPhysicalSignalStates('sumo', false, false, true)).toBe(false);
  });
});
