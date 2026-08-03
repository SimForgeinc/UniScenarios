import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { TimelineDock, timelineActionOutcome } from './TimelineDock';
import { buildTimelineGroups, TIMELINE_LAYOUT_EXTENSION_KEY, timelineLanePreferencesForDrop, timelineLayoutExtension } from './model';

const controller = {
  doc: { data: { choreography: { clipSeconds: 20, interactions: [] }, roles: [] } },
} as never;

const outcomeController = {
  doc: { data: {
    choreography: { clipSeconds: 20, interactions: [{
      id: 'go-straight', actor: 'car', trigger: { kind: 'at', t: 3 }, until: { kind: 'at', t: 5 },
      verb: 'route', target: { mode: 'lanePath', lanes: ['road.1'] },
    }] },
    roles: [{ id: 'car', label: 'Sedan', actor: { class: 'vehicle', catalogId: 'vehicle.sedan' } }],
  } },
} as never;

const session = {
  state: { mode: 'authoring' as const, time: 0, duration: 20, validation: 'unchecked' as const, error: null },
  playPause: vi.fn(),
  stop: vi.fn(),
  seek: vi.fn(),
};

describe('author timeline playback controls', () => {
  it('projects canonical trigger outcomes as pending, executed, or missed', () => {
    expect(timelineActionOutcome([], 'a')).toBe('pending');
    expect(timelineActionOutcome([{ interactionId: 'a', time: 2, kind: 'trigger_fired' }], 'a')).toBe('executed');
    expect(timelineActionOutcome([{ interactionId: 'a', time: 5, kind: 'trigger_skipped' }], 'a')).toBe('missed');
  });
  it('renders a canonical clip outcome into the authored timeline DOM', () => {
    const markup = renderToStaticMarkup(<TimelineDock
      controller={outcomeController}
      editorState={null}
      session={{ ...session, state: { ...session.state, mode: 'playing', time: 3 } }}
      outcomes={[{ interactionId: 'go-straight', actorId: 'car', time: 3, kind: 'trigger_fired' }]}
    />);
    expect(markup).toMatch(/data-outcome="executed"[^>]*data-testid="timeline-item-go-straight"/);
    expect(markup).toContain('border-width:1px');
    expect(markup).toContain('border-style:solid');
    expect(markup).toContain('border-color:#67d99a');

    const missedMarkup = renderToStaticMarkup(<TimelineDock
      controller={outcomeController}
      editorState={null}
      session={{ ...session, state: { ...session.state, mode: 'playing', time: 5 } }}
      outcomes={[{ interactionId: 'go-straight', actorId: 'car', time: 5, kind: 'trigger_skipped' }]}
    />);
    expect(missedMarkup).toMatch(/data-outcome="missed"[^>]*data-testid="timeline-item-go-straight"/);
    expect(missedMarkup).toContain('border-color:#ff788c');

    const resetMarkup = renderToStaticMarkup(<TimelineDock
      controller={outcomeController}
      editorState={null}
      session={session}
      outcomes={[]}
    />);
    expect(resetMarkup).toMatch(/data-outcome="pending"[^>]*data-testid="timeline-item-go-straight"/);
    expect(resetMarkup).toContain('aria-label="Resize start of route"');
    expect(resetMarkup).toContain('aria-label="Edit and move route"');
    expect(resetMarkup).toContain('aria-label="Resize end of route"');
    expect(resetMarkup).toContain('data-lane="0"');
  });
  it('renders an occupied Parallel 2 drop in a new Parallel 3 row', () => {
    const template = {
      schemaVersion: 2,
      roles: [{ id: 'ambulance', label: 'Ambulance', actor: { class: 'car', catalogId: 'vehicle.ambulance' } }],
      choreography: { clipSeconds: 20, interactions: [
        { id: 'horn', actor: 'ambulance', trigger: { kind: 'at', t: 2 }, until: { kind: 'at', t: 2.5 }, verb: 'set', target: { key: 'audio.horn', value: true } },
        { id: 'pull-over', actor: 'ambulance', trigger: { kind: 'at', t: 14.66 }, until: { kind: 'at', t: 16.26 }, verb: 'laneOffset', target: { tFrac: -.8, reference: 'lane_center' }, dynamics: { shape: 'cubic', constraint: 'time', value: 3 } },
        { id: 'pass', actor: 'ambulance', trigger: { kind: 'at', t: 15 }, until: { kind: 'at', t: 15.8 }, verb: 'speed', target: { mode: 'absolute', valueKph: 57.6 }, dynamics: { shape: 'linear', constraint: 'time', value: .8 } },
        { id: 'center', actor: 'ambulance', trigger: { kind: 'at', t: 16 }, until: { kind: 'at', t: 17.2 }, verb: 'laneOffset', target: { tFrac: 0, reference: 'lane_center' }, dynamics: { shape: 'cubic', constraint: 'time', value: 3 } },
      ] },
      extensions: { [TIMELINE_LAYOUT_EXTENSION_KEY]: timelineLayoutExtension({ 'pull-over': 0 }) },
    } as unknown as ScenarioTemplateV2;
    const group = buildTimelineGroups(template)[0]!;
    const preferences = timelineLanePreferencesForDrop(
      group.lanes, 'pull-over', { start: 14.66, end: 16.26 }, 1, { 'pull-over': 0 },
    );
    const dropped = { ...template, extensions: { ...template.extensions, [TIMELINE_LAYOUT_EXTENSION_KEY]: timelineLayoutExtension(preferences) } };
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: dropped } } as never} editorState={null} session={session} />);

    expect(markup).toContain('data-testid="timeline-ambulance-actions-3"');
    expect(markup).toMatch(/data-testid="timeline-item-pull-over"[^>]*data-lane="2"/);
    expect(markup).toMatch(/data-testid="timeline-item-pass"[^>]*data-lane="1"/);
    expect(markup).toMatch(/data-testid="timeline-item-center"[^>]*data-lane="1"/);
  });
  it('keeps normal Play camera-neutral and exposes an actionable empty camera state', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={controller} editorState={null} session={session} />);
    expect(markup).toContain('aria-label="Play simulation"');
    expect(markup).toContain('aria-label="Play from dash camera"');
    expect(markup).toMatch(/<button[^>]+disabled=""[^>]+data-testid="session-camera-play"/);
    expect(markup).toContain('No dash camera');
    expect(markup).not.toContain('timeline-ambient-summary');
    expect(markup).not.toContain('Ambient traffic');
  });

  it('offers a deterministic chooser when multiple actor cameras are attached', () => {
    const markup = renderToStaticMarkup(<TimelineDock
      controller={controller}
      editorState={null}
      session={session}
      dashCameras={[{ id: 'car-a:front', label: 'Car A · Front' }, { id: 'car-b:front', label: 'Car B · Front' }]}
      selectedDashCameraId="car-b:front"
      onDashCameraChange={vi.fn()}
      onCameraPlay={vi.fn()}
    />);
    expect(markup).toContain('aria-label="Dash camera for Camera Play"');
    expect(markup).toContain('<option value="car-b:front" selected="">Car B · Front</option>');
    expect(markup).not.toMatch(/<button[^>]+disabled=""[^>]+data-testid="session-camera-play"/);
  });
});
