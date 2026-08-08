#!/usr/bin/env python3
"""
WS-3 3D video renderer for the UniScenarios-vista edge-case corpus.

Renders each corpus scenario as an H.264 MP4 *from the real UniScenarios 3D
world* (apps/studio + city-renderer, three.js) by driving the Studio dev server
in Chrome through scripts/export-render.mjs (playwright-core).

It does not reimplement any renderer. It is a batch driver:
  * resolves instance/trace/result triplets from a dataset .jsonl (or a scan of
    /tmp/vista-harv-deliver),
  * runs scripts/export-render.mjs --evidence-class corpus once per scenario,
  * reads the manifest each run writes and records its integrity verdict,
  * writes/updates INDEX.json incrementally after every scenario so a killed
    run keeps everything it already produced.

PREREQUISITE - the Studio dev server must already be running, started ONCE:
    pnpm --filter @uniscenarios/studio dev --host 127.0.0.1 --port 5199

Usage:
    python3 render3d.py --records /tmp/vista-dataset-all/train.jsonl \
                        --records /tmp/vista-dataset-all/test.jsonl \
                        --out /tmp/vista-3d --concurrency 4

    python3 render3d.py --instance <path>.instance.json --out /tmp/vista-3d

INDEX.json shape (matches what audit.py consumes):
    {"generatedAt":..., "records":[{"scenarioId","mp4","integrity":{...}}, ...]}
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
EXPORTER = REPO / "scripts" / "export-render.mjs"
DEFAULT_URL = "http://127.0.0.1:5199"

_index_lock = threading.Lock()


# --------------------------------------------------------------------------- inputs
def load_records(record_files: list[Path], scan_root: Path | None) -> list[dict]:
    """Dataset .jsonl records win; a directory scan is the fallback."""
    out: list[dict] = []
    seen: set[str] = set()
    for file in record_files:
        with file.open() as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                key = rec["scenarioId"]
                if key in seen:
                    continue
                seen.add(key)
                out.append({
                    "scenarioId": key,
                    "archetypeId": rec.get("archetypeId"),
                    "mapId": rec.get("mapId"),
                    "siteId": rec.get("siteId"),
                    "split": file.stem,
                    "instance": rec["instance"],
                })
    if scan_root is not None:
        for instance in sorted(scan_root.rglob("draw-*.instance.json")):
            parts = instance.relative_to(scan_root).parts
            key = f"{parts[2]}#{instance.name.split('.')[0].split('-')[1]}"
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "scenarioId": key,
                "archetypeId": parts[0],
                "mapId": parts[1],
                "siteId": parts[2],
                "split": "scan",
                "instance": str(instance),
            })
    return out


def triplet(instance: str) -> tuple[Path, Path, Path]:
    base = str(instance)[: -len(".instance.json")]
    return Path(instance), Path(base + ".trace.json.gz"), Path(base + ".result.json")


# --------------------------------------------------------------------------- render
def render_one(rec: dict, out_root: Path, url: str, quality: str, fps: int,
               width: int, height: int, timeout_s: int, force: bool) -> dict:
    instance, trace, result = triplet(rec["instance"])
    scenario_out = out_root / rec["scenarioId"]
    manifest_file = scenario_out / "manifest.json"
    log_file = out_root / "_logs" / f"{rec['scenarioId']}.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    entry = {
        "scenarioId": rec["scenarioId"],
        "archetypeId": rec.get("archetypeId"),
        "mapId": rec.get("mapId"),
        "siteId": rec.get("siteId"),
        "split": rec.get("split"),
        "instance": str(instance),
        "mp4": None,
        "manifest": None,
        "integrity": None,
        "status": "pending",
        "error": None,
        "seconds": None,
    }

    for path in (instance, trace, result):
        if not path.exists():
            entry.update(status="missing-input", error=f"missing {path}")
            return entry

    if manifest_file.exists() and not force:
        return finalise(entry, manifest_file, scenario_out, 0.0)

    shutil.rmtree(scenario_out, ignore_errors=True)
    cmd = [
        "node", str(EXPORTER),
        "--url", url,
        "--instance", str(instance),
        "--trace", str(trace),
        "--result", str(result),
        "--out", str(scenario_out),
        "--headless",
        "--fps", str(fps),
        "--width", str(width),
        "--height", str(height),
        "--evidence-class", "corpus",
        "--quality", quality,
        "--pin-page",
        "--progress",
    ]
    started = time.time()
    with log_file.open("w") as log:
        log.write(" ".join(cmd) + "\n")
        log.flush()
        try:
            proc = subprocess.run(cmd, cwd=REPO, stdout=log, stderr=subprocess.STDOUT,
                                  timeout=timeout_s)
            code = proc.returncode
        except subprocess.TimeoutExpired:
            entry.update(status="timeout", error=f"exporter exceeded {timeout_s}s",
                         seconds=round(time.time() - started, 2))
            return entry
    elapsed = round(time.time() - started, 2)
    if code != 0 or not manifest_file.exists():
        tail = log_file.read_text()[-1500:]
        entry.update(status="render-failed", error=f"exit {code}: ...{tail[-400:]}", seconds=elapsed)
        return entry
    return finalise(entry, manifest_file, scenario_out, elapsed)


def finalise(entry: dict, manifest_file: Path, scenario_out: Path, elapsed: float) -> dict:
    manifest = json.loads(manifest_file.read_text())
    integrity = dict(manifest.get("integrity") or {})
    assessment = manifest.get("machineAssessment") or {}
    video = manifest.get("video") or {}
    mp4 = scenario_out / video.get("file", "video.mp4")
    integrity.update({
        # audit.py accepts either spelling for the instance/trace hash gates.
        "instanceHashMatches": integrity.get("instanceInputHashMatches"),
        "manifestInputHashMatches": integrity.get("instanceInputHashMatches"),
        "traceHashMatches": integrity.get("traceInputHashMatches"),
        "machineVerdict": assessment.get("verdict"),
        "failedGates": [g["id"] for g in assessment.get("gates", []) if g.get("status") != "pass"],
        "manifestScenarioId": manifest.get("scenarioId"),
        "inputHash": manifest.get("inputHash"),
        "traceDigest": manifest.get("traceDigest"),
        "videoSha256": video.get("sha256"),
        "videoFrameCount": video.get("frameCount"),
        "videoFps": video.get("fps"),
        "videoDurationSeconds": video.get("durationSeconds"),
        "resultBinding": (manifest.get("resultBinding") or {}).get("mode"),
    })
    passed = (
        integrity.get("instanceInputHashMatches") is True
        and integrity.get("traceInputHashMatches") is True
        and integrity.get("mapIdsExactMatch") is True
        and integrity.get("actorIdsExactMatch") is True
        and assessment.get("verdict") == "pass"
        and mp4.exists()
    )
    integrity["pass"] = passed
    entry.update({
        "mp4": str(mp4) if mp4.exists() else None,
        "manifest": str(manifest_file),
        "integrity": integrity,
        "status": "ok" if passed else "integrity-failed",
        "seconds": elapsed,
    })
    return entry


# --------------------------------------------------------------------------- index
def write_index(index_file: Path, entries: dict, meta: dict) -> None:
    """INDEX.json is a bare JSON ARRAY of entries.

    audit.py does `ent = json.load(open(idx))` then `for e in ent`, so a
    top-level object would silently iterate its keys and report zero coverage.
    Run metadata therefore goes to INDEX-meta.json next to it.
    """
    records = [entries[k] for k in sorted(entries)]
    ok = [r for r in records if r["status"] == "ok"]
    tmp = index_file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(records, indent=2) + "\n")
    tmp.replace(index_file)

    meta_file = index_file.parent / "INDEX-meta.json"
    durations = sorted(r["seconds"] for r in ok if r["seconds"])
    meta_tmp = meta_file.with_suffix(".json.tmp")
    meta_tmp.write_text(json.dumps({
        "schema": "uniscenarios.vista.3d-video-index-meta.v1",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "renderer": "apps/studio 3D world (city-renderer/three.js) via scripts/export-render.mjs",
        **meta,
        "summary": {
            "total": len(records),
            "ok": len(ok),
            "failed": len(records) - len(ok),
            "medianSecondsPerScenario": durations[len(durations) // 2] if durations else None,
        },
    }, indent=2) + "\n")
    meta_tmp.replace(meta_file)


# --------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--records", action="append", type=Path, default=[],
                    help="dataset .jsonl (repeatable); e.g. /tmp/vista-dataset-all/train.jsonl")
    ap.add_argument("--scan", type=Path, default=None,
                    help="fallback: scan a harvest root for draw-*.instance.json")
    ap.add_argument("--instance", type=Path, default=None, help="render a single instance.json")
    ap.add_argument("--out", type=Path, default=Path("/tmp/vista-3d"))
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--quality", default="minimal",
                    help="studio render-quality preset seeded into localStorage (default: minimal)")
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--width", type=int, default=1600, help="browser viewport width")
    ap.add_argument("--height", type=int, default=960, help="browser viewport height")
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=900, help="per-scenario exporter timeout (s)")
    ap.add_argument("--force", action="store_true", help="re-render even if manifest.json exists")
    args = ap.parse_args()

    if args.instance:
        records = [{"scenarioId": args.instance.parent.name + "#" + args.instance.name.split(".")[0],
                    "archetypeId": None, "mapId": None, "siteId": args.instance.parent.name,
                    "split": "single", "instance": str(args.instance)}]
    else:
        records = load_records(args.records, args.scan)
    if args.limit:
        records = records[: args.limit]
    if not records:
        print("no scenarios selected", file=sys.stderr)
        return 2

    args.out.mkdir(parents=True, exist_ok=True)
    index_file = args.out / "INDEX.json"
    entries: dict[str, dict] = {}
    meta = {
        "url": args.url,
        "quality": args.quality,
        "fps": args.fps,
        "viewport": {"width": args.width, "height": args.height},
        "concurrency": args.concurrency,
    }
    started = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {
            pool.submit(render_one, rec, args.out, args.url, args.quality, args.fps,
                        args.width, args.height, args.timeout, args.force): rec
            for rec in records
        }
        for future in as_completed(futures):
            rec = futures[future]
            try:
                entry = future.result()
            except Exception as exc:  # noqa: BLE001 - a driver crash must not lose the index
                entry = {"scenarioId": rec["scenarioId"], "status": "driver-error",
                         "error": repr(exc), "mp4": None, "integrity": None, "seconds": None}
            done += 1
            with _index_lock:
                entries[entry["scenarioId"]] = entry
                meta["wallSecondsSoFar"] = round(time.time() - started, 1)
                meta["secondsPerScenarioWallClock"] = round((time.time() - started) / done, 2)
                write_index(index_file, entries, meta)
            print(f"[{done}/{len(records)}] {entry['scenarioId']} {entry['status']} "
                  f"{entry.get('seconds')}s", flush=True)

    wall = time.time() - started
    ok = sum(1 for e in entries.values() if e["status"] == "ok")
    print(json.dumps({
        "index": str(index_file),
        "total": len(entries),
        "ok": ok,
        "wallSeconds": round(wall, 1),
        "secondsPerScenarioWallClock": round(wall / max(1, len(entries)), 2),
        "concurrency": args.concurrency,
        "rendersPerHour": round(3600.0 / (wall / max(1, len(entries))), 1),
    }, indent=2))
    return 0 if ok == len(entries) else 1


if __name__ == "__main__":
    raise SystemExit(main())
