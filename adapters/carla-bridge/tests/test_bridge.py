import hashlib
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from uniscenarios_carla_bridge import ContractError, assess_scenario_runner_1_0, execute_trace_job


XODR = b"<OpenDRIVE/>"


def job():
    return {
        "schema": "uniscenarios.carla-trace-job/v1",
        "mapXodrSha256": hashlib.sha256(XODR).hexdigest(),
        "fixedTimestepS": 0.02,
        "actorBindings": {"ego": "vehicle.tesla.model3"},
        "signalBindings": {"head-a": "odr-signal-42"},
        "requiredSemantics": ["actor.lifecycle", "actor.trajectory", "traffic_signal.state", "collision.observe", "custom.map.opendrive"],
        "frames": [
            {"index": 0, "t": 0, "actors": {"ego": {"lifecycle": "spawn", "x": 1, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3}}, "signals": {"head-a": "red"}},
            {"index": 1, "t": 0.02, "actors": {"ego": {"lifecycle": "active", "x": 1.06, "y": 2, "z": 0, "headingDeg": 90, "speedMps": 3}}, "signals": {"head-a": "green"}},
        ],
    }


class FakeBackend:
    def __init__(self): self.calls = []
    def configure_synchronous(self, step): self.calls.append(("sync", step))
    def load_opendrive(self, data): self.calls.append(("map", data))
    def resolved_actor_binding_ids(self): return ["vehicle.tesla.model3"]
    def resolved_signal_opendrive_ids(self): return ["odr-signal-42"]
    def freeze_traffic_lights(self): self.calls.append(("freeze",))
    def apply_frame(self, frame, actors, signals): self.calls.append(("frame", frame["index"]))
    def tick(self): return len([call for call in self.calls if call[0] == "frame"])
    def collect_result(self): return {"collisions": []}
    def cleanup(self): self.calls.append(("cleanup",))


class BridgeTests(unittest.TestCase):
    def test_executes_one_backend_tick_per_authoritative_frame(self):
        backend = FakeBackend()
        result = execute_trace_job(job(), XODR, backend)
        self.assertEqual(result["renderedFrames"], [1, 2])
        self.assertEqual([call[0] for call in backend.calls], ["map", "sync", "freeze", "frame", "frame", "cleanup"])

    def test_rejects_stale_map_and_ambiguous_signal_binding(self):
        with self.assertRaisesRegex(ContractError, "stale map binding"):
            execute_trace_job(job(), b"different", FakeBackend())
        backend = FakeBackend()
        backend.resolved_signal_opendrive_ids = lambda: ["odr-signal-42", "odr-signal-42"]
        with self.assertRaisesRegex(ContractError, "resolved 2 times"):
            execute_trace_job(job(), XODR, backend)

    def test_rejects_unknown_semantics_and_non_contiguous_time(self):
        unknown = job()
        unknown["requiredSemantics"].append("made.up.semantic")
        with self.assertRaisesRegex(ContractError, "unsupported by CARLA bridge"):
            execute_trace_job(unknown, XODR, FakeBackend())
        mistimed = job()
        mistimed["frames"][1]["t"] = 0.03
        with self.assertRaisesRegex(ContractError, r"index \* fixedTimestepS"):
            execute_trace_job(mistimed, XODR, FakeBackend())

    def test_requires_closed_frames_and_non_repeating_lifecycle(self):
        missing_signal = job()
        missing_signal["frames"][1]["signals"] = {}
        with self.assertRaisesRegex(ContractError, "exact signal binding closure"):
            execute_trace_job(missing_signal, XODR, FakeBackend())
        repeated_spawn = job()
        repeated_spawn["frames"][1]["actors"]["ego"]["lifecycle"] = "spawn"
        with self.assertRaisesRegex(ContractError, "spawn may occur exactly once"):
            execute_trace_job(repeated_spawn, XODR, FakeBackend())

    def test_requires_derived_semantics_and_exact_actor_resolution(self):
        missing = job()
        missing["requiredSemantics"].remove("traffic_signal.state")
        with self.assertRaisesRegex(ContractError, "missing semantics derived"):
            execute_trace_job(missing, XODR, FakeBackend())
        backend = FakeBackend()
        backend.resolved_actor_binding_ids = lambda: []
        with self.assertRaisesRegex(ContractError, "resolved 0 times"):
            execute_trace_job(job(), XODR, backend)
        self.assertEqual(backend.calls[-1], ("cleanup",))

    def test_cleans_up_after_backend_failure(self):
        backend = FakeBackend()
        backend.tick = lambda: (_ for _ in ()).throw(RuntimeError("tick failed"))
        with self.assertRaisesRegex(RuntimeError, "tick failed"):
            execute_trace_job(job(), XODR, backend)
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
