"""Backend-neutral deterministic executor used by a CARLA Python deployment."""

from typing import Any, Protocol

from .capabilities import BRIDGE_CAPABILITIES
from .protocol import ContractError, validate_job, validate_resolved_actor_ids, validate_resolved_signal_ids

JOB_V1_SEMANTICS = {
    "actor.lifecycle", "actor.trajectory", "actor.route", "actor.lane_change", "actor.speed",
    "pedestrian.trajectory", "traffic_signal.state", "traffic_signal.controller_logic",
    "collision.observe", "custom.map.opendrive",
}


class CarlaBackend(Protocol):
    def configure_synchronous(self, fixed_timestep_s: float) -> None: ...
    def load_opendrive(self, xodr_bytes: bytes) -> None: ...
    def resolved_actor_binding_ids(self) -> list[str]: ...
    def resolved_signal_opendrive_ids(self) -> list[str]: ...
    def freeze_traffic_lights(self) -> None: ...
    def apply_frame(self, frame: dict[str, Any], actor_bindings: dict[str, str], signal_bindings: dict[str, str]) -> None: ...
    def tick(self) -> int: ...
    def collect_result(self) -> dict[str, Any]: ...
    def cleanup(self) -> None: ...


def execute_trace_job(job: dict[str, Any], xodr_bytes: bytes, backend: CarlaBackend) -> dict[str, Any]:
    validate_job(job, xodr_bytes)
    unsupported = sorted(
        semantic for semantic in set(job["requiredSemantics"])
        if semantic not in BRIDGE_CAPABILITIES or BRIDGE_CAPABILITIES[semantic].bridge == "unsupported"
    )
    if unsupported:
        raise ContractError(f"requiredSemantics: unsupported by CARLA bridge: {', '.join(unsupported)}")
    unrepresented = sorted(set(job["requiredSemantics"]) - JOB_V1_SEMANTICS)
    if unrepresented:
        raise ContractError(f"requiredSemantics: not represented by the v1 trace-job schema: {', '.join(unrepresented)}")
    rendered_frames: list[int] = []
    result: dict[str, Any]
    try:
        backend.load_opendrive(xodr_bytes)
        backend.configure_synchronous(job["fixedTimestepS"])
        validate_resolved_actor_ids(job, backend.resolved_actor_binding_ids())
        validate_resolved_signal_ids(job, backend.resolved_signal_opendrive_ids())
        backend.freeze_traffic_lights()
        previous_tick: int | None = None
        for frame in job["frames"]:
            backend.apply_frame(frame, job["actorBindings"], job["signalBindings"])
            tick = backend.tick()
            if not isinstance(tick, int) or isinstance(tick, bool) or (previous_tick is not None and tick <= previous_tick):
                raise ContractError("backend tick ids must be strictly increasing integers")
            rendered_frames.append(tick)
            previous_tick = tick
        result = backend.collect_result()
        if not isinstance(result, dict):
            raise ContractError("backend observations must be an object")
        if "collision.observe" in job["requiredSemantics"] and not isinstance(result.get("collisions"), list):
            raise ContractError("backend observations must include a collision list")
    finally:
        backend.cleanup()
    return {
        "schema": "uniscenarios.carla-trace-result/v1",
        "status": "succeeded",
        "fixedTimestepS": job["fixedTimestepS"],
        "renderedFrames": rendered_frames,
        "observations": result,
    }
