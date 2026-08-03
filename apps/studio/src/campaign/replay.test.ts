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
      directory: 'examples/edge-cases/blind-chicane-emerging-worker',
      template: 'scenario.template.json', instance: 'instance.json', trace: 'trace.json.gz',
    },
    {
      ordinal: 5,
      directory: 'examples/edge-cases/05-ambulance-gridlocked-intersection',
      template: 'template.json', instance: 'instance.baseline.json', trace: 'trace.baseline.json.gz',
    },
    {
      ordinal: 6,
      directory: 'examples/edge-cases/06-dark-signal-conflicting-human-control',
      template: 'template.json', instance: 'instance.baseline.json', trace: 'trace.baseline.json.gz',
    },
    {
      ordinal: 9,
      directory: 'examples/edge-cases/double-turn-mobility-scooter',
      template: 'scenario.template.json', instance: 'instance.json', trace: 'trace.json.gz',
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
      expect(pair.instance.input.clipSeconds).toBe(20);
      if (fixture.ordinal === 1) {
        expect(pair.actors.map((actor) => actor.id).sort()).toEqual(['ego', 'oncoming-van', 'worker']);
        expect(pair.props.find((prop) => prop.id === 'worker-pipe')).toMatchObject({
          catalogId: 'construction.long_pipe',
          attachment: { actorId: 'worker' },
        });
        expect(pair.instance.input.occlusionPairs).toContainEqual({
          observer: 'ego', target: 'worker', occluderId: 'excavator',
        });
        expect(pair.trace.metrics.declaredOcclusion).toContainEqual(expect.objectContaining({
          observer: 'ego', target: 'worker', occluderId: 'excavator', status: 'revealed_before_conflict',
        }));
        const camera = buildIncidentCameraPlan(pair);
        expect(camera?.actorIds).toEqual(expect.arrayContaining(['ego', 'worker']));
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
      expect(reopened.data).toEqual(document.data);
      expect(reopened.data.choreography.clipSeconds).toBe(20);
    }, 20_000);
  }

});
