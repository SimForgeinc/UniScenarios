import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CityView } from '@scenario-studio/city-renderer/react';
import type { BenchResult, CityViewer, CityViewerOptions } from '@scenario-studio/city-renderer';
import { Hud } from './Hud';
import { LayerPanel } from './LayerPanel';
import { loadMapOverlays, type MapOverlayHandle, type MapOverlayLayer } from './mapOverlays';

const MAP_BASE = '/dev-assets/yale-street';
const MANIFEST_URL = `${MAP_BASE}/3d/manifest.json`;
const OVERLAY_URLS = {
  xodr: `${MAP_BASE}/map.xodr`,
  manifest: MANIFEST_URL,
  lanePolygons: `${MAP_BASE}/lane-polygons.geojson.gz`,
  signals: `${MAP_BASE}/signals.geojson.gz`,
};

/**
 * Overlay defaults.
 *
 * **Lanes on**: the lane surfaces are the substrate everything else in Scenario
 * Studio is authored against, and they are the fastest way to see that the map
 * is georeferenced correctly. They cost one translucent draw call for all 1,144
 * lanes, so leaving them on is close to free.
 *
 * **Signals off**: the builder emits one `Mesh` per head, so 160 features are
 * ~160 draw calls — a 17% bump on a 967-call frame for markers that are
 * sub-pixel at the default city-wide framing. They earn their cost once you are
 * down at an intersection, which is exactly when you would switch them on.
 */
const OVERLAY_DEFAULTS: Record<MapOverlayLayer, boolean> = { lanes: true, signals: false };

/** Dev knobs: ?debugShadow=1&sse=300&budgetMB=1500&exposure=1.1 */
function optionsFromUrl(): CityViewerOptions {
  const params = new URLSearchParams(window.location.search);
  const num = (key: string): number | undefined => {
    const raw = params.get(key);
    return raw === null || raw === '' ? undefined : Number(raw);
  };
  const budgetMB = num('budgetMB');
  return {
    debugShadowProjection: params.get('debugShadow') === '1',
    maxScreenSpaceError: num('sse'),
    exposure: num('exposure'),
    sunIntensity: num('sun'),
    byteBudget: budgetMB === undefined ? undefined : budgetMB * 1024 * 1024,
    maxPixelRatio: num('dpr'),
  };
}

declare global {
  interface Window {
    __viewer?: CityViewer;
    __bench?: (durationMs?: number) => Promise<BenchResult>;
    /** Map overlays, once they have loaded. Used by the verification harness. */
    __overlays?: MapOverlayHandle;
  }
}

export function App(): JSX.Element {
  const [viewer, setViewer] = useState<CityViewer | null>(null);
  const [overlays, setOverlays] = useState<MapOverlayHandle | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const viewerRef = useRef<CityViewer | null>(null);
  const optionsRef = useRef<CityViewerOptions>(optionsFromUrl());

  const onReady = useCallback((next: CityViewer) => {
    viewerRef.current = next;
    setViewer(next);
  }, []);

  useEffect(() => {
    if (!viewer) return;
    window.__viewer = viewer;
    window.__bench = (durationMs?: number) => {
      setBenchRunning(true);
      return viewer.runBenchmark(durationMs).finally(() => setBenchRunning(false));
    };
    return () => {
      delete window.__viewer;
      delete window.__bench;
    };
  }, [viewer]);

  // Map overlays load themselves once the map has settled; see ./mapOverlays.
  // Nothing here runs before the city is on screen.
  useEffect(() => {
    if (!viewer) return;
    const controller = new AbortController();
    let handle: MapOverlayHandle | null = null;
    loadMapOverlays(viewer, OVERLAY_URLS, {
      signal: controller.signal,
      initialVisibility: OVERLAY_DEFAULTS,
    })
      .then((next) => {
        if (controller.signal.aborted) {
          next.dispose();
          return;
        }
        handle = next;
        window.__overlays = next;
        setOverlays(next);
        console.info('[overlays] ready', next.stats);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err as { name?: string } | null)?.name === 'AbortError') {
          return;
        }
        console.error('[overlays] failed', err);
        setOverlayError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      controller.abort();
      handle?.dispose();
      if (window.__overlays === handle) delete window.__overlays;
      setOverlays(null);
    };
  }, [viewer]);

  return (
    <div style={styles.root}>
      <CityView
        manifestUrl={MANIFEST_URL}
        options={optionsRef.current}
        onReady={onReady}
        style={styles.canvas}
      />
      <Hud viewer={viewer} />
      <LayerPanel
        viewer={viewer}
        overlays={overlays}
        overlayError={overlayError}
        overlayDefaults={OVERLAY_DEFAULTS}
        benchRunning={benchRunning}
        onBench={() => void window.__bench?.()}
      />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    background: '#0b0d10',
    color: '#e6e9ef',
    font: '13px/1.45 ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
  canvas: { position: 'absolute', inset: 0 },
};
