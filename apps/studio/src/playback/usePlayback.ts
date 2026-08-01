import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { PlaybackController, type PlaybackState } from './controller';
import type { PlaybackBundle } from './model';

export interface UsePlaybackOptions {
  viewer: CityViewer | null;
  bundle: PlaybackBundle | null;
  sampleHeight: ((x: number, z: number) => number | null) | null;
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
}: UsePlaybackOptions): { controller: PlaybackController | null; state: PlaybackState | null } {
  const [controller, setController] = useState<PlaybackController | null>(null);

  useEffect(() => {
    if (!viewer || !bundle || !sampleHeight) return;
    const next = new PlaybackController({ viewer, bundle, sampleHeight });
    window.__playback = next;
    setController(next);
    return () => {
      if (window.__playback === next) delete window.__playback;
      next.dispose();
      setController(null);
    };
  }, [viewer, bundle, sampleHeight]);

  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : nullSnapshot,
    nullSnapshot,
  );
  return { controller, state };
}

function noopSubscribe(): () => void {
  return () => {};
}

function nullSnapshot(): null {
  return null;
}
