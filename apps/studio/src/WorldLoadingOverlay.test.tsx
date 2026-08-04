import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorldLoadingOverlay, worldLoadingStage } from './WorldLoadingOverlay';
import type { CityViewer } from '@uniscenarios/city-renderer';

describe('world loading status', () => {
  it('reports truthful ordered stages and dismisses only when world and editor are ready', () => {
    expect(worldLoadingStage({ viewerReady: false, roadVisible: false, editorReady: false, error: null })).toBe('renderer');
    expect(worldLoadingStage({ viewerReady: true, roadVisible: false, editorReady: false, error: null })).toBe('road');
    expect(worldLoadingStage({ viewerReady: true, roadVisible: true, editorReady: false, error: null })).toBe('editor');
    expect(worldLoadingStage({ viewerReady: true, roadVisible: true, editorReady: true, error: null })).toBe('ready');
    expect(worldLoadingStage({ viewerReady: true, roadVisible: true, editorReady: true, error: 'broken' })).toBe('error');
  });

  it('announces initial loading accessibly', () => {
    const markup = renderToStaticMarkup(
      <WorldLoadingOverlay viewer={null} mapLabel="Yale Street" editorReady={false} error={null} />,
    );
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('Opening Yale Street');
    expect(markup).toContain('Starting the world renderer');
  });

  it('distinguishes a usable world from optional detail streaming', () => {
    const viewer = {
      getStats: () => ({ roadVisible: true, loading: 1, queued: 2, uploading: 1, streamingError: null }),
    } as unknown as CityViewer;
    const markup = renderToStaticMarkup(
      <WorldLoadingOverlay viewer={viewer} mapLabel="Yale Street" editorReady={true} error={null} />,
    );
    expect(markup).toContain('data-stage="background"');
    expect(markup).toContain('World ready · loading 4 detail items');
    expect(markup).not.toContain('aria-busy="true"');
  });
});
