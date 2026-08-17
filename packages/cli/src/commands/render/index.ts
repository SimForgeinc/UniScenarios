import path from 'node:path';

import { renderTrace, type TraceRenderResult } from '@uniscenarios/trace-render';

import { boolFlag, optionalNumber, optionalString, parseArgs, requireString } from '../../args.js';
import { CliError, EXIT } from '../../errors.js';
import { emit, emitLines } from '../../output.js';
import { render3d, type Render3dResult } from './tier3d.js';

export type RenderTier = '2d' | '3d' | 'both';
export type RenderFormat = 'stills' | 'video' | 'both';
export type RenderCamera = 'follow-ego' | 'overview';

export interface RenderOptions {
  readonly trace: string;
  readonly instance: string;
  readonly out?: string | undefined;
  readonly tier: RenderTier;
  readonly format: RenderFormat;
  readonly camera: RenderCamera;
  readonly fps: number;
  readonly redact: boolean;
  readonly devAssets?: string | undefined;
  readonly pretty: boolean;
}

export interface RenderCommandResult {
  readonly trace: string;
  readonly instance: string;
  readonly out: string;
  readonly tier: RenderTier;
  readonly format: RenderFormat;
  readonly camera: RenderCamera;
  readonly fps: number;
  readonly tiers: {
    readonly '2d'?: { readonly status: 'rendered'; readonly manifest: string };
    readonly '3d'?: Render3dResult;
  };
}

type MutableRenderTiers = {
  '2d'?: { status: 'rendered'; manifest: string };
  '3d'?: Render3dResult;
};

export function parseRenderArgs(argv: readonly string[]): RenderOptions {
  const args = parseArgs(argv, {
    booleans: ['pretty', 'help', 'redact'],
    values: ['instance', 'out', 'tier', 'format', 'camera', 'fps', 'dev-assets'],
  });
  const trace = args.positionals[0];
  if (trace === undefined) {
    throw new CliError('missing_argument', '<trace.json.gz> is required', { path: 'trace.json.gz' });
  }
  const tier = optionalString(args, 'tier') ?? '2d';
  if (tier !== '2d' && tier !== '3d' && tier !== 'both') {
    throw new CliError('bad_value', '--tier must be 2d | 3d | both', { path: '--tier' });
  }
  const format = optionalString(args, 'format') ?? 'both';
  if (format !== 'stills' && format !== 'video' && format !== 'both') {
    throw new CliError('bad_value', '--format must be stills | video | both', { path: '--format' });
  }
  const camera = optionalString(args, 'camera') ?? 'follow-ego';
  if (camera !== 'follow-ego' && camera !== 'overview') {
    throw new CliError('bad_value', '--camera must be follow-ego | overview', { path: '--camera' });
  }
  const fps = optionalNumber(args, 'fps') ?? 12;
  if (!(fps > 0) || !Number.isFinite(fps)) {
    throw new CliError('bad_value', '--fps must be greater than zero', { path: '--fps' });
  }
  return {
    trace,
    instance: requireString(args, 'instance'),
    out: optionalString(args, 'out'),
    tier,
    format,
    camera,
    fps,
    redact: boolFlag(args, 'redact'),
    devAssets: optionalString(args, 'dev-assets'),
    pretty: boolFlag(args, 'pretty'),
  };
}

export async function render(options: RenderOptions): Promise<number> {
  const out = path.resolve(options.out ?? path.join(path.dirname(options.trace), 'render'));
  const tiers: MutableRenderTiers = {};

  if (options.tier === '2d' || options.tier === 'both') {
    let result: TraceRenderResult;
    try {
      result = await renderTrace({
        instance: options.instance,
        trace: options.trace,
        out: options.tier === 'both' ? path.join(out, '2d') : out,
        format: options.format,
        camera: options.camera,
        fps: options.fps,
        redact: options.redact,
        ...(options.devAssets === undefined ? {} : { devAssets: options.devAssets }),
      });
    } catch (error) {
      throw new CliError('render_failed', error instanceof Error ? error.message : String(error), {
        detail: { tier: '2d' },
      });
    }
    tiers['2d'] = { status: 'rendered', manifest: result.manifestPath };
  }

  if (options.tier === '3d' || options.tier === 'both') {
    tiers['3d'] = await render3d({
      instance: options.instance,
      trace: options.trace,
      out: options.tier === 'both' ? path.join(out, '3d') : out,
      format: options.format,
      camera: options.camera,
      fps: options.fps,
      redact: options.redact,
      ...(options.devAssets === undefined ? {} : { devAssets: options.devAssets }),
    });
  }

  const payload: RenderCommandResult = {
    trace: options.trace,
    instance: options.instance,
    out,
    tier: options.tier,
    format: options.format,
    camera: options.camera,
    fps: options.fps,
    tiers,
  };
  if (options.pretty) {
    const lines = [`render ${options.tier}: ${out}`];
    if (tiers['2d']) lines.push(`  2d  rendered  ${tiers['2d'].manifest}`);
    if (tiers['3d']) lines.push(`  3d  ${tiers['3d'].status}  ${tiers['3d'].reason}`);
    emitLines(lines);
  } else {
    emit(payload, options);
  }
  return EXIT.ok;
}
