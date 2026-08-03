import copy
import hashlib
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from uniscenarios_carla_bridge import (
    ContractError,
    ManifestWorkerRuntimeAttestor,
    assess_scenario_runner_1_0,
    canonical_sha256,
    execute_job as _execute_job,
    payload_for_digest,
)


XODR = b"<OpenDRIVE/>"
OSC = b'<OpenSCENARIO><FileHeader revMajor="1" revMinor="4"/></OpenSCENARIO>'
CATALOG = b'{"passenger-car":{"blueprintId":"vehicle.tesla.model3","kind":"vehicle"}}'
OFFICIAL_XSD_SHA256 = "949fe2bcebd1f3fdb941a2cc56641482737ab48e3c5b0eed0ee5294b2355c0e9"


def job(mode="authoritative-trace"):
    value = {
        "schema": "uniscenarios.carla-job/v3",
        "executionMode": mode,
        "actorLifecyclePolicy": "persist-to-final-frame",
        "runtimeContract": {
            "workerManifestSha256": "8" * 64,
            "workerImageDigest": "sha256:" + "9" * 64,
            "bridgeRevision": "a" * 40,
            "carlaServerVersion": "0.10.0-dev",
            "carlaClientVersion": "0.10.0-dev",
            "engineVersion": "UE5.5",
        },
        "map": {
            "name": "Town10HD_Opt",
            "xodrSha256": hashlib.sha256(XODR).hexdigest(),
            "controlDigest": "1" * 64,
        },
        "openScenario": {
            "sha256": hashlib.sha256(OSC).hexdigest(),
            "xsdValidation": {
                "standardVersion": "1.4.0",
                "xsdSha256": OFFICIAL_XSD_SHA256,
                "xmlSha256": hashlib.sha256(OSC).hexdigest(),
                "valid": True,
            },
        },
        "fixedTimestepS": 0.02,
        "assetCatalogSha256": hashlib.sha256(CATALOG).hexdigest(),
        "actorBindings": {"ego": {"catalogRef": "passenger-car", "blueprintId": "vehicle.tesla.model3", "kind": "vehicle"}},
        "signalBindings": {"head-a": "odr-signal-42"},
        "requiredSemantics": ["actor.lifecycle", "actor.trajectory", "collision.observe", "custom.map.opendrive", "traffic_signal.state"],
        "frames": [
            {"index": 0, "t": 0, "actors": {"ego": {"lifecycle": "spawn", "x": 1, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3, "roadId": "42", "laneId": -1, "onRoad": True}}, "signals": {"head-a": "red"}, "collisions": []},
            {"index": 1, "t": 0.02, "actors": {"ego": {"lifecycle": "active", "x": 1.06, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3, "roadId": "42", "laneId": -1, "onRoad": True}}, "signals": {"head-a": "green"}, "collisions": []},
        ],
    }
    if mode == "native-dynamics":
        value["requiredSemantics"] = ["actor.lifecycle", "actor.native_controls", "collision.observe", "custom.map.opendrive", "traffic_signal.state"]
        value["frames"][0]["controls"] = {"ego": {"throttle": 0.4, "brake": 0, "steer": 0}}
        value["frames"][1]["controls"] = {"ego": {"throttle": 0.3, "brake": 0, "steer": 0.1}}
    value["payloadSha256"] = canonical_sha256(payload_for_digest(value))
    return value


