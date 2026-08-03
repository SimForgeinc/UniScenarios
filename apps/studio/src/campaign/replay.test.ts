import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, TemplateDocument, WebTemplateFileStore } from '@uniscenarios/scenario-model';
import { readPlaybackFiles } from '../playback/model';
import { buildIncidentCameraPlan } from '../playback/controller';
import { initialSession, reduceSession } from '../session/model';
import { GENERATED_CAMPAIGN_ENTRIES } from './generated';
import { isCampaignReady } from './catalog';

const root = path.resolve(process.cwd(), '../..');

async function bytes(relative: string): Promise<ArrayBuffer> {
  const data = await readFile(path.join(root, relative));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

describe('campaign exact-evidence replay', () => {
  for (const fixture of [
    {
      ordinal: 1,
      directory: 'examples/edge-cases/01-construction-chicane-reversing-truck',
      template: 'scenario.template.json', instance: 'scenario.instance.json', trace: 'scenario.trace.json.gz',
    },
    {
      ordinal: 3,
      directory: 'examples/edge-cases/03-red-light-ambulance-preemption',
      template: 'scenario.template.json', instance: 'scenario.instance.json', trace: 'scenario.trace.json.gz',
    },
    {
      ordinal: 10,
      directory: 'examples/edge-cases/10-officer-flashing-red-junction',
      template: 'scenario.template.json', instance: 'scenario.instance.json', trace: 'scenario.trace.json.gz',
    },
    {
      ordinal: 11,
      directory: 'examples/edge-cases/11-double-threat-crosswalk',
      template: 'scenario.template.json', instance: 'scenario.instance.json', trace: 'scenario.trace.json.gz',
    },
  ]) {
    it(`imports exact scenario ${fixture.ordinal}, plays 20 s, Stops, saves and reopens`, async () => {
      const pair = await readPlaybackFiles(
        { name: fixture.instance, arrayBuffer: () => bytes(`${fixture.directory}/${fixture.instance}`) },
        { name: fixture.trace, arrayBuffer: () => bytes(`${fixture.directory}/${fixture.trace}`) },
      );
      expect(pair.startTime).toBe(0);
      expect(pair.endTime).toBe(20);
      expect(pair.trace.ticks.t).toHaveLength(1001);
      for (const track of Object.values(pair.trace.ticks.actors)) {
        expect(track.lateralOffsetM).toHaveLength(pair.trace.ticks.t.length);
        expect(track.lateralOffsetM.every(Number.isFinite)).toBe(true);
      }
      if (fixture.ordinal !== 3) {
        expect(Object.values(pair.trace.ticks.actors)
          .every((track) => track.lateralOffsetM.every((offset) => offset === 0))).toBe(true);
      }
      expect(pair.instance.input.clipSeconds).toBe(20);
      if (fixture.ordinal === 1) {
        expect(pair.actors.map((actor) => actor.id).sort()).toEqual(['focus-vehicle', 'reversing-truck', 'worker']);
        expect(pair.props.find((prop) => prop.id === 'worker-pipe')).toMatchObject({
          catalogId: 'construction.long_pipe',
          attachment: { actorId: 'worker' },
        });
        expect(pair.instance.input.occlusionPairs).toContainEqual({
          observer: 'focus-vehicle', target: 'worker', occluderId: 'excavator',
        });
        expect(pair.trace.metrics.declaredOcclusion).toContainEqual(expect.objectContaining({
          observer: 'focus-vehicle', target: 'worker', occluderId: 'excavator', status: 'revealed_before_conflict',
        }));
        const camera = buildIncidentCameraPlan(pair);
        expect(camera?.actorIds).toEqual(expect.arrayContaining(['focus-vehicle', 'worker']));
        expect(camera?.actorIds.some((id) => id.startsWith('ambient-'))).toBe(false);
        expect(camera?.radius).toBeGreaterThanOrEqual(7);
        expect(camera?.radius).toBeLessThanOrEqual(34);
      }

      let session = initialSession(20);
      session = reduceSession(session, { type: 'prepare', duration: 20 });
      session = reduceSession(session, { type: 'ready' });
      session = reduceSession(session, { type: 'play' });
      session = reduceSession(session, { type: 'tick', delta: 20 });
      expect(session.mode).toBe('ended');
      expect(session.time).toBe(20);
      session = reduceSession(session, { type: 'stop' });
      expect(session.mode).toBe('authoring');
      expect(session.time).toBe(0);

      const templateValue: unknown = JSON.parse(await readFile(path.join(root, fixture.directory, fixture.template), 'utf8'));
      const catalogEntry = GENERATED_CAMPAIGN_ENTRIES.find((entry) => entry.ordinal === fixture.ordinal)!;
      if (!isCampaignReady(catalogEntry)) {
        expect(() => TemplateDocument.fromJSON(templateValue)).toThrow();
        expect(catalogEntry.diagnostics.length).toBeGreaterThan(0);
        return;
      }
      const document = TemplateDocument.fromJSON(templateValue);
      const storage = new MemoryStorage();
      const store = new WebTemplateFileStore({ storage });
      const name = `campaign-${String(fixture.ordinal).padStart(2, '0')}-replay-test`;
      await store.write(name, document);
      const reopened = TemplateDocument.fromJSON(await store.read(name));
      expect(reopened.data).toMatchObject({
        meta: document.data.meta,
        roles: document.data.roles,
        choreography: document.data.choreography,
      });
      expect(reopened.data.choreography.clipSeconds).toBe(20);
    }, 20_000);
  }

});
