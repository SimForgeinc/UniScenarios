import type { Group } from 'three';

import { type CatalogId, getEntry } from './catalog';
import type {
  ArrowBoardParams,
  BarrierParams,
  BarrierRunParams,
  ConeParams,
  FlaggerParams,
  PipeParams,
  SignParams,
  SpoilPileParams,
} from './builders/construction';
import {
  buildArrowBoard,
  buildBarricadeTypeIII,
  buildChannelizerDrum,
  buildConstructionSign,
  buildExcavator,
  buildFlagger,
  buildJerseyBarrier,
  buildJerseyBarrierRun,
  buildPortableToilet,
  buildPortableSignal,
  buildPedestrianBarrier,
  buildLongPipe,
  buildSpoilPile,
  buildTemporaryStopSign,
  buildTrafficCone,
} from './builders/construction';
import type { TrashBagParams } from './builders/hazards';
import {
  buildCardboardBox,
  buildDownedBranch,
  buildTireDebris,
  buildTrashBags,
} from './builders/hazards';
import type { PedestrianParams } from './builders/pedestrians';
import {
  buildAdultPedestrian,
  buildChildPedestrian,
  buildTrafficMarshal,
} from './builders/pedestrians';
import type { RunParams } from './builders/street';
import {
  buildBusShelter,
  buildCoveredCar,
  buildDumpster,
  buildFenceRun,
  buildFoodCart,
  buildHedgeRun,
  buildMailboxCluster,
  buildShoppingCart,
} from './builders/street';
import type { VehicleParams } from './builders/vehicles';
import {
  buildAmbulance,
  buildBoxTruck,
  buildBus,
  buildCyclist,
  buildFleetVehicle,
  buildHatchback,
  buildMotorcycle,
  buildMobilityScooter,
  buildPickup,
  buildSedan,
  buildSemiTruck,
  buildSuv,
  buildTram,
  buildVan,
} from './builders/vehicles';
import type { RobotParams } from './builders/robots';
import {
  buildConstructionHumanoid,
  buildCoolerRobot,
  buildDeliveryHumanoid,
  buildDeliveryRover,
  buildGeneralPurposeHumanoid,
  buildPublicSafetyHumanoid,
  buildQuadrupedCourier,
  buildWarehouseHumanoid,
} from './builders/robots';
import type { DroneParams } from './builders/drones';
import { buildCameraDrone, buildDeliveryDrone, buildEmergencyDrone } from './builders/drones';
import type { AnimalParams } from './builders/animals';
import { buildCat, buildDeer, buildDog, buildGoose, buildRaccoon } from './builders/animals';

