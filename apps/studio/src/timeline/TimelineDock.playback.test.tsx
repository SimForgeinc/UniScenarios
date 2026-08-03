import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TimelineDock } from './TimelineDock';

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
  it('keeps normal Play camera-neutral and exposes an actionable empty camera state', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={controller} editorState={null} session={session} />);
    expect(markup).toContain('aria-label="Play simulation"');
    expect(markup).toContain('title="Play without changing the editor camera"');
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
