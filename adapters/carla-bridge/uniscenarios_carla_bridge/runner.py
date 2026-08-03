"""Backend-neutral deterministic executor used by a CARLA Python deployment."""

import math
from typing import Any, Protocol

from .attestation import WorkerRuntimeAttestor
from .capabilities import BRIDGE_CAPABILITIES
from .protocol import ContractError, validate_job, validate_resolved_actor_bindings, validate_resolved_signal_bindings
from .validation import OpenScenario14Validator


class CarlaBackend(Protocol):
    def load_map(self, map_name: str, xodr_bytes: bytes) -> None: ...
    def configure_synchronous(self, fixed_timestep_s: float) -> None: ...
    def resolve_bindings(self, actor_bindings: dict[str, dict[str, Any]], signal_bindings: dict[str, str]) -> None: ...
    def resolved_actor_bindings(self) -> dict[str, dict[str, Any]]: ...
    def resolved_signal_bindings(self) -> dict[str, dict[str, Any]]: ...
    def freeze_traffic_lights(self) -> None: ...
    def apply_authoritative_frame(self, frame: dict[str, Any], signal_bindings: dict[str, str]) -> None: ...
    def apply_native_frame(self, frame: dict[str, Any], signal_bindings: dict[str, str]) -> None: ...
    def tick(self) -> int: ...
    def collect_result(self) -> dict[str, Any]: ...
    def cleanup(self) -> None: ...


POSITION_TOLERANCE_M = 0.25
HEADING_TOLERANCE_DEG = 2.0
SPEED_TOLERANCE_MPS = 0.25


def _evidence_error(path: str, message: str) -> None:
    raise ContractError(f"observations.{path}: {message}")


def _number(path: str, value: Any) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        _evidence_error(path, "must be finite")
    return float(value)


def _collision_set(path: str, value: Any, actor_ids: set[str]) -> set[tuple[str, str]]:
    if not isinstance(value, list):
        _evidence_error(path, "must be an explicit array, including when empty")
    result: set[tuple[str, str]] = set()
    for index, pair in enumerate(value):
        if not isinstance(pair, list) or len(pair) != 2 or any(actor not in actor_ids for actor in pair) or pair[0] == pair[1]:
            _evidence_error(f"{path}.{index}", "must name two distinct bound actors")
        normalized = tuple(sorted((pair[0], pair[1])))
        if normalized in result:
            _evidence_error(f"{path}.{index}", "duplicates a collision pair in the same frame")
        result.add(normalized)
    return result


def _heading_error(expected: float, observed: float) -> float:
    return abs((observed - expected + 180.0) % 360.0 - 180.0)


def _validate_collision_summary(job: dict[str, Any], value: Any, actor_ids: set[str]) -> None:
    if not isinstance(value, list):
        _evidence_error("collisions", "collision summary must be an explicit array")
    expected = {
        (frame["index"], tuple(sorted(pair)))
        for frame in job["frames"]
        for pair in frame["collisions"]
    }
    observed: set[tuple[int, tuple[str, str]]] = set()
    for index, event in enumerate(value):
        path = f"collisions.{index}"
        if not isinstance(event, dict) or not isinstance(event.get("frameIndex"), int):
            _evidence_error(path, "must contain an integer frameIndex and actor pair")
        frame_index = event["frameIndex"]
        if frame_index < 0 or frame_index >= len(job["frames"]):
            _evidence_error(f"{path}.frameIndex", "is outside the submitted frame range")
        pair = _collision_set(f"{path}.actors", [event.get("actors")], actor_ids)
        identity = (frame_index, next(iter(pair)))
        if identity in observed:
            _evidence_error(path, "duplicates a collision edge")
        observed.add(identity)
    if observed != expected:
        _evidence_error("collisions", "summary does not match authoritative collision edges")


