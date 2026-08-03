import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FirstRunGraphicsChooser } from './FirstRunGraphicsChooser';

describe('first-run graphics chooser', () => {
  it('renders an accessible blocking decision with the original options plus Roads Only and no preselected value', () => {
    const markup = renderToStaticMarkup(<FirstRunGraphicsChooser onChoose={() => undefined} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup.match(/data-testid="graphics-choice-/g)).toHaveLength(4);
    expect(markup).toContain('Use Roads Only');
    expect(markup).toContain('Use Ultra Low');
    expect(markup).toContain('Use Minimal');
    expect(markup).toContain('Use High');
    expect(markup).not.toContain('aria-checked="true"');
    expect(markup).toContain('RECOMMENDED');
    expect(markup).toContain('cold-cache measurements');
  });
});
