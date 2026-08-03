import type { AcceptedVariationProject, VariationDecision } from './model';

const DECISIONS_KEY = 'uniscenarios.studio.variation-decisions.v1';
const PROJECTS_KEY = 'uniscenarios.studio.variation-projects.v1';

function readArray<T>(key: string): T[] {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]');
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

function writeArray<T>(key: string, value: readonly T[]): void {
  globalThis.localStorage?.setItem(key, JSON.stringify(value));
}

export class VariationProjectStore {
  decisions(): VariationDecision[] { return readArray<VariationDecision>(DECISIONS_KEY); }
  projects(): AcceptedVariationProject[] { return readArray<AcceptedVariationProject>(PROJECTS_KEY); }

  decision(key: string): VariationDecision | undefined {
    return this.decisions().find((item) => item.key === key);
  }

  recordDecision(decision: VariationDecision): void {
    const next = this.decisions().filter((item) => item.key !== decision.key);
    next.push(decision);
    writeArray(DECISIONS_KEY, next.sort((a, b) => a.key.localeCompare(b.key)));
  }

  saveProject(project: AcceptedVariationProject): void {
    const next = this.projects().filter((item) => item.key !== project.key);
    next.push(project);
    writeArray(PROJECTS_KEY, next.sort((a, b) => a.key.localeCompare(b.key)));
  }
}

