import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MapSignalCatalog } from '@uniscenarios/scenario-materializer';
import type { MapSignalPlan, ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import { mapSignalPlanBindingIssue, TimelineDock, submitTimelineSignalClip } from './TimelineDock';

const plan: MapSignalPlan = {
  id: 'signals-447', version: 1,
  binding: { mapId: 'yale', junctionId: '447', controlDigest: 'digest' },
  clips: [{ id: 'phase_1', startS: 2, endS: 6, reference: { controllerId: 'ctrl', headId: 'head' }, indication: 'green' }],
};

const template = {
  mapSignalPlans: [plan], roles: [], trafficControls: [], props: [], invariants: [], variants: [],
  choreography: { clipSeconds: 20, warmupSeconds: 0, interactions: [] },
} as unknown as ScenarioTemplateV2;

const session = {
  state: { mode: 'authoring' as const, time: 0, duration: 20, validation: 'unchecked' as const, error: null },
  playPause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
};

const catalog: MapSignalCatalog = {
  heads: [{ id: 'head', roadId: '1', s: 10, dynamic: true }], roadControls: [], speedLimits: [], applicability: [],
  controllers: [{ id: 'ctrl', sequence: 0, signalIds: ['head'] }, { id: 'alternate', sequence: 1, signalIds: ['head'] }],
  junctions: [{ junctionId: '447', controllerIds: ['ctrl', 'alternate'] }],
};

describe('controller-level signal timeline UI', () => {
  it('renders a signal group and an indication-colored, resizable phase clip', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template, map: { id: 'yale' } } } as never} editorState={null} session={session as never} signalCatalog={catalog} signalControlDigest="digest" />);
    expect(markup).toContain('data-testid="timeline-signal-row-signals-447"');
    expect(markup).toContain('Intersection 447');
    expect(markup).toContain('data-testid="timeline-signal-clip-phase_1"');
    expect(markup).toContain('data-indication="green"');
    expect(markup).toContain('aria-label="Move green signal phase"');
    expect(markup).toContain('aria-label="Resize green signal phase start"');
    expect(markup).toContain('aria-label="Resize green signal phase end"');
  });

  it('offers explicit controller authoring for a selected physical orb', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template, map: { id: 'yale' } } } as never} editorState={null} session={session as never} signalCatalog={catalog} signalControlDigest="digest" selectedSignalHeadId="head" />);
    expect(markup).toContain('data-testid="selected-signal-head"');
    expect(markup).toContain('Intersection 447');
    expect(markup).toContain('data-testid="timeline-add-signal-controller"');
  });

  it('fails visibly and disables authoring when exact runtime ownership is unresolved', () => {
    const markup = renderToStaticMarkup(<TimelineDock controller={{ doc: { data: template, map: { id: 'yale' } } } as never} editorState={null} session={session as never} signalCatalog={catalog} signalControlDigest="digest" selectedSignalHeadId="head" selectedSignalResolved={false} />);
    expect(markup).toContain('Unbound signal — exact controller ownership is unavailable');
    expect(markup).toContain('disabled="" data-testid="timeline-add-signal-controller"');
  });

  it('commits a new clip by replacing its plan exactly once', () => {
    const replaceMapSignalPlan = vi.fn();
    const document = { data: template, replaceMapSignalPlan } as never;
    const result = submitTimelineSignalClip(document, {
      planId: plan.id, clipId: 'phase_2', startS: 6, endS: 9,
      reference: { controllerId: 'ctrl', headId: 'head' }, indication: 'yellow',
    });
    expect(result.ok).toBe(true);
    expect(replaceMapSignalPlan).toHaveBeenCalledTimes(1);
    expect(replaceMapSignalPlan).toHaveBeenCalledWith(plan.id, expect.objectContaining({ clips: [
      expect.objectContaining({ id: 'phase_1' }), expect.objectContaining({ id: 'phase_2', indication: 'yellow', startS: 6, endS: 9 }),
    ] }));
  });

  it('rejects an overlapping editor draft without mutating the document', () => {
    const replaceMapSignalPlan = vi.fn();
    const result = submitTimelineSignalClip({ data: template, replaceMapSignalPlan } as never, {
      planId: plan.id, clipId: 'phase_2', startS: 5, endS: 7,
      reference: { controllerId: 'ctrl', headId: 'head' }, indication: 'red',
    });
    expect(result).toEqual({ ok: false, message: expect.stringContaining('overlaps “phase_1”') });
    expect(replaceMapSignalPlan).not.toHaveBeenCalled();
  });

  it('adds a pending first plan and clip in one document mutation', () => {
    const addMapSignalPlan = vi.fn();
    const result = submitTimelineSignalClip({ data: { ...template, mapSignalPlans: [] }, addMapSignalPlan } as never, {
      planId: plan.id, clipId: 'phase_1', startS: 2, endS: 6,
      reference: { controllerId: 'ctrl', headId: 'head' }, indication: 'green', pendingPlan: { ...plan, clips: [] },
    });
    expect(result.ok).toBe(true);
    expect(addMapSignalPlan).toHaveBeenCalledTimes(1);
    expect(addMapSignalPlan).toHaveBeenCalledWith(expect.objectContaining({ clips: [expect.objectContaining({ id: 'phase_1' })] }));
  });

  it('fails closed on stale map, digest, and physical ownership bindings', () => {
    expect(mapSignalPlanBindingIssue(plan, 'other-map', 'digest', catalog)).toContain('map changed');
    expect(mapSignalPlanBindingIssue(plan, 'yale', 'other-digest', catalog)).toContain('topology changed');
    expect(mapSignalPlanBindingIssue(plan, 'yale', 'digest', { ...catalog, controllers: [] })).toContain('resolved 0 times');
  });
});
