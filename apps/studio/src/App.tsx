import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CityView } from '@scenario-studio/city-renderer/react';
import type { BenchResult, CityViewer, CityViewerOptions } from '@scenario-studio/city-renderer';
import type { CatalogId } from '@scenario-studio/prop-catalog';
import { Hud } from './Hud';
import { LayerPanel } from './LayerPanel';
import { loadMapOverlays, type MapOverlayHandle, type MapOverlayLayer } from './mapOverlays';
import { MAPS, initialMapId, mapById, rememberMapId, type MapEntry } from './maps';
import { useEditor } from './editor/useEditor';
import { Inspector, MapPicker, Palette, StatusBar } from './editor/ui';
import type { EditorController } from './editor/controller';

/**
 * Overlay defaults.
 *
 * **Lanes on**: the lane surfaces are the substrate everything else in Scenario
 * Studio is authored against, and they are the fastest way to see that the map
 * is georeferenced correctly. They cost one translucent draw call for all 1,144
 * lanes, so leaving them on is close to free.
 *
 * **Signals on**: they used to be one `Mesh` per head — ~160 draw calls, which
 * is why they shipped off. `buildSignalOverlay` now instances per category, so
 * Yale Street's 160 features cost **13 draws** (measured: 967 -> 980 at the
 * default framing). At that price the signalised intersections are worth seeing
 * without hunting for a toggle, which is the whole point of authoring against
 * them.
 */
const OVERLAY_DEFAULTS: Record<MapOverlayLayer, boolean> = { lanes: true, signals: true };

/** Dev knobs: ?debugShadow=1&sse=300&budgetMB=1500&exposure=1.1&map=yale-street */
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
    /** Switch maps from the harness; resolves when the new map is on screen. */
    __setMap?: (mapId: string) => void;
    /** Which map is mounted right now. */
    __mapId?: string;
  }
}

export function App(): JSX.Element {
  const [mapId, setMapId] = useState(initialMapId);
  const map = mapById(mapId) ?? (MAPS[0] as MapEntry);

  /**
   * The viewer, tagged with the map it was built for.
   *
   * `CityView` is keyed on the map, so a switch unmounts it (disposing the old
   * viewer) and mounts a fresh one. Between those two moments the `viewer` state
   * still points at the disposed instance, and every effect downstream — overlay
   * load, ground index, editor — would happily attach to it. Tagging and
   * comparing makes `viewer` *derived* rather than a second source of truth: it
   * is `null` for exactly the duration of the swap, with no reset effect that
   * could race the child's `onReady`.
   */
  const [session, setSession] = useState<{ viewer: CityViewer; mapId: string } | null>(null);
  const [overlays, setOverlays] = useState<MapOverlayHandle | null>(null);
  const [overlayError, setOverlayError] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<CityViewerOptions>(optionsFromUrl());
  const pendingMapId = useRef(mapId);
  pendingMapId.current = mapId;

  const viewer = session && session.mapId === mapId ? session.viewer : null;

  const onReady = useCallback((next: CityViewer) => {
    setSession({ viewer: next, mapId: pendingMapId.current });
  }, []);

  const selectMap = useCallback(
    (next: MapEntry) => {
      if (next.id === pendingMapId.current) return;
      rememberMapId(next.id);
      setOverlayError(null);
      setMapId(next.id);
    },
    [],
  );

  useEffect(() => {
    window.__mapId = map.id;
    window.__setMap = (id: string) => {
      const entry = mapById(id);
      if (entry) selectMap(entry);
    };
    return () => {
      delete window.__setMap;
    };
  }, [map.id, selectMap]);

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
    loadMapOverlays(
      viewer,
      { xodr: map.xodr, manifest: map.manifest, lanePolygons: map.lanePolygons, signals: map.signals },
      { signal: controller.signal, initialVisibility: OVERLAY_DEFAULTS },
    )
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
  }, [viewer, map]);

  /**
   * The editor's ground lookup.
   *
   * The overlay load already bakes a `GroundIndex` over the road layer (~30 ms,
   * ~0.2 µs a query), so placement reuses it rather than paying for a second
   * copy. If the overlays failed outright, fall back to the viewer's live
   * raycast — 9.5 ms a call, which is visibly slower under a moving ghost but
   * beats refusing to place anything.
   */
  const sampleHeight = useMemo(() => {
    if (overlays) return (x: number, z: number) => overlays.sampleHeight(x, z);
    if (viewer && overlayError) return (x: number, z: number) => viewer.sampleGroundHeight(x, z);
    return null;
  }, [overlays, viewer, overlayError]);

  const { controller, state, laneStats, error: editorError } = useEditor({
    viewer,
    map,
    sampleHeight,
    hostRef,
  });

  // 1-5 switch maps. Deliberately global (not scoped to the picker) and
  // deliberately not swallowed when a modal edit is running — switching maps is
  // a navigation, and the editor parks its work on the way out.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      const index = Number(event.key) - 1;
      const next = MAPS[index];
      if (!Number.isInteger(index) || !next) return;
      event.preventDefault();
      selectMap(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMap]);

  const onPick = useCallback(
    (id: CatalogId) => (controller as EditorController | null)?.togglePlacement(id),
    [controller],
  );

  const loading = state === null;

  return (
    <div style={styles.root} ref={hostRef}>
      <CityView
        key={map.id}
        manifestUrl={map.manifest}
        options={optionsRef.current}
        onReady={onReady}
        style={styles.canvas}
      />

      <div style={styles.leftRail}>
        <MapPicker current={map} loading={loading} onSelect={selectMap} />
        <Palette placing={state?.placing ?? null} onPick={onPick} />
      </div>

      <div style={styles.rightRail}>
        {controller && state ? <Inspector controller={controller} state={state} /> : null}
        <LayerPanel
          viewer={viewer}
          overlays={overlays}
          overlayError={overlayError ?? editorError}
          overlayDefaults={OVERLAY_DEFAULTS}
          benchRunning={benchRunning}
          onBench={() => void window.__bench?.()}
          actorCount={state?.actors.length ?? 0}
          laneCount={laneStats?.lanes ?? null}
        />
        <Hud viewer={viewer} />
      </div>

      {state ? (
        <StatusBar state={state} mapLabel={map.label} loading={loading} />
      ) : (
        <div style={styles.loadingBar} data-testid="status-bar">
          loading {map.label}…
        </div>
      )}
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
  leftRail: {
    position: 'absolute',
    top: 12,
    left: 12,
    bottom: 40,
    width: 216,
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
  },
  rightRail: {
    position: 'absolute',
    top: 12,
    right: 12,
    bottom: 40,
    width: 232,
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    overflowY: 'auto',
    alignItems: 'stretch',
  },
  loadingBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    padding: '0 12px',
    background: 'rgba(8, 10, 14, 0.88)',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    fontSize: 12,
    color: '#8f98a6',
  },
};
