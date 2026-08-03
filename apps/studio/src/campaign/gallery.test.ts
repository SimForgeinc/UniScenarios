import { describe, expect, it } from 'vitest';
import { GENERATED_CAMPAIGN_ENTRIES } from './generated';
import { filterGalleryEntries, galleryDetails } from './gallery';

describe('scenario gallery discovery', () => {
  it('searches titles, summaries, tags and locations', () => {
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, 'controlled merge', 'all', 'all', []).map((entry) => entry.ordinal)).toEqual([8]);
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, 'wrong-way', 'all', 'all', []).map((entry) => entry.ordinal)).toEqual([6]);
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, 'easterbrook', 'all', 'all', []).map((entry) => entry.ordinal)).toEqual([6]);
  });

  it('filters by verified capabilities without treating unverified as success', () => {
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, '', 'variations', 'all', []).map((entry) => entry.ordinal)).toEqual([]);
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, '', 'ambient', 'all', []).map((entry) => entry.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('filters saved copies by immutable stable identity rather than card position', () => {
    const entry = GENERATED_CAMPAIGN_ENTRIES[7]!;
    const imported = [{
      ordinal: 1,
      stableId: entry.stableId,
      slug: entry.slug,
      savedName: 'saved',
      mapId: entry.mapId!,
      title: entry.title,
      importedAt: '2026-08-02T00:00:00.000Z',
    }];
    expect(filterGalleryEntries(GENERATED_CAMPAIGN_ENTRIES, '', 'saved', 'all', imported).map((item) => item.stableId)).toEqual([entry.stableId]);
  });

  it('provides concise user-facing details for all twelve curated identities', () => {
    expect(GENERATED_CAMPAIGN_ENTRIES.map(galleryDetails).every((details) => details.summary.length > 30 && details.tags.length >= 3)).toBe(true);
  });
});
