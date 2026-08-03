"""Backend-neutral deterministic executor used by a CARLA Python deployment."""

from typing import Any, Protocol

from .capabilities import BRIDGE_CAPABILITIES
from .protocol import ContractError, validate_job, validate_resolved_signal_ids


class CarlaBackend(Protocol):
    def configure_synchronous(self, fixed_timestep_s: float) -> None: ...
    def load_opendrive(self, xodr_bytes: bytes) -> None: ...
    def resolved_signal_opendrive_ids(self) -> list[str]: ...
    def freeze_traffic_lights(self) -> None: ...
    def apply_frame(self, frame: dict[str, Any], actor_bindings: dict[str, str], signal_bindings: dict[str, str]) -> None: ...
    def tick(self) -> int: ...
    def collect_result(self) -> dict[str, Any]: ...


def execute_trace_job(job: dict[str, Any], xodr_bytes: bytes, backend: CarlaBackend) -> dict[str, Any]:
    validate_job(job, xodr_bytes)
    unsupported = sorted(
        semantic for semantic in set(job["requiredSemantics"])
        if semantic not in BRIDGE_CAPABILITIES or BRIDGE_CAPABILITIES[semantic].bridge == "unsupported"
    )
    if unsupported:
        raise ContractError(f"requiredSemantics: unsupported by CARLA bridge: {', '.join(unsupported)}")
    backend.configure_synchronous(job["fixedTimestepS"])
    backend.load_opendrive(xodr_bytes)
    validate_resolved_signal_ids(job, backend.resolved_signal_opendrive_ids())
    backend.freeze_traffic_lights()
    rendered_frames: list[int] = []
    for frame in job["frames"]:
        backend.apply_frame(frame, job["actorBindings"], job["signalBindings"])
        rendered_frames.append(backend.tick())
    result = backend.collect_result()
    return {
        "schema": "uniscenarios.carla-trace-result/v1",
        "status": "succeeded",
        "fixedTimestepS": job["fixedTimestepS"],
        "renderedFrames": rendered_frames,
        "observations": result,
    }
