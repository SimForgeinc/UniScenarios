"""Local command-line entry point for the optional public CARLA adapter."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Mapping

from .runtime.backend import CarlaBackend
from .runtime.contract import parse_lease
from .runtime.executor import execute_lease, filesystem_validator

DEFAULT_XSD = Path(__file__).parent / "assets" / "OpenSCENARIO.xsd"


def _probe(host: str, port: int) -> dict[str, str]:
    backend = CarlaBackend(host, port)
    try:
        return {
            "schema": "uniscenarios.carla-probe/v1",
            "clientVersion": str(getattr(backend.carla, "__version__", "unknown")),
            "serverVersion": str(backend.client.get_server_version()),
        }
    finally:
        backend.cleanup()


def _run_local(args: argparse.Namespace) -> dict[str, object]:
    lease = parse_lease(json.loads(Path(args.lease).read_text("utf-8")))
    asset_paths = {
        lease.execution_package.manifest.url: Path(args.manifest),
        lease.execution_package.xosc.url: Path(args.xosc),
        lease.execution_package.xodr.url: Path(args.xodr),
        lease.execution_package.asset_catalog.url: Path(args.asset_catalog),
    }
    traffic = lease.execution_package.ambient.get("materializedTraffic")
    if traffic is not None:
        if not args.materialized_traffic:
            raise ValueError("--materialized-traffic is required by this lease")
        asset_paths[traffic.url] = Path(args.materialized_traffic)
    for label, source in asset_paths.items():
        if not source.is_file():
            raise ValueError(f"local asset for {label!r} is not a file: {source}")

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_by_url: dict[str, Path] = {}
    for kind, reservation in lease.artifact_uploads.items():
        output_by_url[str(reservation["uploadUrl"])] = output_dir / f"{kind.replace('/', '_')}.artifact"

    def download_local(url: str, maximum: int) -> bytes:
        body = asset_paths[url].read_bytes()
        if len(body) > maximum:
            raise ValueError(f"local asset {url!r} exceeds its contract limit")
        return body

    def upload_local(url: str, body: bytes | Path, _media_type: str, _headers: Mapping[str, str] | None = None) -> None:
        target = output_by_url[url]
        target.write_bytes(body.read_bytes() if isinstance(body, Path) else body)

    def bind_local(
        _kind: str,
        _digest: str,
        _size: int,
        media_type: str,
        reservation: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        return {
            **reservation,
            "requiredHeaders": {"content-type": media_type},
        }

    result = execute_lease(
        lease,
        CarlaBackend(args.host, args.port),
        filesystem_validator(Path(args.xsd)),
        downloader=download_local,
        uploader=upload_local,
        authorize_upload=bind_local,
    )
    (output_dir / "result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", "utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(prog="uniscenarios-carla")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=2000)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("probe", help="connect without loading or mutating a CARLA world")
    run = commands.add_parser("run-lease", help="execute an immutable local render lease")
    run.add_argument("--lease", required=True)
    run.add_argument("--manifest", required=True)
    run.add_argument("--xosc", required=True)
    run.add_argument("--xodr", required=True)
    run.add_argument("--asset-catalog", required=True)
    run.add_argument("--materialized-traffic")
    run.add_argument("--xsd", default=str(DEFAULT_XSD), help="official ASAM OpenSCENARIO 1.4 XSD (bundled by default)")
    run.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    result = _probe(args.host, args.port) if args.command == "probe" else _run_local(args)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
