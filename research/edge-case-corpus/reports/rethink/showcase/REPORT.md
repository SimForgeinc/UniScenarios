# SHOWCASE implementation report

### P4 — showcase frontend

Implemented a Vite + Preact single-page frontend in `apps/showcase/web/` against the frozen §5 API:

- Gallery: responsive render-card grid with headline still/looping MP4 support, brief, engine, admitted-cell, realism, dynamism, and map chips.
- Job detail: SSE connection and stage-status merge across stages 00→90, raw JSON expanders, image/video/download artifact views, Vista2 author-action filmstrip, and per-cell gate/judge verdicts.
- Submit: every §1 knob is represented and posted using the frozen field names and the exact five repository map IDs; a successful `{jobId}` response navigates directly to the live detail view.
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
dist/assets/index-C8ogr-F5.js   27.62 kB │ gzip: 10.55 kB
✓ built in 143ms
```

The production `dist/` bundle was served with `pnpm --filter showcase-web mock -- --static` and walked with `playwright-core` using `/usr/bin/google-chrome` at 1440×1000. The walkthrough also submitted the form and asserted navigation to the mock server's returned job ID. Captures are committed in `p4-screens/`: `gallery.png`, `job-detail.png`, and `submit.png`.

Needs the real server: an end-to-end smoke against actual job-index shapes and generated image/video artifacts. The frontend uses adapters for both array- and object-shaped `stages`/`cells`, but the frozen contract does not prescribe the internal `/full` JSON schema, so this must be confirmed once P3 exposes a runnable server. The mock verifies all frozen endpoint names, POST field names, SSE event fields, navigation, and artifact rendering behavior.

### P2 — 3D render tier + Q3D qualification

#### Q3D milestone: qualified on real NVIDIA GPU

The frozen gate tripwire passed before qualification (manifest v1 `1a08698e95fca4bc`, v2
`3823182614e5a5ba`). Xvfb `:99`, system Chrome, and Studio were started with:

```text
Xvfb :99 -screen 0 1920x1080x24 +extension GLX +render -noreset
DISPLAY=:99 pnpm --filter @uniscenarios/studio dev --host 127.0.0.1 --port 5199
DISPLAY=:99 VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json \
  /usr/bin/time -f 'WALL_SECONDS=%e' node scripts/verify-city-renderer.mjs \
  --url 'http://127.0.0.1:5199/?map=belmont-research-center' \
  --out /tmp/q3d-angle-vulkan-belmont --min-tiles 20 \
  --settle 60000 --bench 15000 \
  --chrome-flags '--use-gl=angle,--use-angle=vulkan,--enable-features=Vulkan'
```

Verdict: **Q3D GPU qualified**. The WebGL renderer was
`ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce RTX 5080 (0x00002C02)), NVIDIA)`
(`Google Inc. (NVIDIA)`, driver 595.84). The complete Belmont city reached 20 resident tiles in
10.196 s. The 15.057 s, 1600×960 orbit benchmark rendered 212 frames at 14.080 average FPS
(p50 63.5 ms, p95 134.4 ms, minimum 5.319 FPS). The complete verifier took 48.55 s, exercised
city/vegetation visibility, orbit and fly controls, and reported zero console errors. Raw results
and five screenshots are in `p2-q3d/`.

Qualification harness fixes were necessary and are part of P2: seed Studio's required first-run
`balanced` quality preference, report the unmasked WebGL renderer and Chrome flags, allow a
map-appropriate resident-tile threshold, choose a street camera from the current map's longest
lane, and exercise current viewer layer groups instead of removed UI test IDs.

The default Yale qualification could not be used honestly: its local manifest references 132 LOD
files, but 111 are absent from `dev-assets/yale-street/3d/tiles/`; requests returned Vite's HTML
fallback and the old verifier timed out. The other four map bundles have all manifest-referenced LOD
files. Belmont was selected because its bundle is complete. Baseline Chrome without ANGLE Vulkan
reported `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)` and timed out at the old
30-tile gate; it is not the qualified configuration.
