import {
  contentHash,
  decodeTraceGz,
  safeParseSimScenarioInput,
  traceToSceneFrame,
  TRACE_FORMAT_VERSION,
  type SceneTrace,
  type SimActor,
  type SimScenarioInput,
  type SimTrace,
} from '@uniscenarios/sim-engine';
import {
  getEntry,
  isCatalogId,
  type CatalogId,
  type Dims,
} from '@uniscenarios/prop-catalog';

const TRACE_CHANNELS = ['x', 'y', 'headingRad', 'speedMps', 'laneRsl', 's', 'present'] as const;
const STATIC_CHANNELS = ['x', 'y', 'headingRad', 'speedMps', 'present'] as const;
const KIND_DEFAULTS: Record<SimActor['kind'], CatalogId> = {
  vehicle: 'vehicle.sedan',
  pedestrian: 'pedestrian.adult_walking',
};

export interface PlaybackSource {
  readonly instanceName: string;
  readonly traceName: string;
}

export interface ConcreteInstance {
  readonly kind: 'scenario-instance';
  readonly version: 1;
  readonly manifest: {
    readonly instanceId: string;
    readonly inputHash: string;
    readonly replayKey: { readonly mapId: string; readonly engineGraphDigest?: string };
    readonly actors: Array<{ readonly id: string }>;
    readonly [key: string]: unknown;
  };
  readonly input: SimScenarioInput;
}

export interface PlaybackActor {
  readonly id: string;
  readonly kind: SimActor['kind'];
  readonly static: boolean;
  readonly catalogId: CatalogId;
  readonly modelBasis: 'input-tag' | 'kind-default';
  readonly dims: Dims;
  readonly initial: { readonly x: number; readonly z: number; readonly headingRad: number };
}

export interface PlaybackBundle {
  readonly instance: ConcreteInstance;
  readonly trace: SceneTrace;
  readonly actors: readonly PlaybackActor[];
  readonly signals: readonly PlaybackSignal[];
  readonly source: PlaybackSource;
  readonly startTime: number;
  readonly endTime: number;
}

export interface PlaybackSignal {
  readonly id: string;
  readonly headIds: readonly string[];
  readonly timingSource: 'map' | 'synthetic-default' | 'authored' | 'unbound';
}

export interface PlaybackFile {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface SampledActor {
  readonly id: string;
  readonly catalogId: CatalogId;
  readonly dims: Dims;
  readonly x: number;
  readonly z: number;
  readonly headingRad: number;
  readonly present: boolean;
  readonly static: boolean;
}

export interface SampledSignal extends PlaybackSignal {
  readonly phase: 'green' | 'yellow' | 'red';
}

/** One import failure with all repairable findings, rather than the first opaque throw. */
export class PlaybackLoadError extends Error {
  readonly diagnostics: readonly string[];

