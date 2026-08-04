import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AmbientTrafficPanel, AmbientTrafficPopover } from './AmbientTrafficPanel';
import { defaultAmbientTrafficProfile, profileForPreset } from './model';

describe('AmbientTrafficPanel', () => {
  it('exposes City as the enabled authoring default alongside Off and density controls', () => {
    const markup = renderToStaticMarkup(<AmbientTrafficPanel
      profile={defaultAmbientTrafficProfile()}
      provenance={null}
      onChange={vi.fn()}
      defaultOpen
    />);
    expect(markup).toContain('<option value="off">Off</option>');
    expect(markup).toContain('<option value="city" selected="">City</option>');
    expect(markup).toContain('<option value="custom">Custom</option>');
    expect(markup).toContain('Reset to City');
  });

  it('keeps reset available when a scenario explicitly saved Off', () => {
    const markup = renderToStaticMarkup(<AmbientTrafficPanel
      profile={profileForPreset('off', defaultAmbientTrafficProfile())}
      provenance={null}
      onChange={vi.fn()}
      defaultOpen
    />);
    const reset = markup.match(/<button[^>]*data-testid="ambient-traffic-reset"[^>]*>/)?.[0];
    expect(reset).toBeDefined();
    expect(reset).not.toContain('disabled');
  });

  it('renders every authoring control in the toolbar popover with an accessible dialog label', () => {
    const markup = renderToStaticMarkup(<AmbientTrafficPopover
      profile={defaultAmbientTrafficProfile()}
      provenance={null}
      provider="sumo"
      onChange={vi.fn()}
      onRunRobustness={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="Ambient traffic configuration"');
    expect(markup).toContain('data-testid="ambient-traffic-preset"');
    expect(markup).toContain('data-testid="ambient-traffic-seed"');
    expect(markup).toContain('data-testid="ambient-traffic-regenerate"');
    expect(markup).toContain('data-testid="ambient-traffic-accelerated-signal-cycles"');
    expect(markup).toContain('Accelerated signal cycles');
    expect(markup).toContain("Off uses the map&#x27;s original timings.");
    expect(markup).toContain('Test scenario with background traffic');
    expect(markup).toContain('Reset to City');
    expect(markup).not.toContain('ambient-traffic-disclosure');
  });

  it('keeps accelerated signal cycles off by default and exposes checkbox semantics', () => {
    const off = renderToStaticMarkup(<AmbientTrafficPanel
      profile={defaultAmbientTrafficProfile()}
      provenance={null}
      provider="sumo"
      onChange={vi.fn()}
      defaultOpen
    />);
    const checkbox = off.match(/<input[^>]*data-testid="ambient-traffic-accelerated-signal-cycles"[^>]*>/)?.[0];
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).not.toContain('checked');
    const on = renderToStaticMarkup(<AmbientTrafficPanel
      profile={defaultAmbientTrafficProfile()}
      provenance={null}
      provider="sumo"
      acceleratedSignalCycles
      onChange={vi.fn()}
      defaultOpen
    />);
    expect(on.match(/<input[^>]*data-testid="ambient-traffic-accelerated-signal-cycles"[^>]*>/)?.[0]).toContain('checked');
  });

  it('offers an accessible engine-level Off state and disables density controls', () => {
    const markup = renderToStaticMarkup(<AmbientTrafficPanel
      profile={defaultAmbientTrafficProfile()}
      provenance={null}
      provider="off"
      onChange={vi.fn()}
      defaultOpen
    />);
    expect(markup).toContain('<option value="off" selected="">Off</option>');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Ambient traffic off');
    expect(markup.match(/<select[^>]*data-testid="ambient-traffic-preset"[^>]*>/)?.[0]).toContain('disabled');
    expect(markup.match(/<input[^>]*data-testid="ambient-traffic-seed"[^>]*>/)?.[0]).toContain('disabled');
    expect(markup).not.toContain('ambient-traffic-accelerated-signal-cycles');
    expect(markup).not.toContain('sumo-traffic-status');
  });
});