def evidence(value=None):
    value = value or job()
    frames = copy.deepcopy(value["frames"])
    for index, frame in enumerate(frames):
        frame.pop("controls", None)
        frame["carlaFrame"] = index + 1
        frame["elapsedSeconds"] = (index + 1) * value["fixedTimestepS"]
        for actor in frame["actors"].values():
            actor.update({"carlaActorId": 1001, "blueprintId": "vehicle.tesla.model3", "kind": "vehicle"})
            actor["alive"] = actor["lifecycle"] in {"spawn", "active"}
            if actor["lifecycle"] == "absent":
                actor["carlaActorId"] = None
            if actor["lifecycle"] in {"spawn", "active"}:
                actor["teleported"] = False
        frame["signals"] = {
            signal_id: {"carlaActorId": 2001, "opendriveId": "odr-signal-42", "state": state, "alive": True}
            for signal_id, state in frame["signals"].items()
        }
    return {
        "frames": frames,
        "collisions": [],
        "provenance": {
            "backend": "carla",
            "carlaServerVersion": value["runtimeContract"]["carlaServerVersion"],
            "carlaClientVersion": value["runtimeContract"]["carlaClientVersion"],
            "engineVersion": value["runtimeContract"]["engineVersion"],
            "bridgeRevision": value["runtimeContract"]["bridgeRevision"],
            "workerImageDigest": value["runtimeContract"]["workerImageDigest"],
            "workerManifestSha256": value["runtimeContract"]["workerManifestSha256"],
            "workerAttestationSource": "worker-owned-manifest+live-carla-probe",
            "jobSchema": value["schema"],
            "executionMode": value["executionMode"],
            "mapName": value["map"]["name"],
            "xodrSha256": value["map"]["xodrSha256"],
            "controlDigest": value["map"]["controlDigest"],
            "assetCatalogSha256": value["assetCatalogSha256"],
            "openScenarioSha256": value["openScenario"]["sha256"],
            "xsdSha256": OFFICIAL_XSD_SHA256,
            "validationXmlSha256": hashlib.sha256(OSC).hexdigest(),
            "validator": "test-pinned-validator",
            "payloadSha256": value["payloadSha256"],
            "fixedTimestepS": value["fixedTimestepS"],
            "synchronousMode": True,
        },
    }


class FakeValidator:
    def validate(self, xml_bytes):
        return {
            "validator": "test-pinned-validator",
            "standardVersion": "1.4.0",
            "xsdSha256": OFFICIAL_XSD_SHA256,
            "xmlSha256": hashlib.sha256(xml_bytes).hexdigest(),
            "valid": True,
        }


class FakeAttestor:
    def attest(self):
        return {
            "source": "worker-owned-manifest+live-carla-probe",
            "workerManifestSha256": "8" * 64,
            "workerImageDigest": "sha256:" + "9" * 64,
            "bridgeRevision": "a" * 40,
            "carlaServerVersion": "0.10.0-dev",
            "carlaClientVersion": "0.10.0-dev",
            "engineVersion": "UE5.5",
        }


def execute_job(value, xodr_bytes, osc_bytes, catalog_bytes, backend, validator=None, attestor=None):
    return _execute_job(
        value, xodr_bytes, osc_bytes, catalog_bytes, backend,
        validator or FakeValidator(), attestor or FakeAttestor(),
    )


class FakeBackend:
    def __init__(self, job_value=None): self.calls = []; self.job_value = job_value or job()
    def configure_synchronous(self, step): self.calls.append(("sync", step))
    def load_map(self, name, data): self.calls.append(("map", name, data))
    def resolve_bindings(self, actors, signals): self.calls.append(("actors", sorted(actors), sorted(signals)))
    def resolved_actor_bindings(self): return {"ego": {"blueprintId": "vehicle.tesla.model3", "kind": "vehicle"}}
    def resolved_signal_bindings(self): return {"head-a": {"opendriveId": "odr-signal-42", "carlaActorId": 2001}}
    def freeze_traffic_lights(self): self.calls.append(("freeze",))
    def apply_authoritative_frame(self, frame, signals): self.calls.append(("trace", frame["index"]))
    def apply_native_frame(self, frame, signals): self.calls.append(("native", frame["index"]))
    def tick(self): return len([call for call in self.calls if call[0] in {"trace", "native"}])
    def collect_result(self): return evidence(self.job_value)
    def cleanup(self): self.calls.append(("cleanup",))


