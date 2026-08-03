import { useEffect } from 'react';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { ActorRenderer, type ActorView } from '../editor/actorRenderer';
import { samplePlaybackActors, type PlaybackBundle } from '../playback/model';

export function isAmbientPlaybackActor(actor: { readonly id: string; readonly tags: readonly string[] }): boolean {
  return actor.id.startsWith('ambient:')
    || actor.id.startsWith('ambient-')
    || actor.tags.some((tag) => tag === 'ambient' || tag.startsWith('ambient:'));
}

export function authoringPreviewActors<T extends { readonly id: string }>(
  actors: readonly T[],
  editorActorIds: readonly string[],
): readonly T[] {
  const editorOwned = new Set(editorActorIds);
  return actors.filter((actor) => !editorOwned.has(actor.id));
}

/**
 * Draw the materialized population at its exact t=0 pose while the document is editable.
 * Scene-absolute actors remain owned by EditorController; portable authored actors and
 * generated ambient actors live in this non-editable preview layer until playback starts.
 */
export function useAmbientTrafficPreview(
  viewer: CityViewer | null,
  bundle: PlaybackBundle | null,
  sampleHeight: ((x: number, z: number) => number | null) | null,
  visible: boolean,
  editorActorIds: readonly string[] = [],
  sharedRenderer?: ActorRenderer | null,
): void {
  useEffect(() => {
    if (!viewer || !bundle || !sampleHeight || !visible) return;
    const previewMetadata = new Map(authoringPreviewActors(bundle.actors, editorActorIds).map((actor) => [actor.id, actor] as const));
    if (previewMetadata.size === 0) return;
    const renderer = sharedRenderer ?? new ActorRenderer();
    const ownsRenderer = !sharedRenderer;
    if (ownsRenderer) {
      renderer.group.name = 'authoring-t0-preview';
      viewer.scene.add(renderer.group);
    }
    const views: ActorView[] = samplePlaybackActors(bundle, bundle.startTime).flatMap((actor) => {
      const metadata = previewMetadata.get(actor.id);
      if (!metadata || !actor.present) return [];
      return [{
        id: actor.id,
        catalogId: actor.catalogId,
        dims: actor.dims,
        x: actor.x,
        y: sampleHeight(actor.x, actor.z) ?? 0,
        z: actor.z,
        headingRad: actor.headingRad,
        reversing: actor.motionDirection === -1,
        kind: metadata.kind,
        ...(metadata.modelBasis === 'input-tag' ? { catalogIdAuthored: true } : {}),
      } satisfies ActorView];
    });
    renderer.syncLayer('ambient-preview', views);
    if (ownsRenderer) renderer.setSelection([]);
    return () => {
      if (ownsRenderer) renderer.dispose();
      else renderer.clearLayer('ambient-preview');
    };
  }, [bundle, editorActorIds, sampleHeight, sharedRenderer, viewer, visible]);
}
