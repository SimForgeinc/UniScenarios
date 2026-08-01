/**
 * A ~90-line argument parser, deliberately not a framework.
 *
 * The whole surface is `--flag`, `--key value`, `--key=value` and positionals.
 * A dependency would buy help formatting we do not want (the help output here
 * is JSON so an agent can read the command surface) and cost a resolution step
 * in a repo whose packages are consumed as TypeScript source.
 *
 * Unknown flags are an **error**, not a warning: a typo'd `--limt 5` that
 * silently returns 25 results is exactly the failure an unattended loop cannot
 * detect.
 */

import { CliError } from './errors.js';

export interface ParsedArgs {
  readonly positionals: string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

export interface OptionSpec {
  /** Flags that take no value. */
  readonly booleans?: readonly string[];
  /** Flags that take a value. */
  readonly values?: readonly string[];
}

export function parseArgs(argv: readonly string[], spec: OptionSpec): ParsedArgs {
  const booleans = new Set(spec.booleans ?? []);
  const values = new Set(spec.values ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined;
    if (booleans.has(name)) {
      if (inline !== undefined) {
        flags[name] = inline !== 'false' && inline !== '0';
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (values.has(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined) {
        throw new CliError('missing_value', `--${name} requires a value`, { path: `--${name}` });
      }
      flags[name] = value;
      continue;
    }
    throw new CliError('unknown_flag', `unknown flag --${name}`, {
      path: `--${name}`,
      detail: { known: [...booleans, ...values].sort() },
    });
  }
  return { positionals, flags };
}

/** Required string flag. */
export function requireString(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CliError('missing_option', `--${name} is required`, { path: `--${name}` });
  }
  return value;
}

export function optionalString(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

export function optionalNumber(args: ParsedArgs, name: string): number | undefined {
  const raw = optionalString(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new CliError('bad_value', `--${name} must be a number, got "${raw}"`, {
      path: `--${name}`,
    });
  }
  return value;
}

export function optionalInt(args: ParsedArgs, name: string): number | undefined {
  const value = optionalNumber(args, name);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) {
    throw new CliError('bad_value', `--${name} must be an integer, got "${value}"`, {
      path: `--${name}`,
    });
  }
  return value;
}

/** Comma-separated list flag (`--maps a,b,c`). */
export function listFlag(args: ParsedArgs, name: string): string[] | undefined {
  const raw = optionalString(args, name);
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** `--facts k=v --facts k2=v2` style repeated pairs, collected from one string. */
export function pairsFlag(args: ParsedArgs, name: string): Array<[string, string]> {
  const raw = optionalString(args, name);
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq < 0) {
        throw new CliError('bad_value', `--${name} entries must be key=value, got "${entry}"`, {
          path: `--${name}`,
        });
      }
      return [entry.slice(0, eq), entry.slice(eq + 1)] as [string, string];
    });
}
