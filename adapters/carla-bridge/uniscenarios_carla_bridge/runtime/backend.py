from __future__ import annotations

from pathlib import Path
from dataclasses import dataclass
from math import isfinite, sqrt
import os
from threading import Condition, Lock
from time import monotonic
from typing import Any, Callable, Mapping, Protocol

from .compiler import LIFECYCLE_ABSENT, ActorBinding, PlanFrame
from .contract import ASSET_CATALOG_SCHEMA, ContractError, Environment, RenderSpec

#: Period of one deterministic flash cycle, 50% duty, phase-locked to plan time.
FLASH_PERIOD_S = 1.0

#: How each authored signal indication is realised on CARLA hardware.
#:
#: `carla.TrafficLightState` has exactly four renderable lamps
#: (Red/Yellow/Green/Off), so the eleven authored indications resolve onto them.
#: Its fifth member, `Unknown = 4`, is a readback sentinel rather than a lamp and
#: is never written; `bind_signals` captures whatever it reads as an opaque token
#: and restores it verbatim, so an `Unknown` read back from the runtime survives
#: the round trip without this table needing an entry for it.
#: This is not a lossy shortcut: a head's arrow/X glyph is hardware derived from
#: the plan's protected turns (`signal-head-model.ts`), never from the phase
#: word, so `green_arrow` genuinely *is* a green lamp on an arrow head. The
#: browser signal overlay (`uniscenario-xodr-tools/src/overlays/signals.ts`)
#: resolves the same eleven words onto the same colours, and renders the two
#: flashing indications by alternating against `off` — which is what the second
#: tuple element asks for here.
SIGNAL_LAMP_BY_INDICATION: Mapping[str, tuple[str, bool]] = {
    "green": ("green", False),
    "yellow": ("yellow", False),
    "red": ("red", False),
    "off": ("off", False),
    "green_arrow": ("green", False),
    "yellow_arrow": ("yellow", False),
    "red_x": ("red", False),
    "proceed": ("green", False),
    "stop": ("red", False),
    "flashing_yellow": ("yellow", True),
    "flashing_red": ("red", True),
}

#: OpenSCENARIO `vehicleLightType` -> the `carla.VehicleLightState` members it
#: raises. CARLA has no dedicated hazard bit, so warning lights are both
#: blinkers; emergency beacons use the vehicle's special-purpose channel. CARLA
#: has no daytime-running-lamp bit either, so `daytimeRunningLights` drives the
#: position-lamp channel, which is the closest thing it can actually render.
#:
#: Every entry here is deliberately DISJOINT from every other. `_apply_vehicle_lights`
#: iterates `sorted(lights)`, so overlapping bit sets would make the final mask
#: depend on the alphabetical order of the light-type names — `highBeam` sorts
#: before `lowBeam`, so a `low` beam setting expressed as overlapping masks
#: would be silently order-dependent. Keeping the sets disjoint means the writer
#: decides the beam combination and this table only translates it.
VEHICLE_LIGHT_BITS: Mapping[str, tuple[str, ...]] = {
    "indicatorLeft": ("LeftBlinker",),
    "indicatorRight": ("RightBlinker",),
    "warningLights": ("LeftBlinker", "RightBlinker"),
    "brakeLights": ("Brake",),
    "reversingLights": ("Reverse",),
    "specialPurposeLights": ("Special1",),
    "daytimeRunningLights": ("Position",),
    "lowBeam": ("LowBeam",),
    "highBeam": ("HighBeam",),
}

#: OpenSCENARIO `vehicleComponentType` -> the `carla.VehicleDoor` member.
#:
#: There is no `trunk` entry and there cannot be one: CARLA 0.10.0's binding
#: exports only `FL=0, FR=1, RL=2, RR=3, All=6`. The C++ enum does define
#: `Hood = 4, Trunk = 5` (`LibCarla/source/carla/rpc/VehicleDoor.h`), but
#: `PythonAPI/carla/src/Actor.cpp` exports only the five — an upstream binding
#: omission, not a UE5 regression. `carla.VehicleDoor(5)` would construct,
#: because boost::python enums accept arbitrary ints, but whether the UE5 asset
#: actually actuates a trunk is unverified, and a silent no-op in a paid render
#: is worse than refusing the scenario at export. So `doors.rear` is rejected by
#: the writer instead. `RL`/`RR` are genuinely available if the set-key schema
#: ever grows a rear-door distinction.
VEHICLE_DOOR_MEMBERS: Mapping[str, str] = {
    "doorFrontLeft": "FL",
    "doorFrontRight": "FR",
}

#: How far below its last authored pose an actor is parked once it goes absent.
DESPAWN_SINK_M = 1000.0


def flash_on(t: float) -> bool:
    """Deterministic 50% duty flash phase for plan time `t`."""
    return int(t / (FLASH_PERIOD_S / 2)) % 2 == 0


def resolve_signal_lamp(indication: str, t: float) -> str:
    """Resolve an authored indication to the lamp CARLA should show at `t`."""
    resolution = SIGNAL_LAMP_BY_INDICATION.get(indication)
    if resolution is None:
        raise RuntimeError(f"execution plan carries an unrenderable traffic signal indication {indication}")
    lamp, flashing = resolution
    return lamp if not flashing or flash_on(t) else "off"


@dataclass(frozen=True)
class _OwnedSignalSnapshot:
    light: Any
    state: Any
    frozen: bool | None
    green_time: float
    yellow_time: float
    red_time: float


