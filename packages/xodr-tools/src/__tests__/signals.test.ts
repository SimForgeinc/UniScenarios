import { describe, expect, it } from 'vitest';
import { CoordinateFrame } from '../coordinate-frame.js';
import { signalsFromGeoJson } from '../signals.js';
import { buildSignalOverlay } from '../overlays/signals.js';
import { yaleHeaderText, yaleManifest, yaleSignals } from './fixtures.js';

const frame = (): CoordinateFrame =>
  CoordinateFrame.fromMapAssets(yaleHeaderText(), yaleManifest());

async function load() {
  return signalsFromGeoJson(await yaleSignals(), frame());
}

describe('signalsFromGeoJson', () => {
  it('parses all 164 Yale Street features, 59 of them traffic lights', async () => {
    const signals = await load();
    expect(signals).toHaveLength(164);
    expect(signals.filter((s) => s.category === 'traffic_light')).toHaveLength(59);
  });

  it('splits into 143 point signals and 21 crosswalk polygons', async () => {
    const signals = await load();
    const kinds = new Map<string, number>();
    for (const s of signals) kinds.set(s.featureKind, (kinds.get(s.featureKind) ?? 0) + 1);
    expect(kinds.get('signal')).toBe(143);
    expect(kinds.get('crosswalk')).toBe(21);
    // Crosswalks carry no signal_category and keep their surface ring.
    const crosswalks = signals.filter((s) => s.featureKind === 'crosswalk');
    for (const c of crosswalks) {
      expect(c.category).toBe('unknown');
      expect(c.outline!.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('covers the full category vocabulary', async () => {
    const signals = await load();
    const counts = new Map<string, number>();
    for (const s of signals) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toEqual({
      traffic_light: 59,
      unknown: 27 + 21, // 27 explicit "unknown" + 21 category-less crosswalks
      stop_sign: 14,
      parking_sign: 11,
      regulatory_sign: 8,
      warning_sign: 6,
      stop_line: 6,
      street_name_sign: 5,
      other_sign: 3,
      turn_restriction_sign: 3,
      bus_stop: 1,
    });
  });

  it('places every good signal inside the manifest scene bounds', async () => {
    const f = frame();
    const signals = signalsFromGeoJson(await yaleSignals(), f);
    const b = f.sceneBounds!;
    for (const s of signals) {
      expect(Number.isFinite(s.position[0])).toBe(true);
      expect(Number.isFinite(s.position[2])).toBe(true);
      if (!s.withinExtents) continue;
      expect(s.position[0]).toBeGreaterThanOrEqual(b.min[0] as number);
      expect(s.position[0]).toBeLessThanOrEqual(b.max[0] as number);
      expect(s.position[2]).toBeGreaterThanOrEqual(b.min[2] as number);
      expect(s.position[2]).toBeLessThanOrEqual(b.max[2] as number);
    }
  });

  it('flags the four bad Stop Line rows on road 918 instead of trusting them', async () => {
    // Source defect: t = -1725.5 m (a 1.7 km lateral offset) and a negative
    // z_offset, which projects these four duplicated rows onto the projection
    // origin, far outside the map.
    const signals = await load();
    const bad = signals.filter((s) => !s.withinExtents);
    expect(bad).toHaveLength(4);
    for (const s of bad) {
      expect(s.name).toBe('Stop Line');
      expect(s.roadId).toBe('918');
      expect(Math.abs(s.t)).toBeGreaterThan(1000);
      expect(s.zOffset).toBeLessThan(0);
    }
    expect(signals.filter((s) => s.withinExtents)).toHaveLength(160);

    const dropped = signalsFromGeoJson(await yaleSignals(), frame(), {
      dropOutsideExtents: true,
    });
    expect(dropped).toHaveLength(160);
  });

  it('exposes mounting height separately from the pole base', async () => {
    const signals = await load();
    const lights = signals.filter((s) => s.category === 'traffic_light');
    expect(lights.every((s) => s.dynamic)).toBe(true);
    expect(lights.every((s) => s.zOffset > 0)).toBe(true);
    // position is the BASE — the ground plane, not the head.
    expect(lights.every((s) => s.position[1] === 0)).toBe(true);

    const sampled = signalsFromGeoJson(await yaleSignals(), frame(), {
      heightSampler: () => 12.5,
    });
    expect(sampled.every((s) => s.position[1] === 12.5)).toBe(true);

    const flat = signalsFromGeoJson(await yaleSignals(), frame(), { groundHeight: 3 });
    expect(flat.every((s) => s.position[1] === 3)).toBe(true);
  });

  it('normalises typed properties and preserves the raw ones', async () => {
    const signals = await load();
    const stop = signals.find((s) => s.category === 'stop_sign')!;
    expect(stop.mutcdCode).toBeTruthy();
    expect(stop.dynamic).toBe(false);
    expect(stop.roadId).toMatch(/^\d+$/);
    expect(typeof stop.s).toBe('number');
    expect(typeof stop.t).toBe('number');
    expect(stop.properties.signal_category).toBe('stop_sign');
    expect(stop.properties.dynamic).toBe('no');
  });
});

describe('buildSignalOverlay', () => {
  it('returns a "signals" group with poles and per-id pickable heads', async () => {
    const signals = await load();
    const group = buildSignalOverlay(signals, { heightSampler: () => 12 });
    expect(group.name).toBe('signals');

    const poles = group.getObjectByName('signal-poles')!;
    const heads = group.getObjectByName('signal-heads')!;
    expect(poles).toBeDefined();
    // 164 features minus the 4 out-of-extent Stop Line rows.
    expect(heads.children).toHaveLength(160);
    expect(buildSignalOverlay(signals, { includeOutOfBounds: true }).getObjectByName(
      'signal-heads',
    )!.children).toHaveLength(164);

    // Every head is named with its signal id and carries the feature.
    for (const s of signals.filter((x) => x.withinExtents)) {
      const obj = group.getObjectByName(s.id)!;
      expect(obj).toBeDefined();
      expect(obj.userData.signalId).toBe(s.id);
    }

    // Head sits at ground + z_offset; the pole spans that.
    const light = signals.find((s) => s.category === 'traffic_light')!;
    const head = group.getObjectByName(light.id)!;
    expect(head.position.y).toBeCloseTo(12 + light.zOffset, 6);

    const polePositions = (poles as unknown as { geometry: { attributes: { position: { count: number } } } })
      .geometry.attributes.position;
    expect(polePositions.count).toBeGreaterThan(0);
    expect(polePositions.count % 2).toBe(0);
  });

  it('shares geometry and material across same-category heads', async () => {
    const signals = await load();
    const group = buildSignalOverlay(signals);
    const lights = signals
      .filter((s) => s.category === 'traffic_light')
      .map((s) => group.getObjectByName(s.id) as unknown as { geometry: object; material: object });
    expect(lights.length).toBe(59);
    const geoms = new Set(lights.map((m) => m.geometry));
    const mats = new Set(lights.map((m) => m.material));
    expect(geoms.size).toBe(1);
    expect(mats.size).toBe(1);
  });

  it('can drop the crosswalk layer', async () => {
    const signals = await load();
    const group = buildSignalOverlay(signals, { includeCrosswalks: false });
    expect(group.getObjectByName('signal-heads')!.children).toHaveLength(143 - 4);
  });
});
