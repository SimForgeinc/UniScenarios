import type { MapSignalCatalog } from '@uniscenarios/scenario-materializer';
import type { MapSignalPlan } from '@uniscenarios/scenario-model';

export interface PhysicalSignalChoice {
  readonly headId: string;
  readonly junctionId: string;
  readonly controllerId: string;
  readonly controllerSequence: number;
}

/** Resolve every authoritative junction/controller-stage membership for one physical head. */
export function physicalSignalChoices(
  catalog: MapSignalCatalog,
  headId: string,
): PhysicalSignalChoice[] {
  const controllers = catalog.controllers
    .filter((controller) => controller.signalIds.includes(headId));
  const choices = controllers.flatMap((controller) => catalog.junctions
    .filter((junction) => junction.controllerIds.includes(controller.id))
    .map((junction) => ({
      headId,
      junctionId: junction.junctionId,
      controllerId: controller.id,
      controllerSequence: controller.sequence,
    })));
  return choices.sort((left, right) => left.junctionId.localeCompare(right.junctionId)
    || left.controllerSequence - right.controllerSequence
    || left.controllerId.localeCompare(right.controllerId));
}

/** Keep a shared physical head on the exact junction/controller stage derived
 * by the executable reverse index; catalog order is never treated as ownership. */
export function physicalSignalChoiceIndex(
  choices: readonly PhysicalSignalChoice[],
  junctionId: string | null | undefined,
  controllerId: string | null | undefined,
): number {
  const exact = choices.findIndex((choice) => choice.junctionId === junctionId
    && choice.controllerId === controllerId);
  return exact >= 0 ? exact : 0;
}

export function createMapSignalPlan(
  mapId: string,
  controlDigest: string,
  choice: PhysicalSignalChoice,
  existingIds: ReadonlySet<string> = new Set(),
): MapSignalPlan {
  const base = `signals-${choice.junctionId}`.replace(/[^A-Za-z0-9._:@/-]/g, '-').slice(0, 112) || 'signals';
  let id = base;
  for (let ordinal = 2; existingIds.has(id); ordinal += 1) id = `${base}-${ordinal}`.slice(0, 128);
  return {
    id,
    version: 1,
    binding: { mapId, junctionId: choice.junctionId, controlDigest },
    clips: [],
  };
}

/** All physical heads owned by a junction plan, used to arbitrate visual ownership. */
export function ownedSignalHeadIds(
  catalog: MapSignalCatalog | null | undefined,
  plans: readonly Pick<MapSignalPlan, 'binding'>[],
): ReadonlySet<string> {
  if (!catalog || plans.length === 0) return new Set();
  const junctionIds = new Set(plans.map((plan) => plan.binding.junctionId));
  const controllerIds = new Set(catalog.junctions
    .filter((junction) => junctionIds.has(junction.junctionId))
    .flatMap((junction) => junction.controllerIds));
  return new Set(catalog.controllers
    .filter((controller) => controllerIds.has(controller.id))
    .flatMap((controller) => controller.signalIds));
}
