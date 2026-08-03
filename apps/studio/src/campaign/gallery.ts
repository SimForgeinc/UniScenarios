import type { CampaignImportRecord, GeneratedCampaignEntry } from './types';

export type GalleryFilter = 'all' | 'ambient' | 'variations' | 'saved';

export interface GalleryScenarioDetails {
  summary: string;
  tags: readonly string[];
}

const DETAILS: Readonly<Record<string, GalleryScenarioDetails>> = {
  'ec-01-01-construction-chicane-reversing-truck-v2': {
    summary: 'Negotiate an alternating-flow construction chicane while a work vehicle reverses and a worker enters the corridor.',
    tags: ['construction', 'chicane', 'reversing truck'],
  },
  'ec-02-02-police-roadside-stop-v2': {
    summary: 'Pass a police roadside stop with an occupied shoulder and constrained adjacent traffic.',
    tags: ['police', 'roadside stop', 'blocked shoulder'],
  },
  'ec-03-03-red-light-ambulance-preemption-v2': {
    summary: 'Create a refuge path for an ambulance as preemption changes right-of-way at a red-light intersection.',
    tags: ['ambulance', 'preemption', 'red light'],
  },
  'ec-04-04-child-emerging-behind-bus-v2': {
    summary: 'Stop for a child emerging from the blind side of a bus while rear traffic closes in.',
    tags: ['child', 'bus', 'occlusion'],
  },
  'ec-05-05-cyclist-occlusion-conflict-v2': {
    summary: 'Creep from a garage exit, then stop for a hidden contraflow cyclist revealed behind a delivery vehicle.',
    tags: ['cyclist', 'garage exit', 'contraflow'],
  },
  'ec-06-06-wrong-way-vehicle-blind-approach-v2': {
    summary: 'React to a wrong-way vehicle beyond limited sight distance while escape space is constrained.',
    tags: ['wrong-way', 'limited sight', 'avoidance'],
  },
  'ec-07-07-protected-left-red-runner-v2': {
    summary: 'Remain stopped while a red-light runner traverses a protected intersection and nearby vulnerable road users clear.',
    tags: ['signalized intersection', 'red runner', 'vulnerable road users'],
  },
  'ec-08-08-zipper-merge-lane-closure-v2': {
    summary: 'Merge under a marshal-controlled lane closure while a following vehicle brakes and aborts a pass.',
    tags: ['controlled merge', 'lane closure', 'construction'],
  },
  'ec-09-09-stalled-vehicle-beyond-sight-v2': {
    summary: 'Brake for a stopped roadway obstruction revealed late by rain, glare, and constrained visibility.',
    tags: ['stalled vehicle', 'limited sight', 'braking'],
  },
  'ec-10-10-officer-flashing-red-junction-v2': {
    summary: 'Treat each approach as a stop while an officer releases traffic through a flashing-red junction.',
    tags: ['traffic officer', 'flashing red', 'junction'],
  },
  'ec-11-11-double-threat-crosswalk-v2': {
    summary: 'Hold at a crossing while a cyclist and mobility-scooter rider enter in sequence.',
    tags: ['staged crossing', 'crosswalk', 'vulnerable road user'],
  },
  'ec-12-12-fire-engine-gridlock-escape-v2': {
    summary: 'Coordinate gridlocked traffic to create an escape corridor for a fire engine.',
    tags: ['fire engine', 'gridlock', 'escape corridor'],
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
    if (filter === 'ambient' && entry.ambient !== 'sumo-smoke-verified') return false;
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