def runtime_asset_bindings(
    manifest: Any,
    *,
    expected_catalog_version_id: str,
    abort: Callable[[], None] | None = None,
) -> dict[str, Mapping[str, str]]:
    """Validate a signed asset-catalog manifest and index its exact CARLA bindings."""
    check = abort or (lambda: None)
    check()
    if not isinstance(manifest, Mapping):
        raise ContractError("asset catalog manifest must be a JSON object")
    if manifest.get("contractVersion") != ASSET_CATALOG_SCHEMA:
        raise ContractError(f"asset catalog manifest contractVersion must equal {ASSET_CATALOG_SCHEMA}")
    if manifest.get("catalogVersionId") != expected_catalog_version_id:
        raise ContractError("asset catalog manifest version does not match the execution package")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ContractError("asset catalog manifest entries must be an array")
    bindings: dict[str, Mapping[str, str]] = {}
    for index, entry in enumerate(entries):
        check()
        if not isinstance(entry, Mapping):
            raise ContractError(f"asset catalog entry {index} must be an object")
        asset_id = entry.get("id")
        if not isinstance(asset_id, str) or not asset_id:
            raise ContractError(f"asset catalog entry {index} must have a non-empty id")
        if asset_id in bindings:
            raise ContractError(f"asset catalog contains duplicate id {asset_id}")
        runtime = entry.get("runtimeBindings")
        carla = runtime.get("carla") if isinstance(runtime, Mapping) else None
        blueprint_id = carla.get("blueprintId") if isinstance(carla, Mapping) else None
        if not isinstance(blueprint_id, str) or not blueprint_id:
            raise ContractError(f"asset catalog entry {asset_id} has no exact CARLA blueprintId")
        bindings[asset_id] = {"blueprintId": blueprint_id}
    if not bindings:
        raise ContractError("asset catalog manifest must contain at least one entry")
    check()
    return bindings


class RenderBackend(Protocol):
    def set_rpc_timeout(self, timeout_s: float) -> None: ...
    def configure_execution(self, mode: str) -> None: ...
    def configure_environment(self, environment: Environment) -> None: ...
    def load_opendrive(self, map_name: str, xodr: bytes, fixed_timestep_s: float) -> None: ...
    def bind_signals(self, signal_ids: tuple[str, ...], abort: Callable[[], None] | None = None) -> None: ...
    def spawn(self, actors: Mapping[str, ActorBinding], first_frame: PlanFrame, catalog: Mapping[str, Any], abort: Callable[[], None] | None = None) -> None: ...
    def prepare_scenario(self, first_frame: PlanFrame, abort: Callable[[], None] | None = None) -> Mapping[str, Any] | None: ...
    def configure_cameras(self, spec: RenderSpec, output_dir: Path, max_capture_disk_bytes: int, abort: Callable[[], None] | None = None) -> None: ...
    def apply(self, frame: PlanFrame, abort: Callable[[], None] | None = None) -> None: ...
    def tick(self, capture: Mapping[str, float | int] | None = None, abort: Callable[[], None] | None = None) -> Mapping[str, Mapping[str, float]]: ...
    def finalize_capture(self, expected_frame_count: int, abort: Callable[[], None] | None = None) -> None: ...
    def cleanup(self) -> None: ...
    def sensor_manifest(self, abort: Callable[[], None] | None = None) -> list[Mapping[str, Any]]: ...
    def signal_readback(self, abort: Callable[[], None] | None = None) -> Mapping[str, str]: ...


