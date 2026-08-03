import {
  contentHash,
  normalizeSimScenarioInput,
  type AmbientTrafficProfile,
  type AmbientTrafficProvenance,
  type SimActor,
  type SimScenarioInput,
} from '@uniscenarios/sim-engine';

export interface AmbientPopulationSnapshot {
  readonly actors: readonly SimActor[];
  readonly provenance: AmbientTrafficProvenance;
}

export function isAmbientSimActor(actor: Pick<SimActor, 'id' | 'tags'>): boolean {
  return actor.id.startsWith('ambient:')
    || actor.id.startsWith('ambient-')
    || actor.tags.some((tag) => tag === 'ambient' || tag.startsWith('ambient:'));
}

/** Attach exact generated actors to a newly materialized authored input. */
export function reuseAmbientPopulation(
  base: SimScenarioInput,
  profile: AmbientTrafficProfile,
  snapshot: AmbientPopulationSnapshot | undefined,
): { input: SimScenarioInput; provenance: AmbientTrafficProvenance } | null {
  if (!snapshot || snapshot.provenance.profileHash !== contentHash(profile)) return null;
  const actors = snapshot.actors.filter(isAmbientSimActor);
  const input = normalizeSimScenarioInput({ ...base, actors: [...base.actors.filter((actor) => !isAmbientSimActor(actor)), ...actors] });
  return {
    input,
    provenance: {
      ...snapshot.provenance,
      baseInputHash: contentHash(base),
      generatedInputHash: contentHash(input),
    },
  };
}