class BridgeTests(unittest.TestCase):
    def test_authored_policy_rejects_destroy_but_preserves_late_spawn(self):
        late = job()
        late["frames"][0]["actors"]["ego"] = {"lifecycle": "absent"}
        late["frames"][1]["actors"]["ego"]["lifecycle"] = "spawn"
        late["payloadSha256"] = canonical_sha256(payload_for_digest(late))
        result = execute_job(late, XODR, OSC, CATALOG, FakeBackend(late))
        self.assertTrue(result["comparison"]["accepted"])

        destroyed = job()
        destroyed["frames"][1]["actors"]["ego"] = {"lifecycle": "destroy"}
        destroyed["payloadSha256"] = canonical_sha256(payload_for_digest(destroyed))
        with self.assertRaisesRegex(ContractError, "USC-ACTOR-LIFECYCLE-001"):
            execute_job(destroyed, XODR, OSC, CATALOG, FakeBackend(destroyed))

    def test_generic_v3_policy_retains_destroy_contract_expressiveness(self):
        destroyed = job()
        destroyed["actorLifecyclePolicy"] = "generic-v3"
        destroyed["frames"][1]["actors"]["ego"] = {"lifecycle": "destroy"}
        destroyed["payloadSha256"] = canonical_sha256(payload_for_digest(destroyed))
        backend = FakeBackend(destroyed)
        result = execute_job(destroyed, XODR, OSC, CATALOG, backend)
        self.assertTrue(result["comparison"]["accepted"])

    def test_executes_one_tick_per_authoritative_frame(self):
        backend = FakeBackend()
        result = execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(result["renderedFrames"], [1, 2])
        self.assertEqual([call[0] for call in backend.calls], ["map", "sync", "actors", "freeze", "trace", "trace", "cleanup"])

    def test_native_mode_dispatches_controls(self):
        native_job = job("native-dynamics")
        backend = FakeBackend(native_job)
        result = execute_job(native_job, XODR, OSC, CATALOG, backend)
        self.assertEqual(result["executionMode"], "native-dynamics")
        self.assertEqual([call[0] for call in backend.calls][-3:-1], ["native", "native"])

    def test_rejects_stale_assets_payload_and_ambiguous_signal(self):
        with self.assertRaisesRegex(ContractError, "stale map binding"):
            execute_job(job(), b"different", OSC, CATALOG, FakeBackend())
        with self.assertRaisesRegex(ContractError, "stale XML binding"):
            execute_job(job(), XODR, b"different", CATALOG, FakeBackend())
        stale = job()
        stale["frames"][1]["actors"]["ego"]["x"] = 99
        with self.assertRaisesRegex(ContractError, "stale control payload"):
            execute_job(stale, XODR, OSC, CATALOG, FakeBackend())
        backend = FakeBackend()
        backend.resolved_signal_bindings = lambda: {"head-a": {"opendriveId": "wrong", "carlaActorId": 2001}}
        with self.assertRaisesRegex(ContractError, "wrong OpenDRIVE physical-head"):
            execute_job(job(), XODR, OSC, CATALOG, backend)

    def test_rejects_unknown_semantics_and_missing_native_controls(self):
        unknown = job()
        unknown["requiredSemantics"] = [*unknown["requiredSemantics"], "made.up.semantic"]
        unknown["payloadSha256"] = canonical_sha256(payload_for_digest(unknown))
        with self.assertRaisesRegex(ContractError, "not represented"):
            execute_job(unknown, XODR, OSC, CATALOG, FakeBackend())
        missing = job("native-dynamics")
        del missing["frames"][1]["controls"]
        missing["payloadSha256"] = canonical_sha256(payload_for_digest(missing))
        with self.assertRaisesRegex(ContractError, "control closure"):
            execute_job(missing, XODR, OSC, CATALOG, FakeBackend())

    def test_requires_exact_actor_resolution_and_strict_ticks(self):
        backend = FakeBackend()
        backend.resolved_actor_bindings = lambda: {}
        with self.assertRaisesRegex(ContractError, "exact submitted stable-actor"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))
        backend = FakeBackend()
        backend.tick = lambda: 1
        with self.assertRaisesRegex(ContractError, "contiguous increasing"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))
        backend = FakeBackend()
        backend.resolved_actor_bindings = lambda: {"ego": {"blueprintId": "vehicle.wrong", "kind": "vehicle"}}
        with self.assertRaisesRegex(ContractError, "exact allowlisted blueprint"):
            execute_job(job(), XODR, OSC, CATALOG, backend)

    def test_rejects_unrepresented_semantics_and_missing_evidence(self):
        unrepresented = job()
        unrepresented["requiredSemantics"].append("camera.rgb")
        unrepresented["payloadSha256"] = canonical_sha256(payload_for_digest(unrepresented))
        with self.assertRaisesRegex(ContractError, "not represented"):
            execute_job(unrepresented, XODR, OSC, CATALOG, FakeBackend())
        backend = FakeBackend()
        backend.collect_result = lambda: {"frames": evidence()["frames"], "collisions": []}
        with self.assertRaisesRegex(ContractError, "provenance"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))

    def test_xsd_receipt_is_hash_closed_and_mandatory(self):
        invalid = copy.deepcopy(job())
        invalid["openScenario"]["xsdValidation"]["valid"] = False
        with self.assertRaisesRegex(ContractError, "passing receipt"):
            execute_job(invalid, XODR, OSC, CATALOG, FakeBackend())
        forged = job()
        forged["openScenario"]["xsdValidation"]["xsdSha256"] = "2" * 64
        with self.assertRaisesRegex(ContractError, "pinned official ASAM"):
            execute_job(forged, XODR, OSC, CATALOG, FakeBackend())
        wrong_xml = job()
        wrong_xml["openScenario"]["xsdValidation"]["xmlSha256"] = "3" * 64
        with self.assertRaisesRegex(ContractError, "not bound to the submitted XML"):
            execute_job(wrong_xml, XODR, OSC, CATALOG, FakeBackend())

    def test_rejects_empty_frames_and_missing_actor_or_signal_readback(self):
        backend = FakeBackend()
        backend.collect_result = lambda: {**evidence(), "frames": []}
        with self.assertRaisesRegex(ContractError, "empty or missing"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        missing_actor = evidence()
        del missing_actor["frames"][0]["actors"]["ego"]
        backend.collect_result = lambda: missing_actor
        with self.assertRaisesRegex(ContractError, "actor binding closure"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        missing_signal = evidence()
        del missing_signal["frames"][1]["signals"]["head-a"]
        backend.collect_result = lambda: missing_signal
        with self.assertRaisesRegex(ContractError, "physical-head readback closure"):
            execute_job(job(), XODR, OSC, CATALOG, backend)

    def test_rejects_timestamp_drift_and_threshold_violations(self):
        backend = FakeBackend()
        drift = evidence()
        drift["frames"][1]["t"] = 0.021
        backend.collect_result = lambda: drift
        with self.assertRaisesRegex(ContractError, "fixed-step authoritative timestamp"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        snapshot_drift = evidence()
        snapshot_drift["frames"][1]["elapsedSeconds"] = 0.061
        backend.collect_result = lambda: snapshot_drift
        with self.assertRaisesRegex(ContractError, "snapshot time must advance"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        for field, delta, message in (("x", 0.251, "position divergence"), ("headingDeg", 2.01, "divergence"), ("speedMps", 0.251, "divergence")):
            with self.subTest(field=field):
                backend = FakeBackend()
                divergent = evidence()
                divergent["frames"][1]["actors"]["ego"][field] += delta
                backend.collect_result = lambda divergent=divergent: divergent
                with self.assertRaisesRegex(ContractError, message):
                    execute_job(job(), XODR, OSC, CATALOG, backend)

    def test_valid_fixture_reports_actual_comparison_for_both_modes(self):
        for mode in ("authoritative-trace", "native-dynamics"):
            with self.subTest(mode=mode):
                value = job(mode)
                result = execute_job(value, XODR, OSC, CATALOG, FakeBackend(value))
                self.assertTrue(result["comparison"]["accepted"])
                self.assertEqual(result["comparison"]["samples"], 2)
                self.assertEqual(result["comparison"]["maxError"]["positionM"], 0)

    def test_rejects_unbound_provenance_and_occupancy_readback(self):
        backend = FakeBackend()
        unbound = evidence()
        unbound["provenance"]["payloadSha256"] = "f" * 64
        backend.collect_result = lambda: unbound
        with self.assertRaisesRegex(ContractError, "not bound to the submitted job"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        wrong_lane = evidence()
        wrong_lane["frames"][1]["actors"]["ego"]["laneId"] = -2
        backend.collect_result = lambda: wrong_lane
        with self.assertRaisesRegex(ContractError, "authoritative road/lane occupancy"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        swapped = evidence()
        swapped["frames"][1]["actors"]["ego"]["carlaActorId"] = 9999
        backend.collect_result = lambda: swapped
        with self.assertRaisesRegex(ContractError, "changed after the actor was spawned"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        backend = FakeBackend()
        swapped_signal = evidence()
        swapped_signal["frames"][1]["signals"]["head-a"]["carlaActorId"] = 9999
        backend.collect_result = lambda: swapped_signal
        with self.assertRaisesRegex(ContractError, "physical-head runtime identity"):
            execute_job(job(), XODR, OSC, CATALOG, backend)

    def test_worker_revalidation_must_agree_with_hash_closed_receipt(self):
        class DisagreeingValidator:
            def validate(self, xml_bytes):
                result = FakeValidator().validate(xml_bytes)
                result["xmlSha256"] = "f" * 64
                return result

        with self.assertRaisesRegex(ContractError, "disagrees with submitted receipt"):
            execute_job(job(), XODR, OSC, CATALOG, FakeBackend(), DisagreeingValidator())

        class RejectingValidator:
            def validate(self, xml_bytes):
                raise ContractError("worker XSD rejected XML")

        with self.assertRaisesRegex(ContractError, "worker XSD rejected"):
            execute_job(job(), XODR, OSC, CATALOG, FakeBackend(), RejectingValidator())

    def test_trusted_worker_attestation_rejects_caller_backend_identity_collusion(self):
        colluding_job = job()
        colluding_job["runtimeContract"]["workerImageDigest"] = "sha256:" + "7" * 64
        colluding_job["runtimeContract"]["workerManifestSha256"] = "6" * 64
        colluding_job["runtimeContract"]["bridgeRevision"] = "b" * 40
        colluding_job["runtimeContract"]["carlaServerVersion"] = "forged-server"
        colluding_job["payloadSha256"] = canonical_sha256(payload_for_digest(colluding_job))
        colluding_evidence = evidence(colluding_job)
        backend = FakeBackend(colluding_job)
        backend.collect_result = lambda: colluding_evidence
        with self.assertRaisesRegex(ContractError, "disagrees with trusted worker attestation"):
            execute_job(colluding_job, XODR, OSC, CATALOG, backend)

    def test_valid_trusted_worker_attestation_is_reported(self):
        value = job()
        result = execute_job(value, XODR, OSC, CATALOG, FakeBackend(value))
        self.assertEqual(result["runtimeAttestation"], FakeAttestor().attest())
        self.assertEqual(
            result["observations"]["provenance"]["workerManifestSha256"],
            result["runtimeAttestation"]["workerManifestSha256"],
        )

    def test_manifest_attestor_hashes_worker_owned_bytes_and_probes_live_runtime(self):
        manifest = b'{"workerImageDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999","bridgeRevision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = pathlib.Path(directory) / "worker-build.json"
            manifest_path.write_bytes(manifest)
            attestor = ManifestWorkerRuntimeAttestor(manifest_path, lambda: {
                "carlaServerVersion": "0.10.0-dev",
                "carlaClientVersion": "0.10.0-dev",
                "engineVersion": "UE5.5",
            })
            attestation = attestor.attest()
        self.assertEqual(attestation["workerManifestSha256"], hashlib.sha256(manifest).hexdigest())
        self.assertEqual(attestation["workerImageDigest"], "sha256:" + "9" * 64)
        self.assertEqual(attestation["carlaServerVersion"], "0.10.0-dev")

    def test_cleanup_runs_when_backend_fails(self):
        backend = FakeBackend()
        backend.tick = lambda: (_ for _ in ()).throw(RuntimeError("server exited"))
        with self.assertRaisesRegex(RuntimeError, "server exited"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))

    def test_scenario_runner_gate_requires_exact_coverage(self):
        exact = assess_scenario_runner_1_0(["actor.speed"])
        self.assertTrue(exact.allowed)
        blocked = assess_scenario_runner_1_0(["actor.lane_change", "traffic_signal.state", "unknown"])
        self.assertFalse(blocked.allowed)
        self.assertEqual(blocked.approximate, ("actor.lane_change",))
        self.assertEqual(blocked.unsupported, ("traffic_signal.state", "unknown"))


if __name__ == "__main__":
    unittest.main()
