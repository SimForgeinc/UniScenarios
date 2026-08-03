import type { NetworkWorldTransform } from './protocol';

export function toWorld(x: number, y: number, transform: NetworkWorldTransform): { x: number; y: number } {
  const radians = transform.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: (x * cosine - (transform.invertY ? -y : y) * sine) * transform.scale + transform.translationX,
    y: (x * sine + (transform.invertY ? -y : y) * cosine) * transform.scale + transform.translationY,
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
    y: (translatedX * sine + translatedY * cosine) * (transform.invertY ? -1 : 1),
  };
}

export function transformPackedStatesToWorld(
  buffer: ArrayBuffer,
  count: number,
  transform: NetworkWorldTransform,
): void {
  const floats = new Float32Array(buffer);
  if (count < 0 || floats.length < count * 8) {
    throw new RangeError(`packed traffic state has ${floats.length} floats for ${count} actors`);
  }
  for (let actor = 0; actor < count; actor += 1) {
    const offset = actor * 8;
    const position = toWorld(floats[offset + 1]!, floats[offset + 2]!, transform);
    floats[offset + 1] = position.x;
    floats[offset + 2] = position.y;
    const heading = floats[offset + 3]!;
    floats[offset + 3] = (transform.invertY ? 180 - heading : heading) + transform.rotationDegrees;
  }
}
