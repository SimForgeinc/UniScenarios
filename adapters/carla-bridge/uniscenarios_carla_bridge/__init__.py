"""Fail-closed contracts for the optional UniScenarios CARLA adapter."""

from .capabilities import BRIDGE_CAPABILITIES, Capability, assess_scenario_runner_1_0
from .protocol import ContractError, validate_job
from .runner import CarlaBackend, execute_trace_job

__all__ = [
    "BRIDGE_CAPABILITIES",
    "Capability",
    "CarlaBackend",
    "ContractError",
    "assess_scenario_runner_1_0",
    "execute_trace_job",
    "validate_job",
]
