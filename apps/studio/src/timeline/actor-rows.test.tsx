import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { TimelineDock, timelineActorIcon } from './TimelineDock';
import { buildTimelineGroups } from './model';

const roles = [
  { id: 'delivery', label: 'Delivery van', actor: { class: 'car' as const, catalogId: 'vehicle.van', static: false, sensors: [] }, kind: 'scene_absolute' as const, pose: { position: { x: 0, y: 0, z: 0 }, headingRad: 0 }, essentiality: 'required' as const },
  { id: 'cone', label: 'Traffic cone', actor: { class: 'static_object' as const, catalogId: 'construction.traffic_cone', static: true, sensors: [] }, kind: 'scene_absolute' as const, pose: { position: { x: 1, y: 0, z: 0 }, headingRad: 0 }, essentiality: 'preferred' as const },
  { id: 'portable-prop', label: 'Portable barrier', actor: { class: 'static_object' as const, catalogId: 'construction.jersey_barrier_run', static: true, sensors: [] }, kind: 'on_reference' as const, pose: { laneOffset: 0, s: -10, tFrac: 0, headingOffsetRad: 0 }, essentiality: 'preferred' as const },
];

const template = {
  schemaVersion: 2 as const,
  id: 'timeline-actor-rows',
  meta: { name: 'Timeline actor rows', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', appVersion: 'test' },
  map: { mode: 'scene_absolute' as const, mapId: 'map' },
  roles,
  choreography: { clipSeconds: 20, warmupSeconds: 0, interactions: [] },
  invariants: [], variants: [], extensions: {},
} as unknown as ScenarioTemplateV2;

function session(mode: 'authoring' | 'playing') {
  return {
    state: { mode, time: 0, duration: 20, validation: 'unchecked' as const, error: null },
    playPause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
  } as never;
}

describe('timeline actor rows', () => {
  it('maps actor class and catalog identity to semantic icons', () => {
    expect(timelineActorIcon('car', 'vehicle.sedan').kind).toBe('car');
    expect(timelineActorIcon('car', 'vehicle.van').kind).toBe('truck');
    expect(timelineActorIcon('bus').kind).toBe('bus');
    expect(timelineActorIcon('motorcycle').kind).toBe('motorcycle');
    expect(timelineActorIcon('bicycle').kind).toBe('bicycle');
    expect(timelineActorIcon('pedestrian').kind).toBe('pedestrian');
    expect(timelineActorIcon('static_object').kind).toBe('object');
    expect(timelineActorIcon('car', 'unknown.catalog').kind).toBe('car');
  });

  it('keeps scene-absolute and portable objects as compact name-only rows', () => {
    const groups = buildTimelineGroups(template);
    expect(groups.map((group) => [group.actorId, group.compact])).toEqual([
      ['delivery', false], ['cone', true], ['portable-prop', true],
    ]);
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template } } as never} editorState={null} session={session('authoring')} />);
    expect(markup).toContain('data-testid="timeline-object-cone"');
    expect(markup).toContain('data-testid="timeline-object-portable-prop"');
    expect(markup).not.toContain('data-testid="timeline-cone-speed"');
    expect(markup).not.toContain('data-testid="timeline-cone-actions"');
    expect(markup).toContain('aria-label="Object or prop icon"');
    expect(markup).toContain('aria-label="Delete Traffic cone"');
  });

  it('does not expose actor deletion during playback', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template } } as never} editorState={null} session={session('playing')} />);
    expect(markup).not.toContain('timeline-delete-actor-');
    expect(markup).not.toContain('aria-label="Delete Traffic cone"');
    expect(markup).toContain('aria-label="Select and frame Delivery van"');
  });
});
