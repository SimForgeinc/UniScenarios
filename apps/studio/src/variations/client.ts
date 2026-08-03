import type { ScenarioTemplateV2 } from '@uniscenarios/scenario-model';
import type { MapEntry } from '../maps';
import type { PortableBindingAdapter, VariationSearchPayload } from './model';
import type { PortableLiftIssue } from '@uniscenarios/scenario-materializer';
import type { VariationWorkerRequest, VariationWorkerResponse } from './variation-worker';

export class VariationSearchClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private rejectPending: ((reason: Error) => void) | null = null;

  async search(template: ScenarioTemplateV2, sourceMap: MapEntry, maps: readonly MapEntry[], adapter?: PortableBindingAdapter, resumeToken?: string): Promise<VariationSearchPayload> {
    this.cancel();
    const id = ++this.sequence;
    const worker = new Worker(new URL('./variation-worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const source = mapSource(sourceMap);
    const bindingResult = adapter ? await adapter.bind(template, source) : { ok: true, issues: [] };
    if (!bindingResult.ok) throw new PortableLiftError(bindingResult.issues);
    const portableBinding = bindingResult.binding;
    if (portableBinding && portableBinding.template.roles.some((role) => role.kind === 'scene_absolute')) {
      throw new Error('Portable binding adapter returned scene_absolute roles; refusing to send map coordinates to variation search');
    }
    return new Promise((resolve, reject) => {
      this.rejectPending = reject;
      worker.onmessage = (event: MessageEvent<VariationWorkerResponse>) => {
        if (event.data.id !== id || worker !== this.worker) return;
        this.finish(worker);
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error));
      };
      worker.onerror = (event) => {
        if (worker !== this.worker) return;
        this.finish(worker);
        reject(new Error(event.message || 'Variation worker failed'));
      };
      worker.postMessage({
        id, template, sourceMap: source, maps: maps.map(mapSource),
        ...(portableBinding ? { portableBinding } : {}),
        ...(resumeToken ? { resumeToken } : {}),
      } satisfies VariationWorkerRequest);
    });
  }

  cancel(): void {
    this.sequence++;
    this.worker?.terminate();
    this.worker = null;
    const reject = this.rejectPending;
    this.rejectPending = null;
    reject?.(new DOMException('Variation search was canceled', 'AbortError'));
  }

  private finish(worker: Worker): void {
    this.worker = null;
    this.rejectPending = null;
    worker.terminate();
  }
}

export class PortableLiftError extends Error {
  readonly issues: PortableLiftIssue[];
  constructor(issues: PortableLiftIssue[]) {
    super(issues.length
      ? issues.map((issue) => `${issue.path}: ${issue.message}${issue.dependency ? ` (${issue.dependency})` : ''}`).join('\n')
      : 'The authored scene could not be lifted into a portable scenario.');
    this.name = 'PortableLiftError';
    this.issues = issues;
  }
}

function mapSource(map: MapEntry) {
  return { id: map.id, label: map.label, topology: map.topology, derivedTopology: map.derivedTopology, locations: map.locations, xodr: map.xodr, signals: map.signals };
}
