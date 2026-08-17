#!/usr/bin/env python3
"""Resumable showcase wrapper around the frozen FootageLane judge configuration."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time


ROOT = Path(__file__).resolve().parents[3]
FOOTAGE = ROOT / "tools/research/footage"
sys.path.insert(0, str(FOOTAGE))
import futil  # noqa: E402
import judge  # noqa: E402

MODEL = "gpt-5.6-sol"
EFFORT = "medium"
STRATEGY = "spread8"


def _write(path: Path, doc: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")
    tmp.replace(path)


def run(cells_root: Path, out: Path) -> tuple[dict, int]:
    cells = ([str(cells_root)] if futil.is_cell_dir(str(cells_root))
             else futil.discover_cells(str(cells_root)))
    if not cells:
        raise ValueError(f"no contract cell directories under {cells_root}")
    doc = {"config": {"model": MODEL, "effort": EFFORT, "strategy": STRATEGY,
                      "visionRequired": True, "redactedRequired": True},
           "cellsRoot": str(cells_root.resolve()), "verdicts": [], "errors": []}
    if out.is_file():
        old = json.loads(out.read_text())
        if old.get("config") != doc["config"]:
            raise ValueError(f"{out}: existing output uses a different frozen config")
        doc["verdicts"] = old.get("verdicts", [])
        doc["errors"] = old.get("errors", [])
    done = {v["cellId"] for v in doc["verdicts"]}
    errors = {e["cellId"]: e for e in doc["errors"]}
    failed = 0
    for cell in cells:
        meta = futil.load_json(os.path.join(cell, "meta.json"))
        cell_id = meta["cellId"]
        if cell_id in done:
            print(f"cached {cell_id}", flush=True)
            continue
        started = time.time()
        try:
            verdict = judge.judge_cell(cell, MODEL, EFFORT, STRATEGY,
                                       require_redacted=True)
            doc["verdicts"].append(verdict)
            errors.pop(cell_id, None)
            print(f"judged {cell_id} realism={verdict['realism']} "
                  f"dynamism={verdict['dynamism']}", flush=True)
        except Exception as exc:  # preserve completed calls for a later resume
            failed += 1
            errors[cell_id] = {"cellId": cell_id, "error": str(exc)[:1000],
                               "wallS": round(time.time() - started, 3)}
            print(f"ERROR {cell_id}: {exc}", file=sys.stderr, flush=True)
        doc["errors"] = sorted(errors.values(), key=lambda item: item["cellId"])
        doc["verdicts"].sort(key=lambda item: item["cellId"])
        doc["summary"] = {"discovered": len(cells), "completed": len(doc["verdicts"]),
                          "errors": len(doc["errors"])}
        out.parent.mkdir(parents=True, exist_ok=True)
        _write(out, doc)
    return doc, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cells", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    os.environ.setdefault("OPENAI_BASE_URL", "http://127.0.0.1:4141/v1")
    os.environ.setdefault("OPENAI_API_KEY", "x")
    doc, failed = run(Path(args.cells), Path(args.out))
    print(json.dumps(doc["summary"], indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