def validate_and_compare_observations(
    job: dict[str, Any],
    observations: Any,
    rendered_frames: list[int],
    resolved_actors: dict[str, dict[str, Any]],
    resolved_signals: dict[str, dict[str, Any]],
    runtime_validation: dict[str, Any],
    runtime_attestation: dict[str, Any],
) -> dict[str, Any]:
    """Fail closed unless CARLA returned complete readback within acceptance limits."""
    if not isinstance(observations, dict):
        raise ContractError("observations: must be an object")
    actual_frames = observations.get("frames")
    expected_frames = job["frames"]
    if not isinstance(actual_frames, list) or not actual_frames:
        raise ContractError("observations.frames: empty or missing frame evidence")
    if len(actual_frames) != len(expected_frames):
        raise ContractError("observations.frames: missing complete frame evidence")

    actor_ids = set(job["actorBindings"])
    signal_ids = set(job["signalBindings"])
    max_position = max_heading = max_speed = 0.0
    previous_elapsed: float | None = None
    runtime_actor_ids: dict[str, int] = {}
    runtime_id_owners: dict[int, str] = {}
    for index, (expected, actual) in enumerate(zip(expected_frames, actual_frames)):
        path = f"frames.{index}"
        if not isinstance(actual, dict):
            _evidence_error(path, "must be an object")
        if actual.get("index") != index:
            _evidence_error(f"{path}.index", "must preserve the exact contiguous frame identity")
        if actual.get("carlaFrame") != rendered_frames[index]:
            _evidence_error(f"{path}.carlaFrame", "must identify the CARLA tick returned for this submitted frame")
        elapsed = _number(f"{path}.elapsedSeconds", actual.get("elapsedSeconds"))
        if elapsed < 0:
            _evidence_error(f"{path}.elapsedSeconds", "must be non-negative")
        if previous_elapsed is not None and abs((elapsed - previous_elapsed) - job["fixedTimestepS"]) > 1e-9:
            _evidence_error(f"{path}.elapsedSeconds", "CARLA snapshot time must advance by exactly one fixed step")
        previous_elapsed = elapsed
        observed_t = _number(f"{path}.t", actual.get("t"))
        expected_t = float(expected["t"])
        if abs(observed_t - expected_t) > 1e-9:
            _evidence_error(f"{path}.t", "must equal the fixed-step authoritative timestamp")

        actual_actors = actual.get("actors")
        if not isinstance(actual_actors, dict) or set(actual_actors) != actor_ids:
            _evidence_error(f"{path}.actors", "must contain the exact actor binding closure")
        for actor_id in actor_ids:
            expected_actor = expected["actors"][actor_id]
            observed_actor = actual_actors[actor_id]
            actor_path = f"{path}.actors.{actor_id}"
            if not isinstance(observed_actor, dict):
                _evidence_error(actor_path, "must be an actor readback object")
            runtime_binding = resolved_actors[actor_id]
            for field in ("blueprintId", "kind"):
                if observed_actor.get(field) != runtime_binding[field]:
                    _evidence_error(f"{actor_path}.{field}", "does not preserve the resolved CARLA runtime identity")
            if observed_actor.get("lifecycle") != expected_actor["lifecycle"]:
                _evidence_error(f"{actor_path}.lifecycle", "does not match the authoritative lifecycle edge")
            expected_alive = expected_actor["lifecycle"] in {"spawn", "active"}
            if observed_actor.get("alive") is not expected_alive:
                _evidence_error(f"{actor_path}.alive", "does not prove lifecycle existence in the CARLA world")
            carla_actor_id = observed_actor.get("carlaActorId")
            if expected_actor["lifecycle"] == "absent":
                if carla_actor_id is not None:
                    _evidence_error(f"{actor_path}.carlaActorId", "must be null while the actor is absent")
            else:
                if not isinstance(carla_actor_id, int) or isinstance(carla_actor_id, bool) or carla_actor_id < 0:
                    _evidence_error(f"{actor_path}.carlaActorId", "must identify the spawned CARLA actor")
                prior_runtime_id = runtime_actor_ids.get(actor_id)
                if prior_runtime_id is not None and carla_actor_id != prior_runtime_id:
                    _evidence_error(f"{actor_path}.carlaActorId", "changed after the actor was spawned")
                prior_owner = runtime_id_owners.get(carla_actor_id)
                if prior_owner is not None and prior_owner != actor_id:
                    _evidence_error(f"{actor_path}.carlaActorId", f"was already bound to stable actor {prior_owner!r}")
                runtime_actor_ids[actor_id] = carla_actor_id
                runtime_id_owners[carla_actor_id] = actor_id
            if expected_actor["lifecycle"] in {"spawn", "active"}:
                for field in ("x", "y", "z", "headingDeg", "speedMps"):
                    _number(f"{actor_path}.{field}", observed_actor.get(field))
                position = math.sqrt(sum(
                    (float(observed_actor[field]) - float(expected_actor[field])) ** 2
                    for field in ("x", "y", "z")
                ))
                heading = _heading_error(float(expected_actor["headingDeg"]), float(observed_actor["headingDeg"]))
                speed = abs(float(observed_actor["speedMps"]) - float(expected_actor["speedMps"]))
                max_position = max(max_position, position)
                max_heading = max(max_heading, heading)
                max_speed = max(max_speed, speed)
                if position > POSITION_TOLERANCE_M:
                    _evidence_error(actor_path, f"position divergence {position:.6g} m exceeds {POSITION_TOLERANCE_M} m")
                if heading > HEADING_TOLERANCE_DEG:
                    _evidence_error(f"{actor_path}.headingDeg", f"divergence {heading:.6g} degrees exceeds {HEADING_TOLERANCE_DEG} degrees")
                if speed > SPEED_TOLERANCE_MPS:
                    _evidence_error(f"{actor_path}.speedMps", f"divergence {speed:.6g} m/s exceeds {SPEED_TOLERANCE_MPS} m/s")
                for field in ("roadId", "laneId", "onRoad"):
                    if observed_actor.get(field) != expected_actor[field]:
                        _evidence_error(f"{actor_path}.{field}", "does not match authoritative road/lane occupancy")
                if observed_actor.get("teleported") is not False:
                    _evidence_error(f"{actor_path}.teleported", "must explicitly prove that no unexpected teleport occurred")
        live_runtime_ids = [
            actual_actors[actor_id]["carlaActorId"]
            for actor_id in actor_ids
            if actual_actors[actor_id].get("alive") is True
        ]
        if len(live_runtime_ids) != len(set(live_runtime_ids)):
            _evidence_error(f"{path}.actors", "multiple stable actors read back from the same live CARLA actor")

        actual_signals = actual.get("signals")
        if not isinstance(actual_signals, dict) or set(actual_signals) != signal_ids:
            _evidence_error(f"{path}.signals", "must contain the exact physical-head readback closure")
        for signal_id in signal_ids:
            signal = actual_signals[signal_id]
            binding = resolved_signals[signal_id]
            signal_path = f"{path}.signals.{signal_id}"
            if not isinstance(signal, dict):
                _evidence_error(signal_path, "must be a physical-head readback object")
            for field in ("carlaActorId", "opendriveId"):
                if signal.get(field) != binding[field]:
                    _evidence_error(f"{signal_path}.{field}", "does not preserve the resolved physical-head runtime identity")
            if signal.get("state") != expected["signals"][signal_id]:
                _evidence_error(f"{signal_path}.state", "readback does not match the authoritative physical-head state")
            if signal.get("alive") is not True:
                _evidence_error(f"{signal_path}.alive", "must prove that the resolved physical head still exists")
        if _collision_set(f"{path}.collisions", actual.get("collisions"), actor_ids) != {
            tuple(sorted(pair)) for pair in expected["collisions"]
        }:
            _evidence_error(f"{path}.collisions", "does not match authoritative collision edges")

    _validate_collision_summary(job, observations.get("collisions"), actor_ids)
    provenance = observations.get("provenance")
    if not isinstance(provenance, dict):
        _evidence_error("provenance", "validated runtime provenance is required")
    required_text = ("backend", "carlaServerVersion", "carlaClientVersion", "engineVersion", "bridgeRevision", "workerImageDigest")
    for field in required_text:
        if not isinstance(provenance.get(field), str) or not provenance[field]:
            _evidence_error(f"provenance.{field}", "must be a non-empty runtime identity")
    if provenance["backend"] != "carla":
        _evidence_error("provenance.backend", "must identify a real CARLA backend")
    exact_provenance = {
        "jobSchema": job["schema"],
        "executionMode": job["executionMode"],
        "workerAttestationSource": runtime_attestation["source"],
        "workerManifestSha256": runtime_attestation["workerManifestSha256"],
        "workerImageDigest": runtime_attestation["workerImageDigest"],
        "bridgeRevision": runtime_attestation["bridgeRevision"],
        "carlaServerVersion": runtime_attestation["carlaServerVersion"],
        "carlaClientVersion": runtime_attestation["carlaClientVersion"],
        "engineVersion": runtime_attestation["engineVersion"],
        "mapName": job["map"]["name"],
        "xodrSha256": job["map"]["xodrSha256"],
        "controlDigest": job["map"]["controlDigest"],
        "assetCatalogSha256": job["assetCatalogSha256"],
        "openScenarioSha256": job["openScenario"]["sha256"],
        "xsdSha256": runtime_validation["xsdSha256"],
        "validationXmlSha256": runtime_validation["xmlSha256"],
        "validator": runtime_validation["validator"],
        "payloadSha256": job["payloadSha256"],
        "fixedTimestepS": job["fixedTimestepS"],
        "synchronousMode": True,
    }
    for field, expected_value in exact_provenance.items():
        if provenance.get(field) != expected_value:
            _evidence_error(f"provenance.{field}", "is not bound to the submitted job")

    return {
        "accepted": True,
        "samples": len(actual_frames),
        "thresholds": {
            "positionM": POSITION_TOLERANCE_M,
            "headingDeg": HEADING_TOLERANCE_DEG,
            "speedMps": SPEED_TOLERANCE_MPS,
        },
        "maxError": {"positionM": max_position, "headingDeg": max_heading, "speedMps": max_speed},
    }