  constructor(summary: string, diagnostics: readonly string[]) {
    super(`${summary}:\n${diagnostics.map((item) => `• ${item}`).join('\n')}`);
    this.name = 'PlaybackLoadError';
    this.diagnostics = diagnostics;
  }
}

/** Read a concrete instance and either canonical JSON or gzip trace bytes. */
export async function readPlaybackFiles(
  instanceFile: PlaybackFile,
  traceFile: PlaybackFile,
): Promise<PlaybackBundle> {
  let instanceValue: unknown;
  try {
    const text = new TextDecoder().decode(await instanceFile.arrayBuffer());
    instanceValue = JSON.parse(text);
  } catch (error) {
    throw new PlaybackLoadError(`Could not read instance “${instanceFile.name}”`, [
      `instance JSON is invalid: ${messageOf(error)}`,
      'Choose a concrete *.instance.json file produced by uniscenarios instantiate.',
    ]);
  }

  let traceValue: unknown;
  try {
    const bytes = new Uint8Array(await traceFile.arrayBuffer());
    traceValue = await decodeTraceGz(bytes);
  } catch (error) {
    throw new PlaybackLoadError(`Could not read trace “${traceFile.name}”`, [
      `trace is neither valid plain JSON nor gzip JSON: ${messageOf(error)}`,
      'Choose the matching *.trace.json or *.trace.json.gz file produced by uniscenarios simulate.',
    ]);
  }

  return parsePlaybackPair(instanceValue, traceValue, {
    instanceName: instanceFile.name,
    traceName: traceFile.name,
  });
}

/** Strictly join one concrete instance to the exact trace produced from its input. */
export function parsePlaybackPair(
  instanceValue: unknown,
  traceValue: unknown,
  source: PlaybackSource = { instanceName: 'instance', traceName: 'trace' },
): PlaybackBundle {
  const issues: string[] = [];
  const raw = objectOf(instanceValue);
  if (!raw) {
    throw new PlaybackLoadError('Scenario import failed', [
      `${source.instanceName}: document root must be an object`,
    ]);
  }
  if (raw['kind'] !== 'scenario-instance') {
    issues.push(`${source.instanceName}: kind must be "scenario-instance" (templates and editor autosaves cannot be played)`);
  }
  if (raw['version'] !== 1) issues.push(`${source.instanceName}: version must be 1; got ${String(raw['version'])}`);

  const parsedInput = safeParseSimScenarioInput(raw['input']);
  if (!parsedInput.ok) {
    for (const issue of parsedInput.issues) {
      issues.push(`${source.instanceName}: input.${issue.path || '<root>'}: ${issue.message}`);
    }
  }
  const manifest = objectOf(raw['manifest']);
  if (!manifest) issues.push(`${source.instanceName}: manifest is missing`);

  if (!parsedInput.ok || !manifest) {
    throw new PlaybackLoadError('Scenario import failed', issues);
  }
  const input = parsedInput.value;
  const recomputedHash = contentHash(input);
  const manifestHash = manifest['inputHash'];
  if (manifestHash !== recomputedHash) {
    issues.push(
      `${source.instanceName}: manifest.inputHash ${display(manifestHash)} does not match recomputed input hash ${recomputedHash}`,
    );
  }
  const instanceId = manifest['instanceId'];
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    issues.push(`${source.instanceName}: manifest.instanceId is missing`);
  }

  const replayKey = objectOf(manifest['replayKey']);
  const replayMapId = replayKey?.['mapId'];
  if (replayMapId !== input.mapId) {
    issues.push(
      `${source.instanceName}: manifest.replayKey.mapId ${display(replayMapId)} does not match input.mapId ${input.mapId}`,
    );
  }

  const trace = validateTrace(traceValue, source.traceName, issues);
  if (trace) {
    if (trace.header.inputHash !== recomputedHash) {
      issues.push(
        `${source.traceName}: header.inputHash ${display(trace.header.inputHash)} does not match instance input hash ${recomputedHash}`,
      );
    }
    if (trace.header.mapId !== input.mapId) {
      issues.push(
        `${source.traceName}: header.mapId ${display(trace.header.mapId)} does not match instance input.mapId ${input.mapId}`,
      );
    }
    for (const field of ['clipSeconds', 'warmupSeconds', 'dt'] as const) {
      if (trace.header[field] !== input[field]) {
        issues.push(
          `${source.traceName}: header.${field} ${display(trace.header[field])} does not match instance input.${field} ${input[field]}`,
        );
      }
    }
    const replayGraph = replayKey?.['engineGraphDigest'];
    if (typeof replayGraph === 'string' && trace.header.engineGraphDigest !== replayGraph) {
      issues.push(
        `${source.traceName}: header.engineGraphDigest does not match manifest.replayKey.engineGraphDigest`,
      );
    }
    validateActorIdentity(input, manifest, trace, source, issues);
    validateTracks(input, trace, source.traceName, issues);
    validateSignalTracks(input, trace, source.traceName, issues);
  }

  const actors = mapPlaybackActors(input.actors, source.instanceName, issues);
  const signals = mapPlaybackSignals(input, source.instanceName, issues);
  if (issues.length > 0 || !trace) throw new PlaybackLoadError('Scenario/trace identity validation failed', issues);

