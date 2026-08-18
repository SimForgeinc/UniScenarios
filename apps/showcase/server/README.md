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

## Benchmark evidence

Each generation attempt writes exactly one record, `95-benchmark.json`, updated
after every stage so a crashed attempt still leaves a truthful partial record.
Every field is either measured or `null`; nothing is imputed. `GET
/api/jobs/<jobId>/benchmark` returns it.

The campaign runner folds those records into `totals.benchmark` inside
`showcase-data/campaigns/<id>/report.json`, also served by `GET
/api/campaigns/<id>/benchmark`. Read it with:

```sh
python3 tools/research/showcase/benchmark_report.py \
  --report showcase-data/campaigns/edge-cases-67x5/report.json \
  --expect-entries 67 --strict
```

That tool verifies rather than recomputes: it fails when a rate lacks its
denominator or disagrees with it, when the corpus does not account for every
entry exactly once, when the funnel is not monotone, or when benchmark evidence
violates the report contract.

Generator throughput ends at deterministic eligibility (`55-eligibility`), the
last decision made before a render is spent. Product throughput adds rendering,
review, and the deterministic `75-product` decision. The report's `execution`
block records cold-vs-warm starts, host concurrency, and the models behind the
numbers, because token and wall-time costs are comparable only within one set of
execution conditions.

Two acceptance decisions are recorded separately for every reviewed cell.
`semanticAccepted` asks whether the requested behaviour happened and is visible
in the footage; `presentationAccepted` is the strict ship decision and is the
only one that admits a video into a campaign case. Operational failures
(provider outages, renderer infrastructure, host exhaustion) censor an attempt at
the stage where they occurred: earlier stage outcomes stay in their denominators,
so an outage cannot lower a generator conversion rate.

Defect codes in the report are the review contract's own hashed vocabulary; the
benchmark module never re-attributes reviewer prose itself, because a second
taxonomy could disagree with the verdicts it summarises and the disagreement
would be invisible. `defects.taxonomy` names the contract file,
`defects.unknownCodes` lists any counted code outside it — non-empty means the
report mixes verdicts from another contract — and reviewer prose the contract
could not attribute is kept verbatim per attempt in
`outcome.unclassifiedDefects`.

Set `SHOWCASE_BENCHMARK_GPU=0` to skip `nvidia-smi` sampling; GPU cost is then
reported as `null` rather than estimated.
