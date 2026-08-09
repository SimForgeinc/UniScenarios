import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CameraView, CityViewer } from '@uniscenarios/city-renderer';
import { PlaybackController, type PlaybackState } from '@uniscenarios/playback';
import type { PlaybackBundle } from '@uniscenarios/playback';
import type { MapOverlayHandle } from '../mapOverlays';
import type { CameraPolicy } from '@uniscenarios/camera-rig';
import type { DashCameraSensor } from '@uniscenarios/scenario-model';
import type { ActorRenderer } from '../editor/actorRenderer';

export interface UsePlaybackOptions {
  viewer: CityViewer | null;
  bundle: PlaybackBundle | null;
  sampleHeight: ((x: number, z: number) => number | null) | null;
  overlays: MapOverlayHandle | null;
  cameraPolicy?: CameraPolicy;
  cameraView?: CameraView | null;
  dashCamera?: { actorId: string; sensor: DashCameraSensor } | null;
  restoreCameraOnDispose?: boolean;
  renderer?: ActorRenderer | null;
  externalClock?: boolean;
}

declare global {
  interface Window {
    /** Deterministic import/playback surface for the verification harness. */
    __playback?: PlaybackController;
  }
}

export function usePlayback({
  viewer,
  bundle,
  sampleHeight,
  overlays,
  cameraPolicy,
  cameraView,
  dashCamera,
  restoreCameraOnDispose,
  renderer,
  externalClock,
}: UsePlaybackOptions): { controller: PlaybackController | null; state: PlaybackState | null; error: string | null } {
  const [controller, setController] = useState<PlaybackController | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer || !bundle || !sampleHeight) return;
    let next: PlaybackController;
    try {
      next = new PlaybackController({
        viewer,
        bundle,
        sampleHeight,
        setSignalStates: (states, timeSeconds) => overlays?.setSignalStates(states, timeSeconds) ?? 0,
        clearSignalStates: () => overlays?.clearSignalStates(),
        ...(cameraPolicy ? { cameraPolicy } : {}),
        ...(cameraView ? { cameraView } : {}),
        ...(dashCamera ? { dashCamera } : {}),
        ...(restoreCameraOnDispose ? { restoreCameraOnDispose: true } : {}),
        ...(renderer ? { renderer } : {}),
        ...(externalClock ? { externalClock: true } : {}),
      });
      setError(null);
    } catch (reason) {
      setController(null);
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    window.__playback = next;
    setController(next);
    return () => {
      if (window.__playback === next) delete window.__playback;
      next.dispose();
      setController(null);
    };
  }, [viewer, bundle, sampleHeight, overlays, cameraPolicy, cameraView, dashCamera, restoreCameraOnDispose, renderer, externalClock]);

  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : nullSnapshot,
    nullSnapshot,
  );
  return { controller, state, error };
}

function noopSubscribe(): () => void {
  return () => {};
}

function nullSnapshot(): null {
  return null;
}
