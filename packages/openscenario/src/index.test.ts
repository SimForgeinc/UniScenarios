import { describe, expect, it } from 'vitest';

import { exportOpenScenarioXml14 } from './index.js';

describe('@uniscenarios/openscenario public boundary', () => {
  it('exposes the canonical OpenSCENARIO XML exporter', () => {
    expect(exportOpenScenarioXml14).toBeTypeOf('function');
  });
});
