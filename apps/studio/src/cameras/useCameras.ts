import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { CameraRegistry, type CameraAttachmentResolver, type CameraPresentationStore } from './controller';
import { EMPTY_CAMERA_PRESENTATION, type CameraPresentation } from './model';

export interface UseCamerasOptions {
  viewer: CityViewer | null;
  store: CameraPresentationStore | null;
  resolveAttachment?: CameraAttachmentResolver;
}

export function useCameras(options: UseCamerasOptions): {
  registry: CameraRegistry | null;
  state: CameraPresentation;
} {
  const [registry, setRegistry] = useState<CameraRegistry | null>(null);
  useEffect(() => {
    if (!options.viewer || !options.store) return;
    const next = new CameraRegistry({
      viewer: options.viewer,
      store: options.store,
      ...(options.resolveAttachment ? { resolveAttachment: options.resolveAttachment } : {}),
    });
    setRegistry(next);
    return () => { next.dispose(); setRegistry(null); };
  }, [options.viewer, options.store, options.resolveAttachment]);
  const state = useSyncExternalStore(
    registry ? registry.subscribe : noopSubscribe,
    registry ? registry.getSnapshot : emptySnapshot,
    emptySnapshot,
  );
  return { registry, state };
}

function noopSubscribe(): () => void { return () => {}; }
function emptySnapshot(): CameraPresentation { return EMPTY_CAMERA_PRESENTATION; }

