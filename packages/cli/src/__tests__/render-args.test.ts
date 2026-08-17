import { describe, expect, it } from 'vitest';

import { CliError } from '../errors.js';
import { parseRenderArgs } from '../commands/render/index.js';

describe('uniscenarios render argument parsing', () => {
  it('applies the documented 2D defaults', () => {
    expect(parseRenderArgs(['trace.json.gz', '--instance', 'instance.json'])).toEqual({
      trace: 'trace.json.gz',
      instance: 'instance.json',
      out: undefined,
      tier: '2d',
      format: 'both',
      camera: 'follow-ego',
      fps: 12,
      redact: false,
      devAssets: undefined,
      pretty: false,
    });
  });

  it('parses every P1 render option', () => {
    expect(parseRenderArgs([
      'trace.json.gz', '--instance=instance.json', '--out', 'artifacts', '--tier', 'both',
      '--format', 'video', '--camera', 'overview', '--fps', '24', '--redact',
      '--dev-assets', 'dev-assets', '--pretty',
    ])).toEqual({
      trace: 'trace.json.gz',
      instance: 'instance.json',
      out: 'artifacts',
      tier: 'both',
      format: 'video',
      camera: 'overview',
      fps: 24,
      redact: true,
      devAssets: 'dev-assets',
      pretty: true,
    });
  });

  it.each([
    [['trace', '--instance', 'instance', '--tier', '4d'], '--tier'],
    [['trace', '--instance', 'instance', '--format', 'gif'], '--format'],
    [['trace', '--instance', 'instance', '--camera', 'orbit'], '--camera'],
    [['trace', '--instance', 'instance', '--fps', '0'], '--fps'],
  ] as const)('rejects invalid values at %s', (argv, expectedPath) => {
    expect(() => parseRenderArgs(argv)).toThrowError(CliError);
    try {
      parseRenderArgs(argv);
    } catch (error) {
      expect((error as CliError).path).toBe(expectedPath);
    }
  });
});
