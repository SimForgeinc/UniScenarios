"""Strict JSON job validation; no CARLA import is needed at this boundary."""

import hashlib
import math
import re
from typing import Any

SHA256 = re.compile(r"^[a-f0-9]{64}$")
SIGNAL_STATES = {"red", "yellow", "green", "off"}
LIFECYCLE = {"spawn", "active", "destroy"}


class ContractError(ValueError):
    pass


def _fail(path: str, message: str) -> None:
    raise ContractError(f"{path}: {message}")


def _finite(path: str, value: Any) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        _fail(path, "must be finite")
    return float(value)


def validate_job(job: dict[str, Any], xodr_bytes: bytes) -> None:
    """Validate identity, closure, ordering, and exact map/signal bindings."""
    if job.get("schema") != "uniscenarios.carla-trace-job/v1":
        _fail("schema", "unsupported CARLA bridge job")
    digest = job.get("mapXodrSha256")
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        _fail("mapXodrSha256", "must be a lowercase SHA-256")
    actual = hashlib.sha256(xodr_bytes).hexdigest()
    if digest != actual:
        _fail("mapXodrSha256", f"stale map binding; expected {digest}, received {actual}")
    step = _finite("fixedTimestepS", job.get("fixedTimestepS"))
    if step <= 0 or step > 0.05:
        _fail("fixedTimestepS", "must be in (0, 0.05]")

    actor_bindings = job.get("actorBindings")
    signal_bindings = job.get("signalBindings")
    if not isinstance(actor_bindings, dict) or not actor_bindings:
        _fail("actorBindings", "must be a non-empty object")
    if not isinstance(signal_bindings, dict):
        _fail("signalBindings", "must be an object")
    for label, bindings in (("actorBindings", actor_bindings), ("signalBindings", signal_bindings)):
        values = list(bindings.values())
        if any(not isinstance(value, str) or not value for value in values):
            _fail(label, "binding values must be non-empty strings")
        if len(values) != len(set(values)):
            _fail(label, "target bindings must be one-to-one")

    frames = job.get("frames")
    if not isinstance(frames, list) or not frames:
        _fail("frames", "must be a non-empty array")
    known_actors = set(actor_bindings)
    known_signals = set(signal_bindings)
    previous_lifecycle: dict[str, str] = {}
    for index, frame in enumerate(frames):
        path = f"frames.{index}"
        if not isinstance(frame, dict) or frame.get("index") != index:
            _fail(path, "index must be contiguous from zero")
        t = _finite(f"{path}.t", frame.get("t"))
        if abs(t - index * step) > 1e-9:
            _fail(f"{path}.t", "must equal index * fixedTimestepS")
        actors = frame.get("actors")
        signals = frame.get("signals")
        if not isinstance(actors, dict) or set(actors) != known_actors:
            _fail(f"{path}.actors", "must contain the exact actor binding closure")
        if not isinstance(signals, dict) or not set(signals).issubset(known_signals):
            _fail(f"{path}.signals", "contains an unbound signal")
        for actor_id, state in actors.items():
            actor_path = f"{path}.actors.{actor_id}"
            if not isinstance(state, dict) or state.get("lifecycle") not in LIFECYCLE:
                _fail(actor_path, "has an unknown lifecycle state")
            lifecycle = state["lifecycle"]
            prior = previous_lifecycle.get(actor_id)
            if prior == "destroy" and lifecycle != "destroy":
                _fail(actor_path, "cannot become active after destroy")
            if index == 0 and lifecycle == "active":
                _fail(actor_path, "first presence must use spawn")
            if lifecycle in {"spawn", "active"}:
                for field in ("x", "y", "z", "headingDeg", "speedMps"):
                    _finite(f"{actor_path}.{field}", state.get(field))
            previous_lifecycle[actor_id] = lifecycle
        for signal_id, state in signals.items():
            if state not in SIGNAL_STATES:
                _fail(f"{path}.signals.{signal_id}", "unsupported CARLA signal state")

    required = job.get("requiredSemantics")
    if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
        _fail("requiredSemantics", "must be an array of semantic identifiers")


def validate_resolved_signal_ids(job: dict[str, Any], resolved_opendrive_ids: list[str]) -> None:
    """Require each declared physical head to resolve exactly once in CARLA."""
    counts: dict[str, int] = {}
    for signal_id in resolved_opendrive_ids:
        counts[signal_id] = counts.get(signal_id, 0) + 1
    for source_id, target_id in job["signalBindings"].items():
        if counts.get(target_id, 0) != 1:
            _fail(f"signalBindings.{source_id}", f"OpenDRIVE id {target_id!r} resolved {counts.get(target_id, 0)} times")
