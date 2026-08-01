import type { SimScenarioInput } from '@uniscenarios/sim-engine';

import { exportOpenScenarioDsl22 } from './dsl-2.2.js';
import type { AsamExportOptions, AsamExportResult, AsamFormat } from './types.js';
import { exportOpenScenarioXml14 } from './xml-1.4.js';

export { exportOpenScenarioDsl22 } from './dsl-2.2.js';
export { exportOpenScenarioXml14 } from './xml-1.4.js';
export {
  ASAM_FORMATS,
  AsamExportError,
  type AsamExportIssue,
  type AsamExportOptions,
  type AsamExportResult,
  type AsamExportWarning,
  type AsamFormat,
} from './types.js';

export function exportAsamScenario(
  format: AsamFormat,
  input: SimScenarioInput,
  options: AsamExportOptions,
): AsamExportResult {
  return format === 'xosc-1.4'
    ? exportOpenScenarioXml14(input, options)
    : exportOpenScenarioDsl22(input, options);
}