def execute_job(
    job: dict[str, Any],
    xodr_bytes: bytes,
    osc_bytes: bytes,
    asset_catalog_bytes: bytes,
    backend: CarlaBackend,
    validator: OpenScenario14Validator,
    attestor: WorkerRuntimeAttestor,
) -> dict[str, Any]:
    validate_job(job, xodr_bytes, osc_bytes, asset_catalog_bytes)
    runtime_validation = validator.validate(osc_bytes)
    expected_validation = job["openScenario"]["xsdValidation"]
    for field in ("standardVersion", "xsdSha256", "xmlSha256", "valid"):
        if runtime_validation.get(field) != expected_validation[field]:
            raise ContractError(f"worker OpenSCENARIO validation disagrees with submitted receipt field {field}")
    if not isinstance(runtime_validation.get("validator"), str) or not runtime_validation["validator"]:
        raise ContractError("worker OpenSCENARIO validation did not identify its validator")
    runtime_attestation = attestor.attest()
    if not isinstance(runtime_attestation, dict) or runtime_attestation.get("source") != "worker-owned-manifest+live-carla-probe":
        raise ContractError("worker runtime attestation did not come from the trusted manifest and live CARLA probe")
    for field in ("workerManifestSha256", "workerImageDigest", "bridgeRevision", "carlaServerVersion", "carlaClientVersion", "engineVersion"):
        if runtime_attestation.get(field) != job["runtimeContract"][field]:
            raise ContractError(f"runtimeContract.{field}: submitted expectation disagrees with trusted worker attestation")
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
        resolved_actors = backend.resolved_actor_bindings()
        resolved_signals = backend.resolved_signal_bindings()
        validate_resolved_actor_bindings(job, resolved_actors)
        validate_resolved_signal_bindings(job, resolved_signals)
        backend.freeze_traffic_lights()
        rendered_frames: list[int] = []
        apply = backend.apply_authoritative_frame if mode == "authoritative-trace" else backend.apply_native_frame
        previous_tick: int | None = None
        for frame in job["frames"]:
            apply(frame, job["signalBindings"])
            tick = backend.tick()
            if not isinstance(tick, int) or isinstance(tick, bool) or (previous_tick is not None and tick != previous_tick + 1):
                raise ContractError("backend tick ids must be contiguous increasing integers")
            rendered_frames.append(tick)
            previous_tick = tick
        observations = backend.collect_result()
        comparison = validate_and_compare_observations(
            job, observations, rendered_frames, resolved_actors, resolved_signals, runtime_validation, runtime_attestation,
        )
        return {
            "schema": "uniscenarios.carla-result/v3",
            "status": "succeeded",
            "executionMode": mode,
            "fixedTimestepS": job["fixedTimestepS"],
            "payloadSha256": job["payloadSha256"],
            "runtimeValidation": runtime_validation,
            "runtimeAttestation": runtime_attestation,
            "renderedFrames": rendered_frames,
            "observations": observations,
            "comparison": comparison,
        }
    finally:
        backend.cleanup()
