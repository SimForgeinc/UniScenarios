import copy
import hashlib
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from uniscenarios_carla_bridge import (
    ContractError,
    assess_scenario_runner_1_0,
    canonical_sha256,
    execute_job,
    payload_for_digest,
)


XODR = b"<OpenDRIVE/>"
OSC = b'<OpenSCENARIO><FileHeader revMajor="1" revMinor="4"/></OpenSCENARIO>'
CATALOG = b'{"passenger-car":{"blueprintId":"vehicle.tesla.model3","kind":"vehicle"}}'


def job(mode="authoritative-trace"):
    value = {
        "schema": "uniscenarios.carla-job/v2",
        "executionMode": mode,
        "map": {
            "name": "Town10HD_Opt",
            "xodrSha256": hashlib.sha256(XODR).hexdigest(),
            "controlDigest": "1" * 64,
        },
        "openScenario": {
            "sha256": hashlib.sha256(OSC).hexdigest(),
            "xsdValidation": {"standardVersion": "1.4.0", "schemaSha256": "2" * 64, "valid": True},
        },
        "fixedTimestepS": 0.02,
        "assetCatalogSha256": hashlib.sha256(CATALOG).hexdigest(),
        "actorBindings": {"ego": {"catalogRef": "passenger-car", "blueprintId": "vehicle.tesla.model3", "kind": "vehicle"}},
        "signalBindings": {"head-a": "odr-signal-42"},
        "requiredSemantics": ["actor.lifecycle", "actor.trajectory", "collision.observe", "custom.map.opendrive", "traffic_signal.state"],
        "frames": [
            {"index": 0, "t": 0, "actors": {"ego": {"lifecycle": "spawn", "x": 1, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3}}, "signals": {"head-a": "red"}},
            {"index": 1, "t": 0.02, "actors": {"ego": {"lifecycle": "active", "x": 1.06, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3}}, "signals": {"head-a": "green"}},
        ],
    }
    if mode == "native-dynamics":
        value["requiredSemantics"] = ["actor.lifecycle", "actor.native_controls", "collision.observe", "custom.map.opendrive", "traffic_signal.state"]
        value["frames"][0]["controls"] = {"ego": {"throttle": 0.4, "brake": 0, "steer": 0}}
        value["frames"][1]["controls"] = {"ego": {"throttle": 0.3, "brake": 0, "steer": 0.1}}
    value["payloadSha256"] = canonical_sha256(payload_for_digest(value))
    return value


class FakeBackend:
    def __init__(self): self.calls = []
    def configure_synchronous(self, step): self.calls.append(("sync", step))
    def load_map(self, name, data): self.calls.append(("map", name, data))
    def resolve_bindings(self, actors, signals): self.calls.append(("actors", sorted(actors), sorted(signals)))
    def resolved_actor_ids(self): return ["ego"]
    def resolved_signal_opendrive_ids(self): return ["odr-signal-42"]
    def freeze_traffic_lights(self): self.calls.append(("freeze",))
    def apply_authoritative_frame(self, frame, signals): self.calls.append(("trace", frame["index"]))
    def apply_native_frame(self, frame, signals): self.calls.append(("native", frame["index"]))
    def tick(self): return len([call for call in self.calls if call[0] in {"trace", "native"}])
    def collect_result(self): return {"frames": [{}, {}], "collisions": [], "provenance": {"backend": "fake"}}
    def cleanup(self): self.calls.append(("cleanup",))


class BridgeTests(unittest.TestCase):
    def test_executes_one_tick_per_authoritative_frame(self):
        backend = FakeBackend()
        result = execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(result["renderedFrames"], [1, 2])
        self.assertEqual([call[0] for call in backend.calls], ["map", "sync", "actors", "freeze", "trace", "trace", "cleanup"])

    def test_native_mode_dispatches_controls(self):
        backend = FakeBackend()
        result = execute_job(job("native-dynamics"), XODR, OSC, CATALOG, backend)
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
        backend.resolved_signal_opendrive_ids = lambda: ["odr-signal-42", "odr-signal-42"]
        with self.assertRaisesRegex(ContractError, "resolved 2 times"):
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
        backend.resolved_actor_ids = lambda: []
        with self.assertRaisesRegex(ContractError, "resolved 0 times"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))
        backend = FakeBackend()
        backend.tick = lambda: 1
        with self.assertRaisesRegex(ContractError, "strictly increasing"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))

    def test_rejects_unrepresented_semantics_and_missing_evidence(self):
        unrepresented = job()
        unrepresented["requiredSemantics"].append("camera.rgb")
        unrepresented["payloadSha256"] = canonical_sha256(payload_for_digest(unrepresented))
        with self.assertRaisesRegex(ContractError, "not represented"):
            execute_job(unrepresented, XODR, OSC, CATALOG, FakeBackend())
        backend = FakeBackend()
        backend.collect_result = lambda: {"frames": [{}, {}], "collisions": []}
        with self.assertRaisesRegex(ContractError, "provenance"):
            execute_job(job(), XODR, OSC, CATALOG, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))

    def test_xsd_receipt_is_hash_closed_and_mandatory(self):
        invalid = copy.deepcopy(job())
        invalid["openScenario"]["xsdValidation"]["valid"] = False
        with self.assertRaisesRegex(ContractError, "passing receipt"):
            execute_job(invalid, XODR, OSC, CATALOG, FakeBackend())

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