  const times = trace.ticks.t;
  const concreteManifest = manifest as ConcreteInstance['manifest'];
  return {
    instance: {
      kind: 'scenario-instance',
      version: 1,
      manifest: concreteManifest,
      input,
    },
    trace: traceToSceneFrame(trace),
    actors,
    signals,
    source,
    startTime: times[0] as number,
    endTime: times[times.length - 1] as number,
  };
}

function validateSignalTracks(
  input: SimScenarioInput,
  trace: SimTrace,
  name: string,
  issues: string[],
): void {
  const expected = input.signalPrograms.map((program) => program.id).sort();
  const actual = Object.keys(trace.ticks.signals ?? {}).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    issues.push(`signal program ids differ: instance input=[${expected.join(',')}] trace tracks=[${actual.join(',')}]`);
  }
  for (const id of expected) {
    const phases = trace.ticks.signals?.[id]?.phase;
    if (!Array.isArray(phases) || phases.length !== trace.ticks.t.length) {
      issues.push(
        `${name}: ticks.signals.${id}.phase length ${Array.isArray(phases) ? phases.length : 'missing'} does not match ticks.t length ${trace.ticks.t.length}`,
      );
      continue;
    }
    if (phases.some((phase) => phase !== 'green' && phase !== 'yellow' && phase !== 'red')) {
      issues.push(`${name}: ticks.signals.${id}.phase contains an unknown phase`);
    }
  }
}

function mapPlaybackSignals(
  input: SimScenarioInput,
  name: string,
  issues: string[],
): PlaybackSignal[] {
  const claimedHeads = new Set<string>();
  return input.signalPrograms.map((program) => {
    const headIds = program.mapBinding?.headIds ?? [];
    for (const headId of headIds) {
      if (claimedHeads.has(headId)) issues.push(`${name}: physical signal head ${headId} is bound by multiple programs`);
      claimedHeads.add(headId);
    }
    return {
      id: program.id,
      headIds,
      timingSource: program.mapBinding?.timingSource ?? 'unbound',
    };
  });
}

function validateTrace(value: unknown, name: string, issues: string[]): SimTrace | null {
  const trace = objectOf(value);
  const header = objectOf(trace?.['header']);
  const ticks = objectOf(trace?.['ticks']);
  const actors = objectOf(ticks?.['actors']);
  const times = ticks?.['t'];
  if (!trace) issues.push(`${name}: trace root must be an object`);
  if (!header) issues.push(`${name}: header is missing`);
  if (!ticks) issues.push(`${name}: ticks is missing`);
  if (!actors) issues.push(`${name}: ticks.actors is missing`);
  if (!Array.isArray(times) || times.length === 0) {
    issues.push(`${name}: ticks.t must be a non-empty array`);
  } else {
    for (let index = 0; index < times.length; index++) {
      if (!Number.isFinite(times[index])) issues.push(`${name}: ticks.t.${index} must be finite`);
      if (index > 0 && Number(times[index]) <= Number(times[index - 1])) {
        issues.push(`${name}: ticks.t must be strictly increasing (index ${index})`);
        break;
      }
    }
  }
  if (header) {
    if (header['traceVersion'] !== TRACE_FORMAT_VERSION) {
      issues.push(`${name}: header.traceVersion must be ${TRACE_FORMAT_VERSION}; got ${display(header['traceVersion'])}`);
    }
    if (header['frame'] !== 'xodr-local') {
      issues.push(`${name}: header.frame must be "xodr-local"; got ${display(header['frame'])}`);
    }
    for (const key of ['inputHash', 'mapId', 'engineGraphDigest'] as const) {
      if (typeof header[key] !== 'string' || header[key].length === 0) {
        issues.push(`${name}: header.${key} is missing`);
      }
    }
    if (!Array.isArray(header['actorIds'])) issues.push(`${name}: header.actorIds must be an array`);
  }
  return trace && header && ticks && actors && Array.isArray(times) && times.length > 0
    ? (value as SimTrace)
    : null;
}

