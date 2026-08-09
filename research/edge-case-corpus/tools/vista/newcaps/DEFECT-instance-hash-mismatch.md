# DEFECT: instance manifest.inputHash disagrees with the instance's own input (~1.5% of cells)

**Status:** OPEN, reproducible, cause not isolated. Blocks M3.2 and the corpus integrity check.

## What is wrong
For a small fraction of cells, `instance.json`'s declared `manifest.inputHash` does not equal
`sha256Json(instance.input)` computed with the repo's own canonicaliser
(`scripts/export-render-lib.mjs sha256Json`).

## Exact reproduction
```
/tmp/vista-harv-final/c4g-circulating-sudden-stop/belmont-research-center/6cc81cf207a211d1/draw-012.instance.json
  declared    9a8382f460ed0239...
  recomputed  13da6421ba0c53a9...
```
```bash
node --input-type=module -e "
import { sha256Json } from './scripts/export-render-lib.mjs'; import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.env.P,'utf8'));
console.log(sha256Json(d.input) === d.manifest.inputHash);"
```

## Measured rate
- 4 of 293 (1.4%) in the first corpus, two of them at the **same site**
- 1 of 62 (1.6%) in the regenerated corpus
- A separate but similar defect: 1 of 62 results has `traceDigest` != `sha256Json(trace)`

## What has been ruled out
- **Not a write race.** Deleting the cell's three files and re-running `batch` regenerated
  **the same mismatch at the same cell**. It is deterministic.
- **Not my canonicalisation.** The repo's own `sha256Json` reproduces it, and 61 of 62 cells in the
  same corpus match exactly.
- **Not ambient traffic per se.** A 6-cell probe on the same template and map at
  `--ambient off`, `--ambient moderate --ambient-settle 0`, and `--ambient moderate` (settle 20 s)
  produced **0 mismatches in all three configurations**.
- **Not malformed values.** The bad instance has no NaN, no Infinity, no negative zero, no >1e15
  magnitudes, and its key shape is identical to a good neighbour (`draw-011`) in the same directory.

## Why it matters beyond rendering
`gate.py` reads ticks, `dataset.py` reads metrics, `audit.py` reads both — **none recompute the
instance hash**. The 3D export path's integrity check is currently the only layer in the system that
would notice a corrupted instance. These cells passed the frozen gate, Q1-Q8 and intent verification
and shipped in the delivered dataset. `audit.py instance_hash_integrity()` now runs on every corpus so
the rate is measured rather than discovered.

## Suggested next step for whoever picks this up
The failing cell is one specific draw index at one specific site, and the neighbouring draw at the same
site is clean. That points at something in the per-draw parameter solve or the arrival solver mutating
`input` after the manifest hash is taken, on a path that only some draws reach. Instrument
`materialize`/`batch-cell` to hash `input` immediately before and immediately after the manifest is
assembled, and run the 20 draws at site `6cc81cf207a211d1` on `belmont-research-center`.
