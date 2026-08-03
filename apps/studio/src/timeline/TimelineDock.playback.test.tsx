import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimelineDock, timelineActionOutcome } from './TimelineDock';

const controller = {
  doc: { data: { choreography: { clipSeconds: 20, interactions: [] }, roles: [] } },
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
