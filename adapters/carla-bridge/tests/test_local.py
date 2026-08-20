from __future__ import annotations

import hashlib

import pytest

from uniscenarios_carla_bridge import local
from uniscenarios_carla_bridge.runtime.contract import OFFICIAL_XSD_SHA256


def test_default_schema_is_bundled_and_digest_pinned() -> None:
    assert local.DEFAULT_XSD.is_file()
    assert hashlib.sha256(local.DEFAULT_XSD.read_bytes()).hexdigest() == OFFICIAL_XSD_SHA256


def test_probe_is_read_only_and_always_cleans_up(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[object] = []

    class Client:
        def get_server_version(self) -> str:
            calls.append("server-version")
            return "0.10.0-test"

    class Backend:
        carla = type("Carla", (), {"__version__": "0.10.0-client"})()
        client = Client()

        def __init__(self, host: str, port: int) -> None:
            calls.append((host, port))

        def cleanup(self) -> None:
            calls.append("cleanup")

    monkeypatch.setattr(local, "CarlaBackend", Backend)
    assert local._probe("carla.test", 2000) == {
        "schema": "uniscenarios.carla-probe/v2",
        "clientVersion": "0.10.0-client",
        "serverVersion": "0.10.0-test",
        "maxSimultaneousSensors": 64,
        "nativeSensors": local.native_sensor_capabilities(),
    }
    assert calls == [("carla.test", 2000), "server-version", "cleanup"]


def test_probe_cleans_up_when_server_version_probe_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    cleaned: list[bool] = []

    class Backend:
        carla = object()
        client = type("Client", (), {"get_server_version": lambda _self: (_ for _ in ()).throw(RuntimeError("offline"))})()

        def __init__(self, _host: str, _port: int) -> None:
            pass

        def cleanup(self) -> None:
            cleaned.append(True)

    monkeypatch.setattr(local, "CarlaBackend", Backend)
    with pytest.raises(RuntimeError, match="offline"):
        local._probe("carla.test", 2000)
    assert cleaned == [True]
