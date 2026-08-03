import { describe, expect, it } from 'vitest';
import { resolveAmbientTrafficProfile } from '@uniscenarios/sim-engine';
import { buildSumoRouteDocument, decodeSumoActorViews, loadSumoAssets } from './sumoAssets';

describe('SUMO browser assets', () => {
  it('builds a deterministic bounded population and proxy route', () => {
    const profile = resolveAmbientTrafficProfile({ version: 1, preset: 'custom', seed: 'fixed', maxActors: 2 });
    const routes = [['a', 'b'], ['c', 'd'], ['e', 'f']];
    const first = buildSumoRouteDocument(routes, profile);
    expect(first).toBe(buildSumoRouteDocument(routes, profile));
    expect(first).toContain('id="proxy-route"');
    expect(first.match(/<vehicle /g)).toHaveLength(2);
  });

  it('decodes packed browser state into editor coordinates', () => {
    const states = new ArrayBuffer(32);
    const view = new DataView(states);
    view.setUint32(0, 0x1234, true);
    view.setFloat32(4, 10, true);
    view.setFloat32(8, 20, true);
    view.setFloat32(12, 90, true);
    const [actor] = decodeSumoActorViews({ sequence: 1, simulationSeconds: .1, states, actorCount: 1, stepMilliseconds: 2 }, () => 3);
    expect(actor).toMatchObject({ id: 'sumo:00001234', x: 10, y: 3, z: 20, headingRad: 0 });
  });

  it('fails closed when the selected map has no packaged SUMO sidecar', async () => {
    const map = {
      id: 'test-map', label: 'Test map', locality: '', manifest: '', xodr: '', lanePolygons: '', signals: '',
      topology: '', derivedTopology: '', locations: '', sumoManifest: '/missing/sumo-network-manifest.json',
    };
    const profile = resolveAmbientTrafficProfile({ version: 1, preset: 'moderate', seed: 'fixed' });
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('runtime-manifest')) {
        return new Response(JSON.stringify({
          schema: 'uniscenarios.sumo-runtime.v1', sumoVersion: '1.27.1', sumoCommit: 'pin',
          wasmBytes: 1, wasmGzipBytes: 1, licenseNotice: 'notice', sourceOffer: 'source',
        }));
      }
      return new Response('', { status: 404 });
    }) as typeof fetch;
    await expect(loadSumoAssets(map, profile, fetcher)).rejects.toThrow('map sidecar 404');
  });
});
