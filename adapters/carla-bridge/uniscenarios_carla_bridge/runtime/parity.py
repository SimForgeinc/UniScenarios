from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping

from .compiler import LIFECYCLE_ABSENT, PlanFrame


@dataclass(frozen=True)
class ParityReport:
    accepted: bool
    samples: int
    max_error: Mapping[str, float]
    violation_counts: Mapping[str, int]


class ParityAccumulator:
    def __init__(self, thresholds: Mapping[str, float]):
        self.thresholds = {"positionM": 0.25, "headingDeg": 2.0, "speedMps": 0.25, **thresholds}
        self.max_error = {key: 0.0 for key in self.thresholds}
        self.violations = {key: 0 for key in self.thresholds}
        self.samples = 0

    def observe(self, expected: PlanFrame, actual: Mapping[str, Mapping[str, float]]) -> None:
        if set(actual) != set(expected.actors):
            raise RuntimeError("CARLA readback actor closure differs from the execution plan")
        for actor_id, target in expected.actors.items():
            # A despawned actor is parked off-scene on purpose; its readback is
            # deliberately not the authored pose and is not a parity sample.
            if target.lifecycle == LIFECYCLE_ABSENT:
                continue
            value = actual[actor_id]
            errors = {
                "positionM": math.sqrt((target.x - value["x"]) ** 2 + (target.y - value["y"]) ** 2 + (target.z - value["z"]) ** 2),
                "headingDeg": abs((target.heading_deg - value["headingDeg"] + 180) % 360 - 180),
                "speedMps": abs(target.speed_mps - value["speedMps"]),
            }
            for key, error in errors.items():
                self.max_error[key] = max(self.max_error[key], error)
                self.violations[key] += int(error > self.thresholds[key])
            self.samples += 1

    def report(self) -> ParityReport:
        return ParityReport(not any(self.violations.values()), self.samples, self.max_error, self.violations)

