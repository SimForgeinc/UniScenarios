"""Worker-owned build identity and live CARLA runtime attestation."""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
from typing import Any, Callable, Protocol

from .protocol import ContractError

IMAGE_DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
REVISION = re.compile(r"^[a-f0-9]{40}$")


class WorkerRuntimeAttestor(Protocol):
    def attest(self) -> dict[str, Any]: ...


class ManifestWorkerRuntimeAttestor:
    """Combine an image-owned manifest with versions probed from live CARLA.

    The service constructs this object from a fixed, read-only image path. Job
    data never selects the manifest or the runtime probe.
    """

    def __init__(
        self,
        manifest_path: str | pathlib.Path,
        runtime_probe: Callable[[], dict[str, Any]],
    ) -> None:
        self.manifest_path = pathlib.Path(manifest_path).resolve(strict=True)
        self.manifest_bytes = self.manifest_path.read_bytes()
        self.manifest_sha256 = hashlib.sha256(self.manifest_bytes).hexdigest()
        try:
            manifest = json.loads(self.manifest_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContractError(f"invalid worker build manifest: {exc}") from exc
        if not isinstance(manifest, dict):
            raise ContractError("worker build manifest must be a JSON object")
        if not isinstance(manifest.get("workerImageDigest"), str) or not IMAGE_DIGEST.fullmatch(manifest["workerImageDigest"]):
            raise ContractError("worker build manifest has an invalid image digest")
        if not isinstance(manifest.get("bridgeRevision"), str) or not REVISION.fullmatch(manifest["bridgeRevision"]):
            raise ContractError("worker build manifest has an invalid bridge revision")
        self.manifest = manifest
        self.runtime_probe = runtime_probe

    def attest(self) -> dict[str, Any]:
        runtime = self.runtime_probe()
        if not isinstance(runtime, dict):
            raise ContractError("CARLA runtime identity probe returned no attestation")
        result = {
            "source": "worker-owned-manifest+live-carla-probe",
            "workerManifestSha256": self.manifest_sha256,
            "workerImageDigest": self.manifest["workerImageDigest"],
            "bridgeRevision": self.manifest["bridgeRevision"],
        }
        for field in ("carlaServerVersion", "carlaClientVersion", "engineVersion"):
            value = runtime.get(field)
            if not isinstance(value, str) or not value:
                raise ContractError(f"CARLA runtime identity probe omitted {field}")
            result[field] = value
        return result
