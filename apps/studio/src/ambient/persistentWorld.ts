import { contentHash, type ResolvedAmbientTrafficProfile } from '@uniscenarios/sim-engine';

/** Changes to authored choreography rematerialize the world, but do not reroll traffic. */
export function ambientPopulationKey(mapId: string, profile: ResolvedAmbientTrafficProfile): string {
  return contentHash({ mapId, profile });
}

export function ambientMaterializationKey(populationKey: string, simulationSourceHash: string): string {
  return contentHash({ populationKey, simulationSourceHash });
}

export interface PersistentAmbientEntry<T> {
  readonly populationKey: string;
  readonly materializationKey: string;
  readonly value: T;
}

/**
 * Tiny lifecycle boundary for the background world. Failed or superseded work
 * can never erase the last visible population, and Play reads the same object
 * that the authoring preview rendered.
 */
export class PersistentAmbientWorld<T> {
  private committed: PersistentAmbientEntry<T> | null = null;
  private generation = 0;

  get current(): PersistentAmbientEntry<T> | null {
    return this.committed;
  }

  begin(): number {
    return ++this.generation;
  }

  commit(token: number, entry: PersistentAmbientEntry<T>): boolean {
    if (token !== this.generation) return false;
    this.committed = entry;
    return true;
  }

  fail(token: number): void {
    // Deliberately retain the committed population. Merely mark this attempt
    // complete so a late response cannot replace it.
    if (token === this.generation) this.generation++;
  }

  playback(): T | null {
    return this.committed?.value ?? null;
  }
}
