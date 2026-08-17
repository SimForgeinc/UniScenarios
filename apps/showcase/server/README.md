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
