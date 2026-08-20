import {
  Color,
  LinearSRGBColorSpace,
  NearestFilter,
  NoToneMapping,
  RGBAFormat,
  UnsignedByteType,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';

export type OffscreenRenderInput = Readonly<{
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  width: number;
  height: number;
  resourcePool?: RenderResourcePool;
  resourceKey?: string;
  overrideMaterial?: Material | null;
  beforeRender?: () => void;
  clearColor?: Color;
  clearAlpha?: number;
  onTiming?: (stage: 'scenePass' | 'readback', milliseconds: number) => void;
}>;

type RenderResource = {
  target: WebGLRenderTarget;
  readback: Uint8Array;
  flipped: Uint8Array;
  width: number;
  height: number;
};

/** Owns long-lived GPU targets and CPU readback buffers for a render session. */
export class RenderResourcePool {
  private readonly resources = new Map<string, RenderResource>();

  acquire(key: string, width: number, height: number): RenderResource {
    const current = this.resources.get(key);
    if (current?.width === width && current.height === height) return current;
    current?.target.dispose();
    const target = createTarget(width, height);
    const resource = {
      target,
      readback: new Uint8Array(width * height * 4),
      flipped: new Uint8Array(width * height * 4),
      width,
      height,
    };
    this.resources.set(key, resource);
    return resource;
  }

  dispose(): void {
    for (const resource of this.resources.values()) resource.target.dispose();
    this.resources.clear();
  }
}

function createTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    samples: 0,
  });
  target.texture.colorSpace = LinearSRGBColorSpace;
  return target;
}

/** Render byte-exact RGBA and restore every renderer/scene mutation. */
export function renderOffscreenRgba(input: OffscreenRenderInput): Uint8Array {
  if (!Number.isSafeInteger(input.width) || input.width <= 0 || !Number.isSafeInteger(input.height) || input.height <= 0) throw new Error('Offscreen dimensions must be positive safe integers.');
  const temporaryPool = input.resourcePool ? null : new RenderResourcePool();
  const resources = (input.resourcePool ?? temporaryPool!).acquire(input.resourceKey ?? `${input.width}x${input.height}`, input.width, input.height);
  const renderer = input.renderer;
  const previousTarget = renderer.getRenderTarget();
  const previousViewport = renderer.getViewport(new Vector4());
  const previousScissor = renderer.getScissor(new Vector4());
  const previousScissorTest = renderer.getScissorTest();
  const previousClearColor = renderer.getClearColor(new Color());
  const previousClearAlpha = renderer.getClearAlpha();
  const previousToneMapping = renderer.toneMapping;
  const previousOutputColorSpace = renderer.outputColorSpace;
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  const previousShadowsEnabled = renderer.shadowMap.enabled;
  const previousOverrideMaterial = input.scene.overrideMaterial;

  try {
    renderer.xr.enabled = false;
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = true;
    renderer.setRenderTarget(resources.target);
    renderer.setViewport(0, 0, input.width, input.height);
    renderer.setScissor(0, 0, input.width, input.height);
    renderer.setScissorTest(false);
    renderer.setClearColor(input.clearColor ?? new Color(0), input.clearAlpha ?? 0);
    input.scene.overrideMaterial = input.overrideMaterial ?? null;
    input.beforeRender?.();
    renderer.clear(true, true, true);
    let started = performance.now();
    renderer.render(input.scene, input.camera);
    input.onTiming?.('scenePass', performance.now() - started);
    started = performance.now();
    renderer.readRenderTargetPixels(resources.target, 0, 0, input.width, input.height, resources.readback);
    flipRgbaRowsInto(resources.readback, resources.flipped, input.width, input.height);
    input.onTiming?.('readback', performance.now() - started);
    return resources.flipped;
  } finally {
    input.scene.overrideMaterial = previousOverrideMaterial;
    renderer.setRenderTarget(previousTarget);
    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    renderer.toneMapping = previousToneMapping;
    renderer.outputColorSpace = previousOutputColorSpace;
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXrEnabled;
    renderer.shadowMap.enabled = previousShadowsEnabled;
    temporaryPool?.dispose();
  }
}

export function flipRgbaRows(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(pixels.byteLength);
  flipRgbaRowsInto(pixels, output, width, height);
  return output;
}

function flipRgbaRowsInto(pixels: Uint8Array, output: Uint8Array, width: number, height: number): void {
  if (pixels.byteLength !== width * height * 4 || output.byteLength !== pixels.byteLength) throw new Error('RGBA readback dimensions do not match its byte length.');
  const stride = width * 4;
  for (let row = 0; row < height; row += 1) output.set(pixels.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
}
