import type { CampaignImportRecord, GeneratedCampaignEntry } from './types';

export type GalleryFilter = 'all' | 'ambient' | 'variations' | 'saved';

export interface GalleryScenarioDetails {
  summary: string;
  tags: readonly string[];
}

const DETAILS: Readonly<Record<string, GalleryScenarioDetails>> = {
  'edge-01-blind-chicane-emerging-worker-v1': {
    summary: 'Navigate an alternating-flow construction chicane as an occluded worker emerges carrying a long pipe.',
    tags: ['construction', 'pedestrian', 'occlusion'],
  },
  'edge-02-bus-occluded-child-signalized-crossing-v1': {
    summary: 'Stop for a child emerging from a bus blind spot while rear traffic closes in.',
    tags: ['child', 'bus', 'crossing', 'occlusion'],
  },
  'edge-03-contraflow-cyclist-garage-exit-v1': {
    summary: 'Creep across a sidewalk and bike lane as a hidden contraflow cyclist arrives.',
    tags: ['cyclist', 'garage', 'contraflow'],
  },
  'edge-04-wrong-way-sedan-blind-crest-v1': {
    summary: 'React to a wrong-way sedan beyond a blind crest with both escape lanes constrained.',
    tags: ['wrong-way', 'blind crest', 'motorcycle'],
  },
  'edge-05-ambulance-gridlock-v1': {
    summary: 'Create a refuge corridor at a red light so an ambulance can clear gridlocked traffic.',
    tags: ['ambulance', 'gridlock', 'intersection'],
  },
  'edge-06-dark-signal-human-control-v1': {
    summary: 'Interpret an officer’s staged directions while every signal head is dark.',
    tags: ['dark signal', 'traffic officer', 'pedestrian'],
  },
  'edge-case-07-dooring-chain-tram': {
    summary: 'Handle a cyclist dooring chain reaction beside an occupied tram swept path.',
    tags: ['cyclist', 'dooring', 'tram'],
  },
  'edge-case-08-runaway-shopping-cart': {
    summary: 'Brake for a runaway cart that rolls back into the lane in rain and glare.',
    tags: ['shopping cart', 'rain', 'low visibility'],
  },
  'edge-09-double-turn-mobility-scooter-v1': {
    summary: 'Wait through a two-stage crossing used by a cyclist and mobility-scooter rider.',
    tags: ['mobility scooter', 'cyclist', 'crossing'],
  },
  'edge-10-reversible-lane-stadium-egress-v1': {
    summary: 'Exit a closing reversible lane safely as a red-X and marshal override traffic flow.',
    tags: ['reversible lane', 'red-X', 'stadium'],
  },
};

export function galleryDetails(entry: GeneratedCampaignEntry): GalleryScenarioDetails {
  return DETAILS[entry.stableId] ?? {
    summary: 'A verified twenty-second edge-case scenario.',
    tags: [],
  };
}

export function hasVerifiedVariation(entry: GeneratedCampaignEntry): boolean {
  return /^\d+-verified-site(?:s)?$/.test(entry.transfer);
}

export function filterGalleryEntries(
  entries: readonly GeneratedCampaignEntry[],
  query: string,
  filter: GalleryFilter,
  mapId: string,
  imports: readonly CampaignImportRecord[],
): GeneratedCampaignEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  const savedIds = new Set(imports.map((record) => record.stableId));
  return entries.filter((entry) => {
    if (mapId !== 'all' && entry.mapId !== mapId) return false;
    if (filter === 'ambient' && entry.ambient !== 'verified-evidence') return false;
    if (filter === 'variations' && !hasVerifiedVariation(entry)) return false;
    if (filter === 'saved' && !savedIds.has(entry.stableId)) return false;
    if (!needle) return true;
    const details = galleryDetails(entry);
    return [entry.title, details.summary, entry.mapId ?? '', ...details.tags]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle);
  });
}
