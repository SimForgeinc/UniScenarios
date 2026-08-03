"""Fail-closed contracts for the optional UniScenarios CARLA adapter."""

from .capabilities import BRIDGE_CAPABILITIES, Capability, assess_scenario_runner_1_0
from .protocol import ContractError, canonical_sha256, derive_payload_semantics, payload_for_digest, validate_job, validate_resolved_actor_bindings, validate_resolved_signal_bindings
from .runner import CarlaBackend, execute_job
from .validation import OpenScenario14Validator, XmllintOpenScenario14Validator

__all__ = [
    "BRIDGE_CAPABILITIES",
    "Capability",
    "CarlaBackend",
    "ContractError",
    "OpenScenario14Validator",
    "XmllintOpenScenario14Validator",
    "canonical_sha256",
    "derive_payload_semantics",
    "assess_scenario_runner_1_0",
    "execute_job",
    "payload_for_digest",
    "validate_job",
    "validate_resolved_actor_bindings",
    "validate_resolved_signal_bindings",
]