/** Build parameters accepted by each catalog id. */
export interface PropParamMap {
  'vehicle.sedan': VehicleParams;
  'vehicle.hatchback': VehicleParams;
  'vehicle.suv': VehicleParams;
  'vehicle.pickup': VehicleParams;
  'vehicle.van': VehicleParams;
  'vehicle.box_truck': VehicleParams;
  'vehicle.semi_truck': VehicleParams;
  'vehicle.bus': VehicleParams;
  'vehicle.motorcycle': VehicleParams;
  'vehicle.bicycle': VehicleParams;
  'vehicle.ambulance': VehicleParams;
  'vehicle.tram': VehicleParams;
  'vehicle.mobility_scooter': VehicleParams;
  'vehicle.honda_civic': VehicleParams;
  'vehicle.toyota_camry': VehicleParams;
  'vehicle.tesla_model_3': VehicleParams;
  'vehicle.ford_mustang': VehicleParams;
  'vehicle.chevrolet_corvette': VehicleParams;
  'vehicle.porsche_911': VehicleParams;
  'vehicle.jeep_wrangler': VehicleParams;
  'vehicle.minivan': VehicleParams;
  'vehicle.taxi': VehicleParams;
  'vehicle.police_cruiser': VehicleParams;
  'vehicle.police_suv': VehicleParams;
  'vehicle.fire_command_suv': VehicleParams;
  'vehicle.fire_engine': VehicleParams;
  'vehicle.dump_truck': VehicleParams;
  'vehicle.garbage_truck': VehicleParams;
  'vehicle.tow_truck': VehicleParams;
  'vehicle.cement_mixer': VehicleParams;
  'vehicle.utility_bucket_truck': VehicleParams;
  'vehicle.tanker_truck': VehicleParams;
  'vehicle.flatbed_truck': VehicleParams;
  'vehicle.school_bus': VehicleParams;
  'vehicle.shuttle_bus': VehicleParams;
  'vehicle.delivery_van': VehicleParams;
  'pedestrian.adult': PedestrianParams;
  'pedestrian.child': PedestrianParams;
  'pedestrian.adult_standing': PedestrianParams;
  'pedestrian.adult_walking': PedestrianParams;
  'pedestrian.child_standing': PedestrianParams;
  'pedestrian.child_walking': PedestrianParams;
  'pedestrian.traffic_marshal': PedestrianParams;
  'sidewalk_robot.delivery_rover': RobotParams;
  'sidewalk_robot.cooler_bot': RobotParams;
  'sidewalk_robot.quadruped_courier': RobotParams;
  'sidewalk_robot.humanoid_general_purpose': RobotParams;
  'sidewalk_robot.humanoid_delivery': RobotParams;
  'sidewalk_robot.humanoid_warehouse': RobotParams;
  'sidewalk_robot.humanoid_public_safety': RobotParams;
  'sidewalk_robot.humanoid_construction': RobotParams;
  'drone.delivery_quadcopter': DroneParams;
  'drone.camera_quadcopter': DroneParams;
  'drone.emergency_responder': DroneParams;
  'animal.dog': AnimalParams;
  'animal.cat': AnimalParams;
  'animal.deer': AnimalParams;
  'animal.raccoon': AnimalParams;
  'animal.goose': AnimalParams;
  'construction.traffic_cone': ConeParams;
  'construction.channelizer_drum': Record<string, never>;
  'construction.barricade_type3': Record<string, never>;
  'construction.pedestrian_barrier': Record<string, never>;
  'construction.jersey_barrier': BarrierParams;
  'construction.jersey_barrier_run': BarrierRunParams;
  'construction.sign_road_work': SignParams;
  'construction.flagger': FlaggerParams;
  'construction.arrow_board': ArrowBoardParams;
  'construction.excavator': Record<string, never>;
  'construction.portable_toilet': Record<string, never>;
  'construction.spoil_pile': SpoilPileParams;
  'construction.temporary_stop_sign': Record<string, never>;
  'construction.portable_signal': Record<string, never>;
  'construction.long_pipe': PipeParams;
  'occluder.dumpster': Record<string, never>;
  'occluder.covered_car': Record<string, never>;
  'occluder.hedge_run': RunParams;
  'occluder.fence_run': RunParams;
  'street.mailbox_cluster': Record<string, never>;
  'street.bus_shelter': Record<string, never>;
  'street.food_cart': Record<string, never>;
  'street.shopping_cart': Record<string, never>;
  'hazard.tire_debris': Record<string, never>;
  'hazard.cardboard_box': Record<string, never>;
  'hazard.trash_bags': TrashBagParams;
  'hazard.downed_branch': Record<string, never>;
}

type Builders = { [K in CatalogId]: (params: PropParamMap[K]) => Group };

/**
 * Id -> builder. The mapped type makes this exhaustive: adding a catalog entry
 * without a builder (or vice versa) is a type error, which is the whole point
 * of keeping the ids in one place.
 */