function validateActorIdentity(
  input: SimScenarioInput,
  manifest: Record<string, unknown>,
  trace: SimTrace,
  source: PlaybackSource,
  issues: string[],
): void {
  const inputIds = sortedIds(input.actors.map((actor) => actor.id), `${source.instanceName}: input actor ids`, issues);
  const manifestActors = manifest['actors'];
  const manifestIds = Array.isArray(manifestActors)
    ? sortedIds(manifestActors.map((actor) => objectOf(actor)?.['id']), `${source.instanceName}: manifest actor ids`, issues)
    : (issues.push(`${source.instanceName}: manifest.actors must be an array`), []);
  const headerIds = sortedIds(trace.header.actorIds, `${source.traceName}: header actor ids`, issues);
  const trackIds = Object.keys(trace.ticks.actors).sort();
  compareIds(inputIds, manifestIds, 'instance input', 'manifest', issues);
  compareIds(inputIds, headerIds, 'instance input', 'trace header', issues);
  compareIds(inputIds, trackIds, 'instance input', 'trace tracks', issues);
  if (inputIds.length === 0) issues.push(`${source.instanceName}: input carries zero actors; playback requires at least one`);
}

function validateTracks(
  input: SimScenarioInput,
  trace: SimTrace,
  name: string,
  issues: string[],
): void {
  const count = trace.ticks.t.length;
  for (const actor of input.actors) {
    const track = trace.ticks.actors[actor.id] as unknown as Record<string, unknown> | undefined;
    if (!track) {
      issues.push(`${name}: ticks.actors.${actor.id} is missing`);
      continue;
    }
    for (const channel of TRACE_CHANNELS) {
      const values = track[channel];
      if (!Array.isArray(values) || values.length !== count) {
        issues.push(
          `${name}: ticks.actors.${actor.id}.${channel} length ${Array.isArray(values) ? values.length : 'missing'} does not match ticks.t length ${count}`,
        );
        continue;
      }
      if (channel !== 'laneRsl' && values.some((value) => !Number.isFinite(value))) {
        issues.push(`${name}: ticks.actors.${actor.id}.${channel} contains a non-finite value`);
      }
    }
    if (actor.static) {
      for (const channel of STATIC_CHANNELS) {
        const values = track[channel];
        if (Array.isArray(values) && values.length > 0 && values.some((value) => !Object.is(value, values[0]))) {
          issues.push(`${name}: static actor ${actor.id} changes in channel ${channel}`);
        }
      }
      const x = Array.isArray(track['x']) ? Number(track['x'][0]) : Number.NaN;
      const z = Array.isArray(track['y']) ? -Number(track['y'][0]) : Number.NaN;
      const heading = Array.isArray(track['headingRad']) ? Number(track['headingRad'][0]) : Number.NaN;
      if (
        Number.isFinite(x) && Number.isFinite(z) &&
        Math.hypot(x - actor.initial.pose.x, z - actor.initial.pose.z) > 0.001
      ) {
        issues.push(`${name}: static actor ${actor.id} trace pose does not match its instance initial pose`);
      }
      if (Number.isFinite(heading) && Math.abs(angleDelta(heading, actor.initial.pose.headingRad)) > 0.0001) {
        issues.push(`${name}: static actor ${actor.id} trace heading does not match its instance initial heading`);
      }
    }
  }
}

function mapPlaybackActors(
  inputActors: readonly SimActor[],
  name: string,
  issues: string[],
): PlaybackActor[] {
  const actors: PlaybackActor[] = [];
  for (const actor of inputActors) {
    const catalogTags = actor.tags.filter((tag) => tag.startsWith('catalog:'));
    if (catalogTags.length > 1) {
      issues.push(`${name}: actor ${actor.id} has multiple catalog:* tags (${catalogTags.join(', ')})`);
      continue;
    }
    const explicit = catalogTags[0]?.slice('catalog:'.length);
    const catalogId = explicit ?? KIND_DEFAULTS[actor.kind];
    if (!isCatalogId(catalogId)) {
      issues.push(`${name}: actor ${actor.id} requests unknown Studio catalog model ${display(catalogId)}`);
      continue;
    }
    // Buildability and dimensions are checked by prop-catalog itself; calling
    // getEntry here turns a stale registry id into an import diagnostic.
    getEntry(catalogId);
    actors.push({
      id: actor.id,
      kind: actor.kind,
      static: actor.static,
      catalogId,
      modelBasis: explicit ? 'input-tag' : 'kind-default',
      dims: { l: actor.dims.l, w: actor.dims.w, h: actor.dims.h },
      initial: {
        x: actor.initial.pose.x,
        z: actor.initial.pose.z,
        headingRad: actor.initial.pose.headingRad,
      },
    });
  }
  return actors;
}

