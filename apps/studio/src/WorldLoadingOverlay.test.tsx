import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorldLoadingOverlay, worldLoadingStage } from './WorldLoadingOverlay';

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
});
