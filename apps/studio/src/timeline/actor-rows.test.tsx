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

describe('timeline actor stickers', () => {
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

  it('puts every actor identity in its single base action lane without a standalone header row', () => {
    const groups = buildTimelineGroups(template);
    expect(groups.map((group) => [group.actorId, group.compact])).toEqual([
      ['delivery', false], ['cone', true], ['portable-prop', true],
    ]);
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template } } as never} editorState={null} session={session('authoring')} />);
    expect(markup).toContain('data-testid="timeline-actor-sticker-cone"');
    expect(markup).toContain('data-testid="timeline-actor-sticker-portable-prop"');
    expect(markup).toContain('data-testid="timeline-cone-actions"');
    expect(markup).toContain('data-testid="timeline-portable-prop-actions"');
    expect(markup).not.toContain('timeline-actor-row-');
    expect(markup).not.toContain('Signals &amp; actors');
    expect(markup).toContain('data-testid="timeline-full-width"');
    expect(markup).not.toContain('data-testid="timeline-cone-speed"');
    expect(markup).toContain('aria-label="Object or prop icon"');
    expect(markup).toContain('aria-label="Delete Traffic cone 1"');
  });

  it('uses catalog type names and independent per-type ordinals while preserving ids', () => {
    const namedTemplate = { ...template, roles: [
      { ...roles[0]!, id: 'pickup-a', actor: { ...roles[0]!.actor, catalogId: 'vehicle.pickup' } },
      { ...roles[0]!, id: 'sedan-a', actor: { ...roles[0]!.actor, catalogId: 'vehicle.sedan' } },
      { ...roles[0]!, id: 'pickup-b', actor: { ...roles[0]!.actor, catalogId: 'vehicle.pickup' } },
      { ...roles[0]!, id: 'sedan-b', actor: { ...roles[0]!.actor, catalogId: 'vehicle.sedan' } },
    ] } as unknown as ScenarioTemplateV2;
    const groups = buildTimelineGroups(namedTemplate);
    expect(groups.map((group) => [group.actorId, group.displayLabel])).toEqual([
      ['pickup-a', 'Pickup 1'], ['sedan-a', 'Sedan 1'], ['pickup-b', 'Pickup 2'], ['sedan-b', 'Sedan 2'],
    ]);
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: namedTemplate } } as never} editorState={null} session={session('authoring')} />);
    expect(markup).toContain('data-testid="timeline-actor-sticker-pickup-a"');
    expect(markup).toContain('>Pickup 1<');
    expect(markup).toContain('>Pickup 2<');
    expect(markup).toContain('>Sedan 1<');
  });

  it('keeps time-zero clips below the identity sticker', () => {
    const timeZero = { ...template, choreography: { ...template.choreography, interactions: [
      { id: 'start-now', actor: 'delivery', trigger: { kind: 'at', t: 0 }, until: { kind: 'at', t: 2 }, verb: 'speed', target: { mode: 'absolute', valueKph: 30 }, dynamics: { shape: 'linear', constraint: 'time', value: 2 } },
    ] } } as unknown as ScenarioTemplateV2;
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: timeZero } } as never} editorState={null} session={session('authoring')} />);
    expect(markup).toContain('data-testid="timeline-actor-sticker-delivery"');
    expect(markup).toMatch(/data-testid="timeline-item-start-now"[^>]+top:37px[^>]+left:0%/);
  });

  it('does not expose actor deletion during playback', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template } } as never} editorState={null} session={session('playing')} />);
    expect(markup).not.toContain('timeline-delete-actor-');
    expect(markup).not.toContain('aria-label="Delete Traffic cone 1"');
    expect(markup).toContain('aria-label="Select and frame Van 1"');
  });
});
