import { describe, expect, it } from 'vitest';
import { CATALOG } from '@uniscenarios/prop-catalog';
import { filterCatalog, pushRecent, shouldShowEditorToolRail } from '../EditorToolRail';
import { actorKindFor, simulationClassFor } from '../document';

describe('editor actor catalog model', () => {
  it('shows only while authoring and restores immediately after playback', () => {
    expect(shouldShowEditorToolRail(true, false)).toBe(true);
    expect(shouldShowEditorToolRail(false, false)).toBe(false);
    expect(shouldShowEditorToolRail(true, false)).toBe(true);
    expect(shouldShowEditorToolRail(true, true)).toBe(false);
  });

  it('provides distinct vehicle, pedestrian and prop quick filters', () => {
    const none = new Set<string>();
    expect(filterCatalog(CATALOG, 'vehicle', '', none, []).every((entry) => entry.class === 'vehicle')).toBe(true);
    expect(filterCatalog(CATALOG, 'pedestrian', '', none, []).every((entry) => entry.class === 'pedestrian')).toBe(true);
    expect(
      filterCatalog(CATALOG, 'prop', '', none, []).every(
        (entry) => entry.class !== 'vehicle' && entry.class !== 'pedestrian',
      ),
    ).toBe(true);
  });

  it('searches semantic descriptions and tags, not only display labels', () => {
    const results = filterCatalog(CATALOG, 'all', 'large-vehicle', new Set(), []);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.tags.includes('large-vehicle'))).toBe(true);
  });

  it('keeps favorite and recent views deterministic', () => {
    const favorites = new Set(['vehicle.bus']);
    expect(filterCatalog(CATALOG, 'favorite', '', favorites, []).map((entry) => entry.id)).toEqual(['vehicle.bus']);
    expect(
      filterCatalog(CATALOG, 'recent', '', new Set(), ['pedestrian.child_walking', 'vehicle.bus'])
        .map((entry) => entry.id),
    ).toEqual(['pedestrian.child_walking', 'vehicle.bus']);
  });

  it('moves a repeated selection to the front and bounds history', () => {
    let recents: string[] = [];
    for (let index = 0; index < 12; index++) recents = pushRecent(recents, `actor-${index}`);
    expect(recents).toHaveLength(8);
    expect(pushRecent(recents, 'actor-8').slice(0, 2)).toEqual(['actor-8', 'actor-11']);
  });

  it('places the shopping cart and specialized mobility actors as moving simulation roles', () => {
    expect(actorKindFor('street.shopping_cart')).toBe('vehicle');
    expect(simulationClassFor('street.shopping_cart')).toBe('scooter');
    expect(simulationClassFor('vehicle.mobility_scooter')).toBe('scooter');
    expect(simulationClassFor('vehicle.tram')).toBe('bus');
  });
});
