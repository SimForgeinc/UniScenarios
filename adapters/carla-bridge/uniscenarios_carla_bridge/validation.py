"""Trusted local validation of OpenSCENARIO XML against the pinned ASAM XSD."""

from __future__ import annotations

import hashlib
import pathlib
import re
import subprocess
from typing import Any, Protocol

from .protocol import ContractError, OFFICIAL_OPENSCENARIO_140_XSD_SHA256

EXTERNAL_DECLARATION = re.compile(br"<!\s*(?:DOCTYPE|ENTITY)\b", re.IGNORECASE)


class OpenScenario14Validator(Protocol):
    def validate(self, xml_bytes: bytes) -> dict[str, Any]: ...


class XmllintOpenScenario14Validator:
    """Revalidate inside the worker; caller-supplied receipts are not trusted."""

    def __init__(self, xsd_path: str | pathlib.Path) -> None:
        self.xsd_path = pathlib.Path(xsd_path).resolve(strict=True)
        digest = hashlib.sha256(self.xsd_path.read_bytes()).hexdigest()
        if digest != OFFICIAL_OPENSCENARIO_140_XSD_SHA256:
            raise ContractError("worker XSD does not match the pinned official ASAM OpenSCENARIO 1.4.0 schema")

    def validate(self, xml_bytes: bytes) -> dict[str, Any]:
        xml_sha256 = hashlib.sha256(xml_bytes).hexdigest()
        if EXTERNAL_DECLARATION.search(xml_bytes):
            raise ContractError("worker OpenSCENARIO validation rejects DTD and entity declarations")
        completed = subprocess.run(
            ["xmllint", "--nonet", "--noout", "--schema", str(self.xsd_path), "-"],
            input=xml_bytes,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=False,
            timeout=30,
        )
        if completed.returncode != 0:
            diagnostics = completed.stderr.decode("utf-8", errors="replace").strip()
            raise ContractError(f"worker OpenSCENARIO 1.4 XSD validation failed: {diagnostics[:1000]}")
        return {
            "validator": "xmllint --nonet",
            "standardVersion": "1.4.0",
            "xsdSha256": OFFICIAL_OPENSCENARIO_140_XSD_SHA256,
            "xmlSha256": xml_sha256,
            "valid": True,
        }
