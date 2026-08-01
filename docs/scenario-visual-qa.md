# UniScenarios scenario visual QA

This pipeline turns one concrete scenario instance and its exact simulation
trace into reviewable incident evidence. It does not treat map screenshots,
editor screenshots, orbit videos, load tests, or renderer stress tests as
scenario evidence.

## Evidence lifecycle

1. The trace-only preflight verifies that four distinct recorded ticks exist
   for `pre-reveal`, `reveal`, `conflict`, and `aftermath`, and that both
   incident actors remain present in the aftermath. A failed preflight writes
   `preflight.json`, exits non-zero, and does not render frames or video.
2. A passing preflight drives the real Studio renderer. It writes four named
   PNGs, a continuous H.264 MP4, source snapshots, and a deterministic
   `manifest.json` containing every actor pose, catalog model, camera, viewport,
   composition result, topology digest, input hash, trace digest, and artifact
   hash.
3. Machine gates reject missing/duplicate frames, wrong phase times, incomplete
   actor poses, absent aftermath actors, bad composition, camera intersections,
   missing MP4s, incomplete video coverage, topology provenance gaps, or browser
   errors. Rejected output never counts toward coverage.
4. A passing machine manifest is still only `pending-human-review`. Generate a
   review template and inspect the exact four PNG hashes and MP4 hash. Only an
   `accepted` review with all five artifacts marked observed can enter the
   scenario review ledger with `countsTowardScenarioCoverage: true`.

## Commands

```bash
pnpm render:export -- \
  --url http://127.0.0.1:5199 \
  --instance path/to/instance.json \
  --trace path/to/trace.json.gz \
  --out path/to/render-evidence \
  --headless --fps 12

pnpm render:review -- \
  --manifest path/to/render-evidence/manifest.json \
  --template path/to/render-evidence/review.json

# After a reviewer fills reviewer, completedAt, verdict, notes, and marks the
# exact frame/video records observed:
pnpm render:review -- \
  --manifest path/to/render-evidence/manifest.json \
  --review path/to/render-evidence/review.json \
  --ledger artifacts/qa/scenario-visual-review-ledger.json
```

The ledger updater rejects a changed manifest, changed frame/video hash,
unobserved artifact, machine-rejected render, map-orbit render, and stress/smoke
render. A pending or rejected review always counts as zero accepted incidents.

## Current Yale checkpoint

The four existing Yale bus-stop key frames and representative beginning,
middle, and tail video frames were visually inspected. The scene and motion are
tangible, but the pedestrian disappears on the tick immediately after conflict
(`6.90 s` present, `6.92 s` absent). The old aftermath therefore depicts a
teleport, not aftermath. The strict preflight rejects this instance before GPU
rendering, and the written inspection records zero coverage credit in
`artifacts/qa/golden-yale-bus-stop-20260801-corrected/visual-inspection.json`.

The same inspection also found simultaneously bright red/yellow/green signal
lamp geometry and prototype-grade scene assets. Until dynamic signal state and
the incident-actor lifetime are corrected, this checkpoint is useful renderer
diagnostic evidence but is not a visually accepted realistic scenario.
