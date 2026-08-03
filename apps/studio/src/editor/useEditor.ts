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
  const [documentSession, setDocumentSession] = useState<{
    mapId: string;
    document: EditorDocument;
  } | null>(null);
  const [laneStats, setLaneStats] = useState<LaneIndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The editable document belongs to the map session, not the renderer
  // session. Playback, quality changes, and WebGL recovery may recreate the
  // viewer; none of those presentation events may replace undo history.
  useEffect(() => {
    let disposed = false;
    let liveDoc: EditorDocument | null = null;
    setError(null);
    void EditorDocument.open(map).then((document) => {
      if (disposed) {
        document.dispose();
        return;
      }
      liveDoc = document;
      setDocumentSession({ mapId: map.id, document });
    }).catch((err: unknown) => {
      if (disposed) return;
      console.error('[editor] could not open document', err);
      setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      disposed = true;
      setDocumentSession((current) => current?.document === liveDoc ? null : current);
      // Only a map change/unmount parks and disposes the undo-bearing document.
      void liveDoc?.flush().finally(() => liveDoc?.dispose());
    };
  }, [map]);

  const document = documentSession?.mapId === map.id ? documentSession.document : null;

  // Renderer/controller lifetime is deliberately shorter. Rebinding the same
  // document preserves its TemplateDocument identity and complete history.
  useEffect(() => {
    if (!viewer || !sampleHeight || !document) return;
    let disposed = false;
    let live: EditorController | null = null;
    const abort = new AbortController();
    setError(null);
    void LaneIndex.load(map.topology, { signal: abort.signal }).then((laneIndex) => {
      if (disposed) return;
      live = new EditorController({ viewer, laneIndex, document, sampleHeight });
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
        actors: document.actors.length,
      });
    }).catch((err: unknown) => {
      if (disposed || (err as { name?: string } | null)?.name === 'AbortError') return;
      console.error('[editor] failed to arm', err);
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      disposed = true;
      abort.abort();
      if (window.__editor === live) delete window.__editor;
      live?.dispose();
      live = null;
      setController(null);
      setLaneStats(null);
    };
  }, [viewer, map, sampleHeight, hostRef, document]);

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