class CarlaBackend:
    """Small native CARLA adapter owned by the UniScenario worker."""

    def __init__(self, host: str = "127.0.0.1", port: int = 2000, timeout: float = 60.0):
        try:
            import carla  # type: ignore
        except ImportError as exc:
            raise RuntimeError("CARLA PythonAPI is required in the render container") from exc
        self.carla = carla
        self.client = carla.Client(host, port)
        self.client.set_timeout(timeout)
        self.world = None
        self.actors: dict[str, Any] = {}
        self.sensors: list[Any] = []
        self.signals: dict[str, Any] = {}
        self.signal_snapshots: dict[int, _OwnedSignalSnapshot] = {}
        self.executed_signals: dict[str, str] = {}
        self.executed_signal_lamps: dict[str, Any] = {}
        self.execution_mode = "native-physics"
        self.sensor_records: list[dict[str, Any]] = []
        self.sensor_lock = Lock()
        self.sensor_condition = Condition(self.sensor_lock)
        self.sensor_pending: dict[int, dict[str, Any]] = {}
        self.sensor_last_frame: dict[str, int] = {}
        self.sensor_configs: dict[str, dict[str, Any]] = {}
        self.sensor_error: RuntimeError | None = None
        self.sensor_closed = False
        self.capture_disk_bytes = 0
        self.max_capture_disk_bytes = 0
        self.sensor_timeout_s = float(os.environ.get("UNISCENARIO_SENSOR_FRAME_TIMEOUT_S", "10"))
        if not isfinite(self.sensor_timeout_s) or self.sensor_timeout_s <= 0:
            raise RuntimeError("UNISCENARIO_SENSOR_FRAME_TIMEOUT_S must be finite and positive")
        self.fixed_timestep_s = 0.02
        self.speed_integrals: dict[str, float] = {}
        self.absent_actors: set[str] = set()
        self.door_states: dict[tuple[str, str], str] = {}

    def configure_execution(self, mode: str) -> None:
        if mode not in {"native-physics", "diagnostic-replay"}:
            raise RuntimeError(f"unsupported execution mode {mode}")
        self.execution_mode = mode

    def set_rpc_timeout(self, timeout_s: float) -> None:
        if not isfinite(timeout_s) or timeout_s <= 0:
            raise RuntimeError("CARLA RPC timeout must be finite and positive")
        self.client.set_timeout(min(60.0, timeout_s))

    def configure_environment(self, environment: Environment) -> None:
        assert self.world is not None
        self.world.set_weather(self.carla.WeatherParameters(
            cloudiness=environment.cloudiness,
            precipitation=environment.precipitation,
            precipitation_deposits=environment.precipitation_deposits,
            wind_intensity=environment.wind_intensity,
            sun_azimuth_angle=environment.sun_azimuth_angle,
            sun_altitude_angle=environment.sun_altitude_angle,
            fog_density=environment.fog_density,
            fog_distance=environment.fog_distance,
            wetness=environment.wetness,
        ))

    def load_opendrive(self, map_name: str, xodr: bytes, fixed_timestep_s: float) -> None:
        del map_name
        params = self.carla.OpendriveGenerationParameters(vertex_distance=2.0, max_road_length=500.0, wall_height=0.0, additional_width=0.6, smooth_junctions=True, enable_mesh_visibility=True)
        self.world = self.client.generate_opendrive_world(xodr.decode("utf-8"), params)
        self.fixed_timestep_s = fixed_timestep_s
        settings = self.world.get_settings()
        settings.synchronous_mode = True
        settings.fixed_delta_seconds = fixed_timestep_s
        settings.no_rendering_mode = False
        self.world.apply_settings(settings)

    def spawn(self, actors: Mapping[str, ActorBinding], first_frame: PlanFrame, catalog: Mapping[str, Any], abort: Callable[[], None] | None = None) -> None:
        assert self.world is not None
        check = abort or (lambda: None)
        check()
        library = self.world.get_blueprint_library()
        for actor_id, binding in actors.items():
            check()
            state = first_frame.actors[actor_id]
            entry = catalog.get(binding.catalog_name, {}) if isinstance(catalog, Mapping) else {}
            blueprint_id = entry.get("blueprintId") if isinstance(entry, Mapping) else None
            if not isinstance(blueprint_id, str) or not blueprint_id:
                raise RuntimeError(f"asset catalog has no exact CARLA binding for {actor_id} ({binding.catalog_name})")
            try:
                blueprint = library.find(blueprint_id)
            except RuntimeError as exc:
                raise RuntimeError(
                    f"CARLA runtime is missing required catalog blueprint for {actor_id} ({blueprint_id}, {binding.kind})"
                ) from exc
            transform = self.carla.Transform(
                self.carla.Location(x=state.x, y=-state.y, z=state.z + 0.25),
                self.carla.Rotation(yaw=-state.heading_deg),
            )
            actor = self.world.try_spawn_actor(blueprint, transform)
            check()
            if actor is None:
                raise RuntimeError(f"CARLA failed to spawn {actor_id} as {blueprint_id}")
            self.actors[actor_id] = actor

    def bind_signals(self, signal_ids: tuple[str, ...], abort: Callable[[], None] | None = None) -> None:
        """Take complete, reversible ownership of the map's traffic lights."""
        check = abort or (lambda: None)
        check()
        if not signal_ids:
            return
        assert self.world is not None
        authored = set(signal_ids)
        try:
            lights = list(self.world.get_actors().filter("traffic.traffic_light*"))
        except Exception as exc:  # noqa: BLE001 - this is an execution ownership boundary.
            raise RuntimeError("CARLA traffic light enumeration failed before ownership") from exc
        check()

        resolved: dict[str, Any] = {}
        unbound: list[str] = []
        duplicate_ids: list[str] = []
        for light in lights:
            check()
            try:
                signal_id = str(light.get_opendrive_id() or "").strip()
            except Exception as exc:  # noqa: BLE001 - reject the full map before mutation.
                raise RuntimeError("CARLA traffic light identity read failed before ownership") from exc
            if not signal_id:
                unbound.append(str(getattr(light, "id", "unknown")))
                continue
            if signal_id in resolved:
                duplicate_ids.append(signal_id)
            resolved[signal_id] = light
        runtime_ids = set(resolved)
        missing = sorted(authored - runtime_ids)
        extra = sorted(runtime_ids - authored)
        if missing or extra or unbound or duplicate_ids:
            details = []
            if missing:
                details.append(f"missing: {', '.join(missing)}")
            if extra:
                details.append(f"extra: {', '.join(extra)}")
            if unbound:
                details.append(f"unbound actor ids: {', '.join(sorted(unbound))}")
            if duplicate_ids:
                details.append(f"duplicate OpenDRIVE ids: {', '.join(sorted(set(duplicate_ids)))}")
            raise RuntimeError(
                "authored OpenDRIVE traffic signal heads do not exactly match instantiated CARLA lights ("
                + "; ".join(details)
                + ")"
            )

        snapshots: dict[int, _OwnedSignalSnapshot] = {}
        for light in lights:
            check()
            key = self._signal_identity(light)
            if key in snapshots:
                raise RuntimeError("CARLA returned duplicate traffic light actor identities before ownership")
            get_state = getattr(light, "get_state", None)
            is_frozen = getattr(light, "is_frozen", None)
            duration_getters = (
                getattr(light, "get_green_time", None),
                getattr(light, "get_yellow_time", None),
                getattr(light, "get_red_time", None),
            )
            if not callable(get_state) or not all(callable(getter) for getter in duration_getters):
                raise RuntimeError("CARLA traffic light snapshot API is incomplete before ownership")
            try:
                state = get_state()
                frozen = bool(is_frozen()) if callable(is_frozen) else None
                green_time, yellow_time, red_time = (float(getter()) for getter in duration_getters)
            except Exception as exc:  # noqa: BLE001 - reject before taking ownership.
                raise RuntimeError("CARLA traffic signal state snapshot failed before ownership") from exc
            snapshots[key] = _OwnedSignalSnapshot(
                light, state, frozen, green_time, yellow_time, red_time,
            )

        self.signals = resolved
        self.signal_snapshots = snapshots
        self.executed_signals = {}
        self.executed_signal_lamps = {}
        try:
            for snapshot in snapshots.values():
                check()
                snapshot.light.freeze(True)
            check()
            self.world.tick()
            check()
        except Exception as original_error:
            try:
                self._restore_owned_signals()
            except Exception as cleanup_error:
                raise original_error.with_traceback(original_error.__traceback__) from cleanup_error
            raise

    @staticmethod
    def _signal_identity(light: Any) -> int:
        actor_id = getattr(light, "id", None)
        return actor_id if isinstance(actor_id, int) else id(light)

    def _restore_owned_signals(self) -> None:
        snapshots = list(getattr(self, "signal_snapshots", {}).values())
        self.signal_snapshots = {}
        self.signals = {}
        if not snapshots:
            return
        errors: list[Exception] = []
        for snapshot in snapshots:
            for setter_name, value in (
                ("set_state", snapshot.state),
                ("set_green_time", snapshot.green_time),
                ("set_yellow_time", snapshot.yellow_time),
                ("set_red_time", snapshot.red_time),
            ):
                try:
                    getattr(snapshot.light, setter_name)(value)
                except Exception as exc:  # noqa: BLE001 - attempt every restoration operation.
                    errors.append(exc)
        try:
            self.world.tick()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        for snapshot in snapshots:
            try:
                snapshot.light.freeze(False if snapshot.frozen is None else snapshot.frozen)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
        try:
            self.world.tick()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        if errors:
            raise RuntimeError(f"CARLA traffic light restoration failed in {len(errors)} operation(s)") from errors[0]

    def prepare_scenario(self, first_frame: PlanFrame, abort: Callable[[], None] | None = None) -> Mapping[str, Any] | None:
        """Settle native actors before scenario t=0 and reset dynamic state.

        CARLA vehicles must be spawned slightly above the OpenDRIVE surface so
        their collision shapes do not intersect it.  Sampling immediately after
        spawn consequently records the short gravity-driven drop as scenario
        motion.  Pre-rolling with deterministic braking lets native suspension
        and contacts settle without weakening parity or replaying kinematics.
        Sensors are attached only after this method returns, so neither the
        pre-roll nor its timestamps are render output.
        """
        if self.execution_mode != "native-physics":
            return None
        check = abort or (lambda: None)
        check()
        assert self.world is not None
        for actor in self.actors.values():
            check()
            if actor.type_id.startswith(("vehicle.", "bike.")):
                actor.apply_control(self.carla.VehicleControl(throttle=0.0, brake=1.0, steer=0.0))
            elif actor.type_id.startswith("walker."):
                actor.apply_control(self.carla.WalkerControl(speed=0.0, jump=False))
        reports = [self._wait_for_native_stability("spawn settle", minimum_ticks=20, maximum_ticks=100, abort=abort)]
        zero = self.carla.Vector3D(x=0.0, y=0.0, z=0.0)
        for actor_id, actor in self.actors.items():
            check()
            state = first_frame.actors[actor_id]
            settled = actor.get_transform()
            actor.set_transform(self.carla.Transform(
                self.carla.Location(x=state.x, y=-state.y, z=settled.location.z),
                self.carla.Rotation(yaw=-state.heading_deg),
            ))
            actor.set_target_velocity(zero)
            actor.set_target_angular_velocity(zero)
            self.speed_integrals[actor_id] = 0.0
        reports.append(self._wait_for_native_stability("post-reset", minimum_ticks=5, maximum_ticks=100, abort=abort))
        # The stability window can introduce tiny horizontal suspension drift.
        # Restore the authored planar pose once more without changing settled z;
        # no world tick occurs between this reset and scenario frame zero.
        for actor_id, actor in self.actors.items():
            check()
            state = first_frame.actors[actor_id]
            settled = actor.get_transform()
            actor.set_transform(self.carla.Transform(
                self.carla.Location(x=state.x, y=-state.y, z=settled.location.z),
                self.carla.Rotation(yaw=-state.heading_deg),
            ))
            actor.set_target_velocity(zero)
            actor.set_target_angular_velocity(zero)
        return {
            "schema": "uniscenario.native-stability/v1",
            "thresholds": {
                "linearMps": 0.02,
                "verticalMps": 0.01,
                "angularRadps": 0.02,
                "horizontalDriftM": 0.001,
                "verticalDriftM": 0.001,
                "yawDriftDeg": 0.02,
                "consecutiveTicks": 5,
            },
            "phases": reports,
        }

    def _wait_for_native_stability(self, phase: str, *, minimum_ticks: int, maximum_ticks: int, abort: Callable[[], None] | None = None) -> Mapping[str, Any]:
        """Fail closed unless every actor is physically stable for five ticks."""
        assert self.world is not None
        check = abort or (lambda: None)
        check()
        previous = {actor_id: actor.get_transform() for actor_id, actor in self.actors.items()}
        consecutive = 0
        residuals: dict[str, dict[str, float]] = {}
        for tick in range(1, maximum_ticks + 1):
            check()
            self.world.tick()
            check()
            residuals = {}
            stable = True
            current = {}
            for actor_id, actor in self.actors.items():
                check()
                transform = actor.get_transform()
                velocity = actor.get_velocity()
                angular = actor.get_angular_velocity()
                prior = previous[actor_id]
                linear_speed = sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2)
                angular_speed = sqrt(angular.x ** 2 + angular.y ** 2 + angular.z ** 2)
                horizontal_drift = sqrt(
                    (transform.location.x - prior.location.x) ** 2
                    + (transform.location.y - prior.location.y) ** 2
                )
                vertical_drift = abs(transform.location.z - prior.location.z)
                yaw_drift = abs(((transform.rotation.yaw - prior.rotation.yaw + 180) % 360) - 180)
                residuals[actor_id] = {
                    "linearMps": linear_speed,
                    "verticalMps": abs(velocity.z),
                    "angularRadps": angular_speed,
                    "horizontalDriftM": horizontal_drift,
                    "verticalDriftM": vertical_drift,
                    "yawDriftDeg": yaw_drift,
                }
                if (
                    linear_speed > 0.02
                    or abs(velocity.z) > 0.01
                    or angular_speed > 0.02
                    or horizontal_drift > 0.001
                    or vertical_drift > 0.001
                    or yaw_drift > 0.02
                ):
                    stable = False
                current[actor_id] = transform
            previous = current
            consecutive = consecutive + 1 if stable and tick >= minimum_ticks else 0
            if consecutive >= 5:
                return {"phase": phase, "ticks": tick, "residuals": residuals}
        raise RuntimeError(
            f"native actor stability did not converge during {phase} after {maximum_ticks} ticks: {residuals}"
        )

    def _vehicle_longitudinal_control(self, actor_id: str, target_speed: float, speed: float) -> tuple[float, float]:
        """Return native throttle/brake controls, including crawl-speed actuation.

        A pure proportional command falls below CARLA vehicle driveline static
        friction for OSC crawl trajectories.  Feed-forward supplies the minimum
        useful native actuation while the bounded integral closes the remaining
        error.  Overspeed always clears the integral and applies braking, which
        prevents wind-up and limits the small unavoidable crawl-speed ripple.
        """
        target = max(0.0, target_speed)
        error = target - speed
        if target <= 1e-4:
            self.speed_integrals[actor_id] = 0.0
            return 0.0, min(1.0, 0.15 + speed * 0.8) if speed > 1e-3 else 1.0
        overspeed_deadband = max(0.015, target * 0.08)
        if error < -overspeed_deadband:
            self.speed_integrals[actor_id] = 0.0
            return 0.0, min(1.0, 0.08 + (-error) * 0.65)
        integral = self.speed_integrals.get(actor_id, 0.0)
        integral = min(0.35, max(-0.1, integral + error * self.fixed_timestep_s))
        feed_forward = (0.18 if target < 0.5 else 0.08) + min(0.18, target * 0.012)
        command = feed_forward + error * 0.32 + integral * 0.18
        throttle = min(1.0, max(0.0, command))
        # Do not integrate further while the actuator is saturated in the same
        # direction as the error.
        if throttle < 1.0 or error < 0.0:
            self.speed_integrals[actor_id] = integral
        return throttle, 0.0

    def configure_cameras(self, spec: RenderSpec, output_dir: Path, max_capture_disk_bytes: int, abort: Callable[[], None] | None = None) -> None:
        assert self.world is not None
        check = abort or (lambda: None)
        check()
        if max_capture_disk_bytes <= 0:
            raise ContractError("capture disk quota must be positive")
        self.capture_disk_bytes = 0
        self.max_capture_disk_bytes = max_capture_disk_bytes
        output_dir.mkdir(parents=True, exist_ok=True)
        library = self.world.get_blueprint_library()
        sensor_blueprints = {
            "rgb": "sensor.camera.rgb",
            "depth": "sensor.camera.depth",
            "semantic": "sensor.camera.semantic_segmentation",
            "instance": "sensor.camera.instance_segmentation",
        }
        converters = {
            "depth": self.carla.ColorConverter.LogarithmicDepth,
            "semantic": self.carla.ColorConverter.CityScapesPalette,
            "instance": self.carla.ColorConverter.Raw,
        }
        quality_attributes = {
            "preview": {"enable_postprocess_effects": "False", "motion_blur_intensity": "0.0", "gamma": "2.2"},
            "standard": {"enable_postprocess_effects": "True", "motion_blur_intensity": "0.15", "gamma": "2.2"},
            "high": {"enable_postprocess_effects": "True", "motion_blur_intensity": "0.35", "gamma": "2.2"},
            "cinematic": {"enable_postprocess_effects": "True", "motion_blur_intensity": "0.5", "gamma": "2.2"},
        }
        for camera in spec.cameras:
            check()
            blueprint = library.find(sensor_blueprints[camera.kind])
            blueprint.set_attribute("image_size_x", str(spec.width))
            blueprint.set_attribute("image_size_y", str(spec.height))
            blueprint.set_attribute("fov", str(camera.fov))
            # Every world tick must produce a callback. The worker selects the
            # exact 30 fps output world frames from the 50 Hz execution plan.
            blueprint.set_attribute("sensor_tick", "0.0")
            for name, value in quality_attributes[spec.quality].items():
                if blueprint.has_attribute(name):
                    blueprint.set_attribute(name, value)
            t = camera.transform
            transform = self.carla.Transform(self.carla.Location(x=t["x"], y=-t["y"], z=t["z"]), self.carla.Rotation(pitch=t["pitch"], yaw=-t["yaw"], roll=t["roll"]))
            resolved_attach_to = camera.attach_to
            if not resolved_attach_to and camera.mount != "world":
                resolved_attach_to = next(iter(self.actors))
            parent = self.actors.get(resolved_attach_to) if resolved_attach_to else None
            sensor = self.world.spawn_actor(blueprint, transform, attach_to=parent)
            check()
            camera_dir = output_dir / camera.id
            camera_dir.mkdir(parents=True, exist_ok=True)
            self.sensor_configs[camera.id] = {
                "target": camera_dir, "kind": camera.kind, "converter": converters.get(camera.kind),
                "attachTo": resolved_attach_to, "mount": camera.mount,
            }
            sensor.listen(lambda image, camera_id=camera.id: self._receive_sensor_frame(camera_id, image))
            self.sensors.append(sensor)
            check()

    def _receive_sensor_frame(self, camera_id: str, image: Any) -> None:
        with self.sensor_condition:
            if self.sensor_closed:
                return
            frame = int(image.frame)
            prior = self.sensor_last_frame.get(camera_id)
            if prior is not None and frame <= prior:
                kind = "duplicate" if frame == prior else "out-of-order"
                self.sensor_error = RuntimeError(f"{kind} sensor callback for {camera_id}: {frame} after {prior}")
            elif camera_id in self.sensor_pending.setdefault(frame, {}):
                self.sensor_error = RuntimeError(f"duplicate sensor callback for {camera_id}: {frame}")
            else:
                self.sensor_last_frame[camera_id] = frame
                self.sensor_pending[frame][camera_id] = image
            self.sensor_condition.notify_all()

    def _capture_world_frame(self, carla_frame: int, capture: Mapping[str, float | int], abort: Callable[[], None] | None = None) -> None:
        check = abort or (lambda: None)
        check()
        expected = set(self.sensor_configs)
        deadline = monotonic() + self.sensor_timeout_s
        while True:
            with self.sensor_condition:
                if self.sensor_error:
                    raise self.sensor_error
                received = set(self.sensor_pending.get(carla_frame, {}))
                if received == expected:
                    images = self.sensor_pending.pop(carla_frame)
                    for old_frame in [frame for frame in self.sensor_pending if frame < carla_frame]:
                        del self.sensor_pending[old_frame]
                    break
                remaining = deadline - monotonic()
                if remaining <= 0:
                    missing = sorted(expected - received)
                    raise RuntimeError(f"sensor frame timeout at CARLA frame {carla_frame}; missing: {', '.join(missing)}")
                self.sensor_condition.wait(min(0.25, remaining))
            # The fence may make a synchronous control-plane request. Never
            # hold the sensor callback's condition lock across that request.
            check()
        output_index = int(capture["outputFrameIndex"])
        scheduled_time = float(capture["scheduledTimeS"])
        for camera_id in sorted(images):
            check()
            image = images[camera_id]
            config = self.sensor_configs[camera_id]
            if config["converter"] is not None:
                image.convert(config["converter"])
                check()
            relative = f"{camera_id}/{output_index:08d}.png"
            target = config["target"] / f"{output_index:08d}.png"
            image.save_to_disk(str(target))
            check()
            charged_bytes = target.stat().st_size + 4096
            self.capture_disk_bytes += charged_bytes
            if self.capture_disk_bytes > self.max_capture_disk_bytes:
                target.unlink(missing_ok=True)
                raise ContractError("captured frames exceed the incremental temporary-disk quota")
            with self.sensor_lock:
                self.sensor_records.append({
                    "sensorId": camera_id, "kind": config["kind"], "outputFrameIndex": output_index,
                    "scheduledTimeS": scheduled_time, "carlaFrame": carla_frame,
                    "timestamp": float(image.timestamp), "relativePath": relative,
                    "attachTo": config["attachTo"], "mount": config["mount"],
                })
            check()

    def sensor_manifest(self, abort: Callable[[], None] | None = None) -> list[Mapping[str, Any]]:
        check = abort or (lambda: None)
        check()
        with self.sensor_lock:
            snapshot = list(self.sensor_records)
        records = []
        for item in snapshot:
            check()
            records.append(dict(item))
        check()
        return sorted(records, key=lambda item: (item["carlaFrame"], item["sensorId"]))

    def apply(self, frame: PlanFrame, abort: Callable[[], None] | None = None) -> None:
        check = abort or (lambda: None)
        check()
        if not set(frame.signals).issubset(self.signals):
            missing = sorted(set(frame.signals) - set(self.signals))
            raise RuntimeError(f"authored OpenDRIVE traffic signal heads were not preflighted: {', '.join(missing)}")
        if frame.signals:
            light_states = {
                "red": self.carla.TrafficLightState.Red,
                "yellow": self.carla.TrafficLightState.Yellow,
                "green": self.carla.TrafficLightState.Green,
                "off": self.carla.TrafficLightState.Off,
            }
            for signal_id, indication in frame.signals.items():
                check()
                lamp = light_states[resolve_signal_lamp(indication, frame.t)]
                self.signals[signal_id].set_state(lamp)
                self.executed_signals[signal_id] = indication
                self.executed_signal_lamps[signal_id] = lamp
        for actor_id, state in frame.actors.items():
            check()
            actor = self.actors[actor_id]
            if state.lifecycle == LIFECYCLE_ABSENT:
                self._sink_absent_actor(actor_id, actor, state)
                continue
            self._apply_appearance(actor_id, actor, state.appearance, frame.t)
            target = self.carla.Transform(self.carla.Location(x=state.x, y=-state.y, z=state.z), self.carla.Rotation(yaw=-state.heading_deg))
            if self.execution_mode == "diagnostic-replay":
                actor.set_transform(target)
                actor.set_target_velocity(target.transform_vector(self.carla.Vector3D(x=state.speed_mps, y=0, z=0)))
                continue
            velocity = actor.get_velocity()
            speed = (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) ** 0.5
            if actor.type_id.startswith("walker."):
                direction = target.get_forward_vector()
                actor.apply_control(self.carla.WalkerControl(direction=direction, speed=state.speed_mps, jump=False))
                continue
            if actor.type_id.startswith(("vehicle.", "bike.")):
                current_yaw = actor.get_transform().rotation.yaw
                yaw_error = ((-state.heading_deg - current_yaw + 180) % 360) - 180
                throttle, brake = self._vehicle_longitudinal_control(actor_id, state.speed_mps, speed)
                steer = min(1.0, max(-1.0, yaw_error / 35.0))
                actor.apply_control(self.carla.VehicleControl(throttle=throttle, brake=brake, steer=steer))
                continue
            if state.speed_mps > 1e-6:
                raise RuntimeError(f"native physics does not support moving actor type {actor.type_id}")
        check()

    def _sink_absent_actor(self, actor_id: str, actor: Any, state: Any) -> None:
        """Retire an actor whose `.xosc` DeleteEntityAction has fired.

        The actor is parked far below its last authored pose with physics off
        rather than destroyed. `Actor.destroy()` would also destroy any sensor
        attached to it, which breaks the frame-closure contract
        `finalize_capture` enforces, and would invalidate the handle `tick()`
        reads back every frame. Parking keeps the readback and the parity closure
        intact; `ParityAccumulator` skips absent actors, and `cleanup()` still
        destroys the handle at the end of the run.
        """
        if actor_id in self.absent_actors:
            return
        self.absent_actors.add(actor_id)
        zero = self.carla.Vector3D(x=0.0, y=0.0, z=0.0)
        actor.set_simulate_physics(False)
        actor.set_target_velocity(zero)
        actor.set_target_angular_velocity(zero)
        actor.set_transform(self.carla.Transform(
            self.carla.Location(x=state.x, y=-state.y, z=state.z - DESPAWN_SINK_M),
            self.carla.Rotation(yaw=-state.heading_deg),
        ))

    def _apply_appearance(self, actor_id: str, actor: Any, appearance: Mapping[str, str], t: float) -> None:
        """Drive the authored appearance state CARLA can physically render.

        `cue.*` entries are OpenSCENARIO `UserDefinedAnimation` requests
        (`pose.*` articulation, `audio.horn`). CARLA 0.10.0's Python API exposes
        no audio at all, and no *named* animations — only raw per-bone transform
        injection on `carla.Walker` (`get_bones`/`set_bones`, `blend_pose`,
        `show_pose`/`hide_pose`, `get_pose_from_animation`, with the module-level
        `WalkerBoneControlIn`/`Out` payloads). `carla.Vehicle` and `carla.Actor`
        have no bone members at all.

        The cues in flight are *named semantic* poses — `pose.stopArm:extended`,
        `pose.gesture:halt`, `pose.paddle:stop` — and there is no named-animation
        library to resolve them against, so rendering one would mean
        hand-authoring bone transforms for the pedestrian skeleton. That is a
        real feature, not an impossibility; until it exists these are deliberately
        not applied here and the render manifest reports them as unrendered cues.
        """
        lights = {key[len("light."):]: value for key, value in appearance.items() if key.startswith("light.")}
        doors = {key[len("door."):]: value for key, value in appearance.items() if key.startswith("door.")}
        if lights:
            self._apply_vehicle_lights(actor, lights, t)
        if doors:
            self._apply_vehicle_doors(actor_id, actor, doors)

    def _apply_vehicle_lights(self, actor: Any, lights: Mapping[str, str], t: float) -> None:
        """Write the authored light bits, leaving every unowned bit untouched.

        This method is the ONLY writer of the vehicle light mask in this worker.
        There is no autopilot, no Traffic Manager, and no sun-altitude headlight
        pass here, so authored scenario intent is authoritative by construction:
        a scenario that sets `lights.headlights: off` keeps the vehicle dark even
        in a midnight render, and one that never mentions headlights leaves them
        exactly as the blueprint spawned them.

        That is a deliberate difference from the legacy render fleet, whose
        low-sun pass drives headlights automatically and therefore has to contend
        with the blinker writer over one shared mask. This worker is a separate
        service with no shared runtime (an import-boundary test pins that), so the
        contention does not exist and must not be reintroduced: the scenario is
        the artifact under test, and render determinism outranks the visual
        plausibility of an automatically-lit night scene.
        """
        light_state_cls = getattr(self.carla, "VehicleLightState", None)
        if light_state_cls is None:
            raise RuntimeError("this .xosc authors vehicle light states but the CARLA runtime has no VehicleLightState")
        owned = 0
        wanted_bits = 0
        # Sorted so `warningLights` resolves after the individual indicators it
        # overlaps, making hazard flashers win over a stale indicator setting.
        for light_type in sorted(lights):
            bit = 0
            for member in VEHICLE_LIGHT_BITS[light_type]:
                value = getattr(light_state_cls, member, None)
                if value is None:
                    raise RuntimeError(f"the CARLA runtime has no VehicleLightState.{member} for {light_type}")
                bit |= int(value)
            owned |= bit
            mode = lights[light_type]
            if mode == "on" or (mode == "flashing" and flash_on(t)):
                wanted_bits |= bit
            else:
                wanted_bits &= ~bit
        current = int(actor.get_light_state())
        wanted = (current & ~owned) | wanted_bits
        if wanted != current:
            actor.set_light_state(light_state_cls(wanted))

    def _apply_vehicle_doors(self, actor_id: str, actor: Any, doors: Mapping[str, str]) -> None:
        door_cls = getattr(self.carla, "VehicleDoor", None)
        opener, closer = getattr(actor, "open_door", None), getattr(actor, "close_door", None)
        if door_cls is None or not callable(opener) or not callable(closer):
            raise RuntimeError("this .xosc authors vehicle door states but the CARLA runtime has no door control API")
        for component in sorted(doors):
            state = doors[component]
            if self.door_states.get((actor_id, component)) == state:
                continue
            member = getattr(door_cls, VEHICLE_DOOR_MEMBERS[component], None)
            if member is None:
                raise RuntimeError(f"the CARLA runtime has no VehicleDoor.{VEHICLE_DOOR_MEMBERS[component]}")
            (opener if state == "open" else closer)(member)
            self.door_states[(actor_id, component)] = state

    def tick(self, capture: Mapping[str, float | int] | None = None, abort: Callable[[], None] | None = None) -> Mapping[str, Mapping[str, float]]:
        assert self.world is not None
        check = abort or (lambda: None)
        check()
        carla_frame = int(self.world.tick())
        check()
        if capture is not None:
            self._capture_world_frame(carla_frame, capture, abort)
        else:
            with self.sensor_condition:
                if self.sensor_error:
                    raise self.sensor_error
                for old_frame in [frame for frame in self.sensor_pending if frame <= carla_frame]:
                    del self.sensor_pending[old_frame]
            check()
        result = {}
        for actor_id, actor in self.actors.items():
            check()
            transform, velocity = actor.get_transform(), actor.get_velocity()
            result[actor_id] = {"x": transform.location.x, "y": -transform.location.y, "z": transform.location.z, "headingDeg": -transform.rotation.yaw, "speedMps": (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) ** 0.5}
        return result

    def finalize_capture(self, expected_frame_count: int, abort: Callable[[], None] | None = None) -> None:
        check = abort or (lambda: None)
        check()
        with self.sensor_condition:
            self.sensor_closed = True
            if self.sensor_error:
                raise self.sensor_error
            records = list(self.sensor_records)
            self.sensor_pending.clear()
        for sensor in self.sensors:
            check()
            sensor.stop()
        indexes_by_camera = {camera_id: [] for camera_id in self.sensor_configs}
        for item in records:
            check()
            indexes_by_camera[item["sensorId"]].append(int(item["outputFrameIndex"]))
        for camera_id, indexes in indexes_by_camera.items():
            check()
            if indexes != list(range(expected_frame_count)):
                raise RuntimeError(f"sensor {camera_id} capture is not frame-closed: {len(indexes)} of {expected_frame_count}")
        check()

    def signal_readback(self, abort: Callable[[], None] | None = None) -> Mapping[str, str]:
        check = abort or (lambda: None)
        result: dict[str, str] = {}
        for signal_id, indication in sorted(self.executed_signals.items()):
            check()
            actual = self.signals[signal_id].get_state()
            if actual != self.executed_signal_lamps[signal_id]:
                raise RuntimeError(f"CARLA traffic signal {signal_id} did not retain its executed state")
            result[signal_id] = indication
        check()
        return result

    def cleanup(self) -> None:
        errors: list[Exception] = []
        try:
            self._restore_owned_signals()
        except Exception as exc:  # noqa: BLE001 - continue the rest of cleanup.
            errors.append(exc)
        for actor in [*getattr(self, "sensors", []), *getattr(self, "actors", {}).values()]:
            try:
                actor.stop() if hasattr(actor, "stop") else None
                actor.destroy()
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
        self.sensors = []
        self.actors = {}
        self.executed_signals = {}
        self.executed_signal_lamps = {}
        if getattr(self, "world", None) is not None:
            try:
                settings = self.world.get_settings()
                settings.synchronous_mode = False
                settings.fixed_delta_seconds = None
                self.world.apply_settings(settings)
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)
        if errors:
            raise RuntimeError(f"CARLA cleanup failed in {len(errors)} operation(s)") from errors[0]

