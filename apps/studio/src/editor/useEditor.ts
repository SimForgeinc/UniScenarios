/**
 * React binding for {@link EditorController}.
 *
 * One hook per mounted map. It owns the async part of arming the editor — the
 * lane index (a fetch plus a bin, independent of the viewer) and the scenario
 * document (a `localStorage` read) — and tears both down when the map changes,
 * so nothing from the previous map can write into the next one's scenario.
 *
 * State reaches components through `useSyncExternalStore`, which is exactly the
 * contract the controller already offers (`subscribe` + `getSnapshot`, snapshot
 * replaced wholesale on change). Rendering therefore stays a pure function of
 * the controller's state, and the controller never needs a React import.
 */

import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { EditorController, type EditorState } from './controller';
import { EditorDocument } from './document';
import { LaneIndex } from './laneIndex';
import type { MapEntry } from '../maps';

export interface UseEditorOptions {
  viewer: CityViewer | null;
  map: MapEntry;
  /**
   * Ground height lookup. `null` until it exists — the editor arms only once a
   * placement can actually land on the ground.
   */
  sampleHeight: ((x: number, z: number) => number | null) | null;
  /** Element containing the canvas; input is bound here (capture phase). */
  hostRef: RefObject<HTMLElement | null>;
}

export interface UseEditorResult {
  controller: EditorController | null;
  state: EditorState | null;
  /** Lane index statistics, for the HUD and for verification. */
  laneStats: LaneIndexSummary | null;
  error: string | null;
}

export interface LaneIndexSummary {
  lanes: number;
  segments: number;
  buildMs: number;
  fetchMs: number;
}

declare global {
  interface Window {
    /** The live editor, for the verification harness. */
    __editor?: EditorController;
  }
}

export function useEditor({
  viewer,
  map,
  sampleHeight,
  hostRef,
}: UseEditorOptions): UseEditorResult {
  const [controller, setController] = useState<EditorController | null>(null);
  const [laneStats, setLaneStats] = useState<LaneIndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer || !sampleHeight) return;
    let disposed = false;
    let live: EditorController | null = null;
    let liveDoc: EditorDocument | null = null;
    const abort = new AbortController();

    setError(null);
    void (async () => {
      try {
        const [laneIndex, doc] = await Promise.all([
          LaneIndex.load(map.topology, { signal: abort.signal }),
          EditorDocument.open(map),
        ]);
        if (disposed) {
          doc.dispose();
          return;
        }
        liveDoc = doc;
        live = new EditorController({ viewer, laneIndex, document: doc, sampleHeight });
        const host = hostRef.current;
        if (host) live.attach(host);
        window.__editor = live;
        setLaneStats({
          lanes: laneIndex.stats.lanes,
          segments: laneIndex.stats.segments,
          buildMs: laneIndex.stats.buildMs,
          fetchMs: laneIndex.stats.fetchMs,
        });
        setController(live);
        console.info('[editor] ready', {
          map: map.id,
          lanes: laneIndex.stats.lanes,
          segments: laneIndex.stats.segments,
          buildMs: Math.round(laneIndex.stats.buildMs),
          actors: doc.actors.length,
        });
      } catch (err) {
        if (disposed || (err as { name?: string } | null)?.name === 'AbortError') return;
        console.error('[editor] failed to arm', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      // Park the work before the document goes: a map switch mid-debounce would
      // otherwise drop the last few edits.
      void liveDoc?.flush().finally(() => liveDoc?.dispose());
      if (window.__editor === live) delete window.__editor;
      live?.dispose();
      live = null;
      setController(null);
      setLaneStats(null);
    };
  }, [viewer, map, sampleHeight, hostRef]);

  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : nullSnapshot,
    nullSnapshot,
  );

  return { controller, state, laneStats, error } as UseEditorResult;
}

function noopSubscribe(): () => void {
  return () => {};
}

function nullSnapshot(): null {
  return null;
}
