import type { NetworkWorldTransform } from './protocol';

export function toWorld(x: number, y: number, transform: NetworkWorldTransform): { x: number; y: number } {
  const radians = transform.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: (x * cosine - y * sine) * transform.scale + transform.translationX,
    y: (x * sine + y * cosine) * transform.scale + transform.translationY,
  };
}
export function toNetwork(x: number, y: number, transform: NetworkWorldTransform): { x: number; y: number } {
  const radians = -transform.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const translatedX = (x - transform.translationX) / transform.scale;
  const translatedY = (y - transform.translationY) / transform.scale;
  return {
    x: translatedX * cosine - translatedY * sine,
    y: translatedX * sine + translatedY * cosine,
  };
}

export function transformPackedStatesToWorld(
  buffer: ArrayBuffer,
  count: number,
  transform: NetworkWorldTransform,
): void {
  const floats = new Float32Array(buffer);
  for (let actor = 0; actor < count; actor += 1) {
    const offset = actor * 8;
    const position = toWorld(floats[offset + 1], floats[offset + 2], transform);
    floats[offset + 1] = position.x;
    floats[offset + 2] = position.y;
    floats[offset + 3] += transform.rotationDegrees;
  }
}
