"""Fail-closed contracts for the optional UniScenarios CARLA adapter."""

from .capabilities import BRIDGE_CAPABILITIES, Capability, assess_scenario_runner_1_0
from .protocol import ContractError, canonical_sha256, derive_payload_semantics, payload_for_digest, validate_job, validate_resolved_actor_ids
from .runner import CarlaBackend, execute_job

__all__ = [
    "BRIDGE_CAPABILITIES",
    "Capability",
    "CarlaBackend",
    "ContractError",
    "canonical_sha256",
    "derive_payload_semantics",
    "assess_scenario_runner_1_0",
    "execute_job",
    "payload_for_digest",
    "validate_job",
    "validate_resolved_actor_ids",
]
