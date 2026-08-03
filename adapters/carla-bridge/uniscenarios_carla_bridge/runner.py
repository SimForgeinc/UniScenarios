"""Backend-neutral deterministic executor used by a CARLA Python deployment."""

from typing import Any, Protocol

from .capabilities import BRIDGE_CAPABILITIES
from .protocol import ContractError, validate_job, validate_resolved_actor_ids, validate_resolved_signal_ids


class CarlaBackend(Protocol):
    def load_map(self, map_name: str, xodr_bytes: bytes) -> None: ...
    def configure_synchronous(self, fixed_timestep_s: float) -> None: ...
    def resolve_bindings(self, actor_bindings: dict[str, dict[str, Any]], signal_bindings: dict[str, str]) -> None: ...
    def resolved_actor_ids(self) -> list[str]: ...
    def resolved_signal_opendrive_ids(self) -> list[str]: ...
    def freeze_traffic_lights(self) -> None: ...
    def apply_authoritative_frame(self, frame: dict[str, Any], signal_bindings: dict[str, str]) -> None: ...
    def apply_native_frame(self, frame: dict[str, Any], signal_bindings: dict[str, str]) -> None: ...
    def tick(self) -> int: ...
    def collect_result(self) -> dict[str, Any]: ...
    def cleanup(self) -> None: ...


def execute_job(job: dict[str, Any], xodr_bytes: bytes, osc_bytes: bytes, asset_catalog_bytes: bytes, backend: CarlaBackend) -> dict[str, Any]:
    validate_job(job, xodr_bytes, osc_bytes, asset_catalog_bytes)
    mode = job["executionMode"]
    unsupported = sorted(
        semantic for semantic in set(job["requiredSemantics"])
        if semantic not in BRIDGE_CAPABILITIES or BRIDGE_CAPABILITIES[semantic].bridge == "unsupported"
    )
    if unsupported:
        raise ContractError(f"requiredSemantics: unsupported by CARLA bridge: {', '.join(unsupported)}")
    try:
        # Loading a CARLA world replaces its settings; synchronous ownership is
        # established only after the exact world is active.
        backend.load_map(job["map"]["name"], xodr_bytes)
        backend.configure_synchronous(job["fixedTimestepS"])
        backend.resolve_bindings(job["actorBindings"], job["signalBindings"])
        validate_resolved_actor_ids(job, backend.resolved_actor_ids())
        validate_resolved_signal_ids(job, backend.resolved_signal_opendrive_ids())
        backend.freeze_traffic_lights()
        rendered_frames: list[int] = []
        apply = backend.apply_authoritative_frame if mode == "authoritative-trace" else backend.apply_native_frame
        previous_tick: int | None = None
        for frame in job["frames"]:
            apply(frame, job["signalBindings"])
            tick = backend.tick()
            if not isinstance(tick, int) or isinstance(tick, bool) or (previous_tick is not None and tick <= previous_tick):
                raise ContractError("backend tick ids must be strictly increasing integers")
            rendered_frames.append(tick)
            previous_tick = tick
        observations = backend.collect_result()
        if not isinstance(observations, dict) or not isinstance(observations.get("frames"), list) or len(observations["frames"]) != len(job["frames"]):
            raise ContractError("observations: missing complete frame evidence")
        if "collision.observe" in job["requiredSemantics"] and not isinstance(observations.get("collisions"), list):
            raise ContractError("observations: collision evidence must be an array")
        if not isinstance(observations.get("provenance"), dict):
            raise ContractError("observations: validated runtime provenance is required")
        return {
            "schema": "uniscenarios.carla-result/v2",
            "status": "succeeded",
            "executionMode": mode,
            "fixedTimestepS": job["fixedTimestepS"],
            "payloadSha256": job["payloadSha256"],
            "renderedFrames": rendered_frames,
            "observations": observations,
        }
    finally:
        backend.cleanup()
