import { describe, expect, it } from 'vitest';
import { openScenarioLocationIntent, workspaceForLegacySelection } from './navigation';

describe('OpenSCENARIO workspace navigation migration', () => {
  it.each(['validate', 'validate-export', 'validate-and-export', 'scenario-actions', '#validate'])(
    'maps the legacy %s selection to OpenSCENARIO',
    (selection) => expect(workspaceForLegacySelection(selection)).toBe('openscenario'),
  );

  it('canonicalizes a legacy panel deep link without losing unrelated parameters', () => {
    expect(openScenarioLocationIntent({ search: '?map=yale-street&panel=validate', hash: '' })).toEqual({
      open: true,
      section: 'validation',
      canonicalSearch: '?map=yale-street&workspace=openscenario&section=validation',
      canonicalHash: '',
    });
  });

  it('opens canonical links without rewriting them and ignores unrelated panels', () => {
    expect(openScenarioLocationIntent({ search: '?workspace=openscenario', hash: '' })).toEqual({
      open: true,
      section: 'overview',
      canonicalSearch: null,
      canonicalHash: null,
    });
    expect(openScenarioLocationIntent({ search: '?panel=variations', hash: '' }).open).toBe(false);
  });
});
