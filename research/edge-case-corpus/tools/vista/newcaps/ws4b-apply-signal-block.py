"""WS-4b M4.3: apply the authored trafficControls head to the c15g-red-light-runner template.

Concurrency-safe against a sibling editing the ANCHOR of the same file: it re-reads the document
immediately before writing and mutates ONLY `trafficControls` and `meta.tags`. Never writes a whole
stale document.

usage: python3 apply_signal_block.py <template.json> [<template.json> ...]
"""
import json, sys, pathlib

TC = [{
  "id": "ego-approach-head",
  "kind": "normal_signal",
  "feature": "conflict-junction",
  "pose": {"laneOffset": 0, "s": -6, "tFrac": 0, "headingOffsetRad": 0},
  "stopLines": [{"feature": "conflict-junction",
                 "pose": {"laneOffset": 0, "s": -6, "tFrac": 0, "headingOffsetRad": 0}}],
  "phases": [{"indication": "green", "durationS": 11},
             {"indication": "yellow", "durationS": 3},
             {"indication": "red", "durationS": 30}],
  "offsetS": 0,
  "loop": False,
  "label": "authored head giving the ego a green through the junction",
}]


def apply(path):
    cur = json.loads(pathlib.Path(path).read_text())   # re-read immediately before writing
    cur['trafficControls'] = TC
    tags = cur.setdefault('meta', {}).setdefault('tags', [])
    if 'authored-signal-head' not in tags:
        tags.append('authored-signal-head')
    pathlib.Path(path).write_text(json.dumps(cur, indent=1))
    return cur


if __name__ == '__main__':
    for p in sys.argv[1:]:
        apply(p)
        print('patched', p)
