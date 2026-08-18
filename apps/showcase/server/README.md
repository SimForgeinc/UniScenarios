# UniScenarios showcase server

From the repository root:

```sh
SHOWCASE_TOKEN=replace-me pnpm --filter @uniscenarios/showcase start
```

The server listens on `0.0.0.0:4174` by default. Set `SHOWCASE_HOST`,
`SHOWCASE_PORT`, or `SHOWCASE_DATA_DIR` to override those values. Every API and
artifact request requires either `?token=replace-me` or
`Authorization: Bearer replace-me`.

After `pnpm -r build`, the same process serves the frontend build at `/`. A
successful `?token=` page request sets a same-site, HTTP-only token cookie so
the browser can fetch hashed JS/CSS assets without placing the token in their
URLs.

Job artifacts are written beneath `showcase-data/jobs/<jobId>/`. The data
directory is intentionally not committed.

## Acceptance contract

`config/showcase-review-contract.json` is the single hashed source of truth for the review prompt,
the acceptance predicates, the defect taxonomy, and the retry policy. `server/review-contract.mjs`
and `tools/research/showcase/review_contract.py` are mirrors of it: both hash the canonical body
(sorted keys, compact separators, ASCII escapes) and must agree on the conformance vectors the
contract carries. Editing the contract requires refreshing its `sha256`, or both runtimes refuse to
load it.

Each `70-judge.json` cell carries four fields and the evidence behind them:

- `semanticAccepted` — the render shows the requested mechanism, actors, and sequence, is plausible,
  clears the realism floor and the confidence floor, and has no `scenario.*` defect.
- `presentationAccepted` — semantically accepted *and* free of `simulation.*`, `render.*`, and
  `capture.*` defects. Only this verdict yields a deliverable video, and `topK` caps it.
- `defectCodes` — attributed taxonomy codes (`scenario.*`, `simulation.*`, `render.camera.*`,
  `render.asset.*`, `capture.*`, `judge.uncertain`); `acceptance.defects` keeps the raw reviewer text
  and confidence for each one.
- `unsupportedReason` — why no verdict could be attributed (missing evidence text, low confidence,
  unattributable defect text, or a blind 2D review that cannot see the brief). Unsupported never
  passes.

`70-judge.json` also records `contract` and `cache`. The cache key binds the judgement to the
contract hash, the prompt hash, the review code hash, the request text, the model, and the review
flags; a mismatch retires the artifact into `<stage-dir>/.stale/` and re-reviews, so a judgement made
under a superseded contract can never read as current. Documents written before the split are
normalized on read, but keep a null contract identity and stay uncollectable by campaigns.
