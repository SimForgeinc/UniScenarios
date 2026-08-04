import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OpenScenarioWorkspace } from './OpenScenarioWorkspace';
import type { OpenScenarioSnapshot } from './model';

function snapshot(): OpenScenarioSnapshot {
  return {
    version: 1,
    source: { name: 'Crossing scenario', templateHash: 'template-hash-123456789', mapping: [{ sourcePath: 'actors.0', sourceId: 'car', exportKind: 'entity', exportName: 'actor_car', selector: 'ScenarioObject[name="actor_car"]' }] },
    concrete: {
      input: { clipSeconds: 20, dt: 0.02, actors: [{ id: 'car' }], interactions: [], signalPrograms: [] } as never,
      inputHash: 'input-hash-123456789', instanceId: 'instance-1', traceHash: 'trace-hash-123456789',
      traceHeader: {} as never,
      trace: {} as never,
    },
    map: { id: 'yale-street', roadFile: 'yale-street.xodr', xodrDigest: 'xodr-hash-123456789', laneGraphDigest: 'graph-hash-123456789' },
    artifact: {
      state: 'ready', standard: 'ASAM OpenSCENARIO XML 1.4.0', profile: 'xml-1.4-trajectory-replay', intent: 'trajectory-replay', filename: 'crossing-scenario.xosc', mediaType: 'application/xml', content: '<?xml version="1.0"?><OpenSCENARIO/>', warnings: [], issues: [],
      capabilityReport: { profile: 'xml-1.4-trajectory-replay', intent: 'trajectory-replay', roundTrip: 'not-supported', fields: [], summary: { preserved: 1, derived: 2, extension: 3, omitted: 4 }, externalSimulatorValidation: 'not-verified' },
    },
    validation: [
      { id: 'internal-model', label: 'Concrete model', status: 'passed', detail: 'Strict model passed.' },
      { id: 'external-execution', label: 'External execution', status: 'not-run', detail: 'Not run.' },
    ],
  };
}

describe('OpenScenarioWorkspace', () => {
  it('presents the primary interoperability sections and immutable identity', () => {
    const markup = renderToStaticMarkup(<OpenScenarioWorkspace state={{ status: 'ready', sourceHash: 'template-hash-123456789', snapshot: snapshot() }} onRetry={vi.fn()} onClose={vi.fn()} />);
    expect(markup).toContain('OpenSCENARIO');
    expect(markup).toContain('Generated schema');
    expect(markup).toContain('Compatibility');
    expect(markup).toContain('Source mapping');
    expect(markup).toContain('Validation');
    expect(markup).toContain('Files');
    expect(markup).toContain('XML 1.4 artifact ready');
    expect(markup).toContain('yale-street.xodr');
    expect(markup).toContain('Generated source is read-only');
  });

  it('has explicit loading and fail-closed error states', () => {
    const loading = renderToStaticMarkup(<OpenScenarioWorkspace state={{ status: 'loading', sourceHash: 'next' }} onRetry={vi.fn()} onClose={vi.fn()} />);
    expect(loading).toContain('Building exact export snapshot');
    const error = renderToStaticMarkup(<OpenScenarioWorkspace state={{ status: 'error', sourceHash: 'next', message: 'No intent-preserving site' }} onRetry={vi.fn()} onClose={vi.fn()} />);
    expect(error).toContain('Could not prepare this revision');
    expect(error).toContain('No intent-preserving site');
  });

  it('contains the retired drawer validation, provenance and format coverage in OpenSCENARIO', () => {
    const markup = renderToStaticMarkup(<OpenScenarioWorkspace
      state={{ status: 'ready', sourceHash: 'template-hash-123456789', snapshot: snapshot() }}
      initialSection="validation"
      templateValidation={{ ok: false, issues: [{ severity: 'error', path: 'roles[0]', message: 'Missing actor binding' }] } as never}
      physicsSummary={{ mode: 'dynamic-v1', legacyReplay: false, actors: [{ id: 'car', label: 'Sedan 1', mode: 'dynamic-v1', reason: 'selected', profile: 'car' }], dynamicCount: 1, fallbackCount: 0, staticCount: 0, unknownCount: 0 }}
      onRetry={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(markup).toContain('Template validation');
    expect(markup).toContain('Missing actor binding');
    expect(markup).toContain('Physics provenance');
    expect(markup).toContain('Sedan 1');
    expect(markup).toContain('Strict model passed');
    expect(markup).toContain('aria-current="page"');
  });

  it('keeps unsupported editable formats explicit alongside existing download actions', () => {
    const markup = renderToStaticMarkup(<OpenScenarioWorkspace
      state={{ status: 'ready', sourceHash: 'template-hash-123456789', snapshot: snapshot() }}
      initialSection="files"
      onRetry={vi.fn()}
      onClose={vi.fn()}
    />);
    expect(markup).toContain('crossing-scenario.xosc');
    expect(markup).toContain('Download');
    expect(markup).toContain('XML 1.4 · editable actions');
    expect(markup).toContain('DSL 2.2 · editable actions');
    expect(markup).toContain('Not supported');
  });
});
