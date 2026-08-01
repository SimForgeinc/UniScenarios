/**
 * `uniscenarios` — the agent CLI (layer 4 of `docs/agent-authoring-architecture.md`).
 *
 * Contract, in three lines:
 *
 * - **stdout is JSON** unless `--pretty`; stderr carries the structured error.
 * - **exit 0** ok · **1** the command could not run · **2** it ran and found
 *   something wrong with the input (schema issues, no site, infeasible cell,
 *   a rejected trace). Callers key repair loops off that distinction.
 * - **every error is `{code, path?, reason, detail?}`**, JSON, on stderr.
 */

import {
  boolFlag,
  listFlag,
  optionalInt,
  optionalNumber,
  optionalString,
  pairsFlag,
  parseArgs,
  requireString,
  type ParsedArgs,
} from './args.js';
import { CliError, EXIT, exitCodeOf, toStructuredError } from './errors.js';
import { emit, emitError } from './output.js';
import { availableMaps, resolveMapSelection } from './maps.js';
import { batch } from './commands/batch.js';
import { catalogCreate, catalogVerify } from './commands/catalog.js';
import { evaluate, type EvaluateFilterMode } from './commands/evaluate.js';
import { evidenceVerify } from './commands/evidence.js';
import { exportScenario } from './commands/export.js';
import { instantiate } from './commands/instantiate.js';
import { locationsFind, locationsGet, locationsResolve } from './commands/locations.js';
import { mapsList } from './commands/maps.js';
import { schemas } from './commands/schemas.js';
import { simulate } from './commands/simulate.js';
import { sitesMatch } from './commands/sites.js';
import { templateValidate } from './commands/template.js';
import { validate } from './commands/validate.js';

const COMMANDS = [
  { name: 'maps list', summary: 'the five dev maps, their artifacts and catalog revisions' },
  { name: 'locations find', summary: 'structured location query: --map --type --facts --near …' },
  { name: 'locations get', summary: 'one location by handle or id, optionally --describe' },
  { name: 'locations resolve', summary: 'free text → ranked handles' },
  { name: 'template validate', summary: 'schema + tier-1, with map checks when --map is given' },
  { name: 'sites match', summary: 'anchor → ranked concrete sites on one map or --all-maps' },
  { name: 'instantiate', summary: 'template × site × draw → a concrete SimScenarioInput' },
  { name: 'simulate', summary: 'one engine pass over an instance, with an optional trace' },
  { name: 'validate', summary: 'tier-1, or tier-2 (one engine pass + invariant residuals)' },
  { name: 'evaluate', summary: 'reject filters over a trace' },
  { name: 'evidence verify', summary: 'prove one instance/trace pair shares the same input hash' },
  { name: 'export', summary: 'concrete instance → ASAM OpenSCENARIO XML 1.4.0 or DSL 2.2.0' },
  { name: 'catalog create', summary: 'reserve exactly 100 deterministic scenario identities per supported map' },
  { name: 'catalog verify', summary: 'reject catalog identity, cardinality, provenance, or evidence gaps' },
  { name: 'batch', summary: 'sites × draws matrix: instantiate → simulate → evaluate' },
  { name: 'schemas', summary: 'the published JSON Schemas — the LLM emission contract' },
] as const;

const GLOBAL_BOOLEANS = ['pretty', 'help'];

function usage(pretty: boolean): number {
  const payload = {
    bin: 'uniscenarios',
    exitCodes: { 0: 'ok', 1: 'command error', 2: 'validation findings' },
    commands: COMMANDS,
    maps: availableMaps(),
  };
  if (!pretty) {
    emit(payload, { pretty: false });
  } else {
    process.stdout.write(
      [
        'uniscenarios — UniScenarios agent CLI (`scen` remains an alias)',
        '',
        ...COMMANDS.map((c) => `  uniscenarios ${c.name.padEnd(20)}${c.summary}`),
        '',
        '  --pretty   human-readable rendering of the same result',
        `  maps: ${availableMaps().join(', ')}`,
        '',
      ].join('\n'),
    );
  }
  return EXIT.ok;
}

function filterMode(args: ParsedArgs): EvaluateFilterMode {
  const raw = optionalString(args, 'filter') ?? 'critical';
  if (raw !== 'critical' && raw !== 'negative-control' && raw !== 'all') {
    throw new CliError('bad_value', '--filter must be critical | negative-control | all', {
      path: '--filter',
    });
  }
  return raw;
}

function positional(args: ParsedArgs, index: number, name: string): string {
  const value = args.positionals[index];
  if (value === undefined) {
    throw new CliError('missing_argument', `<${name}> is required`, { path: name });
  }
  return value;
}

