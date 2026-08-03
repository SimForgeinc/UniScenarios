import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, '..');
const root = path.resolve(studio, '../..');
const manifestsDir = path.join(root, 'examples/edge-cases/manifests');
const output = path.join(studio, 'src/campaign/generated.ts');

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function first(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0);
}

function readJson(file) {
  try { return { value: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

function resolveAsset(manifestFile, value) {
  return typeof value === 'string' && value.length > 0 ? path.resolve(path.dirname(manifestFile), value) : undefined;
}

function findSibling(directory, names) {
  return names.map((name) => path.join(directory, name)).find((file) => fs.existsSync(file));
}

function jsonAt(file) {
  return file && fs.existsSync(file) ? readJson(file).value : undefined;
}

function canonical(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(typeof value === 'number' ? value + 0 : value);
}

function rawHash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function invalidHeadingPaths(value, at = '', out = []) {
  if (Array.isArray(value)) value.forEach((item, index) => invalidHeadingPaths(item, `${at}.${index}`, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = at ? `${at}.${key}` : key;
      // Treat the exact boundary conservatively. JSON/validator constants can
      // differ by one ULP; campaign import must fail closed rather than expose
      // a template that TemplateDocument subsequently rejects.
      if ((key === 'headingOffsetRad' || key === 'headingRad') && typeof item === 'number'
        && (item <= -Math.PI || item >= Math.PI)) out.push(next);
      else invalidHeadingPaths(item, next, out);
    }
  }
  return out;
}

function readTrace(file) {
  if (!file || !fs.existsSync(file)) return undefined;
  try { return JSON.parse(gunzipSync(fs.readFileSync(file)).toString('utf8')); }
  catch { return undefined; }
}

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function staticTraceIdentityErrors(input, trace) {
  const actors = Array.isArray(object(input).actors) ? input.actors : [];
  const tracks = object(object(trace).ticks).actors;
  const errors = [];
  for (const actorValue of actors) {
    const actor = object(actorValue);
    if (actor.static !== true || typeof actor.id !== 'string') continue;
    const pose = object(object(actor.initial).pose);
    const track = object(object(tracks)[actor.id]);
    const x = Array.isArray(track.x) ? track.x[0] : undefined;
    const y = Array.isArray(track.y) ? track.y[0] : undefined;
    const heading = Array.isArray(track.headingRad) ? track.headingRad[0] : undefined;
    if (![pose.x, pose.z, x, y].every(Number.isFinite)
      || Math.hypot(x - pose.x, -y - pose.z) > 0.001) {
      errors.push(`static actor ${actor.id} trace pose does not match its instance initial pose`);
      continue;
    }
    if (!Number.isFinite(pose.headingRad) || !Number.isFinite(heading)
      || angleDelta(heading, pose.headingRad) > 0.0001) {
      errors.push(`static actor ${actor.id} trace heading does not match its instance initial heading`);
    }
  }
  return errors;
}

function arrayLength(value) {
  if (Array.isArray(value)) return value.length;
  const record = object(value);
  for (const key of ['matches', 'sites', 'candidates', 'accepted']) {
    if (Array.isArray(record[key])) return record[key].length;
  }
  return undefined;
}

function normalize(rawEntry, manifestFile, manifestOwner) {
  const raw = object(rawEntry);
  const ordinal = Number(raw.ordinal ?? raw.number);
  const slug = first(raw.slug, typeof raw.path === 'string' ? path.basename(raw.path) : undefined) ?? `scenario-${ordinal}`;
  const declaredTemplate = first(raw.template, raw.sourceTemplate);
  const template = resolveAsset(manifestFile, declaredTemplate);
  const directory = template ? path.dirname(template) : path.resolve(path.dirname(manifestFile), first(raw.path, `../${slug}`));
  const instance = resolveAsset(manifestFile, first(raw.instance, raw.sourceInstance, raw.baselineInstance))
    ?? findSibling(directory, ['scenario.instance.json', 'instance.json', 'instance.baseline.json', 'source.instance.json']);
  const trace = resolveAsset(manifestFile, first(raw.trace, raw.sourceTrace, raw.baselineTrace))
    ?? findSibling(directory, ['scenario.trace.json.gz', 'trace.json.gz', 'trace.baseline.json.gz', 'source.trace.json.gz']);
  const rubric = resolveAsset(manifestFile, first(raw.rubric, raw.intentRubric))
    ?? findSibling(directory, ['rubric.json', 'intent-rubric.json']);
  const evidence = resolveAsset(manifestFile, first(raw.evidence, raw.result, raw.review, raw.simulation, raw.sourceSimulation))
    ?? findSibling(directory, ['evidence.json', 'evidence.baseline.json', 'result.json', 'review.json', 'simulation.json', 'source.simulation.json']);
  const provenance = resolveAsset(manifestFile, first(raw.provenance))
    ?? findSibling(directory, ['provenance.json', 'site-provenance.json', 'site.json', 'sites.json']);
  const ambient = resolveAsset(manifestFile, first(raw.ambient, raw.ambientSweep, raw.ambientRobustness))
    ?? findSibling(directory, ['ambient-sweep.json', 'ambient-robustness.json']);
  const variations = resolveAsset(manifestFile, first(raw.siteMatches, raw.sites))
    ?? findSibling(directory, ['site-matches.json', 'sites.json', 'site.json']);
  const studioMeta = resolveAsset(manifestFile, first(
    typeof raw.studio === 'string' ? raw.studio : undefined,
    raw.studioProject,
  )) ?? findSibling(directory, ['studio-project.json', 'studio.json']);

  const templateJson = jsonAt(template);
  const instanceJson = object(jsonAt(instance));
  const traceJson = object(readTrace(trace));
  const evidenceJson = object(jsonAt(evidence));
  const provenanceJson = object(jsonAt(provenance));
  const ambientJson = jsonAt(ambient);
  const variationsJson = jsonAt(variations);
  const studioJson = object(jsonAt(studioMeta));
  const traceInputHash = object(traceJson.header).inputHash;
  const envelope = instanceJson.kind === 'scenario-instance' && object(instanceJson.input);
  const instanceInput = envelope ? object(instanceJson.input) : instanceJson;
  const declaredInputHash = envelope ? object(instanceJson.manifest).inputHash : rawHash(instanceInput);
  const staticIdentityErrors = staticTraceIdentityErrors(instanceInput, traceJson);
  const identity = !instance || !trace ? 'missing'
    : typeof traceInputHash !== 'string' ? 'trace-header-missing'
    : declaredInputHash === traceInputHash
      ? staticIdentityErrors.length > 0
        ? 'static-pose-trace-mismatch'
        : (envelope ? 'exact-envelope' : 'raw-digest-match-runtime-validation')
      : 'stale-input-trace-mismatch';
  const reviewTransfer = object(evidenceJson.transfer);
  const matchCount = Number.isFinite(Number(reviewTransfer.structuralMatches))
    ? Number(reviewTransfer.structuralMatches)
    : arrayLength(variationsJson);
  const matcherDerived = object(provenanceJson.map).matcherDerived;
  const evidenceStatus = String(raw.evidenceStatus ?? raw.status ?? studioJson.status ?? '').toLowerCase();

  let binding = 'unverified';
  if (evidenceStatus.includes('surrogate') || matcherDerived === false) binding = 'pinned-behavioral-surrogate';
  else if ((matchCount ?? 0) > 0 || object(evidenceJson).siteId || object(evidenceJson.source).siteId) binding = 'exact-matched-site';
  else if (instance) binding = 'pinned-behavioral-surrogate';

  let transfer = 'not-verified';
  if (matchCount === 0) transfer = 'zero-transferable-sites';
  else if (typeof matchCount === 'number' && matchCount > 0) transfer = `${matchCount}-verified-site${matchCount === 1 ? '' : 's'}`;

  const diagnostics = [];
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 12) diagnostics.push('ordinal must be an integer from 1 through 12');
  if (!template) diagnostics.push('manifest does not declare a template');
  else if (!fs.existsSync(template)) diagnostics.push(`template is missing: ${path.relative(root, template)}`);
  else if (object(templateJson).scenarioVersion !== 2) diagnostics.push('template is not canonical ScenarioTemplate v2');
  else {
    const invalidHeadings = invalidHeadingPaths(templateJson);
    if (invalidHeadings.length) diagnostics.push(`template has out-of-range heading radians: ${invalidHeadings.slice(0, 3).join(', ')}`);
  }
  if (!instance) diagnostics.push('concrete instance is not declared');
  else if (!fs.existsSync(instance)) diagnostics.push(`instance is missing: ${path.relative(root, instance)}`);
  if (!trace) diagnostics.push('verified trace is not declared');
  else if (!fs.existsSync(trace)) diagnostics.push(`trace is missing: ${path.relative(root, trace)}`);
  if (identity === 'stale-input-trace-mismatch') {
    diagnostics.push(`instance/trace identity is stale (instance ${String(declaredInputHash).slice(0, 12)}…, trace ${String(traceInputHash).slice(0, 12)}…)`);
  } else if (identity === 'static-pose-trace-mismatch') {
    diagnostics.push(...staticIdentityErrors);
  } else if (identity === 'trace-header-missing') diagnostics.push('trace input identity header is missing');
  if (!rubric || !fs.existsSync(rubric)) diagnostics.push('intent rubric is missing');
  if (!evidence || !fs.existsSync(evidence)) diagnostics.push('behavior evidence/review is missing');

  const mapId = first(
    raw.preferredMap,
    raw.preferredMapId,
    object(templateJson).sourceMap?.mapId,
    object(instanceJson.input).mapId,
    studioJson.preferredMapId,
    object(evidenceJson).mapId,
    object(evidenceJson.source).mapId,
    object(provenanceJson.map).mapId,
  );
  if (!mapId) diagnostics.push('map binding cannot be determined');

  return {
    ordinal,
    stableId: first(raw.stableId, raw.projectId, studioJson.projectId, `edge-${String(ordinal).padStart(2, '0')}-${slug}-v1`),
    slug,
    title: first(raw.title, studioJson.displayName, object(templateJson).meta?.name, slug) ?? slug,
    owner: first(raw.owner, manifestOwner, 'unknown') ?? 'unknown',
    status: first(raw.status, raw.evidenceStatus, studioJson.status, 'unknown') ?? 'unknown',
    mapId,
    binding,
    transfer,
    matchCount,
    baseline: identity === 'stale-input-trace-mismatch' || identity === 'static-pose-trace-mismatch' ? 'stale-identity'
      : instance && trace && evidence ? 'declared-evidence-runtime-check' : 'incomplete',
    identity,
    ambient: ambient ? (object(ambientJson).sumoSmoke?.acceptanceOk === true ? 'sumo-smoke-verified' : ambientJson ? 'configured' : 'incomplete') : 'not-run',
    rubric: rubric && evidence ? 'declared-runtime-evidence' : rubric ? 'present-unverified' : 'missing',
    provenance: provenance ? 'present' : 'missing',
    diagnostics,
    assets: { template, instance, trace, rubric, evidence, provenance, ambient, variations },
  };
}

const manifestFiles = fs.existsSync(manifestsDir)
  ? fs.readdirSync(manifestsDir).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(manifestsDir, name))
  : [];
const entries = [];
const campaignDiagnostics = [];
for (const manifestFile of manifestFiles) {
  const parsed = readJson(manifestFile);
  if (parsed.error) {
    campaignDiagnostics.push(`${path.basename(manifestFile)}: invalid JSON: ${parsed.error}`);
    continue;
  }
  const manifest = object(parsed.value);
  const candidates = manifest.entries ?? manifest.projects ?? manifest.scenarios;
  if (!Array.isArray(candidates)) {
    campaignDiagnostics.push(`${path.basename(manifestFile)}: expected entries, projects, or scenarios array`);
    continue;
  }
  for (const candidate of candidates) entries.push(normalize(candidate, manifestFile, first(manifest.owner, manifest.campaign)));
}

entries.sort((a, b) => a.ordinal - b.ordinal || a.slug.localeCompare(b.slug));
const seen = new Set();
for (const entry of entries) {
  if (seen.has(entry.ordinal)) entry.diagnostics.push(`duplicate campaign ordinal ${entry.ordinal}`);
  seen.add(entry.ordinal);
}
for (let ordinal = 1; ordinal <= 12; ordinal++) {
  if (!seen.has(ordinal)) campaignDiagnostics.push(`Scenario ${String(ordinal).padStart(2, '0')}: manifest fragment has not arrived`);
}

const imports = [];
const emitted = entries.map((entry, index) => {
  const assetNames = {};
  for (const [kind, file] of Object.entries(entry.assets)) {
    if (!file || !fs.existsSync(file)) continue;
    const name = `asset_${index}_${kind}`;
    let relative = path.relative(path.dirname(output), file).split(path.sep).join('/');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    imports.push(`import ${name} from ${JSON.stringify(`${relative}?url`)};`);
    assetNames[`${kind}Url`] = name;
  }
  const plain = { ...entry };
  delete plain.assets;
  const fields = Object.entries(assetNames).map(([key, value]) => `${JSON.stringify(key)}: ${value}`).join(', ');
  return `{ ...${JSON.stringify(plain)}, assets: { ${fields} } }`;
});

const source = `/* Generated by scripts/generate-edge-campaign.mjs. Do not hand edit. */\n`
  + `import type { GeneratedCampaignEntry } from './types';\n`
  + `${imports.join('\n')}\n\n`
  + `export const GENERATED_CAMPAIGN_ENTRIES: readonly GeneratedCampaignEntry[] = [\n  ${emitted.join(',\n  ')}\n];\n`
  + `export const GENERATED_CAMPAIGN_DIAGNOSTICS: readonly string[] = ${JSON.stringify(campaignDiagnostics, null, 2)};\n`
  + `export const GENERATED_CAMPAIGN_MANIFEST_COUNT = ${manifestFiles.length};\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, source);
console.log(`edge campaign: ${manifestFiles.length} manifests, ${entries.length}/12 scenarios`);