export interface SampleBracket {
  readonly lower: number;
  readonly upper: number;
  readonly alpha: number;
  readonly time: number;
}

/** Binary-search the trace and return the two samples surrounding `time`. */
export function sampleBracket(times: readonly number[], time: number): SampleBracket {
  if (times.length === 0) throw new Error('cannot sample an empty trace');
  const clamped = Math.max(times[0] as number, Math.min(times[times.length - 1] as number, time));
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((times[mid] as number) < clamped) lo = mid + 1;
    else hi = mid;
  }
  const upper = lo;
  if ((times[upper] as number) === clamped || upper === 0) {
    return { lower: upper, upper, alpha: 0, time: clamped };
  }
  const lower = upper - 1;
  const span = (times[upper] as number) - (times[lower] as number);
  return { lower, upper, alpha: (clamped - (times[lower] as number)) / span, time: clamped };
}

/** Interpolate dynamic poses; static actors always retain their authored instance pose. */
export function samplePlaybackActors(bundle: PlaybackBundle, time: number): SampledActor[] {
  const bracket = sampleBracket(bundle.trace.ticks.t, time);
  return bundle.actors.map((actor) => {
    const track = bundle.trace.ticks.actors[actor.id];
    if (!track) throw new Error(`validated trace lost actor track ${actor.id}`);
    const present = Number(track.present[bracket.lower]) !== 0;
    if (actor.static) {
      return {
        id: actor.id,
        catalogId: actor.catalogId,
        dims: actor.dims,
        x: actor.initial.x,
        z: actor.initial.z,
        headingRad: actor.initial.headingRad,
        present,
        static: true,
      };
    }
    return {
      id: actor.id,
      catalogId: actor.catalogId,
      dims: actor.dims,
      x: lerp(track.x[bracket.lower] as number, track.x[bracket.upper] as number, bracket.alpha),
      z: lerp(track.z[bracket.lower] as number, track.z[bracket.upper] as number, bracket.alpha),
      headingRad: lerpHeading(
        track.headingRad[bracket.lower] as number,
        track.headingRad[bracket.upper] as number,
        bracket.alpha,
      ),
      present,
      static: false,
    };
  });
}

/** Sample discrete signal phases at the same trace bracket as actor transforms. */
export function samplePlaybackSignals(bundle: PlaybackBundle, time: number): SampledSignal[] {
  const bracket = sampleBracket(bundle.trace.ticks.t, time);
  return bundle.signals.map((signal) => {
    const phase = bundle.trace.ticks.signals?.[signal.id]?.phase[bracket.lower];
    if (!phase) throw new Error(`validated trace lost signal track ${signal.id}`);
    return { ...signal, phase };
  });
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function lerpHeading(a: number, b: number, alpha: number): number {
  return a + angleDelta(b, a) * alpha;
}

function sortedIds(values: readonly unknown[], label: string, issues: string[]): string[] {
  if (values.some((id) => typeof id !== 'string' || id.length === 0)) {
    issues.push(`${label} must contain only non-empty strings`);
  }
  const ids = values.filter((id): id is string => typeof id === 'string' && id.length > 0).sort();
  if (new Set(ids).size !== ids.length) issues.push(`${label} contains duplicates`);
  return ids;
}

function compareIds(
  expected: readonly string[],
  actual: readonly string[],
  expectedLabel: string,
  actualLabel: string,
  issues: string[],
): void {
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    issues.push(`actor ids differ: ${expectedLabel}=[${expected.join(',')}] ${actualLabel}=[${actual.join(',')}]`);
  }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function display(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value ?? '<missing>');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
