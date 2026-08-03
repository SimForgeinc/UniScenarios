import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../LayerPanel';
import { CameraDiagnosticsReadout } from '../Hud';
import { WorkspaceHeader } from '../editor/EditorChrome';
import { cloneDefaults } from './model';

function renderSettings(debugGraphics: boolean): string {
  const settings = cloneDefaults();
  settings.debugGraphics = debugGraphics;
  return renderToStaticMarkup(
    <SettingsPanel
      viewer={null}
      overlays={null}
      overlayError={null}
      settings={settings}
      onSettingsChange={vi.fn()}
      onResetDefaults={vi.fn()}
      onClose={vi.fn()}
      benchRunning={false}
      onBench={vi.fn()}
      actorCount={0}
      laneCount={null}
    />,
  );
}

describe('simplified editor settings UI', () => {
  it('exposes Settings in primary chrome without Scene Collections or Inspector', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceHeader
        state={null}
        map={{ id: 'test', label: 'Test map' } as never}
        playback={false}
        openScenario={false}
        settingsOpen={false}
        onSettings={vi.fn()}
        onOpenScenario={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Open settings"');
    expect(markup).toContain('Settings');
    expect(markup).not.toContain('Scene Collection');
    expect(markup).not.toContain('Inspector');
    expect(markup).toContain('Author');
    expect(markup).not.toContain('data-testid="active-physics-mode"');
    expect(markup).not.toContain('Physics · Dynamic');
    expect(markup).not.toContain('>Undo<');
    expect(markup).not.toContain('>Redo<');
    expect(markup).not.toContain('Playback');
  });

  it('uses compatible longhand borders for the active settings control', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceHeader
        state={null}
        map={{ id: 'test', label: 'Test map' } as never}
        playback={false}
        openScenario={false}
        settingsOpen
        onSettings={vi.fn()}
        onOpenScenario={vi.fn()}
      />,
    );
    expect(markup).toContain('border-style:solid');
    expect(markup).toContain('border-color:#f07f2f');
  });

  it('keeps normal class-native dynamic and fixed actor counts out of primary chrome', () => {
    const markup = renderToStaticMarkup(<WorkspaceHeader
      state={null} map={{ id: 'test', label: 'Test map' } as never}
      playback={false} settingsOpen={false} onSettings={vi.fn()}
      physicsSummary={{
        mode: 'dynamic-v1', legacyReplay: false, dynamicCount: 3, staticCount: 1, fallbackCount: 0, unknownCount: 0,
        actors: [
          { id: 'car', label: 'Car', mode: 'dynamic-v1', reason: 'selected', profile: 'car' },
          { id: 'ped', label: 'Walker', mode: 'dynamic-v1', reason: 'selected', profile: 'pedestrian' },
          { id: 'reverse', label: 'Reversing car', mode: 'dynamic-v1', reason: 'selected', profile: 'car' },
          { id: 'barrier', label: 'Barrier', mode: 'fixed-static-v1', reason: 'static-actor', profile: 'fixed-static' },
        ],
      }}
    />);
    expect(markup).not.toContain('data-testid="active-physics-mode"');
    expect(markup).not.toContain('Physics · Dynamic');
  });

  it('retains concise physics warnings for mixed and legacy playback', () => {
    const mixed = renderToStaticMarkup(<WorkspaceHeader
      state={null} map={{ id: 'test', label: 'Test map' } as never}
      playback settingsOpen={false} onSettings={vi.fn()}
      physicsSummary={{
        mode: 'dynamic-v1', legacyReplay: false, dynamicCount: 1, staticCount: 0, fallbackCount: 1, unknownCount: 0,
        actors: [
          { id: 'car', label: 'Car', mode: 'dynamic-v1', reason: 'selected', profile: 'car' },
          { id: 'legacy', label: 'Legacy car', mode: 'kinematic-v1', reason: 'provenance-unavailable' },
        ],
      }}
    />);
    expect(mixed).toContain('Physics · Mixed · 1 exception');
    expect(mixed).toContain('Legacy car');
    expect(mixed).not.toContain('Read-only playback');

    const legacy = renderToStaticMarkup(<WorkspaceHeader
      state={null} map={{ id: 'test', label: 'Test map' } as never}
      playback settingsOpen={false} onSettings={vi.fn()}
      physicsSummary={{ mode: 'kinematic-v1', legacyReplay: true, dynamicCount: 0, staticCount: 0, fallbackCount: 0, unknownCount: 0, actors: [] }}
    />);
    expect(legacy).toContain('Physics · Kinematic legacy');
  });

  it('keeps detailed overlays off, signal orbs on, and diagnostics hidden by default', () => {
    const markup = renderSettings(false);
    expect(markup).toContain('Road overlay');
    expect(markup).toContain('Traffic-light overlay');
    expect(markup.match(/data-testid="overlay-(?:lanes|signals)"/g)).toHaveLength(2);
    expect(markup).toMatch(/data-testid="signal-orbs-visible"[^>]*checked=""/);
    expect(markup).toMatch(/data-testid="signal-orbs-xray"[^>]*checked=""/);
    expect(markup).not.toContain('data-testid="debug-diagnostics"');
    expect(markup).toContain('data-testid="rendering-quality-panel"');
    expect(markup).not.toContain('data-testid="hud"');
    expect(markup).not.toContain('data-testid="ambient-traffic-panel"');
    expect(markup).toContain('Reset defaults');
  });

  it('reveals performance diagnostics only after Debug graphics is enabled', () => {
    const markup = renderSettings(true);
    expect(markup).toContain('data-testid="debug-diagnostics"');
    expect(markup).toContain('data-testid="reset-camera-constraints"');
    expect(markup).toContain('Reset camera / constraints');
    expect(markup).toContain('data-testid="rendering-quality-panel"');
    expect(markup).toContain('data-testid="hud"');
    expect(markup).toContain('data-testid="camera-effective-sensitivities"');
  });

  it('shows versioned camera preferences with the requested defaults and reset', () => {
    const markup = renderSettings(false);
    expect(markup).toContain('data-testid="camera-control-preferences"');
    expect(markup).toContain('Reverse horizontal look');
    expect(markup).toContain('Reverse vertical look');
    expect(markup).toContain('Reverse pan direction');
    expect(markup).toContain('data-testid="camera-control-reverseHorizontalLook" checked=""');
    expect(markup).not.toContain('data-testid="camera-control-reverseVerticalLook" checked=""');
    expect(markup).toContain('data-testid="camera-control-reversePanDirection" checked=""');
    expect(markup).toContain('Q/E direction and WASD direction stay unchanged');
    for (const label of [
      'Horizontal look speed', 'Vertical look speed', 'Middle-drag pan speed',
      'Right-drag pan speed', 'Wheel zoom speed', 'Keyboard movement speed', 'Keyboard turning speed',
    ]) expect(markup).toContain(label);
    expect(markup.match(/type="range"/g)).toHaveLength(7);
    expect(markup.match(/>40%<\/output>/g)).toHaveLength(2);
    expect(markup.match(/>100%<\/output>/g)).toHaveLength(5);
    expect(markup).toContain('data-testid="reset-camera-controls"');
    expect(markup).not.toContain('data-testid="camera-effective-sensitivities"');
  });

  it('renders the complete camera constraint readout only inside diagnostics', () => {
    const markup = renderToStaticMarkup(<CameraDiagnosticsReadout diagnostics={{
      ready: true,
      position: [10, 20, 30],
      target: [1, 2, 3],
      groundY: 4,
      altitudeAgl: 16,
      minAltitude: 6,
      maxAltitude: 28,
      viewDistance: 22.5,
      fov: 55,
      bounds: { minX: -50, maxX: 50, minZ: -100, maxZ: 100, width: 100, height: 200 },
      localBuildingMax: 18,
      headroom: 10,
      clamps: { eyeX: false, eyeY: true, eyeZ: false, targetX: false, targetY: false, targetZ: true },
    }} />);
    expect(markup).toContain('data-testid="camera-diagnostics"');
    expect(markup).toContain('position xyz');
    expect(markup).toContain('height AGL');
    expect(markup).toContain('min altitude');
    expect(markup).toContain('max altitude');
    expect(markup).toContain('map width × height');
    expect(markup).toContain('map x range');
    expect(markup).toContain('map z range');
    expect(markup).toContain('local building max');
    expect(markup).toContain('eyeY, targetZ');
  });
});
