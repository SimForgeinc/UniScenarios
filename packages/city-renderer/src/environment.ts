import { DirectionalLight, EquirectangularReflectionMapping, PMREMGenerator, Scene, Vector3, WebGLRenderer } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export interface SunOptions {
  /** Direction the light travels, from the manifest. */
  direction: Vector3;
  intensity: number;
  /** Scene centre; the light target is parked here. */
  target: Vector3;
}

/** Directional sun matched to the direction the lightmaps were baked with. */
export function createSun(opts: SunOptions): DirectionalLight {
  const light = new DirectionalLight(0xfff2df, opts.intensity);
  const dir = opts.direction.clone().normalize();
  // Shadows are baked, so the light only needs a direction — park it far enough
  // out that the direction is stable across the whole scene.
  light.position.copy(opts.target).addScaledVector(dir, -2000);
  light.target.position.copy(opts.target);
  light.castShadow = false;
  light.name = 'sun';
  return light;
}

/**
 * Loads an .hdr, runs it through PMREM and installs it as both the IBL and the
 * background. Resolves to a disposer.
 */
export async function loadEnvironment(
  renderer: WebGLRenderer,
  scene: Scene,
  url: string,
): Promise<() => void> {
  // HDRLoader is the r182 replacement for RGBELoader (same Radiance .hdr).
  const source = await new HDRLoader().loadAsync(url);
  source.mapping = EquirectangularReflectionMapping;

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const target = pmrem.fromEquirectangular(source);
  source.dispose();
  pmrem.dispose();

  scene.environment = target.texture;
  scene.background = target.texture;

  return () => {
    scene.environment = null;
    scene.background = null;
    target.dispose();
  };
}
