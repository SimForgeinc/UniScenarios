/** Node-only OpenSCENARIO validation and runnable-bundle APIs. */
export {
  OFFICIAL_OPENSCENARIO_140_XSD,
  validateOpenScenarioXml14,
  type OpenScenarioXml14Validation,
} from './xml-1.4-validation.js';
export {
  ESMINI_BUNDLE_VERSION,
  OFFICIAL_OPENSCENARIO_131_XSD,
  buildEsminiRunnableBundle,
  createServerMapDependencyResolver,
  validateOpenScenarioXml13,
  writeEsminiRunnableBundle,
  type EsminiBundleFile,
  type EsminiBundleManifest,
  type EsminiBundleRequest,
  type EsminiRunnableBundle,
  type FullOpenDriveDependency,
  type MapDependencyResolver,
  type OpenScenarioXsdValidation,
} from './esmini-bundle.js';
