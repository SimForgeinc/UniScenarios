/**
 * `@uniscenarios/cli` — layer 4 of `docs/agent-authoring-architecture.md`.
 *
 * The `uniscenarios` binary is the product; this module is its library face, so the
 * editor, the workflows in layer 5 and the tests can call the same code paths
 * without shelling out.
 *
 * ```ts
 * import { loadMap, matchOnMap, materialize } from '@uniscenarios/cli';
 *
 * const bundle = await loadMap('yale-street');
 * const { report } = await matchOnMap(template, 'yale-street');
 * const { input, manifest } = materialize(template, bundle, report.sites[0]!, { drawIndex: 0 });
 * ```
 *
 * @packageDocumentation
 */

export { run } from './main.js';

export {
  CliError,
  EXIT,
  exitCodeOf,
  toStructuredError,
  type StructuredError,
} from './errors.js';

export {
  ARTIFACTS,
  DEV_ASSETS,
  KNOWN_MAPS,
  REPO_ROOT,
  artifactPresence,
  assertKnownMap,
  availableMaps,
  loadMap,
  mapDir,
  resolveMapSelection,
  type MapArtifactPresence,
  type MapBundle,
} from './maps.js';

export {
  buildSiteSignalPlan,
  defaultPhasesForHead,
  loadMapSignalCatalog,
  parseMapSignalCatalog,
  SYNTHETIC_SIGNAL_OFFSET_S,
  type MapSignalCatalog,
  type MapSignalController,
  type MapSignalHead,
  type MapSignalJunction,
  type SiteSignalPlan,
} from './map-signals.js';

export {
  OPEN_END_M,
  adaptTemplate,
  numberish,
  templateCrossingAngle,
  templateStaticScope,
  type AdaptNote,
  type AdaptedAnchor,
} from './adapt.js';

export {
  cellSeed,
  discreteValues,
  paramsVersion,
  resolveParams,
  templateId,
  type ParamDraw,
} from './params.js';

export {
  mapSetKey,
  materialize,
  type InstanceManifest,
  type MaterializeOptions,
  type MaterializeResult,
  type ReplayKey,
} from './materialize.js';

export { createMapContext } from './map-context.js';

export {
  findSite,
  matchOnMap,
  matchOnMaps,
  siteSummary,
  type SiteMatch,
} from './sites.js';

export {
  checkInvariants,
  type InvariantContext,
  type InvariantResidualReport,
} from './invariants.js';

export {
  cellPaths,
  runCell,
  type CellCoords,
  type CellOptions,
  type CellResult,
} from './batch-cell.js';

export {
  detectKind,
  readInstance,
  readTemplate,
  readTraceFile,
  writeJsonFile,
  writeTraceFile,
  type InstanceFile,
} from './template-io.js';

export { PROP_DIMS, propDims, type PropDims } from './prop-dims.js';

export {
  CATALOG_GENERATOR_VERSION,
  CATALOG_KIND,
  CATALOG_RESEARCH_SOURCES,
  CATALOG_SLOTS_PER_MAP,
  CATALOG_TEMPLATE_SOURCES,
  CATALOG_VERSION,
  DEFAULT_CATALOG_NAMESPACE,
  INCIDENT_DOMAINS,
  INCIDENT_TAXONOMY,
  OPERATIONAL_VARIANTS,
  createScenarioCatalog,
  validateScenarioCatalog,
  type CatalogAcceptanceCheck,
  type CatalogEvidencePaths,
  type CatalogIssue,
  type CatalogMapProvenance,
  type CatalogProgressCounts,
  type CatalogSiteBinding,
  type CatalogSlotStatus,
  type CatalogTemplateProvenance,
  type CatalogValidationReport,
  type ScenarioCatalogManifest,
  type ScenarioCatalogSlot,
} from './catalog.js';

export { criticalityBand, filtersFor, type EvaluateFilterMode } from './commands/evaluate.js';
export { metricsSummary } from './commands/simulate.js';
export { SCHEMAS, type SchemaEntry } from './commands/schemas.js';

export {
  ASAM_FORMATS,
  AsamExportError,
  exportAsamScenario,
  exportOpenScenarioDsl22,
  exportOpenScenarioXml14,
  type AsamExportIssue,
  type AsamExportOptions,
  type AsamExportResult,
  type AsamExportWarning,
  type AsamFormat,
} from './asam/index.js';
