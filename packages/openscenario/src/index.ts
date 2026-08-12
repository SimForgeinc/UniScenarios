/** Canonical browser-safe OpenSCENARIO API for UniScenarios. */
export * from './export/index.js';
export {
  MAX_XOSC_BYTES,
  OpenScenarioImportError,
  analyzeOpenScenarioImport,
  resolveOpenScenarioMap,
  translateOpenScenarioImport,
  type OpenScenarioImportAnalysis,
  type OpenScenarioImportDiagnostic,
  type OpenScenarioImportMapCandidate,
  type OpenScenarioMapResolution,
} from './import.js';
export type {
  OpenScenarioSnapshot,
  OpenScenarioSourceMapping,
  OpenScenarioValidationStage,
  OpenScenarioValidationStatus,
} from './snapshot.js';
