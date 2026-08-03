"""Strict, hash-closed job contract for the optional CARLA adapter.

The bridge deliberately does not interpret OpenSCENARIO.  UniScenarios has
already validated the XML 1.4 document and compiled its semantics into the
frame/control stream in this contract.  CARLA therefore cannot silently choose
a different interpretation of the XML.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Any

SCHEMA = "uniscenarios.carla-job/v3"
# Must match packages/cli/src/asam/xml-1.4-validation.ts.  A receipt naming an
# arbitrary schema digest is not evidence that the official ASAM schema ran.
OFFICIAL_OPENSCENARIO_140_XSD_SHA256 = "949fe2bcebd1f3fdb941a2cc56641482737ab48e3c5b0eed0ee5294b2355c0e9"
SHA256 = re.compile(r"^[a-f0-9]{64}$")
IMAGE_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
REVISION = re.compile(r"^[a-f0-9]{40}$")
SIGNAL_STATES = {"red", "yellow", "green", "off"}
LIFECYCLE = {"absent", "spawn", "active", "destroy"}
ACTOR_LIFECYCLE_POLICIES = {"persist-to-final-frame", "generic-v3"}
AUTHORED_LIFECYCLE_ERROR = "USC-ACTOR-LIFECYCLE-001"
EXECUTION_MODES = {"authoritative-trace", "native-dynamics"}
ACTOR_KINDS = {"vehicle", "pedestrian", "cyclist", "static"}
MAX_XODR_BYTES = 128 * 1024 * 1024
MAX_OSC_BYTES = 16 * 1024 * 1024
MAX_ASSET_CATALOG_BYTES = 4 * 1024 * 1024
MAX_FRAMES = 180_001
MAX_ACTORS = 256
MAX_SIGNALS = 4096
REPRESENTED_SEMANTICS = {
    "actor.lifecycle",
    "actor.trajectory",
    "actor.native_controls",
    "actor.route",
    "actor.lane_change",
    "actor.speed",
    "pedestrian.trajectory",
    "static.object",
    "traffic_signal.state",
    "traffic_signal.controller_logic",
    "collision.observe",
    "custom.map.opendrive",
}


class ContractError(ValueError):
    pass


def _fail(path: str, message: str) -> None:
    raise ContractError(f"{path}: {message}")


def _finite(path: str, value: Any) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        _fail(path, "must be finite")
    return float(value)


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_sha(path: str, value: Any) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        _fail(path, "must be a lowercase SHA-256")
    return value


def payload_for_digest(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "executionMode": job.get("executionMode"),
        "fixedTimestepS": job.get("fixedTimestepS"),
        "actorLifecyclePolicy": job.get("actorLifecyclePolicy"),
        "actorBindings": job.get("actorBindings"),
        "signalBindings": job.get("signalBindings"),
        "requiredSemantics": job.get("requiredSemantics"),
        "runtimeContract": job.get("runtimeContract"),
        "frames": job.get("frames"),
    }


def derive_payload_semantics(job: dict[str, Any]) -> set[str]:
    semantics = {"actor.lifecycle", "collision.observe", "custom.map.opendrive"}
    semantics.add("actor.trajectory" if job.get("executionMode") == "authoritative-trace" else "actor.native_controls")
    if job.get("signalBindings"):
        semantics.add("traffic_signal.state")
    return semantics


def validate_job(job: dict[str, Any], xodr_bytes: bytes, osc_bytes: bytes, asset_catalog_bytes: bytes) -> None:
    """Validate immutable assets, identity closure, frames, and controls."""
    if job.get("schema") != SCHEMA:
        _fail("schema", "unsupported CARLA bridge job")
    if len(xodr_bytes) > MAX_XODR_BYTES:
        _fail("map", f"OpenDRIVE exceeds the {MAX_XODR_BYTES}-byte limit")
    if len(osc_bytes) > MAX_OSC_BYTES:
        _fail("openScenario", f"XML exceeds the {MAX_OSC_BYTES}-byte limit")
    if len(asset_catalog_bytes) > MAX_ASSET_CATALOG_BYTES:
        _fail("assetCatalog", f"catalog exceeds the {MAX_ASSET_CATALOG_BYTES}-byte limit")
    mode = job.get("executionMode")
    if mode not in EXECUTION_MODES:
        _fail("executionMode", "must be authoritative-trace or native-dynamics")
    lifecycle_policy = job.get("actorLifecyclePolicy")
    if lifecycle_policy not in ACTOR_LIFECYCLE_POLICIES:
        _fail(
            "actorLifecyclePolicy",
            "must explicitly be persist-to-final-frame for authored exports or generic-v3 for internal lifecycle fixtures",
        )

    runtime = job.get("runtimeContract")
    if not isinstance(runtime, dict):
        _fail("runtimeContract", "must pin the CARLA worker and bridge builds")
    if not isinstance(runtime.get("workerImageDigest"), str) or not IMAGE_DIGEST.fullmatch(runtime["workerImageDigest"]):
        _fail("runtimeContract.workerImageDigest", "must be a sha256 container image digest")
    _require_sha("runtimeContract.workerManifestSha256", runtime.get("workerManifestSha256"))
    if not isinstance(runtime.get("bridgeRevision"), str) or not REVISION.fullmatch(runtime["bridgeRevision"]):
        _fail("runtimeContract.bridgeRevision", "must be a full lowercase Git revision")
    for field in ("carlaServerVersion", "carlaClientVersion", "engineVersion"):
        if not isinstance(runtime.get(field), str) or not runtime[field]:
            _fail(f"runtimeContract.{field}", "must be an exact non-empty build identity")

    map_spec = job.get("map")
    if not isinstance(map_spec, dict):
        _fail("map", "must be an object")
    map_name = map_spec.get("name")
    if not isinstance(map_name, str) or not map_name.strip():
        _fail("map.name", "must be a non-empty exact CARLA map name")
    expected_xodr = _require_sha("map.xodrSha256", map_spec.get("xodrSha256"))
    actual_xodr = hashlib.sha256(xodr_bytes).hexdigest()
    if expected_xodr != actual_xodr:
        _fail("map.xodrSha256", f"stale map binding; expected {expected_xodr}, received {actual_xodr}")
    _require_sha("map.controlDigest", map_spec.get("controlDigest"))
    expected_catalog = _require_sha("assetCatalogSha256", job.get("assetCatalogSha256"))
    actual_catalog = hashlib.sha256(asset_catalog_bytes).hexdigest()
    if expected_catalog != actual_catalog:
        _fail("assetCatalogSha256", f"stale asset catalog; expected {expected_catalog}, received {actual_catalog}")
    try:
        asset_catalog = json.loads(asset_catalog_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        _fail("assetCatalog", f"invalid JSON: {exc}")
    if not isinstance(asset_catalog, dict):
        _fail("assetCatalog", "must be a JSON object keyed by catalogRef")

    osc = job.get("openScenario")
    if not isinstance(osc, dict):
        _fail("openScenario", "must be an object")
    expected_osc = _require_sha("openScenario.sha256", osc.get("sha256"))
    actual_osc = hashlib.sha256(osc_bytes).hexdigest()
    if expected_osc != actual_osc:
        _fail("openScenario.sha256", f"stale XML binding; expected {expected_osc}, received {actual_osc}")
    receipt = osc.get("xsdValidation")
    if not isinstance(receipt, dict) or receipt.get("standardVersion") != "1.4.0" or receipt.get("valid") is not True:
        _fail("openScenario.xsdValidation", "an official OpenSCENARIO 1.4.0 passing receipt is required")
    receipt_xsd = _require_sha("openScenario.xsdValidation.xsdSha256", receipt.get("xsdSha256"))
    if receipt_xsd != OFFICIAL_OPENSCENARIO_140_XSD_SHA256:
        _fail("openScenario.xsdValidation.xsdSha256", "does not identify the pinned official ASAM OpenSCENARIO 1.4.0 XSD")
    receipt_xml = _require_sha("openScenario.xsdValidation.xmlSha256", receipt.get("xmlSha256"))
    if receipt_xml != actual_osc:
        _fail("openScenario.xsdValidation.xmlSha256", "validation receipt is not bound to the submitted XML bytes")

    step = _finite("fixedTimestepS", job.get("fixedTimestepS"))
    if step <= 0 or step > 0.05:
        _fail("fixedTimestepS", "must be in (0, 0.05]")

    actor_bindings = job.get("actorBindings")
    signal_bindings = job.get("signalBindings")
    if not isinstance(actor_bindings, dict) or not actor_bindings or len(actor_bindings) > MAX_ACTORS:
        _fail("actorBindings", f"must contain 1..{MAX_ACTORS} actors")
    if not isinstance(signal_bindings, dict) or len(signal_bindings) > MAX_SIGNALS:
        _fail("signalBindings", f"must contain at most {MAX_SIGNALS} signals")
    for actor_id, binding in actor_bindings.items():
        if not isinstance(actor_id, str) or not actor_id or not isinstance(binding, dict):
            _fail("actorBindings", "must map stable actor ids to binding objects")
        blueprint = binding.get("blueprintId")
        if not isinstance(blueprint, str) or not blueprint:
            _fail(f"actorBindings.{actor_id}.blueprintId", "must be non-empty")
        if binding.get("kind") not in ACTOR_KINDS:
            _fail(f"actorBindings.{actor_id}.kind", "unsupported actor kind")
        catalog_ref = binding.get("catalogRef")
        catalog_binding = asset_catalog.get(catalog_ref) if isinstance(catalog_ref, str) else None
        if not isinstance(catalog_binding, dict) or catalog_binding.get("blueprintId") != blueprint or catalog_binding.get("kind") != binding.get("kind"):
            _fail(f"actorBindings.{actor_id}", "does not match the immutable allowlisted asset catalog")
    # Reusing a blueprint is legitimate; actor identities, not assets, are one-to-one.
    target_signals = list(signal_bindings.values())
    if any(not isinstance(value, str) or not value for value in target_signals):
        _fail("signalBindings", "binding values must be non-empty OpenDRIVE ids")
    if len(target_signals) != len(set(target_signals)):
        _fail("signalBindings", "physical-head bindings must be one-to-one")

    frames = job.get("frames")
    if not isinstance(frames, list) or not frames or len(frames) > MAX_FRAMES:
        _fail("frames", f"must contain 1..{MAX_FRAMES} frames")
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
        if not isinstance(signals, dict) or set(signals) != known_signals:
            _fail(f"{path}.signals", "must contain the exact physical-head binding closure")
        for actor_id, state in actors.items():
            actor_path = f"{path}.actors.{actor_id}"
            if not isinstance(state, dict) or state.get("lifecycle") not in LIFECYCLE:
                _fail(actor_path, "has an unknown lifecycle state")
            lifecycle = state["lifecycle"]
            if lifecycle_policy == "persist-to-final-frame" and lifecycle == "destroy":
                _fail(
                    actor_path,
                    f"{AUTHORED_LIFECYCLE_ERROR}: authored actors must remain present through the final captured frame",
                )
            prior = previous_lifecycle.get(actor_id)
            if prior == "destroy" and lifecycle != "destroy":
                _fail(actor_path, "cannot become active after destroy")
            if index == 0 and lifecycle not in {"absent", "spawn"}:
                _fail(actor_path, "first lifecycle must be absent or spawn")
            if prior == "absent" and lifecycle not in {"absent", "spawn"}:
                _fail(actor_path, "absent actor must spawn before becoming active")
            if prior == "spawn" and lifecycle not in {"active", "destroy"}:
                _fail(actor_path, "spawn must transition to active or destroy")
            if prior == "active" and lifecycle not in {"active", "destroy"}:
                _fail(actor_path, "active actor may only remain active or be destroyed")
            if lifecycle in {"spawn", "active"}:
                for field in ("x", "y", "z", "headingDeg", "speedMps"):
                    _finite(f"{actor_path}.{field}", state.get(field))
                if float(state["speedMps"]) < 0:
                    _fail(f"{actor_path}.speedMps", "must be non-negative")
                on_road = state.get("onRoad")
                if not isinstance(on_road, bool):
                    _fail(f"{actor_path}.onRoad", "must explicitly declare authoritative road occupancy")
                if on_road:
                    if not isinstance(state.get("roadId"), str) or not state["roadId"]:
                        _fail(f"{actor_path}.roadId", "must be a non-empty exact OpenDRIVE road id when on-road")
                    if not isinstance(state.get("laneId"), int) or isinstance(state["laneId"], bool) or state["laneId"] == 0:
                        _fail(f"{actor_path}.laneId", "must be a non-zero OpenDRIVE lane id when on-road")
                elif state.get("roadId") is not None or state.get("laneId") is not None:
                    _fail(actor_path, "off-road occupancy must use null roadId and laneId")
            previous_lifecycle[actor_id] = lifecycle
        for signal_id, state in signals.items():
            if state not in SIGNAL_STATES:
                _fail(f"{path}.signals.{signal_id}", "unsupported CARLA signal state")
        controls = frame.get("controls")
        if mode == "native-dynamics":
            active = {actor_id for actor_id, state in actors.items() if state["lifecycle"] in {"spawn", "active"} and actor_bindings[actor_id]["kind"] != "static"}
            if not isinstance(controls, dict) or set(controls) != active:
                _fail(f"{path}.controls", "native-dynamics requires exact active non-static actor control closure")
            for actor_id, control in controls.items():
                if not isinstance(control, dict):
                    _fail(f"{path}.controls.{actor_id}", "must be an object")
                kind = actor_bindings[actor_id]["kind"]
                required = ("throttle", "brake", "steer") if kind in {"vehicle", "cyclist"} else ("speedMps", "headingDeg")
                for field in required:
                    _finite(f"{path}.controls.{actor_id}.{field}", control.get(field))
                if kind in {"vehicle", "cyclist"}:
                    if not 0 <= float(control["throttle"]) <= 1 or not 0 <= float(control["brake"]) <= 1 or not -1 <= float(control["steer"]) <= 1:
                        _fail(f"{path}.controls.{actor_id}", "throttle/brake must be in [0,1] and steer in [-1,1]")
                elif float(control["speedMps"]) < 0:
                    _fail(f"{path}.controls.{actor_id}.speedMps", "must be non-negative")
        elif controls is not None:
            _fail(f"{path}.controls", "authoritative-trace does not accept native controls")
        collisions = frame.get("collisions")
        if not isinstance(collisions, list):
            _fail(f"{path}.collisions", "must be an explicit array, including when empty")
        for collision_index, pair in enumerate(collisions):
            if not isinstance(pair, list) or len(pair) != 2 or any(actor_id not in known_actors for actor_id in pair) or pair[0] == pair[1]:
                _fail(f"{path}.collisions.{collision_index}", "must name two distinct bound actors")

    required = job.get("requiredSemantics")
    if not isinstance(required, list) or any(not isinstance(item, str) for item in required):
        _fail("requiredSemantics", "must be an array of semantic identifiers")
    if len(required) != len(set(required)):
        _fail("requiredSemantics", "must not contain duplicates")
    missing_derived = sorted(derive_payload_semantics(job) - set(required))
    if missing_derived:
        _fail("requiredSemantics", f"omits payload-derived semantics: {', '.join(missing_derived)}")
    unrepresented = sorted(set(required) - REPRESENTED_SEMANTICS)
    if unrepresented:
        _fail("requiredSemantics", f"not represented by the v3 frame/control schema: {', '.join(unrepresented)}")
    expected_payload = _require_sha("payloadSha256", job.get("payloadSha256"))
    actual_payload = canonical_sha256(payload_for_digest(job))
    if expected_payload != actual_payload:
        _fail("payloadSha256", f"stale control payload; expected {expected_payload}, received {actual_payload}")

    esmini = job.get("esminiReference")
    if esmini is not None:
        if not isinstance(esmini, dict) or esmini.get("status") not in {"passed", "failed", "unsupported"}:
            _fail("esminiReference", "must carry an explicit status")
        _require_sha("esminiReference.resultSha256", esmini.get("resultSha256"))


def validate_resolved_signal_bindings(job: dict[str, Any], resolved: Any) -> None:
    """Verify source head, OpenDRIVE identity, and unique CARLA actor identity."""
    if not isinstance(resolved, dict) or set(resolved) != set(job["signalBindings"]):
        _fail("signalBindings", "resolved CARLA inventory does not equal the exact submitted physical-head binding closure")
    carla_ids: list[int] = []
    for source_id, target_id in job["signalBindings"].items():
        binding = resolved[source_id]
        if not isinstance(binding, dict) or binding.get("opendriveId") != target_id:
            _fail(f"signalBindings.{source_id}", "resolved the wrong OpenDRIVE physical-head identity")
        carla_id = binding.get("carlaActorId")
        if not isinstance(carla_id, int) or isinstance(carla_id, bool) or carla_id < 0:
            _fail(f"signalBindings.{source_id}.carlaActorId", "must be a non-negative CARLA actor id")
        carla_ids.append(carla_id)
    if len(carla_ids) != len(set(carla_ids)):
        _fail("signalBindings", "multiple physical heads resolved to the same CARLA actor")


def validate_resolved_actor_bindings(job: dict[str, Any], resolved: Any) -> None:
    """Verify every stable actor resolves to the exact allowlisted runtime asset."""
    if not isinstance(resolved, dict) or set(resolved) != set(job["actorBindings"]):
        _fail("actorBindings", "resolved CARLA inventory does not equal the exact submitted stable-actor binding closure")
    for actor_id, expected in job["actorBindings"].items():
        binding = resolved[actor_id]
        if not isinstance(binding, dict) or binding.get("blueprintId") != expected["blueprintId"] or binding.get("kind") != expected["kind"]:
            _fail(f"actorBindings.{actor_id}", "resolved runtime asset does not match the exact allowlisted blueprint and kind")