const BUILDERS: Builders = {
  'vehicle.sedan': buildSedan,
  'vehicle.hatchback': buildHatchback,
  'vehicle.suv': buildSuv,
  'vehicle.pickup': buildPickup,
  'vehicle.van': buildVan,
  'vehicle.box_truck': buildBoxTruck,
  'vehicle.semi_truck': buildSemiTruck,
  'vehicle.bus': buildBus,
  'vehicle.motorcycle': buildMotorcycle,
  'vehicle.bicycle': buildCyclist,
  'vehicle.ambulance': buildAmbulance,
  'vehicle.tram': buildTram,
  'vehicle.mobility_scooter': buildMobilityScooter,
  'vehicle.honda_civic': (params) => buildFleetVehicle('vehicle.honda_civic', params),
  'vehicle.toyota_camry': (params) => buildFleetVehicle('vehicle.toyota_camry', params),
  'vehicle.tesla_model_3': (params) => buildFleetVehicle('vehicle.tesla_model_3', params),
  'vehicle.ford_mustang': (params) => buildFleetVehicle('vehicle.ford_mustang', params),
  'vehicle.chevrolet_corvette': (params) => buildFleetVehicle('vehicle.chevrolet_corvette', params),
  'vehicle.porsche_911': (params) => buildFleetVehicle('vehicle.porsche_911', params),
  'vehicle.jeep_wrangler': (params) => buildFleetVehicle('vehicle.jeep_wrangler', params),
  'vehicle.minivan': (params) => buildFleetVehicle('vehicle.minivan', params),
  'vehicle.taxi': (params) => buildFleetVehicle('vehicle.taxi', params),
  'vehicle.police_cruiser': (params) => buildFleetVehicle('vehicle.police_cruiser', params),
  'vehicle.police_suv': (params) => buildFleetVehicle('vehicle.police_suv', params),
  'vehicle.fire_command_suv': (params) => buildFleetVehicle('vehicle.fire_command_suv', params),
  'vehicle.fire_engine': (params) => buildFleetVehicle('vehicle.fire_engine', params),
  'vehicle.dump_truck': (params) => buildFleetVehicle('vehicle.dump_truck', params),
  'vehicle.garbage_truck': (params) => buildFleetVehicle('vehicle.garbage_truck', params),
  'vehicle.tow_truck': (params) => buildFleetVehicle('vehicle.tow_truck', params),
  'vehicle.cement_mixer': (params) => buildFleetVehicle('vehicle.cement_mixer', params),
  'vehicle.utility_bucket_truck': (params) => buildFleetVehicle('vehicle.utility_bucket_truck', params),
  'vehicle.tanker_truck': (params) => buildFleetVehicle('vehicle.tanker_truck', params),
  'vehicle.flatbed_truck': (params) => buildFleetVehicle('vehicle.flatbed_truck', params),
  'vehicle.school_bus': (params) => buildFleetVehicle('vehicle.school_bus', params),
  'vehicle.shuttle_bus': (params) => buildFleetVehicle('vehicle.shuttle_bus', params),
  'vehicle.delivery_van': (params) => buildFleetVehicle('vehicle.delivery_van', params),
  'pedestrian.adult': buildAdultPedestrian,
  'pedestrian.child': buildChildPedestrian,
  'pedestrian.adult_standing': buildAdultPedestrian,
  'pedestrian.adult_walking': buildAdultPedestrian,
  'pedestrian.child_standing': buildChildPedestrian,
  'pedestrian.child_walking': buildChildPedestrian,
  'pedestrian.traffic_marshal': buildTrafficMarshal,
  'sidewalk_robot.delivery_rover': buildDeliveryRover,
  'sidewalk_robot.cooler_bot': buildCoolerRobot,
  'sidewalk_robot.quadruped_courier': buildQuadrupedCourier,
  'sidewalk_robot.humanoid_general_purpose': buildGeneralPurposeHumanoid,
  'sidewalk_robot.humanoid_delivery': buildDeliveryHumanoid,
  'sidewalk_robot.humanoid_warehouse': buildWarehouseHumanoid,
  'sidewalk_robot.humanoid_public_safety': buildPublicSafetyHumanoid,
  'sidewalk_robot.humanoid_construction': buildConstructionHumanoid,
  'drone.delivery_quadcopter': buildDeliveryDrone,
  'drone.camera_quadcopter': buildCameraDrone,
  'drone.emergency_responder': buildEmergencyDrone,
  'animal.dog': buildDog,
  'animal.cat': buildCat,
  'animal.deer': buildDeer,
  'animal.raccoon': buildRaccoon,
  'animal.goose': buildGoose,
  'construction.traffic_cone': buildTrafficCone,
  'construction.channelizer_drum': buildChannelizerDrum,
  'construction.barricade_type3': buildBarricadeTypeIII,
  'construction.pedestrian_barrier': buildPedestrianBarrier,
  'construction.jersey_barrier': buildJerseyBarrier,
  'construction.jersey_barrier_run': buildJerseyBarrierRun,
  'construction.sign_road_work': buildConstructionSign,
  'construction.flagger': buildFlagger,
  'construction.arrow_board': buildArrowBoard,
  'construction.excavator': buildExcavator,
  'construction.portable_toilet': buildPortableToilet,
  'construction.spoil_pile': buildSpoilPile,
  'construction.temporary_stop_sign': buildTemporaryStopSign,
  'construction.portable_signal': buildPortableSignal,
  'construction.long_pipe': buildLongPipe,
  'occluder.dumpster': buildDumpster,
  'occluder.covered_car': buildCoveredCar,
  'occluder.hedge_run': buildHedgeRun,
  'occluder.fence_run': buildFenceRun,
  'street.mailbox_cluster': buildMailboxCluster,
  'street.bus_shelter': buildBusShelter,
  'street.food_cart': buildFoodCart,
  'street.shopping_cart': buildShoppingCart,
  'hazard.tire_debris': buildTireDebris,
  'hazard.cardboard_box': buildCardboardBox,
  'hazard.trash_bags': buildTrashBags,
  'hazard.downed_branch': buildDownedBranch,
};

/**
 * Build a prop by catalog id.
 *
 * Parameters are merged over the entry's `defaultParams`, so `buildProp(id)`
 * always produces the object whose dimensions the catalog advertises. The
 * returned group is ground-centred, faces +X and carries
 * `userData.catalogId` for round-tripping back to the catalog.
 */
export function buildProp<K extends CatalogId>(
  id: K,
  params?: Partial<PropParamMap[K]>,
): Group {
  const builder = BUILDERS[id];
  if (!builder) throw new Error(`Unknown catalog id: ${id}`);
  const entry = getEntry(id);
  const merged = { ...entry.defaultParams, ...params } as PropParamMap[K];
  const group = builder(merged);
  group.name = id;
  group.userData.catalogId = id;
  group.userData.params = merged;
  return group;
}

/** The set of ids that have a builder — identical to the catalog ids. */
export const BUILDER_IDS = Object.keys(BUILDERS) as readonly CatalogId[];
