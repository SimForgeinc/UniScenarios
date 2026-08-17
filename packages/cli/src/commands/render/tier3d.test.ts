import { describe, expect, it } from 'vitest';

import { CliError } from '../../errors.js';
import { assertTier3dManifest, buildTier3dExporterArgs } from './tier3d.js';

describe('tier3d exporter orchestration', () => {
  it('builds the all-actors deterministic export command with qualified Vulkan flags', () => {
    const args = buildTier3dExporterArgs({
      instancePath: 'fixture/instance.json',
      tracePath: 'fixture/trace.json.gz',
      outDir: 'fixture/render',
      format: 'both',
      fps: 12,
      fullClip: true,
    }, 'http://127.0.0.1:54321/');

    expect(args).toContain('--all-authored');
    expect(args).toContain('--camera-search');
    expect(args).toContain('--pin-page');
    expect(args).toContain('--full-clip');
    expect(args[args.indexOf('--chrome-flags') + 1]).toBe(
      'use-gl=angle,use-angle=vulkan,enable-features=Vulkan',
    );
    expect(args).not.toContain('--headless');
    expect(args).not.toContain('--no-video');
  });

  it('allows product rendering to frame only the incident pair', () => {
    const args = buildTier3dExporterArgs({
      instancePath: 'instance.json',
      tracePath: 'trace.json.gz',
      outDir: 'render',
      composition: 'incident',
    }, 'http://studio.test/');
    expect(args).not.toContain('--all-authored');
    expect(args).toContain('--camera-search');
  });

  it('turns video encoding off only for stills format', () => {
    const args = buildTier3dExporterArgs({
      instancePath: 'instance.json',
      tracePath: 'trace.json.gz',
      outDir: 'render',
      format: 'stills',
    }, 'http://studio.test/');
    expect(args).toContain('--no-video');
  });

  it('accepts exactly four ordered phases and a passed deterministic manifest', () => {
    expect(() => assertTier3dManifest({
      deterministic: true,
      frames: ['pre-event', 'reveal', 'conflict', 'aftermath'].map((phase) => ({ phase })),
      video: { file: 'video.mp4' },
      machineAssessment: { verdict: 'pass' },
    }, 'both')).not.toThrow();
  });

  it('rejects a missing phase or requested video', () => {
    const base = {
      deterministic: true,
      frames: ['pre-event', 'reveal', 'conflict', 'aftermath'].map((phase) => ({ phase })),
      machineAssessment: { verdict: 'pass' },
    };
    expect(() => assertTier3dManifest({ ...base, frames: base.frames.slice(0, 3) }, 'stills'))
      .toThrowError(CliError);
    expect(() => assertTier3dManifest(base, 'both')).toThrowError(CliError);
  });
});
