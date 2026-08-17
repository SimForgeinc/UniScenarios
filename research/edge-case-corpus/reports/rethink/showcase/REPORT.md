# SHOWCASE implementation report

### P4 — showcase frontend

Implemented a Vite + Preact single-page frontend in `apps/showcase/web/` against the frozen §5 API:

- Gallery: responsive render-card grid with headline still/looping MP4 support, brief, engine, admitted-cell, realism, dynamism, and map chips.
- Job detail: SSE connection and stage-status merge across stages 00→90, raw JSON expanders, image/video/download artifact views, Vista2 author-action filmstrip, and per-cell gate/judge verdicts.
- Submit: every §1 knob is represented and posted using the frozen field names; a successful `{jobId}` response navigates directly to the live detail view.
- Auth token from `?token=` is preserved on REST, SSE, and artifact URLs.
- A small contract-compatible mock server is available through `pnpm --filter showcase-web dev -- --mock`; it does not invent video and serves labeled stills for visual development.

Verification run on 2026-08-16:

```text
$ pnpm --filter showcase-web test
Test Files  1 passed (1)
Tests       2 passed (2)

$ pnpm --filter showcase-web build
vite v6.4.3 building for production...
✓ 9 modules transformed.
dist/index.html                  0.45 kB │ gzip:  0.29 kB
dist/assets/index-DK7YcmS9.css   8.54 kB │ gzip:  2.84 kB
dist/assets/index-BKM5YBDy.js   27.34 kB │ gzip: 10.42 kB
✓ built in 129ms
```

The production `dist/` bundle was served with `pnpm --filter showcase-web mock -- --static` and walked with `playwright-core` using `/usr/bin/google-chrome` at 1440×1000. Captures are committed in `p4-screens/`: `gallery.png`, `job-detail.png`, and `submit.png`.

Needs the real server: an end-to-end smoke against actual job-index shapes and generated image/video artifacts. The frontend uses adapters for both array- and object-shaped `stages`/`cells`, but the frozen contract does not prescribe the internal `/full` JSON schema, so this must be confirmed once P3 exposes a runnable server. The mock verifies all frozen endpoint names, POST field names, SSE event fields, navigation, and artifact rendering behavior.
