import { Scene } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CityViewer } from '@uniscenarios/city-renderer';
import { ScenarioNotFoundError, type TemplateFileStore } from '@uniscenarios/scenario-model';
import { CameraRegistry } from '../cameras';
import { EditorController } from '../editor/controller';
import { EditorDocument, autosaveName } from '../editor/document';
import type { LaneIndex } from '../editor/laneIndex';
import { MAPS } from '../maps';
import { buildTimelineGroups, newSpeedInteraction } from '../timeline/model';

afterEach(() => vi.unstubAllGlobals());

describe('authoring session integrity', () => {
  it('keeps the undo-bearing document intact across capability lock and Stop', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });

    const document = {
      name: 'Undo survives playback',
      actors: [],
      canUndo: true,
      canRedo: false,
      isDirty: true,
      savedAt: null,
      subscribe: () => () => undefined,
      actor: () => undefined,
    } as unknown as EditorDocument;
    const viewer = { scene: new Scene() } as unknown as CityViewer;
    const controller = new EditorController({
      viewer,
      laneIndex: {} as LaneIndex,
      document,
      sampleHeight: () => 0,
    });

    controller.setAuthoringEnabled(false); // preparing / paused / playing / error
    frames.splice(0).forEach((frame) => frame(0));
    expect(controller.doc).toBe(document);
    expect(controller.state.canUndo).toBe(true);
    expect(controller.canAuthor).toBe(false);

    controller.setAuthoringEnabled(true); // Stop
    frames.splice(0).forEach((frame) => frame(1));
    expect(controller.doc).toBe(document);
    expect(controller.state.canUndo).toBe(true);
    expect(controller.canAuthor).toBe(true);

    controller.dispose();
  });

  it('keeps camera history on the same TemplateDocument through worker snapshot, Play, and Stop', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => null }),
    });
    const files = new Map<string, unknown>();
    const store: TemplateFileStore = {
      list: async () => [],
      read: async (name) => {
        if (!files.has(name)) throw new ScenarioNotFoundError(name);
        return structuredClone(files.get(name));
      },
      write: async (name, value) => {
        const serializable = value as { toJSON?: () => unknown };
        files.set(name, structuredClone(serializable.toJSON?.() ?? value));
      },
      delete: async (name) => files.delete(name),
    };
    const map = MAPS[0]!;
    const editorDocument = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
    const scene = new Scene();
    const viewer = {
      scene,
      controls: {
        getView: () => ({ position: [1, 4, 8], target: [0, 1, 0], fov: 55 }),
        applyView: () => undefined,
      },
    } as unknown as CityViewer;
    const registry = new CameraRegistry({ viewer, store: editorDocument });

    registry.addFromCurrent('Intersection camera');
    expect(editorDocument.canUndo).toBe(true);
    const documentIdentity = editorDocument;
    const workerSnapshot = structuredClone(editorDocument.data);
    expect(workerSnapshot.extensions).toHaveProperty('studio.presentation.cameras.v1');

    const playing = new EditorController({
      viewer,
      laneIndex: {} as LaneIndex,
      document: editorDocument,
      sampleHeight: () => 0,
    });
    playing.setAuthoringEnabled(false);
    frames.splice(0).forEach((frame) => frame(0));
    expect(playing.doc).toBe(documentIdentity);
    playing.dispose();

    // Even if the renderer/controller is replaced while playback is active,
    // Stop rebinds the same map-owned document rather than reopening autosave.
    const stopped = new EditorController({
      viewer,
      laneIndex: {} as LaneIndex,
      document: editorDocument,
      sampleHeight: () => 0,
    });
    stopped.setAuthoringEnabled(true);
    frames.splice(0).forEach((frame) => frame(1));
    expect(stopped.doc).toBe(documentIdentity);
    expect(stopped.state.canUndo).toBe(true);
    expect(editorDocument.canUndo).toBe(true);
    expect(files.has(autosaveName(map.id))).toBe(false);

    stopped.dispose();
    registry.dispose();
    editorDocument.dispose();
  });

  it('undoes timeline edits and reopens the saved interaction without semantic loss', async () => {
    const files = new Map<string, unknown>();
    const store: TemplateFileStore = {
      list: async () => [],
      read: async (name) => {
        if (!files.has(name)) throw new ScenarioNotFoundError(name);
        return structuredClone(files.get(name));
      },
      write: async (name, value) => {
        const serializable = value as { toJSON?: () => unknown };
        files.set(name, structuredClone(serializable.toJSON?.() ?? value));
      },
      delete: async (name) => files.delete(name),
    };
    const map = MAPS[0]!;
    const document = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
    document.add([{ id: 'ego', catalogId: 'vehicle.sedan', x: 0, y: 0, z: 0, headingRad: 0 }]);
    const original = newSpeedInteraction('ego', 0, 1);
    if (original.verb !== 'speed') throw new Error('fixture must be a speed interaction');
    document.addInteraction(original);
    const updated = { ...original, target: { mode: 'absolute' as const, valueKph: 45 } };
    document.replaceInteraction(original.id, updated);
    expect(document.data.choreography.interactions[0]).toMatchObject({ target: { valueKph: 45 } });
    expect(document.undo()).toBe(true);
    expect(document.data.choreography.interactions[0]).toMatchObject({ target: { valueKph: 30 } });
    expect(document.redo()).toBe(true);
    await document.flush();
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
    expect(reopened.data.choreography.interactions).toHaveLength(1);
    expect(reopened.data.choreography.interactions[0]).toMatchObject({
      id: original.id, actor: 'ego', verb: 'speed', trigger: { kind: 'at', t: 0 },
      target: { mode: 'absolute', valueKph: 45 },
    });
    reopened.dispose();
  });

  it('projects placed actors into timeline tracks through delete, undo, redo, and save/reopen', async () => {
    const files = new Map<string, unknown>();
    const store: TemplateFileStore = {
      list: async () => [],
      read: async (name) => {
        if (!files.has(name)) throw new ScenarioNotFoundError(name);
        return structuredClone(files.get(name));
      },
      write: async (name, value) => {
        const serializable = value as { toJSON?: () => unknown };
        files.set(name, structuredClone(serializable.toJSON?.() ?? value));
      },
      delete: async (name) => files.delete(name),
    };
    const map = MAPS[0]!;
    const document = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
    const [actorId] = document.add([{
      catalogId: 'vehicle.sedan', x: 4, y: 0, z: 8, headingRad: 0, label: 'New actor',
    }]);
    const projected = buildTimelineGroups(document.data);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ actorId, label: 'New actor' });
    expect(Object.keys(projected[0]!.tracks)).toEqual(['actions']);

    document.remove([actorId!]);
    expect(buildTimelineGroups(document.data)).toHaveLength(0);
    expect(document.undo()).toBe(true);
    expect(buildTimelineGroups(document.data).map((group) => group.actorId)).toEqual([actorId]);
    expect(document.redo()).toBe(true);
    expect(buildTimelineGroups(document.data)).toHaveLength(0);
    expect(document.undo()).toBe(true);
    await document.flush();
    document.dispose();

    const reopened = await EditorDocument.open(map, { store, autosaveMs: 60_000 });
    expect(buildTimelineGroups(reopened.data).map((group) => group.actorId)).toEqual([actorId]);
    reopened.dispose();
  });
});