async function dispatch(argv: readonly string[]): Promise<number> {
  const head = argv[0];
  if (head === undefined || head === '--help' || head === 'help') {
    return usage(argv.includes('--pretty'));
  }

  const sub = argv[1];

  switch (head) {
    case 'maps': {
      const args = parseArgs(argv.slice(2), { booleans: GLOBAL_BOOLEANS });
      if (sub !== 'list') {
        throw new CliError('unknown_command', `uniscenarios maps ${sub ?? ''}`.trim(), {
          detail: { known: ['list'] },
        });
      }
      return mapsList({ pretty: boolFlag(args, 'pretty') });
    }

    case 'locations': {
      if (sub === 'find') {
        const args = parseArgs(argv.slice(2), {
          booleans: GLOBAL_BOOLEANS,
          values: [
            'map',
            'type',
            'subtype',
            'tags',
            'affordances',
            'facts',
            'near',
            'within-m',
            'limit',
            'diversity-m',
          ],
        });
        return locationsFind({
          mapId: requireString(args, 'map'),
          type: listFlag(args, 'type'),
          subtype: listFlag(args, 'subtype'),
          tags: listFlag(args, 'tags'),
          affordances: listFlag(args, 'affordances'),
          facts: pairsFlag(args, 'facts'),
          near: optionalString(args, 'near'),
          withinM: optionalNumber(args, 'within-m'),
          limit: optionalInt(args, 'limit'),
          diversityM: optionalNumber(args, 'diversity-m'),
          pretty: boolFlag(args, 'pretty'),
        });
      }
      if (sub === 'get') {
        const args = parseArgs(argv.slice(2), {
          booleans: [...GLOBAL_BOOLEANS, 'describe'],
          values: ['map'],
        });
        return locationsGet({
          mapId: requireString(args, 'map'),
          ref: positional(args, 0, 'handleOrId'),
          describe: boolFlag(args, 'describe'),
          pretty: boolFlag(args, 'pretty'),
        });
      }
      if (sub === 'resolve') {
        const args = parseArgs(argv.slice(2), {
          booleans: GLOBAL_BOOLEANS,
          values: ['map', 'limit'],
        });
        return locationsResolve({
          mapId: requireString(args, 'map'),
          text: args.positionals.join(' '),
          limit: optionalInt(args, 'limit'),
          pretty: boolFlag(args, 'pretty'),
        });
      }
      throw new CliError('unknown_command', `uniscenarios locations ${sub ?? ''}`.trim(), {
        detail: { known: ['find', 'get', 'resolve'] },
      });
    }

    case 'template': {
      if (sub !== 'validate') {
        throw new CliError('unknown_command', `uniscenarios template ${sub ?? ''}`.trim(), {
          detail: { known: ['validate'] },
        });
      }
      const args = parseArgs(argv.slice(2), {
        booleans: GLOBAL_BOOLEANS,
        values: ['map', 'site'],
      });
      return templateValidate({
        file: positional(args, 0, 'file'),
        mapId: optionalString(args, 'map'),
        siteId: optionalString(args, 'site'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'sites': {
      if (sub !== 'match') {
        throw new CliError('unknown_command', `uniscenarios sites ${sub ?? ''}`.trim(), {
          detail: { known: ['match'] },
        });
      }
      const args = parseArgs(argv.slice(2), {
        booleans: [...GLOBAL_BOOLEANS, 'all-maps', 'rejected'],
        values: ['map', 'maps', 'min-score', 'max-sites'],
      });
      return sitesMatch({
        file: positional(args, 0, 'template.json'),
        mapIds: resolveMapSelection({
          map: optionalString(args, 'map'),
          maps: listFlag(args, 'maps'),
          allMaps: boolFlag(args, 'all-maps'),
        }),
        minScore: optionalNumber(args, 'min-score'),
        maxSites: optionalInt(args, 'max-sites'),
        includeRejected: boolFlag(args, 'rejected'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'instantiate': {
      const args = parseArgs(argv.slice(1), {
        booleans: GLOBAL_BOOLEANS,
        values: ['map', 'site', 'seed', 'draw', 'out'],
      });
      return instantiate({
        file: positional(args, 0, 'template.json'),
        mapId: requireString(args, 'map'),
        siteId: requireString(args, 'site'),
        seed: optionalString(args, 'seed'),
        draw: optionalInt(args, 'draw'),
        out: optionalString(args, 'out'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'simulate': {
      const args = parseArgs(argv.slice(1), {
        booleans: GLOBAL_BOOLEANS,
        values: ['trace'],
      });
      return simulate({
        file: positional(args, 0, 'instance.json'),
        trace: optionalString(args, 'trace'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'validate': {
      const args = parseArgs(argv.slice(1), {
        booleans: GLOBAL_BOOLEANS,
        values: ['tier', 'map', 'site', 'draw', 'seed'],
      });
      const tier = optionalInt(args, 'tier') ?? 1;
      if (tier !== 1 && tier !== 2) {
        throw new CliError('bad_value', '--tier must be 1 or 2', { path: '--tier' });
      }
      return validate({
        file: positional(args, 0, 'instance|template'),
        tier,
        mapId: optionalString(args, 'map'),
        siteId: optionalString(args, 'site'),
        draw: optionalInt(args, 'draw'),
        seed: optionalString(args, 'seed'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'evaluate': {
      const args = parseArgs(argv.slice(1), {
        booleans: [...GLOBAL_BOOLEANS, 'reject-collisions'],
        values: ['filter', 'trivial-ttc'],
      });
      return evaluate({
        file: positional(args, 0, 'trace'),
        filter: filterMode(args),
        trivialTtcS: optionalNumber(args, 'trivial-ttc'),
        rejectCollisions: boolFlag(args, 'reject-collisions'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'export': {
      const args = parseArgs(argv.slice(1), {
        booleans: GLOBAL_BOOLEANS,
        values: ['format', 'out', 'road-file', 'author', 'description', 'route-sample-m'],
      });
      const format = requireString(args, 'format');
      if (format !== 'xosc-1.4' && format !== 'osc-2.2') {
        throw new CliError('bad_value', '--format must be xosc-1.4 | osc-2.2', {
          path: '--format',
          detail: { known: ['xosc-1.4', 'osc-2.2'] },
        });
      }
      return exportScenario({
        file: positional(args, 0, 'instance.json'),
        format,
        out: requireString(args, 'out'),
        roadFile: optionalString(args, 'road-file'),
        author: optionalString(args, 'author'),
        description: optionalString(args, 'description'),
        routeSampleM: optionalNumber(args, 'route-sample-m'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'evidence': {
      if (sub !== 'verify') {
        throw new CliError('unknown_command', `uniscenarios evidence ${sub ?? ''}`.trim(), {
          detail: { known: ['verify'] },
        });
      }
      const args = parseArgs(argv.slice(2), { booleans: GLOBAL_BOOLEANS });
      return evidenceVerify({
        instance: positional(args, 0, 'instance.json'),
        trace: positional(args, 1, 'trace.json.gz'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'catalog': {
      if (sub === 'create') {
        const args = parseArgs(argv.slice(2), {
          booleans: GLOBAL_BOOLEANS,
          values: ['out', 'namespace', 'evidence-root'],
        });
        return catalogCreate({
          out: requireString(args, 'out'),
          namespace: optionalString(args, 'namespace'),
          evidenceRoot: optionalString(args, 'evidence-root'),
          pretty: boolFlag(args, 'pretty'),
        });
      }
      if (sub === 'verify') {
        const args = parseArgs(argv.slice(2), {
          booleans: [...GLOBAL_BOOLEANS, 'require-evidence'],
          values: ['evidence-root'],
        });
        return catalogVerify({
          file: positional(args, 0, 'catalog.json'),
          evidenceRoot: optionalString(args, 'evidence-root'),
          requireEvidence: boolFlag(args, 'require-evidence'),
          pretty: boolFlag(args, 'pretty'),
        });
      }
      throw new CliError('unknown_command', `uniscenarios catalog ${sub ?? ''}`.trim(), {
        detail: { known: ['create', 'verify'] },
      });
    }

    case 'batch': {
      const args = parseArgs(argv.slice(1), {
        booleans: [...GLOBAL_BOOLEANS, 'all-maps', 'force', 'no-trace'],
        values: [
          'map',
          'maps',
          'draws',
          'out',
          'min-score',
          'max-sites',
          'concurrency',
          'filter',
          'trivial-ttc',
        ],
      });
      return batch({
        file: positional(args, 0, 'template.json'),
        mapIds: resolveMapSelection({
          map: optionalString(args, 'map'),
          maps: listFlag(args, 'maps'),
          allMaps: boolFlag(args, 'all-maps'),
        }),
        draws: optionalInt(args, 'draws') ?? 1,
        outDir: requireString(args, 'out'),
        minScore: optionalNumber(args, 'min-score'),
        maxSites: optionalInt(args, 'max-sites'),
        concurrency: optionalInt(args, 'concurrency'),
        writeTrace: !boolFlag(args, 'no-trace'),
        filter: filterMode(args),
        trivialTtcS: optionalNumber(args, 'trivial-ttc'),
        force: boolFlag(args, 'force'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    case 'schemas': {
      const args = parseArgs(argv.slice(1), {
        booleans: [...GLOBAL_BOOLEANS, 'content'],
        values: ['name'],
      });
      return schemas({
        name: optionalString(args, 'name'),
        content: boolFlag(args, 'content'),
        pretty: boolFlag(args, 'pretty'),
      });
    }

    default:
      throw new CliError('unknown_command', `no command "${head}"`, {
        detail: { known: COMMANDS.map((c) => c.name) },
      });
  }
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    emitError(toStructuredError(error));
    return exitCodeOf(error);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('main.ts') ||
    process.argv[1].endsWith('scen.js') ||
    process.argv[1].endsWith('uniscenarios.js'));

if (invokedDirectly) {
  process.exitCode = await run(process.argv.slice(2));
}
