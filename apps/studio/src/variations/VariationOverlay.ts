import { useEffect } from 'react';
import { BufferGeometry, Color, Group, Line, LineBasicMaterial, SphereGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { CityViewer } from '@uniscenarios/city-renderer';
import type { VariationPreview } from './model';

const COLORS = ['#4bc0ff', '#ff9f43', '#75e69c', '#e879f9', '#facc15'];

/** World-space preview of the exact simulated target routes and conflicts. */
export function useVariationOverlay(viewer: CityViewer | null, preview: VariationPreview | null): void {
  useEffect(() => {
    if (!viewer || !preview) return;
    const group = new Group();
    group.name = 'studio-variation-preview';
    preview.actors.forEach((actor, index) => {
      if (actor.points.length < 2) return;
      const color = COLORS[index % COLORS.length]!;
      const geometry = new BufferGeometry().setFromPoints(actor.points.map((point) => new Vector3(point.x, .22, point.z)));
      const material = new LineBasicMaterial({ color: new Color(color), transparent: true, opacity: .92 });
      const line = new Line(geometry, material);
      line.userData.actorId = actor.id;
      group.add(line);
      const marker = new Mesh(new SphereGeometry(.65, 10, 8), new MeshBasicMaterial({ color }));
      marker.position.set(actor.start.x, .55, actor.start.z);
      marker.userData.actorId = actor.id;
      group.add(marker);
    });
    for (const conflict of preview.conflicts) {
      const marker = new Mesh(new SphereGeometry(.85, 12, 8), new MeshBasicMaterial({ color: '#ff4d6d', wireframe: true }));
      marker.position.set(conflict.x, .7, conflict.z);
      marker.userData.conflictRole = conflict.role;
      group.add(marker);
    }
    viewer.scene.add(group);
    return () => {
      viewer.scene.remove(group);
      group.traverse((object) => {
        const renderable = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
        renderable.geometry?.dispose();
        renderable.material?.dispose();
      });
    };
  }, [viewer, preview]);
}

