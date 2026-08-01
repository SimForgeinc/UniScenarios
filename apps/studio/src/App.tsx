import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CityView } from '@scenario-studio/city-renderer/react';
import type { BenchResult, CityViewer, CityViewerOptions } from '@scenario-studio/city-renderer';
import { Hud } from './Hud';
import { LayerPanel } from './LayerPanel';

const MANIFEST_URL = '/dev-assets/yale-street/3d/manifest.json';

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
  }
}

export function App(): JSX.Element {
  const [viewer, setViewer] = useState<CityViewer | null>(null);
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
