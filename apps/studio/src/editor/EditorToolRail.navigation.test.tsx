import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolRail, migrateViewportTool } from './EditorToolRail';

describe('Editor tool navigation', () => {
  it('does not expose a standalone Validate and Export entry', () => {
    const markup = renderToStaticMarkup(<EditorToolRail
      controller={null}
      state={null}
      placement={{ enabled: false, placing: null, arm: vi.fn(), armKind: vi.fn(), cancel: vi.fn() }}
      authoringEnabled={false}
    />);
    expect(markup).not.toContain('tool-validate');
    expect(markup).not.toContain('aria-label="Validate"');
    expect(markup).not.toContain('Validate &amp; export');
    expect(markup).not.toContain('data-testid="tool-move"');
    expect(markup).not.toContain('aria-label="Move"');
  });

  it('maps a legacy saved Move selection back to Select', () => {
    expect(migrateViewportTool('move')).toBe('select');
    expect(migrateViewportTool('rotate')).toBe('rotate');
    expect(migrateViewportTool('unknown')).toBe('select');
  });
});
